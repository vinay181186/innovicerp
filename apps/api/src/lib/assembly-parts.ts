// Assembly parts — ADR-193 phase 3c (spec §13).
//
// The ONE place the assembly-SO "parts out" numbers and the assembly part
// reservations are read and written, so the Material view, the Item Issue
// guard, Return / Reverse and assembly Complete can never disagree.
//
//   Issued / Returned  non-reversed Item Issue slips of the SO
//   Fitted             Σ assembly_unit_consumptions (deleted_at null) — parts
//                      built into completed units by Complete
//   Still Out          Issued − Returned − Fitted (on the bench, not yet fitted)
//   Reserved (own)     Σ (qty − consumed − released) of the SO's live
//                      assembly_part_reservations
//
// Reservation rows are always changed under a row lock (FOR UPDATE); callers
// hold the item lock (lockItemForStock) where Available is also read.

import { sql } from 'drizzle-orm';
import type { DbTransaction } from '../db/with-user-context';
import { ConflictError, NotFoundError } from './errors';
import { lockItemForStock, roundQty } from './stock-ledger';

function num(v: unknown): number {
  return Number(v ?? 0);
}

export interface PartsOut {
  issued: number;
  returned: number;
  fitted: number;
  /** Issued − Returned − Fitted. */
  stillOut: number;
}

export const NO_PARTS_OUT: PartsOut = { issued: 0, returned: 0, fitted: 0, stillOut: 0 };

/** Lock the SO row (M15). Assembly Complete / Undo and a Return / Reverse of
 *  an assembly-SO slip all take it first, so Still Out cannot change between
 *  their check and their write. */
export async function lockSoRow(tx: DbTransaction, companyId: string, soId: string): Promise<void> {
  const rows = (await tx.execute(sql`
    SELECT id FROM public.sales_orders
    WHERE id = ${soId}::uuid AND company_id = ${companyId}::uuid
    FOR NO KEY UPDATE
  `)) as unknown as Array<{ id: string }>;
  if (rows.length === 0) throw new NotFoundError('Sales Order not found. Refresh the page.');
}

/** Parts out per SO per item, for many assembly SOs at once. */
export async function readPartsOutMany(
  tx: DbTransaction,
  companyId: string,
  soIds: readonly string[],
): Promise<Map<string, Map<string, PartsOut>>> {
  const out = new Map<string, Map<string, PartsOut>>();
  if (soIds.length === 0) return out;
  const ids = sql.param(soIds as string[]);
  const rows = (await tx.execute(sql`
    WITH iss AS (
      SELECT si.sales_order_id AS so_id, l.item_id,
             SUM(l.qty) AS issued, SUM(COALESCE(r.ret, 0)) AS returned
      FROM public.store_issue_lines l
      JOIN public.store_issues si ON si.id = l.issue_id
      LEFT JOIN LATERAL (
        SELECT SUM(x.qty) AS ret FROM public.store_issue_returns x
        WHERE x.issue_line_id = l.id AND x.deleted_at IS NULL
      ) r ON true
      WHERE si.company_id = ${companyId}::uuid
        AND si.deleted_at IS NULL AND si.reversed_at IS NULL AND l.deleted_at IS NULL
        AND si.sales_order_id = ANY(${ids}::uuid[])
      GROUP BY si.sales_order_id, l.item_id
    ), fit AS (
      SELECT c.sales_order_id AS so_id, c.item_id, SUM(c.qty) AS fitted
      FROM public.assembly_unit_consumptions c
      WHERE c.company_id = ${companyId}::uuid AND c.deleted_at IS NULL
        AND c.sales_order_id = ANY(${ids}::uuid[])
      GROUP BY c.sales_order_id, c.item_id
    )
    SELECT COALESCE(i.so_id, f.so_id) AS so_id, COALESCE(i.item_id, f.item_id) AS item_id,
           COALESCE(i.issued, 0) AS issued, COALESCE(i.returned, 0) AS returned,
           COALESCE(f.fitted, 0) AS fitted
    FROM iss i
    FULL OUTER JOIN fit f ON f.so_id = i.so_id AND f.item_id = i.item_id
  `)) as unknown as Array<{
    so_id: string;
    item_id: string;
    issued: unknown;
    returned: unknown;
    fitted: unknown;
  }>;
  for (const r of rows) {
    const issued = roundQty(num(r.issued));
    const returned = roundQty(num(r.returned));
    const fitted = roundQty(num(r.fitted));
    const m = out.get(r.so_id) ?? new Map<string, PartsOut>();
    m.set(r.item_id, { issued, returned, fitted, stillOut: roundQty(issued - returned - fitted) });
    out.set(r.so_id, m);
  }
  return out;
}

