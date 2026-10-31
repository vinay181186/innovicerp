// AL-015 — OSP PRs pending PO (purchase). Legacy line 22285-22286.
// Legacy filter: prType==='JW_OSP' AND status IN ('Pending','Approved').
//
// Our schema doesn't carry a `pr_type` enum; outsourcing PRs are
// identifiable by `source_jc_op_id IS NOT NULL` (per ADR-015 #5: outsource
// ops link to PRs/POs via FK columns on jc_ops). Filter: PR has a
// jc_op source link AND status IN ('open', 'approved') AND no PO has
// been created yet (po_id IS NULL — same gate as the dashboard
// "PRs pending PO" tile).

import { docNavPage } from '@innovic/shared';
import { sql } from 'drizzle-orm';
import { polSql } from '../../../lib/pol';
import type { RegisteredAlert } from '../registry';

export const al015OspPrsPendingPo: RegisteredAlert = {
  definition: {
    code: 'AL-015',
    dept: 'purchase',
    name: 'OSP PRs Pending PO',
    description: 'OSP PRs (raised from a JC operation) that are Open or Approved with no PO yet.',
    columns: [
      // ADR-261 lead columns: SO No. · Internal SO No. · POL · Created On ·
      // Item Code (CODE/REV) · Item Name, then the rest.
      { key: 'pr_code', label: 'PR No.', type: 'text' },
      { key: 'pr_date', label: 'PR Date', type: 'date' },
      { key: 'so_code', label: 'SO No.', type: 'text' },
      { key: 'so_internal_no', label: 'Internal SO No.', type: 'text' },
      { key: 'client_po_line_no', label: 'POL', type: 'text' },
      { key: 'created_on', label: 'Created On', type: 'date' },
      { key: 'item_code', label: 'Item Code', type: 'text' },
      { key: 'item_name', label: 'Item Name', type: 'text' },
      { key: 'jc_code', label: 'JC No.', type: 'text' },
      { key: 'op_seq', label: 'Op', type: 'number' },
      { key: 'vendor', label: 'Vendor', type: 'text' },
      { key: 'status', label: 'PR Status', type: 'text' },
    ],
    defaultActive: true,
  },
  async run({ tx, companyId }) {
    const result = await tx.execute(sql`
      SELECT pr.id AS nav_id,
             COALESCE(so.code, jwo.code) AS so_code, so.internal_so_no AS so_internal_no,
             ${polSql('sol', 'jwl')} AS client_po_line_no,
             (pr.created_at AT TIME ZONE 'Asia/Kolkata')::date::text AS created_on,
             (COALESCE(i.code, pr.item_code_text, '')
               || COALESCE('/' || NULLIF(btrim(COALESCE(sol.revision::text, jwl.revision::text)), ''), '')) AS item_code,
             COALESCE(i.name, pr.item_name) AS item_name,
             pr.code AS pr_code, pr.pr_date,
             jc.code AS jc_code, jo.op_seq,
             COALESCE(v.code, pr.vendor_code_text, '') AS vendor, pr.status
      FROM public.purchase_requests pr
      JOIN public.jc_ops jo ON jo.id = pr.source_jc_op_id
      JOIN public.job_cards jc ON jc.id = jo.job_card_id
      LEFT JOIN public.vendors v ON v.id = pr.vendor_id
      LEFT JOIN public.items i ON i.id = pr.item_id
      -- The order line: the PR's own SO line, else the JC's SO / JW line.
      LEFT JOIN public.sales_order_lines sol
        ON sol.id = COALESCE(pr.source_so_line_id, jc.source_so_line_id)
      LEFT JOIN public.sales_orders so ON so.id = sol.sales_order_id
      LEFT JOIN public.job_work_order_lines jwl ON jwl.id = jc.source_jw_line_id
      LEFT JOIN public.job_work_orders jwo ON jwo.id = jwl.job_work_order_id
      WHERE pr.company_id = ${companyId}::uuid
        AND pr.deleted_at IS NULL
        AND pr.status IN ('open', 'approved')
        AND pr.po_id IS NULL
      ORDER BY pr.pr_date, pr.code
    `);
    const rows = (result as unknown as Array<Record<string, unknown>>).map((r) => ({
      navPage: docNavPage('purchase-request', String(r['nav_id'])),
      so_code: (r['so_code'] as string | null) ?? '',
      so_internal_no: (r['so_internal_no'] as string | null) ?? '',
      client_po_line_no: (r['client_po_line_no'] as string | null) ?? '',
      created_on: String(r['created_on'] ?? ''),
      item_code: (r['item_code'] as string | null) ?? '',
      item_name: (r['item_name'] as string | null) ?? '',
      pr_code: (r['pr_code'] as string) ?? '',
      pr_date:
        r['pr_date'] instanceof Date
          ? r['pr_date'].toISOString().slice(0, 10)
          : String(r['pr_date'] ?? ''),
      jc_code: (r['jc_code'] as string) ?? '',
      op_seq: r['op_seq'] != null ? Number(r['op_seq']) : 0,
      vendor: (r['vendor'] as string) ?? '',
      status: (r['status'] as string) ?? '',
    }));
    return { records: rows };
  },
};
