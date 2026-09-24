// Store / Inventory service (PL-SI-1).
//
// GET /store-inventory — per-item rollup of current stock + open PO pending
// + open JC pending. Mirrors legacy renderStore (HTML L24803). Plus two
// write actions: adjust stock (manual + / − with reason) and set min qty.
//
// ADR-180 also parks two read-only stock-booking endpoints here rather than in
// a module of their own: they answer questions about the Store screen's own
// numbers (how much of this item is free, and who is holding the rest), so they
// belong to the form that already governs it — same permission, same module.

import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import type {
  AdjustStockInput,
  ListReservationsQuery,
  ListReservationsResponse,
  ListStoreInventoryQuery,
  ListStoreInventoryResponse,
  ReservationDetail,
  SetMinStockInput,
  StockAvailability,
  StoreInventoryRow,
} from '@innovic/shared';
import {
  clients,
  items,
  jobCards,
  productionOrders,
  salesOrderLines,
  salesOrders,
  soStockReservations,
  storeTransactions,
  users,
} from '../../db/schema';
import { type AuthContext, withUserContext } from '../../db/with-user-context';
import { requireAnyFormAccess, requireFormAccess } from '../../lib/access';
import {
  AuthorizationError,
  ConflictError,
  NotFoundError,
  ValidationError,
} from '../../lib/errors';
import { readStockPosition, readStockPositions } from '../../lib/stock-reservation';

function requireCompany(user: AuthContext): string {
  if (!user.companyId) throw new AuthorizationError('User is not assigned to a company');
  return user.companyId;
}

/** Escape the ILIKE metacharacters in a user's search term. Without this a user
 *  typing "%" in the Store Inventory search box gets a wildcard pattern instead
 *  of a literal search — i.e. the search box becomes a "show everything"
 *  button. Deliberately a local copy of the sales-orders / purchase-orders
 *  helper rather than an export across modules: it is three lines, and each
 *  list must be free to change its own search behaviour without dragging the
 *  others along. */
function escapeLikeTerm(raw: string): string {
  return raw.replace(/[\\%_]/g, (ch) => `\\${ch}`);
}

