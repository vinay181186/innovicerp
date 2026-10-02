// Material Consumption — ADR-193 phase 5 (spec §15, R11 / P49).
//
// Item Issue lines net of their returns, one row per month (issue date) ×
// item × issue against × reference × issued to. Reversed slips are left out
// entirely (P49): a reversal already put the stock back, so counting it would
// report material nobody used. Returns are credited to the month of the ISSUE
// they came back from, so a month's Net Consumed never goes negative.
//
// Reference = the Job Card (issue against a JC), the Assembly SO, or the
// Department (general / consumable issue).

import { ISSUE_AGAINST, ISSUE_AGAINST_LABELS, type IssueAgainst } from '@innovic/shared';
import { sql } from 'drizzle-orm';
import type { RegisteredReport } from '../registry';
import {
  enumFilter,
  isoDateFilter,
  likeFilter,
  numCell,
  REPORT_ROW_CAP,
  textCell,
} from './report-helpers';

/** Most rows one run returns; the rest are named in a note. */
const ROW_CAP = REPORT_ROW_CAP;

export const materialConsumptionReport: RegisteredReport = {
  definition: {
    slug: 'material-consumption',
    title: 'Material consumption',
    description:
      'Item Issue quantities net of returns, by month, item, what it was issued against (Job Card / Assembly SO / General), department and who it was issued to. Reversed slips are excluded.',
    group: 'Store',
    dept: 'store',
    filters: [
      { key: 'fromDate', label: 'Issue Date From', kind: 'date' },
      { key: 'toDate', label: 'Issue Date To', kind: 'date' },
      { key: 'item', label: 'Item', kind: 'text', placeholder: 'Item code or name' },
      { key: 'department', label: 'Department', kind: 'text', placeholder: 'Department' },
      {
        key: 'issueAgainst',
        label: 'Issue Against',
        kind: 'enum',
        options: [...ISSUE_AGAINST],
      },
    ],
    columns: [
      { key: 'month', label: 'Month', type: 'text' },
      { key: 'item_code', label: 'Item Code', type: 'text' },
      { key: 'item_name', label: 'Item Name', type: 'text' },
      { key: 'uom', label: 'UOM', type: 'text' },
      { key: 'issue_against', label: 'Issue Against', type: 'text' },
      { key: 'reference', label: 'Reference', type: 'text' },
      { key: 'department', label: 'Department', type: 'text' },
      { key: 'issued_to', label: 'Issued To', type: 'text' },
      { key: 'issued_qty', label: 'Issued Qty', type: 'number' },
      { key: 'returned_qty', label: 'Returned Qty', type: 'number' },
      { key: 'net_consumed', label: 'Net Consumed', type: 'number' },
    ],
  },
  async run({ tx, companyId, filters }) {
    const fromDate = isoDateFilter(filters['fromDate']);
    const toDate = isoDateFilter(filters['toDate']);
    const item = likeFilter(filters['item']);
    const department = likeFilter(filters['department']);
    const against = enumFilter(filters['issueAgainst'], ISSUE_AGAINST);

    const fromFrag = fromDate ? sql`AND si.issue_date >= ${fromDate}::date` : sql``;
    const toFrag = toDate ? sql`AND si.issue_date <= ${toDate}::date` : sql``;
    const itemFrag = item
      ? sql`AND (COALESCE(it.code, sil.item_code_text) ILIKE ${item} OR it.name ILIKE ${item})`
      : sql``;
    const deptFrag = department ? sql`AND si.department ILIKE ${department}` : sql``;
    const againstFrag = against ? sql`AND si.issue_against = ${against}` : sql``;

    const result = await tx.execute(sql`
      WITH ret AS (
        SELECT r.issue_line_id, SUM(r.qty) AS qty
        FROM public.store_issue_returns r
        WHERE r.company_id = ${companyId}::uuid AND r.deleted_at IS NULL
        GROUP BY r.issue_line_id
      )
      SELECT
        to_char(si.issue_date, 'YYYY-MM')                AS month,
        COALESCE(it.code, sil.item_code_text)            AS item_code,
        it.name                                          AS item_name,
        it.uom::text                                     AS uom,
        si.issue_against                                 AS issue_against,
        CASE si.issue_against
          WHEN 'job_card'    THEN COALESCE(jc.code, si.ref_no)
          WHEN 'assembly_so' THEN COALESCE(so.code, si.ref_no)
          ELSE si.department
        END                                              AS reference,
        si.department                                    AS department,
        si.issued_to                                     AS issued_to,
        SUM(sil.qty)::float8                             AS issued_qty,
        SUM(COALESCE(ret.qty, 0))::float8                AS returned_qty,
        (SUM(sil.qty) - SUM(COALESCE(ret.qty, 0)))::float8 AS net_consumed
      FROM public.store_issue_lines sil
      JOIN public.store_issues si ON si.id = sil.issue_id
      LEFT JOIN public.items it ON it.id = sil.item_id
      LEFT JOIN public.job_cards jc ON jc.id = si.job_card_id
      LEFT JOIN public.sales_orders so ON so.id = si.sales_order_id
      LEFT JOIN ret ON ret.issue_line_id = sil.id
      WHERE si.company_id = ${companyId}::uuid
        AND sil.company_id = ${companyId}::uuid
        AND si.deleted_at IS NULL
        AND sil.deleted_at IS NULL
        AND si.reversed_at IS NULL
        ${fromFrag}
        ${toFrag}
        ${itemFrag}
        ${deptFrag}
        ${againstFrag}
      GROUP BY 1, 2, 3, 4, 5, 6, 7, 8
      ORDER BY 1 DESC, 2, 5, 6, 8
      LIMIT ${ROW_CAP + 1}
    `);

    const raw = result as unknown as Array<Record<string, unknown>>;
    // One row past the cap tells us the result was cut off — say so.
    const cut = raw.length > ROW_CAP;
    const rows = raw.slice(0, ROW_CAP).map((r) => {
      const ia = String(r['issue_against'] ?? '');
      return {
        month: String(r['month'] ?? ''),
        item_code: String(r['item_code'] ?? ''),
        item_name: textCell(r['item_name']),
        uom: textCell(r['uom']),
        issue_against: ISSUE_AGAINST_LABELS[ia as IssueAgainst] ?? ia,
        reference: textCell(r['reference']),
        department: textCell(r['department']),
        issued_to: textCell(r['issued_to']),
        issued_qty: numCell(r['issued_qty']),
        returned_qty: numCell(r['returned_qty']),
        net_consumed: numCell(r['net_consumed']),
      };
    });

    return {
      columns: materialConsumptionReport.definition.columns,
      rows,
      ...(cut
        ? {
            note: `Showing the latest ${ROW_CAP.toLocaleString('en-IN')} rows only — narrow the dates or pick an item to see the rest.`,
          }
        : {}),
    };
  },
};
