// Store / Inventory service (PL-SI-1).
//
// GET /store-inventory — per-item rollup of current stock + open PO pending
// + open JC pending. Mirrors legacy renderStore (HTML L24803). Plus the
// adjust-stock write (manual + / − with reason). Reorder Level / Reorder List /
// one-click PRs live in reorder.ts (ADR-193 phase 5).
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
  ReservationDetail,
  StockAvailability,
} from '@innovic/shared';
import { MANUAL_RECEIPT_SOURCE_LABEL } from '@innovic/shared';
import {
  clients,
  items,
  jobCards,
  productionOrders,
  salesOrderLines,
  salesOrders,
  soStockReservations,
  users,
} from '../../db/schema';
import { type AuthContext, withUserContext } from '../../db/with-user-context';
import { requireAnyFormAccess, requireFormAccess } from '../../lib/access';
import { AuthorizationError, NotFoundError, ValidationError } from '../../lib/errors';
import { readStockPosition } from '../../lib/stock-reservation';
import { readAssemblyReservationRows } from './assembly-reservations';
import { postStockMove } from '../../lib/stock-ledger';
import { emitActivityLog } from '../activity-log/service';

function requireCompany(user: AuthContext): string {
  if (!user.companyId) throw new AuthorizationError('User is not assigned to a company');
  return user.companyId;
}

// GET /store-inventory lives in ./list.ts (ADR-201 paging + server summary);
// re-exported so the route keeps calling service.listStoreInventory.
export { listStoreInventory } from './list';

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
  // Bought material enters stock through a GRN (PO link + incoming QC), never
  // as a Manual Receipt with Source = Purchase (store-manual-receipt#2).
  if (input.source === 'purchase') {
    throw new ValidationError(
      'Bought material is received through a GRN against its PO, not by Manual Receipt.',
    );
  }
  if (input.source && input.direction !== 'add') {
    throw new ValidationError('A Source is given only when stock is received (+ Add).');
  }
  const sourceNote = input.source ? `Source: ${MANUAL_RECEIPT_SOURCE_LABEL[input.source]} · ` : '';
  return withUserContext(user, async (tx) => {
    const itemRows = await tx
      .select({ id: items.id, code: items.code })
      .from(items)
      .where(
        and(eq(items.id, input.itemId), eq(items.companyId, companyId), isNull(items.deletedAt)),
      )
      .limit(1);
    const itm = itemRows[0];
    if (!itm)
      throw new NotFoundError('Selected Item was not found. Please select the Item Code again.');

    // ADR-193: via the single stock writer. A '−' may take only Available
    // stock — pieces booked for a customer SO must be released first.
    const { stockBefore, stockAfter } = await postStockMove(tx, {
      companyId,
      itemId: itm.id,
      txnType: input.direction === 'add' ? 'in' : 'out',
      qty: input.qty,
      sourceType: 'manual_adjust',
      sourceRef: `ADJ · ${itm.code}`,
      remarks: `Manual adjust: ${sourceNote}${input.remarks}`,
      txnDate: new Date().toISOString().slice(0, 10),
      userId: user.id,
      itemCodeText: itm.code,
      guard: 'available',
    });

    // ADR-189 — every manual stock change is on the activity log with its
    // reason; the ledger row itself cannot be edited or deleted (0149), so a
    // wrong adjustment is undone by an opposite one.
    await emitActivityLog(
      tx,
      {
        action: 'STOCK_ADJUST',
        entity: 'Store Inventory',
        detail: `${itm.code} ${input.direction === 'add' ? '+' : '−'}${input.qty} (stock ${stockBefore} → ${stockAfter}). ${sourceNote}Reason: ${input.remarks}`,
        refId: itm.code,
      },
      companyId,
      user,
    );

    return { ok: true as const, stockAfter };
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
    if (!itm) throw new NotFoundError('Item not found. Refresh the page.');

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

    // ADR-193 3c — parts held for an assembly SO live in their own table; list
    // them too so this drill-down totals the same Reserved as every Store screen.
    if (!query.soLineId) detail.push(...(await readAssemblyReservationRows(tx, companyId, query)));

    const totalReserved = detail.reduce(
      (s, d) =>
        d.status === 'active' || d.status === 'partially_consumed' ? s + d.remainingQty : s,
      0,
    );
    return { rows: detail, totalReserved };
  });
}

void ValidationError;
