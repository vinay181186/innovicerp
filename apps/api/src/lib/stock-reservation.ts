// Stock reservation — the ONE place the three stock numbers are computed and
// the only place a reservation row is written (ADR-180, migration 0141).
//
//   PHYSICAL  = item_stock_balances.on_hand_qty   — what is on the shelf
//   RESERVED  = Σ (qty − consumed_qty − released_qty) of rows still holding
//   AVAILABLE = PHYSICAL − RESERVED
//
// A reservation NEVER writes to store_transactions. Physical stock moves only
// when something really leaves: a dispatch, a store issue. This replaces the
// Stage-1 "hard move" of migration 0099, which debited the ledger at reserve
// time and made the shelf figure lie.
//
// Concurrency: every function that changes a booking takes the item row with
// SELECT ... FOR UPDATE first, then re-reads availability inside that lock, so
// two planners reserving the same free stock serialize and the second one sees
// the first one's booking. Frontend checks are never the guard.
//
// Idempotency: the API-wide Idempotency-Key plugin stops a retried HTTP call
// from posting twice; on top of that an automatic booking carries
// production_order_close_id, which is UNIQUE while live, so replaying a close
// cannot book the same pieces again.

import { itemRevLabel, type ReservationSource } from '@innovic/shared';
import { and, eq, isNull, sql } from 'drizzle-orm';
import {
  customerDispatches,
  itemRevisions,
  items,
  salesOrderLines,
  soStockReservations,
  stockReservationEvents,
} from '../db/schema';
import type { AuthContext, DbTransaction } from '../db/with-user-context';
import { ConflictError, ValidationError } from './errors';
import { assertSoAcceptsWork } from './so-accepts-work';

/** The three numbers, for one item. */
export interface StockPosition {
  physicalQty: number;
  reservedQty: number;
  availableQty: number;
}

function num(v: unknown): number {
  return Number(v ?? 0);
}

/**
 * Read PHYSICAL / RESERVED / AVAILABLE for one item, holding the item row for
 * the rest of the transaction. Every write path calls this FIRST — the lock is
 * what makes "two users reserve the last 5 pieces" impossible.
 */
export async function readStockPositionLocked(
  tx: DbTransaction,
  companyId: string,
  itemId: string,
  itemRevisionId?: string | null,
): Promise<StockPosition> {
  await tx.execute(sql`SELECT 1 FROM public.items WHERE id = ${itemId}::uuid FOR UPDATE`);
  return readStockPosition(tx, companyId, itemId, itemRevisionId);
}

/** Same three numbers without taking the lock — for read-only screens.
 *
 *  Drawing Rev Phase C (0233): `itemRevisionId` omitted (undefined) = the ITEM
 *  totals, exactly as before. Given (a uuid, or null = the blank / no-Rev
 *  bucket) = that one Item + Rev bucket: physical = bucket on hand, reserved =
 *  bookings held in that bucket, available = bucket free. */
export async function readStockPosition(
  tx: DbTransaction,
  companyId: string,
  itemId: string,
  itemRevisionId?: string | null,
): Promise<StockPosition> {
  if (itemRevisionId !== undefined) {
    const b = await readRevBucketPosition(tx, companyId, itemId, itemRevisionId);
    return { physicalQty: b.onHandQty, reservedQty: b.reservedQty, availableQty: b.freeQty };
  }
  const rows = (await tx.execute(sql`
    SELECT physical_qty, reserved_qty, available_qty
    FROM public.v_item_stock_availability
    WHERE company_id = ${companyId}::uuid AND item_id = ${itemId}::uuid
  `)) as unknown as Array<{
    physical_qty: number;
    reserved_qty: number;
    available_qty: number;
  }>;
  const r = rows[0];
  return {
    physicalQty: num(r?.physical_qty),
    reservedQty: num(r?.reserved_qty),
    availableQty: num(r?.available_qty),
  };
}

/** The three numbers for many items at once (lists). Items with no ledger row
 *  at all are simply absent — the caller defaults them to zero. */
export async function readStockPositions(
  tx: DbTransaction,
  companyId: string,
  itemIds: readonly string[],
): Promise<Map<string, StockPosition>> {
  const out = new Map<string, StockPosition>();
  if (itemIds.length === 0) return out;
  const rows = (await tx.execute(sql`
    SELECT item_id, physical_qty, reserved_qty, available_qty
    FROM public.v_item_stock_availability
    WHERE company_id = ${companyId}::uuid
      AND item_id = ANY(${sql.param(itemIds as string[])}::uuid[])
  `)) as unknown as Array<{
    item_id: string;
    physical_qty: number;
    reserved_qty: number;
    available_qty: number;
  }>;
  for (const r of rows) {
    out.set(r.item_id, {
      physicalQty: num(r.physical_qty),
      reservedQty: num(r.reserved_qty),
      availableQty: num(r.available_qty),
    });
  }
  return out;
}