/** Parts out per item for one assembly SO. */
export async function readPartsOut(
  tx: DbTransaction,
  companyId: string,
  soId: string,
): Promise<Map<string, PartsOut>> {
  return (await readPartsOutMany(tx, companyId, [soId])).get(soId) ?? new Map();
}

/** This SO's own assembly reservation still held, per item. */
export async function readOwnAssemblyReserved(
  tx: DbTransaction,
  companyId: string,
  soId: string,
): Promise<Map<string, number>> {
  const rows = (await tx.execute(sql`
    SELECT item_id, SUM(qty - consumed_qty - released_qty) AS held
    FROM public.assembly_part_reservations
    WHERE company_id = ${companyId}::uuid AND sales_order_id = ${soId}::uuid
      AND deleted_at IS NULL AND status IN ('active', 'partially_consumed')
    GROUP BY item_id
  `)) as unknown as Array<{ item_id: string; held: unknown }>;
  const out = new Map<string, number>();
  for (const r of rows) out.set(r.item_id, roundQty(num(r.held)));
  return out;
}

// ─── Reservation writes ─────────────────────────────────────────────────────

interface ResRow {
  id: string;
  qty: number;
  consumed: number;
  released: number;
}

function statusOf(qty: number, consumed: number, released: number): string {
  if (roundQty(consumed + released) >= qty) return consumed > 0 ? 'consumed' : 'released';
  return consumed > 0 ? 'partially_consumed' : 'active';
}

async function lockRows(
  tx: DbTransaction,
  companyId: string,
  soId: string,
  itemId: string | null,
  where: 'holding' | 'consumed',
  order: 'oldest' | 'newest',
): Promise<ResRow[]> {
  const itemFrag = itemId ? sql`AND item_id = ${itemId}::uuid` : sql``;
  const whereFrag =
    where === 'holding'
      ? sql`AND status IN ('active', 'partially_consumed')`
      : // Review F3: never give back into a row that was released (leftovers at
        // the last unit, or by hand), nor on a closed / cancelled SO — the stock
        // then simply returns to free stock.
        sql`AND consumed_qty > 0 AND released_qty = 0
            AND NOT EXISTS (SELECT 1 FROM public.sales_orders so
                            WHERE so.id = sales_order_id AND so.status IN ('closed', 'cancelled'))`;
  const orderFrag =
    order === 'oldest' ? sql`created_at ASC, id ASC` : sql`created_at DESC, id DESC`;
  const rows = (await tx.execute(sql`
    SELECT id, qty, consumed_qty, released_qty
    FROM public.assembly_part_reservations
    WHERE company_id = ${companyId}::uuid AND sales_order_id = ${soId}::uuid
      AND deleted_at IS NULL ${itemFrag} ${whereFrag}
    ORDER BY ${orderFrag}
    FOR UPDATE
  `)) as unknown as Array<{
    id: string;
    qty: unknown;
    consumed_qty: unknown;
    released_qty: unknown;
  }>;
  return rows.map((r) => ({
    id: r.id,
    qty: num(r.qty),
    consumed: num(r.consumed_qty),
    released: num(r.released_qty),
  }));
}

async function writeRow(
  tx: DbTransaction,
  r: ResRow,
  userId: string,
  releaseReason?: string,
): Promise<void> {
  const reasonFrag = releaseReason ? sql`, release_reason = ${releaseReason}` : sql``;
  await tx.execute(sql`
    UPDATE public.assembly_part_reservations
    SET consumed_qty = ${roundQty(r.consumed)}, released_qty = ${roundQty(r.released)},
        status = ${statusOf(r.qty, r.consumed, r.released)},
        updated_by = ${userId}::uuid, updated_at = now() ${reasonFrag}
    WHERE id = ${r.id}::uuid
  `);
}

