// AL-015 — OSP PRs pending PO (purchase). Legacy line 22285-22286.
// Legacy filter: prType==='JW_OSP' AND status IN ('Pending','Approved').
//
// Our schema doesn't carry a `pr_type` enum; outsourcing PRs are
// identifiable by `source_jc_op_id IS NOT NULL` (per ADR-015 #5: outsource
// ops link to PRs/POs via FK columns on jc_ops). Filter: PR has a
// jc_op source link AND status IN ('open', 'approved') AND no PO has
// been created yet (po_id IS NULL — same gate as the dashboard
// "PRs pending PO" tile).

import { sql } from 'drizzle-orm';
import type { RegisteredAlert } from '../registry';

export const al015OspPrsPendingPo: RegisteredAlert = {
  definition: {
    code: 'AL-015',
    dept: 'purchase',
    name: 'OSP PRs pending PO',
    description:
      'Outsourcing-process purchase requests (linked to a JC op) that are open/approved with no PO yet.',
    columns: [
      { key: 'pr_code', label: 'PR no.', type: 'text' },
      { key: 'pr_date', label: 'PR date', type: 'date' },
      { key: 'jc_code', label: 'JC', type: 'text' },
      { key: 'op_seq', label: 'Op', type: 'number' },
      { key: 'vendor', label: 'Vendor', type: 'text' },
      { key: 'item', label: 'Item', type: 'text' },
      { key: 'status', label: 'Status', type: 'text' },
    ],
    defaultActive: true,
  },
  async run({ tx, companyId }) {
    const result = await tx.execute(sql`
      SELECT pr.code AS pr_code, pr.pr_date,
             jc.code AS jc_code, jo.op_seq,
             COALESCE(v.code, pr.vendor_code_text, '') AS vendor,
             COALESCE(i.code, pr.item_code_text, '') AS item, pr.status
      FROM public.purchase_requests pr
      JOIN public.jc_ops jo ON jo.id = pr.source_jc_op_id
      JOIN public.job_cards jc ON jc.id = jo.job_card_id
      LEFT JOIN public.vendors v ON v.id = pr.vendor_id
      LEFT JOIN public.items i ON i.id = pr.item_id
      WHERE pr.company_id = ${companyId}::uuid
        AND pr.deleted_at IS NULL
        AND pr.status IN ('open', 'approved')
        AND pr.po_id IS NULL
      ORDER BY pr.pr_date, pr.code
    `);
    const rows = (result as unknown as Array<Record<string, unknown>>).map((r) => ({
      pr_code: (r['pr_code'] as string) ?? '',
      pr_date:
        r['pr_date'] instanceof Date
          ? r['pr_date'].toISOString().slice(0, 10)
          : String(r['pr_date'] ?? ''),
      jc_code: (r['jc_code'] as string) ?? '',
      op_seq: r['op_seq'] != null ? Number(r['op_seq']) : 0,
      vendor: (r['vendor'] as string) ?? '',
      item: (r['item'] as string) ?? '',
      status: (r['status'] as string) ?? '',
    }));
    return { records: rows };
  },
};