// ─── Drawing Rev Phase C: stock per Item + Rev bucket (0233) ──────────────
//
// item_rev_stock_balances splits each item's on hand into Rev buckets (blank
// bucket = old stock / Buy / RM, key REV_KEY_BLANK). Item totals above are
// untouched; these reads are the bucket view, with the same "reserved" rule as
// v_item_stock_availability (SO bookings + assembly part bookings), per bucket.

/** The blank (no-Rev) bucket key — mirrors REV_KEY_BLANK in db/schema.ts. */
export const BLANK_REV_KEY = '00000000-0000-0000-0000-000000000000';

/** One Item + Rev bucket's numbers. */
export interface RevBucketPosition {
  /** null = the blank (old / no-Rev) bucket. */
  itemRevisionId: string | null;
  onHandQty: number;
  reservedQty: number;
  freeQty: number;
}

/** Bucket key for SQL: the Rev id, or the all-zero blank key. */
export function revKeyOf(itemRevisionId: string | null | undefined): string {
  return itemRevisionId ?? BLANK_REV_KEY;
}

const r3 = (v: number): number => Math.round(v * 1000) / 1000;

/** One bucket's numbers. A bucket with no balance row reads on hand 0, with
 *  whatever is still booked against it (free may then be negative). Callers
 *  that WRITE must hold the item row lock first (postStockMove /
 *  readStockPositionLocked) — every bucket move goes through that lock, so the
 *  figure read under it is the real one (§20.3). */
export async function readRevBucketPosition(
  tx: DbTransaction,
  companyId: string,
  itemId: string,
  itemRevisionId: string | null,
): Promise<RevBucketPosition> {
  const key = revKeyOf(itemRevisionId);
  const rows = (await tx.execute(sql`
    SELECT
      COALESCE((SELECT b.on_hand_qty FROM public.item_rev_stock_balances b
                 WHERE b.company_id = ${companyId}::uuid AND b.item_id = ${itemId}::uuid
                   AND b.rev_key = ${key}::uuid), 0)::float8 AS on_hand,
      COALESCE((SELECT SUM(x.held) FROM (
        SELECT (qty - consumed_qty - released_qty)::numeric AS held
          FROM public.so_stock_reservations
         WHERE company_id = ${companyId}::uuid AND item_id = ${itemId}::uuid
           AND deleted_at IS NULL AND status IN ('active', 'partially_consumed')
           AND COALESCE(item_revision_id, ${BLANK_REV_KEY}::uuid) = ${key}::uuid
        UNION ALL
        SELECT (qty - consumed_qty - released_qty)::numeric
          FROM public.assembly_part_reservations
         WHERE company_id = ${companyId}::uuid AND item_id = ${itemId}::uuid
           AND deleted_at IS NULL AND status IN ('active', 'partially_consumed')
           AND COALESCE(item_revision_id, ${BLANK_REV_KEY}::uuid) = ${key}::uuid
      ) x), 0)::float8 AS reserved
  `)) as unknown as Array<{ on_hand: number; reserved: number }>;
  const onHand = num(rows[0]?.on_hand);
  const reserved = num(rows[0]?.reserved);
  return { itemRevisionId, onHandQty: onHand, reservedQty: reserved, freeQty: r3(onHand - reserved) };
}

/** Every bucket of many items (rows in the balance table, plus any bucket that
 *  only has bookings). Map item id → buckets. Read-only screens. */
export async function readRevBuckets(
  tx: DbTransaction,
  companyId: string,
  itemIds: readonly string[],
): Promise<Map<string, RevBucketPosition[]>> {
  const out = new Map<string, RevBucketPosition[]>();
  if (itemIds.length === 0) return out;
  const ids = sql.param(itemIds as string[]);
  const rows = (await tx.execute(sql`
    WITH res AS (
      SELECT item_id, COALESCE(item_revision_id, ${BLANK_REV_KEY}::uuid) AS rev_key,
             SUM(qty - consumed_qty - released_qty)::numeric AS held
        FROM (
          SELECT item_id, item_revision_id, qty, consumed_qty, released_qty
            FROM public.so_stock_reservations
           WHERE company_id = ${companyId}::uuid AND deleted_at IS NULL
             AND status IN ('active', 'partially_consumed')
             AND item_id = ANY(${ids}::uuid[])
          UNION ALL
          SELECT item_id, item_revision_id, qty, consumed_qty, released_qty
            FROM public.assembly_part_reservations
           WHERE company_id = ${companyId}::uuid AND deleted_at IS NULL
             AND status IN ('active', 'partially_consumed')
             AND item_id = ANY(${ids}::uuid[])
        ) r
       GROUP BY 1, 2
    ), bal AS (
      SELECT item_id, rev_key, on_hand_qty
        FROM public.item_rev_stock_balances
       WHERE company_id = ${companyId}::uuid
         AND item_id = ANY(${ids}::uuid[])
    )
    SELECT COALESCE(bal.item_id, res.item_id) AS item_id,
           NULLIF(COALESCE(bal.rev_key, res.rev_key), ${BLANK_REV_KEY}::uuid) AS item_revision_id,
           COALESCE(bal.on_hand_qty, 0)::float8 AS on_hand,
           COALESCE(res.held, 0)::float8 AS reserved
      FROM bal
      FULL JOIN res ON res.item_id = bal.item_id AND res.rev_key = bal.rev_key
  `)) as unknown as Array<{
    item_id: string;
    item_revision_id: string | null;
    on_hand: number;
    reserved: number;
  }>;
  for (const r of rows) {
    const onHand = num(r.on_hand);
    const reserved = num(r.reserved);
    const list = out.get(r.item_id) ?? [];
    list.push({
      itemRevisionId: r.item_revision_id ?? null,
      onHandQty: onHand,
      reservedQty: reserved,
      freeQty: r3(onHand - reserved),
    });
    out.set(r.item_id, list);
  }
  return out;
}

