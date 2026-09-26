// ADR-184 — what downstream work already hangs off each Sales Order line.
//
// ERPNext refuses to cut an SO line below what is already delivered / billed /
// on a work order, and refuses to cancel or delete an SO whose lines carry
// submitted documents. This module is the one read those guards share: per SO
// line, the plans, production orders, customer dispatches and invoices that
// would be orphaned if the line shrank, vanished or was cancelled.
//
// The SO lines are locked FOR UPDATE first, so a plan / dispatch / invoice
// raised in parallel against the same line waits for this save to finish
// instead of slipping in between the check and the write.

import { and, eq, inArray, isNull, ne } from 'drizzle-orm';
import {
  customerDispatchLines,
  customerDispatches,
  invoiceLines,
  invoices,
  items,
  plans,
  productionOrders,
  salesOrderLines,
} from '../../db/schema';
import type { DbTransaction } from '../../db/with-user-context';

export interface SoLineCommitment {
  lineId: string;
  lineNo: number;
  /** Item code for messages — master code, else the line's text snapshot. */
  itemCode: string | null;
  orderQty: number;
  status: string;
  /** Σ plan_qty of live plans (not deleted, not cancelled) on this line. */
  plannedQty: number;
  /** Σ order_qty of live production orders raised from those plans. */
  orderedQty: number;
  /** sales_order_lines.dispatched_qty (kept by the customer-dispatches service). */
  dispatchedQty: number;
  /** Σ invoice_lines.qty of live invoice lines on this line. */
  invoicedQty: number;
  planCodes: string[];
  orderCodes: string[];
  dispatchCodes: string[];
  invoiceCodes: string[];
}

function pushUnique(list: string[], code: string | null | undefined): void {
  if (code && !list.includes(code)) list.push(code);
}

/**
 * Lock the given SO lines FOR UPDATE and return, per line, what is already
 * committed downstream. Lines not found (other company / already deleted) are
 * simply absent from the map.
 */