export async function listStoreInventory(
  input: ListStoreInventoryQuery,
  user: AuthContext,
): Promise<ListStoreInventoryResponse> {
  const companyId = requireCompany(user);
  return withUserContext(user, async (tx) => {
    // Every text column the Store Inventory row shows: Item Code, Name,
    // Material and UOM. The rest of the row is quantities — In Stock, Min Qty,
    // On PO, At Vendor, Mfg Pending — which stay out: a partial match on a
    // number makes "5" hit almost every item and the box stops being useful.
    // `uom` is a Postgres enum, so it needs the ::text cast the others do not.
    const term = input.search ? `%${escapeLikeTerm(input.search)}%` : null;
    const searchFrag = term
      ? sql`AND (
          i.code ILIKE ${term} ESCAPE '\\'
          OR i.name ILIKE ${term} ESCAPE '\\'
          OR i.material ILIKE ${term} ESCAPE '\\'
          OR i.uom::text ILIKE ${term} ESCAPE '\\'
        )`
      : sql``;

    const result = await tx.execute(sql`
      WITH jc_open AS (
        SELECT
          jc.item_id,
          SUM(GREATEST(jc.order_qty - COALESCE(comp.completed, 0), 0))::int AS qty
        FROM public.job_cards jc
        LEFT JOIN public.v_jc_status v ON v.job_card_id = jc.id
        LEFT JOIN LATERAL (
          -- "Completed" for a job card = output of its LAST operation, NOT the sum
          -- across every op. A JC is the SAME pieces flowing op → op; summing each
          -- op's logged output multi-counts them and wildly understates (often to
          -- 0) Mfg Pending on multi-op routes. Mirror the canonical
          -- lastOpCompletedQty (job-cards/service.ts:141-147): a QC / qc-required
          -- final op credits accepted qty, else completed qty — from the highest
          -- op_seq.
          SELECT CASE WHEN vos.op_type = 'qc' OR vos.qc_required
                      THEN vos.qc_accepted_qty ELSE vos.completed_qty END AS completed
          FROM public.v_jc_op_status vos
          WHERE vos.job_card_id = jc.id
          ORDER BY vos.op_seq DESC LIMIT 1
        ) comp ON TRUE
        WHERE jc.company_id = ${companyId}::uuid
          AND jc.deleted_at IS NULL
          AND (v.computed_status IS NULL OR v.computed_status NOT IN ('complete', 'closed'))
        GROUP BY jc.item_id
      ),
      po_pending AS (
        SELECT
          pol.item_id,
          SUM(GREATEST(0, pol.qty - COALESCE(grn_agg.received, 0)))::int AS qty
        FROM public.purchase_order_lines pol
        JOIN public.purchase_orders po ON po.id = pol.purchase_order_id
        LEFT JOIN (
          SELECT
            grnl.purchase_order_line_id AS po_line_id,
            SUM(grnl.received_qty) AS received
          FROM public.goods_receipt_note_lines grnl
          JOIN public.goods_receipt_notes grn ON grn.id = grnl.goods_receipt_note_id
          WHERE grn.company_id = ${companyId}::uuid
            AND grn.deleted_at IS NULL
            AND grnl.deleted_at IS NULL
          GROUP BY grnl.purchase_order_line_id
        ) grn_agg ON grn_agg.po_line_id = pol.id
        WHERE pol.company_id = ${companyId}::uuid
          AND po.company_id = ${companyId}::uuid
          AND pol.deleted_at IS NULL
          AND po.deleted_at IS NULL
          AND po.status <> 'closed'
          AND pol.item_id IS NOT NULL
        GROUP BY pol.item_id
      ),
      -- Pieces physically at an OSP vendor: sent on an outward DC, not yet
      -- returned. Document-derived via v_osp_wip (ADR-066); deliberately NOT
      -- in the stock ledger (ADR-067), so it must be surfaced as its own
      -- column or the row silently understates where the material is.
      at_vendor AS (
        SELECT w.item_id, SUM(w.at_vendor_qty)::int AS qty
        FROM public.v_osp_wip w
        WHERE w.company_id = ${companyId}::uuid
          AND w.item_id IS NOT NULL
        GROUP BY w.item_id
      )
      SELECT
        i.id                                       AS item_id,
        i.code                                     AS item_code,
        i.name                                     AS item_name,
        i.material                                 AS material,
        i.uom::text                                AS uom,
        COALESCE(s.on_hand_qty, 0)::int            AS in_stock,
        i.min_stock_qty                            AS min_qty,
        COALESCE(po_pending.qty, 0)::int           AS on_po_qty,
        COALESCE(at_vendor.qty, 0)::int            AS at_vendor_qty,
        COALESCE(jc_open.qty, 0)::int              AS mfg_pending_qty
      FROM public.items i
      LEFT JOIN public.v_item_stock s
        ON s.item_id = i.id AND s.company_id = i.company_id
      LEFT JOIN jc_open ON jc_open.item_id = i.id
      LEFT JOIN po_pending ON po_pending.item_id = i.id
      LEFT JOIN at_vendor ON at_vendor.item_id = i.id
      WHERE i.company_id = ${companyId}::uuid
        AND i.deleted_at IS NULL
        ${searchFrag}
      ORDER BY i.code ASC
    `);

    type R = {
      item_id: string;
      item_code: string;
      item_name: string;
      material: string | null;
      uom: string;
      in_stock: number;
      min_qty: number;
      on_po_qty: number;
      at_vendor_qty: number;
      mfg_pending_qty: number;
    };
    const typed = result as unknown as R[];

    // RESERVED / AVAILABLE for every row in ONE read, through the shared
    // reservation library (ADR-180). `inStock` is untouched — it has always been
    // the physical shelf count and still is; what is new is that the screen can
    // now say how much of it is already promised to an order.
    const positions = await readStockPositions(
      tx,
      companyId,
      typed.map((r) => r.item_id),
    );

    const rows: StoreInventoryRow[] = typed.map((r) => {
      const inStock = Number(r.in_stock);
      const minQty = Number(r.min_qty);
      const reservedQty = Math.max(0, positions.get(r.item_id)?.reservedQty ?? 0);
      return {
        itemId: r.item_id,
        itemCode: r.item_code,
        itemName: r.item_name,
        material: r.material,
        uom: r.uom,
        inStock,
        reservedQty,
        availableQty: inStock - reservedQty,
        minQty,
        onPoQty: Number(r.on_po_qty),
        atVendorQty: Number(r.at_vendor_qty),
        mfgPendingQty: Number(r.mfg_pending_qty),
        lowStock: minQty > 0 && inStock <= minQty,
      };
    });

    const filteredRows =
      input.filter === 'low'
        ? rows.filter((r) => r.lowStock)
        : input.filter === 'zero'
          ? rows.filter((r) => r.inStock === 0)
          : rows;

    // Summary always reflects ALL items (legacy stat tiles show whole-master
    // counts regardless of active filter — clicking a tile sets the filter).
    const totalStockPieces = rows.reduce((s, r) => s + r.inStock, 0);
    const totalReservedPieces = rows.reduce((s, r) => s + r.reservedQty, 0);
    const summary = {
      totalItems: rows.length,
      totalStockPieces,
      totalReservedPieces,
      // Clamped at 0: a negative free-stock total would only ever be a data
      // fault, and showing it as a tile figure helps nobody.
      totalAvailablePieces: Math.max(0, totalStockPieces - totalReservedPieces),
      itemsInStockCount: rows.filter((r) => r.inStock > 0).length,
      lowStockCount: rows.filter((r) => r.lowStock).length,
      zeroStockCount: rows.filter((r) => r.inStock === 0).length,
    };

    return {
      generatedAt: new Date().toISOString(),
      filter: input.filter,
      rows: filteredRows,
      summary,
    };
  });
}