/** Pieces still held, per order line AND bucket. Map line id → (rev key → held). */
export async function readReservedByLineRev(
  tx: DbTransaction,
  companyId: string,
  soLineIds: readonly string[],
): Promise<Map<string, Map<string, number>>> {
  const out = new Map<string, Map<string, number>>();
  if (soLineIds.length === 0) return out;
  const rows = (await tx.execute(sql`
    SELECT so_line_id, COALESCE(item_revision_id, ${BLANK_REV_KEY}::uuid)::text AS rev_key,
           COALESCE(SUM(qty - consumed_qty - released_qty), 0)::int AS held
    FROM public.so_stock_reservations
    WHERE company_id = ${companyId}::uuid
      AND deleted_at IS NULL AND status IN ('active', 'partially_consumed')
      AND so_line_id = ANY(${sql.param(soLineIds as string[])}::uuid[])
    GROUP BY 1, 2
  `)) as unknown as Array<{ so_line_id: string; rev_key: string; held: number }>;
  for (const r of rows) {
    const m = out.get(r.so_line_id) ?? new Map<string, number>();
    m.set(r.rev_key, num(r.held));
    out.set(r.so_line_id, m);
  }
  return out;
}

/** "ABC/1", or "ABC · no Rev" for the blank bucket — the one bucket label. */
export function bucketLabel(itemCode: string, rev: string | null | undefined): string {
  return rev ? itemRevLabel(itemCode, rev) : `${itemCode} · no Rev`;
}

/** Same label, reading the Rev text from the register. */
export async function revBucketLabel(
  tx: DbTransaction,
  itemCode: string,
  itemRevisionId: string | null,
): Promise<string> {
  if (!itemRevisionId) return bucketLabel(itemCode, null);
  const rows = await tx
    .select({ rev: itemRevisions.rev })
    .from(itemRevisions)
    .where(eq(itemRevisions.id, itemRevisionId))
    .limit(1);
  return bucketLabel(itemCode, rows[0]?.rev ?? '?');
}

/** Refuse a Rev that is not a live register row of THIS item. Returns the Rev text. */
export async function assertRevBelongsToItem(
  tx: DbTransaction,
  companyId: string,
  itemId: string,
  itemRevisionId: string,
): Promise<string> {
  const rows = await tx
    .select({ rev: itemRevisions.rev })
    .from(itemRevisions)
    .where(
      and(
        eq(itemRevisions.id, itemRevisionId),
        eq(itemRevisions.companyId, companyId),
        eq(itemRevisions.itemId, itemId),
        isNull(itemRevisions.deletedAt),
      ),
    )
    .limit(1);
  if (!rows[0]) {
    throw new ValidationError(
      'That Drawing Rev does not belong to this item. Pick the Item + Rev again.',
    );
  }
  return rows[0].rev;
}

/** Pieces still held for one order line (across all its bookings). */
export async function readReservedForLine(
  tx: DbTransaction,
  companyId: string,
  soLineId: string,
): Promise<number> {
  const rows = (await tx.execute(sql`
    SELECT COALESCE(SUM(qty - consumed_qty - released_qty), 0)::int AS held
    FROM public.so_stock_reservations
    WHERE company_id = ${companyId}::uuid AND so_line_id = ${soLineId}::uuid
      AND deleted_at IS NULL AND status IN ('active', 'partially_consumed')
  `)) as unknown as Array<{ held: number }>;
  return num(rows[0]?.held);
}

/** Pieces still held, per order line, for many lines at once. */
export async function readReservedByLine(
  tx: DbTransaction,
  companyId: string,
  soLineIds: readonly string[],
): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (soLineIds.length === 0) return out;
  const rows = (await tx.execute(sql`
    SELECT so_line_id, COALESCE(SUM(qty - consumed_qty - released_qty), 0)::int AS held
    FROM public.so_stock_reservations
    WHERE company_id = ${companyId}::uuid
      AND deleted_at IS NULL AND status IN ('active', 'partially_consumed')
      AND so_line_id = ANY(${sql.param(soLineIds as string[])}::uuid[])
    GROUP BY so_line_id
  `)) as unknown as Array<{ so_line_id: string; held: number }>;
  for (const r of rows) out.set(r.so_line_id, num(r.held));
  return out;
}

