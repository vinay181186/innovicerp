// Related Documents for one vendor (ADR-190) — GET /vendors/:id/related.
// Read-only, every edge a real FK:
//   purchase_orders.vendor_id     → Purchase Orders
//   delivery_challans.vendor_id   → Delivery Challans (material sent out to them)
//   goods_receipt_notes.vendor_id → GRNs (material received from them)
// Each section lists the newest MASTER_RELATED_ROW_CAP rows; its count is the
// full number.

import type { DocumentTraceability } from '@innovic/shared';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { vendors } from '../../db/schema';
import { type AuthContext, withUserContext } from '../../db/with-user-context';
import { AuthorizationError, NotFoundError } from '../../lib/errors';
import { buildTimeline, MASTER_RELATED_ROW_CAP, masterSection } from '../../lib/traceability';

export async function getVendorRelated(
  id: string,
  user: AuthContext,
): Promise<DocumentTraceability> {
  const companyId = user.companyId;
  if (!companyId) throw new AuthorizationError('User is not assigned to a company');
  return withUserContext(user, async (tx) => {
    const found = await tx
      .select({ id: vendors.id, code: vendors.code })
      .from(vendors)
      .where(and(eq(vendors.id, id), eq(vendors.companyId, companyId), isNull(vendors.deletedAt)))
      .limit(1);
    const vendor = found[0];
    if (!vendor) throw new NotFoundError('Vendor not found. It may have been moved to Trash.');

    const poRaw = await tx.execute(sql`
      SELECT po.id, po.code, po.status::text AS status, po.po_date AS date,
             NULL::text AS label, count(*) OVER () AS total
      FROM public.purchase_orders po
      WHERE po.company_id = ${companyId}::uuid AND po.deleted_at IS NULL
        AND po.vendor_id = ${id}::uuid
      ORDER BY po.po_date DESC, po.code DESC
      LIMIT ${MASTER_RELATED_ROW_CAP}
    `);
    const dcRaw = await tx.execute(sql`
      SELECT dc.id, dc.code, dc.status::text AS status, dc.dc_date AS date,
             dc.po_code_text AS label, count(*) OVER () AS total
      FROM public.delivery_challans dc
      WHERE dc.company_id = ${companyId}::uuid AND dc.deleted_at IS NULL
        AND dc.vendor_id = ${id}::uuid
      ORDER BY dc.dc_date DESC, dc.code DESC
      LIMIT ${MASTER_RELATED_ROW_CAP}
    `);
    const grnRaw = await tx.execute(sql`
      SELECT g.id, g.code, NULL::text AS status, g.grn_date AS date,
             COALESCE(po.code, g.po_code_text) AS label, count(*) OVER () AS total
      FROM public.goods_receipt_notes g
      LEFT JOIN public.purchase_orders po ON po.id = g.purchase_order_id
      WHERE g.company_id = ${companyId}::uuid AND g.deleted_at IS NULL
        AND g.vendor_id = ${id}::uuid
      ORDER BY g.grn_date DESC, g.code DESC
      LIMIT ${MASTER_RELATED_ROW_CAP}
    `);

    const downstream = [
      masterSection('purchase-order', 'Purchase Orders', '\u{1F6D2}', 'purchase-order', poRaw),
      masterSection(
        'delivery-challan',
        'Delivery Challans Out',
        '\u{1F4E4}',
        'delivery-challan',
        dcRaw,
      ),
      masterSection('grn', 'GRNs', '\u{1F4E5}', 'grn', grnRaw),
    ];
    return {
      self: { module: 'vendors', code: vendor.code },
      upstream: [],
      downstream,
      related: [],
      timeline: buildTimeline(null, downstream),
    };
  });
}