export async function adjustStock(
  input: AdjustStockInput,
  user: AuthContext,
): Promise<{ ok: true; stockAfter: number }> {
  // Tier gate (Item Master / Store). There was NO permission check here at all —
  // only the company check below — so any logged-in account, an L1 Viewer
  // included, could move on-hand stock through the API; the browser merely hid
  // the button. Changing a stock balance is `edit`, not `entry`: the balance is
  // an existing saved figure, so L2 Data Entry is correctly refused.
  await requireFormAccess(user, 'item_create', 'edit');
  const companyId = requireCompany(user);
  return withUserContext(user, async (tx) => {
    const itemRows = await tx
      .select({ id: items.id, code: items.code })
      .from(items)
      .where(
        and(eq(items.id, input.itemId), eq(items.companyId, companyId), isNull(items.deletedAt)),
      )
      .limit(1);
    const itm = itemRows[0];
    if (!itm) throw new NotFoundError(`Item ${input.itemId} not found`);

    await tx.execute(sql`SELECT 1 FROM public.items WHERE id = ${itm.id}::uuid FOR UPDATE`);

    const balRows = (await tx.execute(sql`
      SELECT COALESCE(on_hand_qty, 0)::int AS on_hand
      FROM public.v_item_stock
      WHERE company_id = ${companyId}::uuid AND item_id = ${itm.id}::uuid
    `)) as unknown as Array<{ on_hand: number }>;
    const stockBefore = Number(balRows[0]?.on_hand ?? 0);
    const stockAfter =
      input.direction === 'add' ? stockBefore + input.qty : stockBefore - input.qty;
    if (stockAfter < 0) {
      throw new ConflictError(
        `Cannot remove ${input.qty} — only ${stockBefore} available for ${itm.code}`,
      );
    }

    await tx.insert(storeTransactions).values({
      companyId,
      txnDate: new Date().toISOString().slice(0, 10),
      itemId: itm.id,
      itemCodeText: itm.code,
      txnType: input.direction === 'add' ? 'in' : 'out',
      qty: input.qty,
      sourceType: 'manual_adjust',
      sourceRef: `ADJ · ${itm.code}`,
      stockBefore,
      stockAfter,
      remarks: `Manual adjust: ${input.remarks}`,
      createdBy: user.id,
    });

    return { ok: true as const, stockAfter };
  });
}

export async function setMinStock(
  input: SetMinStockInput,
  user: AuthContext,
): Promise<{ ok: true; minQty: number }> {
  // Same hole as adjustStock: unguarded, so anyone logged in could reset the
  // low-stock threshold on any item. Min qty lives on a saved item row, so the
  // action is `edit`.
  await requireFormAccess(user, 'item_create', 'edit');
  const companyId = requireCompany(user);
  return withUserContext(user, async (tx) => {
    const result = await tx
      .update(items)
      .set({ minStockQty: input.minQty, updatedAt: new Date(), updatedBy: user.id })
      .where(
        and(eq(items.id, input.itemId), eq(items.companyId, companyId), isNull(items.deletedAt)),
      )
      .returning({ minStockQty: items.minStockQty });
    if (result.length === 0) throw new NotFoundError(`Item ${input.itemId} not found`);
    return { ok: true as const, minQty: result[0]!.minStockQty };
  });
}

// ─── Stock booking reads (ADR-180) ────────────────────────────────────────

/**
 * The three numbers for ONE item — PHYSICAL, RESERVED, AVAILABLE.
 *
 * Every screen that wants to say "you may still promise N" reads this and
 * nothing else, so no two screens can compute it differently. Read-only, gated
 * by the same form key as the Store screen it sits on.
 */
export async function getStockAvailability(
  itemId: string,
  user: AuthContext,
): Promise<StockAvailability> {
  // Readable by whoever may open Store/Inventory OR SO Planning: the Allocate
  // box needs the live figure and a planner is not required to hold Item
  // Master rights. Without this they got a silent 403 and the box quietly fell
  // back to the sheet's numbers, which can be a minute stale — the cap it
  // enforces would then be wrong with nothing on screen to say so.
  await requireAnyFormAccess(user, [
    ['item_create', 'view'],
    ['plan_create', 'view'],
  ]);
  const companyId = requireCompany(user);
  return withUserContext(user, async (tx) => {
    const itemRows = await tx
      .select({ id: items.id, code: items.code })
      .from(items)
      .where(and(eq(items.id, itemId), eq(items.companyId, companyId), isNull(items.deletedAt)))
      .limit(1);
    const itm = itemRows[0];
    if (!itm) throw new NotFoundError(`Item ${itemId} not found`);

    const position = await readStockPosition(tx, companyId, itm.id);
    return { itemId: itm.id, itemCode: itm.code, ...position };
  });
}