/**
 * How many more pieces this order line may legitimately hold.
 *
 *   orderQty − dispatchedQty − already held
 *
 * Reserving beyond what the customer ordered would park stock nobody can ship.
 * A line id that is not a sales-order line (a job-work line books against the
 * same column) returns null, meaning "no order cap to apply".
 */
export async function readUnreservedRequirement(
  tx: DbTransaction,
  companyId: string,
  soLineId: string,
): Promise<number | null> {
  const lines = await tx
    .select({
      orderQty: salesOrderLines.orderQty,
      dispatchedQty: salesOrderLines.dispatchedQty,
    })
    .from(salesOrderLines)
    .where(and(eq(salesOrderLines.id, soLineId), isNull(salesOrderLines.deletedAt)))
    .limit(1);
  const line = lines[0];
  if (!line) return null;
  const held = await readReservedForLine(tx, companyId, soLineId);
  return Math.max(0, num(line.orderQty) - num(line.dispatchedQty) - held);
}

/** The item an order line is actually for. Null when the line is gone, or is
 *  not a sales-order line (a job-work line uses the same column). */
export async function readLineItemId(tx: DbTransaction, soLineId: string): Promise<string | null> {
  const rows = await tx
    .select({ itemId: salesOrderLines.itemId })
    .from(salesOrderLines)
    .where(and(eq(salesOrderLines.id, soLineId), isNull(salesOrderLines.deletedAt)))
    .limit(1);
  return rows[0]?.itemId ?? null;
}

/** Append one row to the numeric reservation trail. */
export async function logReservationEvent(
  tx: DbTransaction,
  args: {
    companyId: string;
    reservationId: string;
    eventType: 'reserve' | 'consume' | 'release' | 'cancel' | 'amend_release';
    qty: number;
    remainingBefore: number;
    remainingAfter: number;
    reason?: string | null;
    sourceRef?: string | null;
    customerDispatchId?: string | null;
  },
  user: AuthContext,
): Promise<void> {
  await tx.insert(stockReservationEvents).values({
    companyId: args.companyId,
    reservationId: args.reservationId,
    eventType: args.eventType,
    qty: args.qty,
    remainingBefore: args.remainingBefore,
    remainingAfter: args.remainingAfter,
    reason: args.reason ?? null,
    sourceRef: args.sourceRef ?? null,
    customerDispatchId: args.customerDispatchId ?? null,
    createdBy: user.id,
  });
}

export interface CreateReservationArgs {
  companyId: string;
  soLineId: string;
  soCodeText: string;
  lineNo: number;
  itemId: string;
  itemCodeText: string | null;
  qty: number;
  source: ReservationSource;
  productionOrderId?: string | null;
  jobCardId?: string | null;
  productionOrderCloseId?: string | null;
  remarks?: string | null;
  /** Skip the "not more than the customer ordered" cap. Only the automatic
   *  booking after a production close passes true — it has already worked out
   *  its own quantity from the same requirement. */
  skipRequirementCap?: boolean;
  /** Drawing Rev Phase C — the Item + Rev bucket the booking holds (null = the
   *  blank / no-Rev bucket). Omitted: the order line's own Rev bucket when it
   *  has enough free stock, else the blank bucket (Buy items: always blank). */
  itemRevisionId?: string | null;
}

/** The Rev of the order line (SO line, or a JW line sharing the column) when it
 *  is for the same item; null otherwise. */
async function lineRevisionFor(
  tx: DbTransaction,
  companyId: string,
  soLineId: string,
  itemId: string,
): Promise<string | null> {
  const rows = (await tx.execute(sql`
    SELECT item_revision_id FROM public.sales_order_lines
     WHERE id = ${soLineId}::uuid AND company_id = ${companyId}::uuid AND item_id = ${itemId}::uuid
    UNION ALL
    SELECT item_revision_id FROM public.job_work_order_lines
     WHERE id = ${soLineId}::uuid AND company_id = ${companyId}::uuid AND item_id = ${itemId}::uuid
    LIMIT 1
  `)) as unknown as Array<{ item_revision_id: string | null }>;
  return rows[0]?.item_revision_id ?? null;
}

/**
 * Book stock to an order line. Takes the item lock itself, so callers must not
 * hold a conflicting one. Refuses to book more than is available, or more than
 * the line still needs.
 *
 * Returns null when there is nothing to book (qty resolved to 0) rather than
 * throwing — the automatic path calls this speculatively after every close.
 */
