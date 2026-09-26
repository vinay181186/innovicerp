// Related Documents for one item (ADR-189) — GET /items/:id/related.
// Read-only, every edge a real FK:
//   purchase_requests.item_id, PR Status open / approved → Open PRs (not yet on a PO)
//   purchase_order_lines.item_id → the PO                 → Purchase Orders
//   goods_receipt_note_lines.item_id → the GRN            → GRNs
// Each section lists the newest MASTER_RELATED_ROW_CAP rows; its count is the
// full number.

import type { DocumentTraceability } from '@innovic/shared';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { items } from '../../db/schema';
import { type AuthContext, withUserContext } from '../../db/with-user-context';
import { AuthorizationError, NotFoundError } from '../../lib/errors';
import { buildTimeline, MASTER_RELATED_ROW_CAP, masterSection } from '../../lib/traceability';

export async function getItemRelated(id: string, user: AuthContext): Promise<DocumentTraceability> {
  const companyId = user.companyId;
  if (!companyId) throw new AuthorizationError('User is not assigned to a company');
  return withUserContext(user, async (tx) => {
    const found = await tx
      .select({ id: items.id, code: items.code })
      .from(items)
      .where(and(eq(items.id, id), eq(items.companyId, companyId), isNull(items.deletedAt)))
      .limit(1);
    const item = found[0];
    if (!item) throw new NotFoundError('Item not found. It may have been moved to Trash.');

    const prRaw = await tx.execute(sql`
      SELECT pr.id, pr.code, pr.status::text AS status, pr.pr_date AS date,
             'PR Qty ' || pr.qty AS label, count(*) OVER () AS total
      FROM public.purchase_requests pr
      WHERE pr.company_id = ${companyId}::uuid AND pr.deleted_at IS NULL
        AND pr.item_id = ${id}::uuid
        AND pr.status IN ('open', 'approved')
      ORDER BY pr.pr_date DESC, pr.code DESC
      LIMIT ${MASTER_RELATED_ROW_CAP}
    `);
    const poRaw = await tx.execute(sql`
      SELECT po.id, po.code, po.status::text AS status, po.po_date AS date,
             v.name AS label, count(*) OVER () AS total
      FROM public.purchase_orders po
      LEFT JOIN public.vendors v ON v.id = po.vendor_id
      WHERE po.company_id = ${companyId}::uuid AND po.deleted_at IS NULL
        AND EXISTS (
          SELECT 1 FROM public.purchase_order_lines pol
          WHERE pol.purchase_order_id = po.id AND pol.deleted_at IS NULL
            AND pol.item_id = ${id}::uuid
        )
      ORDER BY po.po_date DESC, po.code DESC
      LIMIT ${MASTER_RELATED_ROW_CAP}
    `);
    const grnRaw = await tx.execute(sql`
      SELECT g.id, g.code, NULL::text AS status, g.grn_date AS date,
             v.name AS label, count(*) OVER () AS total
      FROM public.goods_receipt_notes g
      LEFT JOIN public.vendors v ON v.id = g.vendor_id
      WHERE g.company_id = ${companyId}::uuid AND g.deleted_at IS NULL
        AND EXISTS (
          SELECT 1 FROM public.goods_receipt_note_lines gl
          WHERE gl.goods_receipt_note_id = g.id AND gl.deleted_at IS NULL
            AND gl.item_id = ${id}::uuid
        )
      ORDER BY g.grn_date DESC, g.code DESC
      LIMIT ${MASTER_RELATED_ROW_CAP}
    `);

    const downstream = [
      masterSection(
        'purchase-request',
        'Open Purchase Requests',
        '\u{1F4DD}',
        'purchase-request',
        prRaw,
      ),
      masterSection('purchase-order', 'Purchase Orders', '\u{1F6D2}', 'purchase-order', poRaw),
      masterSection('grn', 'GRNs', '\u{1F4E5}', 'grn', grnRaw),
    ];
    return {
      self: { module: 'items', code: item.code },
      upstream: [],
      downstream,
      related: [],
      timeline: buildTimeline(null, downstream),
    };
  });
}
