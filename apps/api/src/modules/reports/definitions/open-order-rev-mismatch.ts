// ADR-292 report 2 — open work on the wrong Drawing Rev.
//   • open SO / JWSO lines whose Rev is not Released (Not released, Under
//     Review, Approved, Rejected, Obsolete, Unverified) or is older than the
//     item's latest Released Rev;
//   • open Job Cards whose Rev differs from their order line's Rev.

import { REV_RELEASE_STATUS_LABELS, type RevReleaseStatus } from '@innovic/shared';
import { sql } from 'drizzle-orm';
import type { RegisteredReport } from '../registry';
import { likeFilter, REPORT_ROW_CAP, textCell, type SqlRow } from './report-helpers';

const DONE = sql`('closed', 'dispatched', 'cancelled')`;

export const openOrderRevMismatchReport: RegisteredReport = {
  definition: {
    slug: 'open-order-rev-mismatch',
    title: 'Open Order Rev Mismatch',
    description:
      'Open SO / JWSO lines whose Drawing Rev is not Released or is older than the latest Released Rev, and open Job Cards whose Drawing Rev differs from their order line.',
    group: 'Design',
    dept: 'design',
    filters: [{ key: 'item', label: 'Item', kind: 'text', placeholder: 'Item code or name' }],
    columns: [
      { key: 'found_on', label: 'Found On', type: 'text' },
      { key: 'doc_code', label: 'Document', type: 'text' },
      { key: 'customer', label: 'Customer', type: 'text' },
      { key: 'item_code', label: 'Item Code', type: 'text' },
      { key: 'item_name', label: 'Item Name', type: 'text' },
      { key: 'doc_rev', label: 'Document Rev', type: 'text' },
      { key: 'doc_rev_status', label: 'Rev Release Status', type: 'text' },
      { key: 'expected_rev', label: 'Expected Rev', type: 'text' },
      { key: 'problem', label: 'Problem', type: 'text' },
    ],
  },
  async run({ tx, companyId, filters }) {
    const item = likeFilter(filters['item']);
    const itemFrag = item ? sql`AND (i.code ILIKE ${item} OR i.name ILIKE ${item})` : sql``;
    const result = await tx.execute(sql`
      WITH latest AS (
        SELECT DISTINCT ON (item_id) item_id, id, rev
          FROM public.item_revisions
         WHERE company_id = ${companyId}::uuid AND deleted_at IS NULL AND release_status = 'released'
         ORDER BY item_id, released_at DESC NULLS LAST, created_at DESC
      ), lines AS (
        SELECT 'SO line' AS found_on, h.code || ' Ln ' || l.line_no AS doc_code,
               COALESCE(c.name, h.customer_name) AS customer, l.item_id, l.item_revision_id
          FROM public.sales_order_lines l
          JOIN public.sales_orders h ON h.id = l.sales_order_id
          LEFT JOIN public.clients c ON c.id = h.client_id
         WHERE l.company_id = ${companyId}::uuid AND l.deleted_at IS NULL AND h.deleted_at IS NULL
           AND h.status::text NOT IN ${DONE} AND l.status::text NOT IN ${DONE}
           AND l.item_revision_id IS NOT NULL
        UNION ALL
        SELECT 'JWSO line', h.code || ' Ln ' || l.line_no, COALESCE(c.name, h.customer_name), l.item_id, l.item_revision_id
          FROM public.job_work_order_lines l
          JOIN public.job_work_orders h ON h.id = l.job_work_order_id
          LEFT JOIN public.clients c ON c.id = h.client_id
         WHERE l.company_id = ${companyId}::uuid AND l.deleted_at IS NULL AND h.deleted_at IS NULL
           AND h.status::text NOT IN ${DONE} AND l.status::text NOT IN ${DONE}
           AND l.item_revision_id IS NOT NULL
      )
      SELECT x.found_on, x.doc_code, x.customer, i.code AS item_code, i.name AS item_name,
             ir.rev AS doc_rev, ir.release_status AS doc_rev_status, lt.rev AS expected_rev,
             CASE WHEN ir.release_status <> 'released' THEN 'Rev not Released'
                  ELSE 'Older than the latest Released Rev' END AS problem
        FROM lines x
        JOIN public.items i ON i.id = x.item_id
        JOIN public.item_revisions ir ON ir.id = x.item_revision_id
        LEFT JOIN latest lt ON lt.item_id = x.item_id
       WHERE (ir.release_status <> 'released' OR (lt.id IS NOT NULL AND lt.id <> ir.id))
         ${itemFrag}
      UNION ALL
      SELECT 'Job Card', jc.code, COALESCE(c1.name, so.customer_name, c2.name, jwo.customer_name),
             i.code, i.name, jr.rev, jr.release_status, lr.rev, 'Job Card Rev differs from its order line'
        FROM public.job_cards jc
        JOIN public.items i ON i.id = jc.item_id
        LEFT JOIN public.v_jc_status js ON js.job_card_id = jc.id
        LEFT JOIN public.sales_order_lines sol ON sol.id = jc.source_so_line_id
        LEFT JOIN public.sales_orders so ON so.id = sol.sales_order_id
        LEFT JOIN public.clients c1 ON c1.id = so.client_id
        LEFT JOIN public.job_work_order_lines jwl ON jwl.id = jc.source_jw_line_id
        LEFT JOIN public.job_work_orders jwo ON jwo.id = jwl.job_work_order_id
        LEFT JOIN public.clients c2 ON c2.id = jwo.client_id
        LEFT JOIN public.item_revisions jr ON jr.id = jc.item_revision_id
        LEFT JOIN public.item_revisions lr ON lr.id = COALESCE(sol.item_revision_id, jwl.item_revision_id)
       WHERE jc.company_id = ${companyId}::uuid AND jc.deleted_at IS NULL
         AND COALESCE(js.computed_status, 'open') NOT IN ('complete', 'closed')
         AND COALESCE(sol.item_revision_id, jwl.item_revision_id) IS NOT NULL
         AND jc.item_revision_id IS DISTINCT FROM COALESCE(sol.item_revision_id, jwl.item_revision_id)
         ${itemFrag}
       ORDER BY 1, 2
       LIMIT ${REPORT_ROW_CAP}`);
    const rows = (result as unknown as SqlRow[]).map((r) => ({
      found_on: textCell(r['found_on']),
      doc_code: textCell(r['doc_code']),
      customer: textCell(r['customer']),
      item_code: textCell(r['item_code']),
      item_name: textCell(r['item_name']),
      doc_rev: textCell(r['doc_rev']),
      doc_rev_status: r['doc_rev_status']
        ? (REV_RELEASE_STATUS_LABELS[r['doc_rev_status'] as RevReleaseStatus] ??
          String(r['doc_rev_status']))
        : null,
      expected_rev: textCell(r['expected_rev']),
      problem: textCell(r['problem']),
    }));
    return { columns: openOrderRevMismatchReport.definition.columns, rows };
  },
};