export async function createReservation(
  tx: DbTransaction,
  args: CreateReservationArgs,
  user: AuthContext,
): Promise<{ id: string; qty: number; position: StockPosition } | null> {
  if (args.qty <= 0) return null;

  // ADR-235 — never book stock to a cancelled order. A hand booking locks the
  // SO line FIRST (its own statement), then reads line + header fresh, then
  // the item below: line → item, the order the SO cancel and the dispatch
  // take, so a booking racing a cancel queues on the line and then sees it.
  // The automatic booking after a Production Order close already holds the
  // item (its stock credit), so it must not wait on the line (item → line
  // would invert the cancel's order); it reads without a lock and quietly
  // books nothing. Safe: the cancel takes the item lock before it releases
  // bookings, so it still sees and releases anything that close committed.
  const auto = args.source === 'auto_production';
  if (!auto) {
    await tx.execute(sql`
      SELECT 1 FROM public.sales_order_lines
      WHERE id = ${args.soLineId}::uuid AND company_id = ${args.companyId}::uuid
      FOR UPDATE
    `);
  }
  const soRows = (await tx.execute(sql`
    SELECT sol.status::text AS "lineStatus", sol.short_closed_at IS NOT NULL AS "shortClosed",
           so.status::text AS "soStatus", so.code AS "soCode"
    FROM public.sales_order_lines sol
    JOIN public.sales_orders so ON so.id = sol.sales_order_id
    WHERE sol.id = ${args.soLineId}::uuid AND sol.company_id = ${args.companyId}::uuid
      AND sol.deleted_at IS NULL
  `)) as unknown as Array<{
    lineStatus: string;
    shortClosed: boolean;
    soStatus: string;
    soCode: string;
  }>;
  const soLine = soRows[0];
  // No row = not a sales-order line (a job-work line shares the column) —
  // left alone, as the item check below does.
  if (soLine) {
    if (auto) {
      if (
        soLine.soStatus === 'draft' ||
        soLine.soStatus === 'cancelled' ||
        soLine.lineStatus === 'cancelled' ||
        soLine.shortClosed
      ) {
        return null;
      }
    } else {
      assertSoAcceptsWork(soLine.soStatus, soLine.soCode, 'stock cannot be reserved against it');
      if (soLine.lineStatus === 'cancelled') {
        throw new ValidationError(
          `${soLine.soCode} Ln ${args.lineNo} is cancelled — stock cannot be reserved against it.`,
        );
      }
      if (soLine.shortClosed) {
        throw new ValidationError(
          `${soLine.soCode} Ln ${args.lineNo} was closed short — stock cannot be reserved against it.`,
        );
      }
    }
  }

  // The lock: read availability only AFTER the item row is held, so a
  // simultaneous booking on the same item cannot slip between the two.
  const position = await readStockPositionLocked(tx, args.companyId, args.itemId);
  if (args.qty > position.availableQty) {
    throw new ConflictError(
      `Only ${position.availableQty} available to reserve for this item ` +
        `(on the shelf ${position.physicalQty}, already reserved ${position.reservedQty}) — ` +
        `you asked for ${args.qty}.`,
    );
  }

  // Drawing Rev Phase C — the booking also holds a Rev bucket, and may not
  // promise more than that bucket has free (read under the same item lock).
  let bucketRevId: string | null;
  if (args.itemRevisionId !== undefined) {
    bucketRevId = args.itemRevisionId;
    if (bucketRevId) await assertRevBelongsToItem(tx, args.companyId, args.itemId, bucketRevId);
  } else {
    const lineRev = await lineRevisionFor(tx, args.companyId, args.soLineId, args.itemId);
    const lineFree = lineRev
      ? (await readRevBucketPosition(tx, args.companyId, args.itemId, lineRev)).freeQty
      : 0;
    bucketRevId = lineRev && args.qty <= lineFree ? lineRev : null;
  }
  const bucket = await readRevBucketPosition(tx, args.companyId, args.itemId, bucketRevId);
  if (args.qty > bucket.freeQty) {
    const code = (await itemCodeFor(tx, args.itemId)) ?? 'item';
    throw new ConflictError(
      `Only ${Math.max(0, bucket.freeQty)} of ${await revBucketLabel(tx, code, bucketRevId)} free to reserve ` +
        `(on the shelf ${bucket.onHandQty}, already reserved ${bucket.reservedQty}) — you asked for ${args.qty}.`,
    );
  }

  // The booking must be for the item the line actually ordered. Without this
  // any item's free stock could be parked on any line: the requirement cap is
  // computed from that line's order_qty, which says nothing about another
  // item. It also stops a BOM-CHILD plan — whose `so_line_id` is the PARENT
  // line but whose item is the child component — from booking child stock
  // against the parent, which would inflate the parent's reserved qty, let a
  // parent dispatch eat the child's booking, and then refuse the parent's own
  // genuine booking as "already fully covered".
  //
  // A line id that is not a sales-order line (a job-work line shares the
  // column) returns null and is left alone — there is no order item to check.
  const lineItemId = await readLineItemId(tx, args.soLineId);
  if (lineItemId !== null && lineItemId !== args.itemId) {
    throw new ValidationError(
      `Cannot reserve this item against ${args.soCodeText} Ln ${args.lineNo} — ` +
        `that line is for a different item. Book the stock against the line that ordered it.`,
    );
  }

  if (!args.skipRequirementCap) {
    const need = await readUnreservedRequirement(tx, args.companyId, args.soLineId);
    if (need !== null && args.qty > need) {
      throw new ConflictError(
        need === 0
          ? `${args.soCodeText} Ln ${args.lineNo} is already fully covered by stock or dispatches — nothing more to reserve.`
          : `Reserve Qty (${args.qty}) cannot be more than Pending (${need}) on ${args.soCodeText} Ln ${args.lineNo}.`,
      );
    }
  }

  const inserted = await tx
    .insert(soStockReservations)
    .values({
      companyId: args.companyId,
      soLineId: args.soLineId,
      soCodeText: args.soCodeText,
      lineNo: args.lineNo,
      itemId: args.itemId,
      itemCodeText: args.itemCodeText,
      itemRevisionId: bucketRevId,
      qty: args.qty,
      consumedQty: 0,
      releasedQty: 0,
      reservationSource: args.source,
      productionOrderId: args.productionOrderId ?? null,
      jobCardId: args.jobCardId ?? null,
      productionOrderCloseId: args.productionOrderCloseId ?? null,
      status: 'active',
      remarks: args.remarks ?? null,
      createdBy: user.id,
      updatedBy: user.id,
    })
    .returning({ id: soStockReservations.id });

  const id = inserted[0]!.id;
  await logReservationEvent(
    tx,
    {
      companyId: args.companyId,
      reservationId: id,
      eventType: 'reserve',
      qty: args.qty,
      remainingBefore: 0,
      remainingAfter: args.qty,
      sourceRef: `${args.soCodeText} / ln ${args.lineNo}`,
      reason: args.source === 'auto_production' ? 'Automatic booking after production close' : null,
    },
    user,
  );

  return {
    id,
    qty: args.qty,
    // Physical is untouched by a booking; only the split between reserved and
    // available moves. Reported back so the screen can refresh without a
    // second round trip.
    position: {
      physicalQty: position.physicalQty,
      reservedQty: position.reservedQty + args.qty,
      availableQty: position.availableQty - args.qty,
    },
  };
}

