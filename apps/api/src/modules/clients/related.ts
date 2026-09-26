// Related Documents for one customer (ADR-190) — GET /clients/:id/related.
// Read-only, every edge a real FK:
//   sales_orders.client_id                          → Sales Orders
//   customer_dispatches.sales_order_id → that SO    → Customer Dispatches
//   invoices.client_id, status unpaid / partial     → Invoices with money still due
// Each section lists the newest MASTER_RELATED_ROW_CAP rows; its count is the
// full number. Customer dispatches have no detail page, so they are listed as
// reference text (routeKind null), never a dead link.

import type { DocumentTraceability } from '@innovic/shared';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { clients } from '../../db/schema';
import { type AuthContext, withUserContext } from '../../db/with-user-context';
import { canSeeFormPrice } from '../../lib/access';
import { AuthorizationError, NotFoundError } from '../../lib/errors';
import { buildTimeline, MASTER_RELATED_ROW_CAP, masterSection } from '../../lib/traceability';

export async function getClientRelated(
  id: string,
  user: AuthContext,
): Promise<DocumentTraceability> {
  const companyId = user.companyId;
  if (!companyId) throw new AuthorizationError('User is not assigned to a company');
  const showMoney = await canSeeFormPrice(user, 'invoice_create');
  return withUserContext(user, async (tx) => {
    const found = await tx
      .select({ id: clients.id, code: clients.code })
      .from(clients)
      .where(and(eq(clients.id, id), eq(clients.companyId, companyId), isNull(clients.deletedAt)))
      .limit(1);
    const client = found[0];
    if (!client) throw new NotFoundError('Customer not found. It may have been moved to Trash.');

    const soRaw = await tx.execute(sql`
      SELECT so.id, so.code, so.status::text AS status, so.so_date AS date,
             so.client_po_no AS label, count(*) OVER () AS total
      FROM public.sales_orders so
      WHERE so.company_id = ${companyId}::uuid AND so.deleted_at IS NULL
        AND so.client_id = ${id}::uuid
      ORDER BY so.so_date DESC, so.code DESC
      LIMIT ${MASTER_RELATED_ROW_CAP}
    `);
    const dispatchRaw = await tx.execute(sql`
      SELECT cd.id, cd.code, cd.status::text AS status, cd.dispatch_date AS date,
             so.code AS label, count(*) OVER () AS total
      FROM public.customer_dispatches cd
      JOIN public.sales_orders so ON so.id = cd.sales_order_id AND so.deleted_at IS NULL
      WHERE cd.company_id = ${companyId}::uuid AND cd.deleted_at IS NULL
        AND so.client_id = ${id}::uuid
      ORDER BY cd.dispatch_date DESC, cd.code DESC
      LIMIT ${MASTER_RELATED_ROW_CAP}
    `);
    // Outstanding = Grand Total − Paid; named only to those who may see money.
    const dueLabel = showMoney
      ? sql`'Due ' || to_char(inv.grand_total - inv.total_paid, 'FM99,99,99,99,990.00')`
      : sql`NULL::text`;
    const invoiceRaw = await tx.execute(sql`
      SELECT inv.id, inv.code, inv.status::text AS status, inv.invoice_date AS date,
             ${dueLabel} AS label, count(*) OVER () AS total
      FROM public.invoices inv
      WHERE inv.company_id = ${companyId}::uuid AND inv.deleted_at IS NULL
        AND inv.client_id = ${id}::uuid
        AND inv.status <> 'paid'
      ORDER BY inv.due_date ASC NULLS LAST, inv.code
      LIMIT ${MASTER_RELATED_ROW_CAP}
    `);

    const downstream = [
      masterSection('sales-order', 'Sales Orders', '\u{1F4CB}', 'sales-order', soRaw),
      masterSection('customer-dispatch', 'Customer Dispatches', '\u{1F69A}', null, dispatchRaw),
      masterSection('invoice', 'Invoices Outstanding', '\u{1F9FE}', 'invoice', invoiceRaw),
    ];
    return {
      self: { module: 'clients', code: client.code },
      upstream: [],
      downstream,
      related: [],
      timeline: buildTimeline(null, downstream),
    };
  });
}