export async function readSoLineCommitments(
  tx: DbTransaction,
  companyId: string,
  lineIds: string[],
): Promise<Map<string, SoLineCommitment>> {
  const out = new Map<string, SoLineCommitment>();
  if (lineIds.length === 0) return out;

  const lines = await tx
    .select({
      id: salesOrderLines.id,
      lineNo: salesOrderLines.lineNo,
      itemId: salesOrderLines.itemId,
      itemCodeText: salesOrderLines.itemCodeText,
      orderQty: salesOrderLines.orderQty,
      status: salesOrderLines.status,
      dispatchedQty: salesOrderLines.dispatchedQty,
    })
    .from(salesOrderLines)
    .where(
      and(
        inArray(salesOrderLines.id, lineIds),
        eq(salesOrderLines.companyId, companyId),
        isNull(salesOrderLines.deletedAt),
      ),
    )
    .for('update');
  if (lines.length === 0) return out;

  const itemIds = [...new Set(lines.flatMap((l) => (l.itemId ? [l.itemId] : [])))];
  const itemCodeById = new Map<string, string>();
  if (itemIds.length > 0) {
    const itemRows = await tx
      .select({ id: items.id, code: items.code })
      .from(items)
      .where(and(inArray(items.id, itemIds), eq(items.companyId, companyId)));
    for (const r of itemRows) itemCodeById.set(r.id, r.code);
  }

  for (const l of lines) {
    out.set(l.id, {
      lineId: l.id,
      lineNo: l.lineNo,
      itemCode: (l.itemId ? itemCodeById.get(l.itemId) : undefined) ?? l.itemCodeText ?? null,
      orderQty: Number(l.orderQty),
      status: l.status,
      plannedQty: 0,
      orderedQty: 0,
      dispatchedQty: Number(l.dispatchedQty ?? 0),
      invoicedQty: 0,
      planCodes: [],
      orderCodes: [],
      dispatchCodes: [],
      invoiceCodes: [],
    });
  }
  const ids = [...out.keys()];

  // Live plans on these lines.
  const planRows = await tx
    .select({
      id: plans.id,
      soLineId: plans.soLineId,
      code: plans.code,
      planQty: plans.planQty,
    })
    .from(plans)
    .where(
      and(
        inArray(plans.soLineId, ids),
        eq(plans.companyId, companyId),
        isNull(plans.deletedAt),
        ne(plans.planStatus, 'cancelled'),
      ),
    );
  const lineIdByPlanId = new Map<string, string>();
  for (const p of planRows) {
    if (!p.soLineId) continue;
    const c = out.get(p.soLineId);
    if (!c) continue;
    c.plannedQty += Number(p.planQty);
    pushUnique(c.planCodes, p.code);
    lineIdByPlanId.set(p.id, p.soLineId);
  }

  // Live production orders raised from those plans.
  const planIds = [...lineIdByPlanId.keys()];
  if (planIds.length > 0) {
    const orderRows = await tx
      .select({
        planId: productionOrders.planId,
        code: productionOrders.code,
        orderQty: productionOrders.orderQty,
      })
      .from(productionOrders)
      .where(
        and(
          inArray(productionOrders.planId, planIds),
          eq(productionOrders.companyId, companyId),
          isNull(productionOrders.deletedAt),
        ),
      );
    for (const o of orderRows) {
      const c = out.get(lineIdByPlanId.get(o.planId) ?? '');
      if (!c) continue;
      c.orderedQty += Number(o.orderQty);
      pushUnique(c.orderCodes, o.code);
    }
  }

  // Live customer dispatches (a cancelled dispatch has already given its qty back).
  const dispatchRows = await tx
    .select({
      soLineId: customerDispatchLines.salesOrderLineId,
      code: customerDispatches.code,
    })
    .from(customerDispatchLines)
    .innerJoin(
      customerDispatches,
      eq(customerDispatches.id, customerDispatchLines.customerDispatchId),
    )
    .where(
      and(
        inArray(customerDispatchLines.salesOrderLineId, ids),
        eq(customerDispatchLines.companyId, companyId),
        isNull(customerDispatchLines.deletedAt),
        isNull(customerDispatches.deletedAt),
        ne(customerDispatches.status, 'cancelled'),
      ),
    );
  for (const d of dispatchRows) {
    const c = out.get(d.soLineId ?? '');
    if (c) pushUnique(c.dispatchCodes, d.code);
  }

  // Live invoice lines.
  const invoiceRows = await tx
    .select({
      soLineId: invoiceLines.salesOrderLineId,
      code: invoices.code,
      qty: invoiceLines.qty,
    })
    .from(invoiceLines)
    .innerJoin(invoices, eq(invoices.id, invoiceLines.invoiceId))
    .where(
      and(
        inArray(invoiceLines.salesOrderLineId, ids),
        eq(invoiceLines.companyId, companyId),
        isNull(invoiceLines.deletedAt),
        isNull(invoices.deletedAt),
      ),
    );
  for (const i of invoiceRows) {
    const c = out.get(i.soLineId ?? '');
    if (!c) continue;
    c.invoicedQty += Number(i.qty);
    pushUnique(c.invoiceCodes, i.code);
  }

  return out;
}

/** "Line 9 (554117187000)" — how every guard message names a line. */
export function lineLabel(c: SoLineCommitment): string {
  return c.itemCode ? `Line ${c.lineNo} (${c.itemCode})` : `Line ${c.lineNo}`;
}

/** True when anything downstream still hangs off the line. */
export function hasCommitments(c: SoLineCommitment): boolean {
  return (
    c.planCodes.length > 0 ||
    c.orderCodes.length > 0 ||
    c.dispatchCodes.length > 0 ||
    c.invoiceCodes.length > 0 ||
    c.dispatchedQty > 0
  );
}

/** "plan PLN-0013, production order PO-0004, invoice INV-0002" */
export function describeCommitments(c: SoLineCommitment): string {
  const parts: string[] = [];
  const add = (one: string, many: string, codes: string[]): void => {
    if (codes.length > 0) parts.push(`${codes.length > 1 ? many : one} ${codes.join(', ')}`);
  };
  add('plan', 'plans', c.planCodes);
  add('production order', 'production orders', c.orderCodes);
  add('dispatch', 'dispatches', c.dispatchCodes);
  add('invoice', 'invoices', c.invoiceCodes);
  if (parts.length === 0 && c.dispatchedQty > 0)
    parts.push(`${c.dispatchedQty} already dispatched`);
  return parts.join(', ');
}

/**
 * The reason a line may not drop to `newQty`, or null when it may. The floor
 * is the largest of what is planned, dispatched and invoiced (production
 * orders are already capped by their plan, so the plan floor covers them).
 */