/** Rows still holding stock for a line, oldest first (first booked, first used). */
async function holdingRowsForLine(
  tx: DbTransaction,
  companyId: string,
  soLineId: string,
  /** undefined = every bucket (as before); string | null = that one bucket. */
  itemRevisionId?: string | null,
): Promise<Array<typeof soStockReservations.$inferSelect>> {
  return tx
    .select()
    .from(soStockReservations)
    .where(
      and(
        eq(soStockReservations.companyId, companyId),
        eq(soStockReservations.soLineId, soLineId),
        isNull(soStockReservations.deletedAt),
        sql`${soStockReservations.status} IN ('active', 'partially_consumed')`,
        itemRevisionId === undefined
          ? undefined
          : sql`COALESCE(${soStockReservations.itemRevisionId}, ${BLANK_REV_KEY}::uuid) = ${revKeyOf(itemRevisionId)}::uuid`,
      ),
    )
    .orderBy(soStockReservations.createdAt);
}

function settledStatus(qty: number, consumed: number, released: number): string {
  if (consumed + released >= qty) return consumed > 0 ? 'consumed' : 'released';
  if (consumed > 0) return 'partially_consumed';
  return 'active';
}

/**
 * Give pieces back to free stock. Physical stock does NOT change — only the
 * booking shrinks, so AVAILABLE rises by exactly the released qty.
 *
 * `qty` omitted = release everything this line still holds.
 */
export async function releaseFromLine(
  tx: DbTransaction,
  args: {
    companyId: string;
    soLineId: string;
    qty?: number | null;
    reason: string;
    eventType?: 'release' | 'cancel' | 'amend_release';
  },
  user: AuthContext,
): Promise<{ released: number; touched: Array<typeof soStockReservations.$inferSelect> }> {
  const rows = await holdingRowsForLine(tx, args.companyId, args.soLineId);
  const totalHeld = rows.reduce((s, r) => s + (r.qty - r.consumedQty - r.releasedQty), 0);
  if (totalHeld === 0) return { released: 0, touched: [] };

  const want = args.qty == null ? totalHeld : args.qty;
  if (want <= 0) throw new ValidationError('Release qty must be greater than 0');
  if (want > totalHeld) {
    throw new ConflictError(
      `Only ${totalHeld} still reserved on this line — cannot release ${want}. ` +
        `Pieces already dispatched cannot be released.`,
    );
  }

  let left = want;
  const touched: Array<typeof soStockReservations.$inferSelect> = [];
  for (const r of rows) {
    if (left <= 0) break;
    const remaining = r.qty - r.consumedQty - r.releasedQty;
    if (remaining <= 0) continue;
    const take = Math.min(left, remaining);
    const newReleased = r.releasedQty + take;
    const status = settledStatus(r.qty, r.consumedQty, newReleased);
    await tx
      .update(soStockReservations)
      .set({
        releasedQty: newReleased,
        status,
        releaseReason: args.reason,
        updatedBy: user.id,
        updatedAt: new Date(),
      })
      .where(eq(soStockReservations.id, r.id));
    await logReservationEvent(
      tx,
      {
        companyId: args.companyId,
        reservationId: r.id,
        eventType: args.eventType ?? 'release',
        qty: take,
        remainingBefore: remaining,
        remainingAfter: remaining - take,
        reason: args.reason,
        sourceRef: `${r.soCodeText} / ln ${r.lineNo}`,
      },
      user,
    );
    touched.push({ ...r, releasedQty: newReleased, status });
    left -= take;
  }
  return { released: want - left, touched };
}