export interface ReservationScope {
  companyId: string;
  soId: string;
  itemId: string;
  userId: string;
}

/** An issue used up to `qty` of the SO's own reservation — oldest first.
 *  Returns what was used (≤ qty; 0 when nothing is reserved). */
export async function consumeOwnReservation(
  tx: DbTransaction,
  s: ReservationScope,
  qty: number,
): Promise<number> {
  let left = roundQty(qty);
  if (left <= 0) return 0;
  const rows = await lockRows(tx, s.companyId, s.soId, s.itemId, 'holding', 'oldest');
  for (const r of rows) {
    if (left <= 0) break;
    const remaining = roundQty(r.qty - r.consumed - r.released);
    if (remaining <= 0) continue;
    const take = Math.min(left, remaining);
    await writeRow(tx, { ...r, consumed: r.consumed + take }, s.userId);
    left = roundQty(left - take);
  }
  return roundQty(qty - left);
}

/** A reversed issue gives back what it used of the reservation — the most
 *  recently consumed rows first, so the reservation holds it again. */
export async function giveBackReservation(
  tx: DbTransaction,
  s: ReservationScope,
  qty: number,
): Promise<number> {
  let left = roundQty(qty);
  if (left <= 0) return 0;
  const rows = await lockRows(tx, s.companyId, s.soId, s.itemId, 'consumed', 'newest');
  for (const r of rows) {
    if (left <= 0) break;
    const take = Math.min(left, roundQty(r.consumed));
    if (take <= 0) continue;
    await writeRow(tx, { ...r, consumed: r.consumed - take }, s.userId);
    left = roundQty(left - take);
  }
  return roundQty(qty - left);
}

/** Release `qty` of the SO's own reservation of one item — newest first.
 *  409 when less than that is still reserved. */
export async function releaseOwnReservation(
  tx: DbTransaction,
  s: ReservationScope & { itemCode: string; soCode: string },
  qty: number,
  reason: string,
): Promise<void> {
  const want = roundQty(qty);
  const rows = await lockRows(tx, s.companyId, s.soId, s.itemId, 'holding', 'newest');
  const held = roundQty(rows.reduce((a, r) => a + (r.qty - r.consumed - r.released), 0));
  if (want > held) {
    throw new ConflictError(
      `${s.itemCode}: only ${held} is reserved for ${s.soCode} — cannot release ${want}.`,
      { itemCode: s.itemCode, reservedQty: held, qty: want },
    );
  }
  let left = want;
  for (const r of rows) {
    if (left <= 0) break;
    const remaining = roundQty(r.qty - r.consumed - r.released);
    if (remaining <= 0) continue;
    const take = Math.min(left, remaining);
    await writeRow(tx, { ...r, released: r.released + take }, s.userId, reason);
    left = roundQty(left - take);
  }
}

/** Release everything the SO still holds (every item). Returns the total qty.
 *  Takes the item locks first (id order) — the same order an Item Issue takes
 *  them — so it cannot deadlock against an issue consuming these rows. */
export async function releaseAllForSo(
  tx: DbTransaction,
  companyId: string,
  soId: string,
  reason: string,
  userId: string,
): Promise<number> {
  const held = (await tx.execute(sql`
    SELECT DISTINCT item_id FROM public.assembly_part_reservations
    WHERE company_id = ${companyId}::uuid AND sales_order_id = ${soId}::uuid
      AND deleted_at IS NULL AND status IN ('active', 'partially_consumed')
  `)) as unknown as Array<{ item_id: string }>;
  if (held.length === 0) return 0;
  for (const id of held.map((h) => h.item_id).sort()) {
    await lockItemForStock(tx, companyId, id);
  }
  const rows = await lockRows(tx, companyId, soId, null, 'holding', 'oldest');
  let total = 0;
  for (const r of rows) {
    const remaining = roundQty(r.qty - r.consumed - r.released);
    if (remaining <= 0) continue;
    await writeRow(tx, { ...r, released: r.released + remaining }, userId, reason);
    total = roundQty(total + remaining);
  }
  return total;
}