export function qtyReductionBlocker(c: SoLineCommitment, newQty: number): string | null {
  const floors: Array<{ qty: number; text: string }> = [
    {
      qty: c.plannedQty,
      text: `${c.plannedQty} already planned in ${c.planCodes.join(', ')}. Reduce the plan first.`,
    },
    {
      qty: c.dispatchedQty,
      text: `${c.dispatchedQty} already dispatched${
        c.dispatchCodes.length > 0 ? ` in ${c.dispatchCodes.join(', ')}` : ''
      }. Cancel the dispatch first.`,
    },
    {
      qty: c.invoicedQty,
      text: `${c.invoicedQty} already invoiced in ${c.invoiceCodes.join(', ')}. Remove the invoice first.`,
    },
  ];
  const worst = floors.reduce((a, b) => (b.qty > a.qty ? b : a));
  if (newQty >= worst.qty) return null;
  return `${lineLabel(c)}: cannot reduce to ${newQty} — ${worst.text}`;
}

const MAX_CODES_IN_MESSAGE = 10;

function codeList(codes: string[]): string {
  if (codes.length <= MAX_CODES_IN_MESSAGE) return codes.join(', ');
  return `${codes.slice(0, MAX_CODES_IN_MESSAGE).join(', ')} and ${codes.length - MAX_CODES_IN_MESSAGE} more`;
}

/**
 * ADR-184 — every live document that hangs off a whole Sales Order: the
 * line-level plans / production orders / dispatches / invoices, plus any
 * dispatch or invoice tied to the SO header itself (an invoice line may carry
 * no SO line id). Returns '' when nothing blocks, else a readable list such as
 * "plans PLN-0013, PLN-0014; invoice INV-0002". Locks the SO's lines.
 */
export async function describeSoBlockingDocuments(
  tx: DbTransaction,
  companyId: string,
  salesOrderId: string,
): Promise<string> {
  const lineRows = await tx
    .select({ id: salesOrderLines.id })
    .from(salesOrderLines)
    .where(
      and(
        eq(salesOrderLines.salesOrderId, salesOrderId),
        eq(salesOrderLines.companyId, companyId),
        isNull(salesOrderLines.deletedAt),
      ),
    );
  const commitments = await readSoLineCommitments(
    tx,
    companyId,
    lineRows.map((l) => l.id),
  );

  const planCodes: string[] = [];
  const orderCodes: string[] = [];
  const dispatchCodes: string[] = [];
  const invoiceCodes: string[] = [];
  let dispatchedWithoutDoc = 0;
  for (const c of commitments.values()) {
    c.planCodes.forEach((x) => pushUnique(planCodes, x));
    c.orderCodes.forEach((x) => pushUnique(orderCodes, x));
    c.dispatchCodes.forEach((x) => pushUnique(dispatchCodes, x));
    c.invoiceCodes.forEach((x) => pushUnique(invoiceCodes, x));
    if (c.dispatchCodes.length === 0) dispatchedWithoutDoc += c.dispatchedQty;
  }

  const hdrDispatches = await tx
    .select({ code: customerDispatches.code })
    .from(customerDispatches)
    .where(
      and(
        eq(customerDispatches.salesOrderId, salesOrderId),
        eq(customerDispatches.companyId, companyId),
        isNull(customerDispatches.deletedAt),
        ne(customerDispatches.status, 'cancelled'),
      ),
    );
  hdrDispatches.forEach((d) => pushUnique(dispatchCodes, d.code));

  const hdrInvoices = await tx
    .select({ code: invoices.code })
    .from(invoices)
    .where(
      and(
        eq(invoices.salesOrderId, salesOrderId),
        eq(invoices.companyId, companyId),
        isNull(invoices.deletedAt),
      ),
    );
  hdrInvoices.forEach((i) => pushUnique(invoiceCodes, i.code));

  const parts: string[] = [];
  const add = (one: string, many: string, codes: string[]): void => {
    if (codes.length > 0) parts.push(`${codes.length > 1 ? many : one} ${codeList(codes)}`);
  };
  add('plan', 'plans', planCodes);
  add('production order', 'production orders', orderCodes);
  add('dispatch', 'dispatches', dispatchCodes);
  add('invoice', 'invoices', invoiceCodes);
  if (dispatchCodes.length === 0 && dispatchedWithoutDoc > 0) {
    parts.push(`${dispatchedWithoutDoc} pcs already dispatched`);
  }
  return parts.join('; ');
}