/**
 * Ship against a booking. Called by the dispatch path AFTER it has posted the
 * real stock-out, so the ledger and the booking move in one transaction.
 *
 * Consumes oldest booking first and never more than the line still holds; the
 * caller may dispatch beyond the booking (out of free stock) and simply gets a
 * smaller number back.
 */
export async function consumeForLine(
  tx: DbTransaction,
  args: {
    companyId: string;
    soLineId: string;
    qty: number;
    dispatchCode: string;
    customerDispatchId?: string | null;
    /** Drawing Rev Phase C — ship only the bookings of this bucket (null =
     *  blank). Omitted = every bucket, oldest first (as before). */
    itemRevisionId?: string | null;
  },
  user: AuthContext,
): Promise<number> {
  if (args.qty <= 0) return 0;
  const rows = await holdingRowsForLine(tx, args.companyId, args.soLineId, args.itemRevisionId);
  let left = args.qty;
  let consumed = 0;
  for (const r of rows) {
    if (left <= 0) break;
    const remaining = r.qty - r.consumedQty - r.releasedQty;
    if (remaining <= 0) continue;
    const take = Math.min(left, remaining);
    const newConsumed = r.consumedQty + take;
    const status = settledStatus(r.qty, newConsumed, r.releasedQty);
    await tx
      .update(soStockReservations)
      .set({
        consumedQty: newConsumed,
        status,
        updatedBy: user.id,
        updatedAt: new Date(),
      })
      .where(eq(soStockReservations.id, r.id));
    await logReservationEvent(
      tx,
      {
        companyId: args.companyId,
        reservationId: r.id,
        eventType: 'consume',
        qty: take,
        remainingBefore: remaining,
        remainingAfter: remaining - take,
        sourceRef: args.dispatchCode,
        customerDispatchId: args.customerDispatchId ?? null,
      },
      user,
    );
    left -= take;
    consumed += take;
  }
  return consumed;
}

/**
 * Undo the consumption a cancelled dispatch performed — the booking holds its
 * pieces again.
 *
 * Cancelling a dispatch credits the goods back to the shelf, so PHYSICAL rises.
 * Without this the pieces would come back as FREE stock and the customer's
 * booking would have silently evaporated: the order would look unreserved even
 * though its goods are sitting on the shelf again.
 *
 * The trail is the source of truth, not a recalculation: it replays the
 * `consume` events this dispatch wrote and nets off any `release` rows it has
 * already written, so cancelling twice (or a replayed call) gives nothing back
 * a second time. Event rows are never deleted — the reversal is appended as a
 * further `release` row carrying the same dispatch id.
 */
export async function unconsumeForDispatch(
  tx: DbTransaction,
  args: { companyId: string; customerDispatchId: string },
  user: AuthContext,
): Promise<number> {
  const netRows = (await tx.execute(sql`
    SELECT reservation_id,
           SUM(CASE WHEN event_type = 'consume' THEN qty ELSE -qty END)::int AS net
    FROM public.stock_reservation_events
    WHERE company_id = ${args.companyId}::uuid
      AND customer_dispatch_id = ${args.customerDispatchId}::uuid
      AND event_type IN ('consume', 'release')
    GROUP BY reservation_id
  `)) as unknown as Array<{ reservation_id: string; net: number }>;

  let restored = 0;
  for (const row of netRows) {
    const net = num(row.net);
    if (net <= 0) continue;
    const found = await tx
      .select()
      .from(soStockReservations)
      .where(eq(soStockReservations.id, row.reservation_id))
      .limit(1);
    const r = found[0];
    if (!r || r.deletedAt) continue;
    // Never give back more than the row actually shows as shipped: a manual
    // correction elsewhere must win over the replay.
    const take = Math.min(net, r.consumedQty);
    if (take <= 0) continue;
    const newConsumed = r.consumedQty - take;
    const remainingBefore = r.qty - r.consumedQty - r.releasedQty;
    await tx
      .update(soStockReservations)
      .set({
        consumedQty: newConsumed,
        status: settledStatus(r.qty, newConsumed, r.releasedQty),
        updatedBy: user.id,
        updatedAt: new Date(),
      })
      .where(eq(soStockReservations.id, r.id));
    await logReservationEvent(
      tx,
      {
        companyId: args.companyId,
        reservationId: r.id,
        eventType: 'release',
        qty: take,
        remainingBefore,
        remainingAfter: remainingBefore + take,
        reason: 'dispatch cancelled',
        sourceRef: `${r.soCodeText} / ln ${r.lineNo}`,
        customerDispatchId: args.customerDispatchId,
      },
      user,
    );
    restored += take;
  }
  return restored;
}