/**
 * "Where is my stock reserved?" — the drill-down behind the Reserved figure.
 *
 * Default is the rows that still hold stock; `includeClosed` adds the settled
 * history (dispatched, released, cancelled) for anyone auditing what happened
 * to a booking. `totalReserved` counts only what is still held, so it matches
 * the Reserved column on the Store screen whichever view is showing.
 */
export async function listReservations(
  query: ListReservationsQuery,
  user: AuthContext,
): Promise<ListReservationsResponse> {
  await requireFormAccess(user, 'item_create', 'view');
  const companyId = requireCompany(user);

  return withUserContext(user, async (tx) => {
    const filters = [
      eq(soStockReservations.companyId, companyId),
      isNull(soStockReservations.deletedAt),
    ];
    if (!query.includeClosed) {
      filters.push(sql`${soStockReservations.status} IN ('active', 'partially_consumed')`);
    }
    if (query.itemId) filters.push(eq(soStockReservations.itemId, query.itemId));
    if (query.soLineId) filters.push(eq(soStockReservations.soLineId, query.soLineId));
    if (query.salesOrderId) filters.push(eq(salesOrderLines.salesOrderId, query.salesOrderId));

    const rows = await tx
      .select({
        r: soStockReservations,
        itemCode: items.code,
        salesOrderId: salesOrderLines.salesOrderId,
        // The customer's drawing revision typed on the SO line, cast for the
        // same pre-0119 reason every other itemRevision read gives. Null for a
        // job-work line, which has no sales-order line behind it.
        itemRevision: sql<string | null>`${salesOrderLines.revision}::text`,
        // POL — the line number on the CUSTOMER's own purchase order, off the
        // SAME SO line as the revision above. Not `lineNo`, which is the
        // snapshot of OUR line number already on the reservation row.
        clientPoLineNo: salesOrderLines.clientPoLineNo,
        clientName: clients.name,
        soCustomerName: salesOrders.customerName,
        productionOrderCode: productionOrders.code,
        jobCardCode: jobCards.code,
        reservedByName: users.fullName,
      })
      .from(soStockReservations)
      .leftJoin(items, eq(items.id, soStockReservations.itemId))
      .leftJoin(
        salesOrderLines,
        and(
          eq(salesOrderLines.id, soStockReservations.soLineId),
          isNull(salesOrderLines.deletedAt),
        ),
      )
      .leftJoin(salesOrders, eq(salesOrders.id, salesOrderLines.salesOrderId))
      .leftJoin(clients, eq(clients.id, salesOrders.clientId))
      .leftJoin(productionOrders, eq(productionOrders.id, soStockReservations.productionOrderId))
      .leftJoin(jobCards, eq(jobCards.id, soStockReservations.jobCardId))
      .leftJoin(users, eq(users.id, soStockReservations.createdBy))
      .where(and(...filters))
      .orderBy(desc(soStockReservations.createdAt));

    const detail: ReservationDetail[] = rows.map((row) => {
      const r = row.r;
      const remainingQty = Math.max(0, r.qty - r.consumedQty - r.releasedQty);
      return {
        id: r.id,
        itemId: r.itemId,
        itemCode: row.itemCode ?? r.itemCodeText,
        soLineId: r.soLineId,
        soCodeText: r.soCodeText,
        lineNo: r.lineNo,
        // The client master is the live name; the SO's own snapshot is the
        // fallback for an order raised before a client row existed.
        customerName: row.clientName ?? row.soCustomerName ?? null,
        itemRevision: row.itemRevision ?? null,
        clientPoLineNo: row.clientPoLineNo ?? null,
        qty: r.qty,
        consumedQty: r.consumedQty,
        releasedQty: r.releasedQty,
        remainingQty,
        source: r.reservationSource === 'auto_production' ? 'auto_production' : 'manual',
        status: r.status as ReservationDetail['status'],
        productionOrderId: r.productionOrderId,
        productionOrderCode: row.productionOrderCode ?? null,
        jobCardId: r.jobCardId,
        jobCardCode: row.jobCardCode ?? null,
        salesOrderId: row.salesOrderId ?? null,
        reservedAt: r.createdAt.toISOString(),
        reservedByName: row.reservedByName ?? null,
        remarks: r.remarks,
      };
    });

    const totalReserved = detail.reduce(
      (s, d) =>
        d.status === 'active' || d.status === 'partially_consumed' ? s + d.remainingQty : s,
      0,
    );
    return { rows: detail, totalReserved };
  });
}

void ValidationError;