/**
 * Bring a line's bookings back within what the order still justifies, after
 * the order was amended, cancelled or closed (ADR-180 §N).
 *
 *   allowed = max(0, newOrderQty − dispatchedQty)
 *
 * Anything held above that is released, oldest first, with the reason on the
 * trail. Already-dispatched pieces are never reversed. Returns what it gave
 * back, so the caller can say so in its own audit line.
 */
export async function reconcileLineReservations(
  tx: DbTransaction,
  args: {
    companyId: string;
    soLineId: string;
    /** The line's new ordered qty. 0 for a cancelled or closed line. */
    newOrderQty: number;
    dispatchedQty: number;
    reason: string;
  },
  user: AuthContext,
): Promise<number> {
  const held = await readReservedForLine(tx, args.companyId, args.soLineId);
  if (held === 0) return 0;
  const allowed = Math.max(0, args.newOrderQty - args.dispatchedQty);
  const excess = held - allowed;
  if (excess <= 0) return 0;
  const { released } = await releaseFromLine(
    tx,
    {
      companyId: args.companyId,
      soLineId: args.soLineId,
      qty: excess,
      reason: args.reason,
      eventType: 'amend_release',
    },
    user,
  );
  return released;
}

/**
 * Give back the automatic booking a Production Order close created, because
 * that close is being reversed (ADR-180 §D).
 *
 * Reversing a close takes the finished goods back OUT of stock, so the booking
 * they paid for must go with them — otherwise the order would still read
 * "reserved 10" against pieces that no longer exist and AVAILABLE would go
 * negative.
 *
 * If any of those pieces have already shipped we refuse and name the dispatch:
 * un-booking shipped goods silently is how a customer's order quietly loses its
 * cover. The user must cancel the dispatch first.
 */
export async function releaseReservationForClose(
  tx: DbTransaction,
  args: { companyId: string; productionOrderCloseId: string; reason: string },
  user: AuthContext,
): Promise<number> {
  const rows = await tx
    .select()
    .from(soStockReservations)
    .where(
      and(
        eq(soStockReservations.companyId, args.companyId),
        eq(soStockReservations.productionOrderCloseId, args.productionOrderCloseId),
        isNull(soStockReservations.deletedAt),
      ),
    )
    .limit(1);
  const r = rows[0];
  if (!r) return 0;

  if (r.consumedQty > 0) {
    const shipped = (await tx.execute(sql`
      SELECT DISTINCT cd.code
      FROM public.stock_reservation_events e
      JOIN public.customer_dispatches cd ON cd.id = e.customer_dispatch_id
      WHERE e.reservation_id = ${r.id}::uuid AND e.event_type = 'consume'
    `)) as unknown as Array<{ code: string }>;
    const names = shipped.map((s) => s.code).join(', ');
    throw new ConflictError(
      `Cannot reverse this close — ${r.consumedQty} of the pieces it booked to ` +
        `${r.soCodeText} Ln ${r.lineNo} have already been dispatched` +
        `${names ? ` on ${names}` : ''}. Cancel the dispatch first.`,
    );
  }

  const remaining = r.qty - r.consumedQty - r.releasedQty;
  if (remaining <= 0) return 0;
  await tx
    .update(soStockReservations)
    .set({
      releasedQty: r.releasedQty + remaining,
      status: settledStatus(r.qty, r.consumedQty, r.releasedQty + remaining),
      releaseReason: args.reason,
      updatedBy: user.id,
      updatedAt: new Date(),
    })
    .where(eq(soStockReservations.id, r.id));
  await logReservationEvent(
    tx,
    {
      companyId: args.companyId,
      reservationId: r.id,
      eventType: 'release',
      qty: remaining,
      remainingBefore: remaining,
      remainingAfter: 0,
      reason: args.reason,
      sourceRef: `${r.soCodeText} / ln ${r.lineNo}`,
    },
    user,
  );
  return remaining;
}

/** Item code for a reservation row's message, or null for a free-text item. */
export async function itemCodeFor(tx: DbTransaction, itemId: string): Promise<string | null> {
  const rows = await tx
    .select({ code: items.code })
    .from(items)
    .where(eq(items.id, itemId))
    .limit(1);
  return rows[0]?.code ?? null;
}

/** Dispatch code for an event's source_ref. */
export async function dispatchCodeFor(
  tx: DbTransaction,
  dispatchId: string,
): Promise<string | null> {
  const rows = await tx
    .select({ code: customerDispatches.code })
    .from(customerDispatches)
    .where(eq(customerDispatches.id, dispatchId))
    .limit(1);
  return rows[0]?.code ?? null;
}
