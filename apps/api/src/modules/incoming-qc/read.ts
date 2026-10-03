// Incoming QC — the read side (GET /incoming-qc). Moved out of service.ts
// (ADR-201) when both tables started paging, so that file keeps the writes.
//
// Inspection queue for received GRN lines awaiting QC + pipeline metrics +
// completed lines. Mirrors legacy renderIncomingQC (HTML L23748). Raw SQL over
// goods_receipt_note_lines ⨝ headers ⨝ vendors ⨝ items. RLS via base tables.
//
// ADR-201: both tables page on the server. `search` and each table's Sort &
// Filter run over ALL rows, and pendingTotal / completedTotal are counted with
// the same WHERE as the page. With no params the answer is what it always was
// (every pending line, the 20 most recent completed) — the QC Call Register
// reads it that way. The metrics strip is always the WHOLE queue (never the
// search), worked out in SQL.

import { sql, type SQL } from 'drizzle-orm';
import type {
  IncomingQcCompletedRow,
  IncomingQcMetrics,
  IncomingQcPendingRow,
  IncomingQcQuery,
  IncomingQcResponse,
} from '@innovic/shared';
import { incomingQcQuerySchema } from '@innovic/shared';
import { type AuthContext, withUserContext } from '../../db/with-user-context';
import { canSeeFormPrice } from '../../lib/access';
import { AuthorizationError } from '../../lib/errors';
import { likeEscape, readSf, sfOrderBy, sfWhere } from '../../lib/list-query';
import { IQC_COMPLETED_SF_COLUMNS, IQC_PENDING_SF_COLUMNS } from './sf-columns';

function dispositionOf(
  accepted: number,
  rejected: number,
  received: number,
): IncomingQcCompletedRow['disposition'] {
  // Still some qty awaiting inspection → the line is only partially done.
  // (Same rule as IQC_DISPOSITION_SQL, which the QC Result filter uses.)
  if (received - accepted - rejected > 0) return 'Partial Accept';
  if (accepted > 0 && rejected > 0) return 'Partial Accept';
  if (rejected > 0) return 'Rejected';
  return 'Accepted';
}

// The joins both tables share: the SO trace for OSP returns (PO line → jc_op →
// JC → SO line → SO; all null for a raw-material GRN), vendor, item.
const JOINS = sql`
  FROM public.goods_receipt_note_lines l
  JOIN public.goods_receipt_notes h ON h.id = l.goods_receipt_note_id AND h.deleted_at IS NULL
  LEFT JOIN public.purchase_order_lines pol ON pol.id = l.purchase_order_line_id
  LEFT JOIN public.jc_ops jco ON jco.id = pol.source_jc_op_id AND jco.deleted_at IS NULL
  LEFT JOIN public.job_cards jc ON jc.id = jco.job_card_id AND jc.deleted_at IS NULL
  LEFT JOIN public.sales_order_lines sol ON sol.id = jc.source_so_line_id AND sol.deleted_at IS NULL
  LEFT JOIN public.job_work_order_lines rev_jwl ON rev_jwl.id = jc.source_jw_line_id AND rev_jwl.deleted_at IS NULL
  LEFT JOIN public.sales_orders so ON so.id = sol.sales_order_id AND so.deleted_at IS NULL
  LEFT JOIN public.vendors v ON v.id = h.vendor_id AND v.deleted_at IS NULL
  LEFT JOIN public.items i ON i.id = l.item_id
  LEFT JOIN public.users u ON u.id = l.qc_inspected_by
`;

const PENDING_WHERE = sql`(l.received_qty - l.qc_accepted_qty - l.qc_rejected_qty) > 0`;
// Any line that has had QC activity (accepted and/or rejected), incl.
// partially-inspected lines still carrying a pending balance.
const COMPLETED_WHERE = sql`(l.qc_accepted_qty > 0 OR l.qc_rejected_qty > 0)`;

/** `AND (… ILIKE …)` over the text a table shows, or empty. */
function searchFrag(term: string | undefined, fields: SQL[]): SQL {
  const q = term?.trim().replace(/\s+/g, ' ');
  if (!q) return sql``;
  const pat = `%${likeEscape(q)}%`;
  return sql`AND (${sql.join(
    fields.map((f) => sql`${f} ILIKE ${pat} ESCAPE '\\'`),
    sql` OR `,
  )})`;
}

const COMMON_SEARCH = [
  sql`h.code`,
  sql`COALESCE(v.name, h.vendor_code_text)`,
  sql`sol.client_po_line_no`,
  sql`COALESCE(i.code, l.item_code_text)`,
  sql`COALESCE(sol.revision::text, rev_jwl.revision::text)`,
  sql`COALESCE(i.name, l.item_name)`,
];
const PENDING_SEARCH = [...COMMON_SEARCH, sql`h.po_code_text`];
const COMPLETED_SEARCH = [...COMMON_SEARCH, sql`l.qc_remarks`];

type Row = Record<string, unknown>;
const str = (v: unknown): string | null => (v as string | null) ?? null;

export async function getIncomingQc(
  user: AuthContext,
  rawQuery: IncomingQcQuery = {},
): Promise<IncomingQcResponse> {
  if (!user.companyId) throw new AuthorizationError('User is not assigned to a company');
  const companyId = user.companyId;
  const q = incomingQcQuerySchema.parse(rawQuery);
  const pendingSf = readSf(q.pendingSf);
  const completedSf = readSf(q.completedSf);
  // Money-hiding for L1 Viewers ("Can See Price"): the "Value in QC" figure
  // rides the Incoming-QC price permission.
  const showMoney = await canSeeFormPrice(user, 'qc_incoming');

  const base = sql`l.company_id = ${companyId}::uuid AND l.deleted_at IS NULL
    ${q.grnLineId ? sql`AND l.id = ${q.grnLineId}::uuid` : sql``}`;
  const pendingFilter = sql`${base} AND ${PENDING_WHERE}
    ${searchFrag(q.search, PENDING_SEARCH)} ${sfWhere(IQC_PENDING_SF_COLUMNS, pendingSf)}`;
  const completedFilter = sql`${base} AND ${COMPLETED_WHERE}
    ${searchFrag(q.search, COMPLETED_SEARCH)} ${sfWhere(IQC_COMPLETED_SF_COLUMNS, completedSf)}`;
  // Oldest first; l.id last so a page never skips or repeats a line.
  const pendingOrder = sfOrderBy(
    IQC_PENDING_SF_COLUMNS,
    pendingSf,
    sql`h.grn_date ASC, h.code ASC, l.id ASC`,
  );
  const completedOrder = sfOrderBy(
    IQC_COMPLETED_SF_COLUMNS,
    completedSf,
    sql`COALESCE(l.qc_date, h.grn_date) DESC, h.code DESC, l.id DESC`,
  );
  // No pendingLimit = every pending line (the QC Call Register's read).
  const pendingLimit = q.pendingLimit !== undefined ? sql`LIMIT ${q.pendingLimit}` : sql``;

  return withUserContext(user, async (tx) => {
    // ── Pending lines (received but not fully inspected) ──
    const pendingRows = (await tx.execute(sql`
      SELECT
        l.id AS "grnLineId", h.id AS "grnId", h.code AS "grnNo", h.grn_date AS "grnDate",
        h.po_code_text AS "poCode",
        COALESCE(v.name, h.vendor_code_text) AS "vendorName",
        so.code AS "soCode", so.internal_so_no AS "soInternalNo",
        jc.code AS "jcCode", jco.op_seq AS "opSeq", jco.operation AS "opName",
        COALESCE(i.code, l.item_code_text) AS "itemCode",
        -- The customer's drawing revision off the SO / JWSO line (never
        -- items.revision); text cast for a pre-0119 database.
        COALESCE(sol.revision::text, rev_jwl.revision::text) AS "itemRevision",
        sol.client_po_line_no AS "clientPoLineNo",
        COALESCE(i.name, l.item_name) AS "itemName",
        l.received_qty AS "receivedQty",
        (l.received_qty - l.qc_accepted_qty - l.qc_rejected_qty) AS "pendingQty",
        GREATEST(0, (CURRENT_DATE - h.grn_date))::int AS "waitDays"
      ${JOINS}
      WHERE ${pendingFilter}
      ORDER BY ${pendingOrder}
      ${pendingLimit} OFFSET ${q.pendingOffset}
    `)) as unknown as Row[];
    const pending: IncomingQcPendingRow[] = pendingRows.map((r) => ({
      grnLineId: r['grnLineId'] as string,
      grnId: r['grnId'] as string,
      grnNo: r['grnNo'] as string,
      grnDate: String(r['grnDate']).slice(0, 10),
      poCode: str(r['poCode']),
      vendorName: str(r['vendorName']),
      soCode: str(r['soCode']),
      soInternalNo: str(r['soInternalNo']),
      jcCode: str(r['jcCode']),
      opSeq: r['opSeq'] != null ? Number(r['opSeq']) : null,
      opName: str(r['opName']),
      itemCode: str(r['itemCode']),
      itemRevision: str(r['itemRevision']),
      clientPoLineNo: str(r['clientPoLineNo']),
      itemName: str(r['itemName']),
      receivedQty: Number(r['receivedQty'] ?? 0),
      pendingQty: Number(r['pendingQty'] ?? 0),
      waitDays: Number(r['waitDays'] ?? 0),
    }));

    // ── Completed (newest first; 20 unless the screen pages) ──
    const completedRows = (await tx.execute(sql`
      SELECT
        l.id AS "grnLineId", h.id AS "grnId", h.code AS "grnNo", h.grn_date AS "grnDate",
        l.qc_date AS "qcDate",
        CASE WHEN l.qc_date IS NOT NULL THEN (l.qc_date - h.grn_date)::int ELSE NULL END AS "respDays",
        COALESCE(v.name, h.vendor_code_text) AS "vendorName",
        COALESCE(i.code, l.item_code_text) AS "itemCode",
        COALESCE(sol.revision::text, rev_jwl.revision::text) AS "itemRevision",
        sol.client_po_line_no AS "clientPoLineNo",
        COALESCE(i.name, l.item_name) AS "itemName",
        l.received_qty AS "receivedQty",
        l.qc_accepted_qty AS "acceptedQty", l.qc_rejected_qty AS "rejectedQty",
        l.qc_remarks AS "qcRemarks",
        l.updated_at AS "qcAt",
        COALESCE(l.qc_inspected_by_text, u.full_name, u.email) AS "qcInspectedBy",
        l.qc_report_path AS "qcReportPath", l.qc_report_name AS "qcReportName"
      ${JOINS}
      WHERE ${completedFilter}
      ORDER BY ${completedOrder}
      LIMIT ${q.completedLimit} OFFSET ${q.completedOffset}
    `)) as unknown as Row[];
    const completed: IncomingQcCompletedRow[] = completedRows.map((r) => {
      const acceptedQty = Number(r['acceptedQty'] ?? 0);
      const rejectedQty = Number(r['rejectedQty'] ?? 0);
      return {
        grnLineId: r['grnLineId'] as string,
        grnId: r['grnId'] as string,
        grnNo: r['grnNo'] as string,
        grnDate: String(r['grnDate']).slice(0, 10),
        qcDate: r['qcDate'] != null ? String(r['qcDate']).slice(0, 10) : null,
        respDays: r['respDays'] != null ? Number(r['respDays']) : null,
        vendorName: str(r['vendorName']),
        itemCode: str(r['itemCode']),
        itemRevision: str(r['itemRevision']),
        clientPoLineNo: str(r['clientPoLineNo']),
        itemName: str(r['itemName']),
        receivedQty: Number(r['receivedQty'] ?? 0),
        acceptedQty,
        rejectedQty,
        disposition: dispositionOf(acceptedQty, rejectedQty, Number(r['receivedQty'] ?? 0)),
        qcAt: r['qcAt'] != null ? String(r['qcAt']) : null,
        qcInspectedBy: str(r['qcInspectedBy']),
        qcRemarks: str(r['qcRemarks']),
        qcReportPath: str(r['qcReportPath']),
        qcReportName: str(r['qcReportName']),
      };
    });

    // ── Totals: same WHERE as each page ──
    const [counts] = (await tx.execute(sql`
      SELECT
        (SELECT COUNT(*) ${JOINS} WHERE ${pendingFilter})::int AS "pendingTotal",
        (SELECT COUNT(*) ${JOINS} WHERE ${completedFilter})::int AS "completedTotal"
    `)) as unknown as Row[];

    // ── Pipeline metrics: the WHOLE pending queue (no search / filters) ──
    const [m] = (await tx.execute(sql`
      SELECT
        COUNT(DISTINCT l.goods_receipt_note_id)::int AS "grnsWaiting",
        COUNT(*)::int AS "lines",
        COALESCE(SUM(l.received_qty - l.qc_accepted_qty - l.qc_rejected_qty), 0)::float AS "pendingQty",
        COALESCE(SUM(GREATEST(0, (CURRENT_DATE - h.grn_date))), 0)::float AS "waitSum",
        -- Value stuck in QC: Σ pendingQty × po_lines.rate (legacy L23839);
        -- a manual GRN line has no PO rate → 0.
        COALESCE(SUM((l.received_qty - l.qc_accepted_qty - l.qc_rejected_qty) * COALESCE(pol.rate, 0)), 0)::float AS "valueInQc"
      FROM public.goods_receipt_note_lines l
      JOIN public.goods_receipt_notes h ON h.id = l.goods_receipt_note_id AND h.deleted_at IS NULL
      LEFT JOIN public.purchase_order_lines pol ON pol.id = l.purchase_order_line_id
      WHERE l.company_id = ${companyId}::uuid AND l.deleted_at IS NULL AND ${PENDING_WHERE}
    `)) as unknown as Row[];
    const [oldest] = (await tx.execute(sql`
      SELECT h.code AS "grnNo", GREATEST(0, (CURRENT_DATE - h.grn_date))::int AS "waitDays"
      FROM public.goods_receipt_note_lines l
      JOIN public.goods_receipt_notes h ON h.id = l.goods_receipt_note_id AND h.deleted_at IS NULL
      WHERE l.company_id = ${companyId}::uuid AND l.deleted_at IS NULL AND ${PENDING_WHERE}
      ORDER BY h.grn_date ASC, h.code ASC, l.id ASC
      LIMIT 1
    `)) as unknown as Row[];
    // ── Today's completed totals ──
    const [t] = (await tx.execute(sql`
      SELECT
        COALESCE(SUM(l.qc_accepted_qty), 0)::numeric AS "todayAcceptedQty",
        COALESCE(SUM(l.qc_rejected_qty), 0)::numeric AS "todayRejectedQty",
        COUNT(DISTINCT l.goods_receipt_note_id)::int AS "todayAcceptedGrns"
      FROM public.goods_receipt_note_lines l
      WHERE l.company_id = ${companyId}::uuid
        AND l.deleted_at IS NULL
        AND ${COMPLETED_WHERE}
        AND l.qc_date = CURRENT_DATE
    `)) as unknown as Row[];

    const lines = Number(m?.['lines'] ?? 0);
    const metrics: IncomingQcMetrics = {
      grnsWaiting: Number(m?.['grnsWaiting'] ?? 0),
      // Decimal on KGS / MTR receipts (0172): trim float noise to 3 places.
      pendingQty: Math.round(Number(m?.['pendingQty'] ?? 0) * 1000) / 1000,
      avgWaitDays: lines > 0 ? Math.round((Number(m?.['waitSum'] ?? 0) / lines) * 10) / 10 : 0,
      oldestDays: oldest ? Number(oldest['waitDays'] ?? 0) : 0,
      oldestGrnNo: oldest ? str(oldest['grnNo']) : null,
      valueInQc: showMoney ? Math.round(Number(m?.['valueInQc'] ?? 0)) : null,
      todayAcceptedQty: Number(t?.['todayAcceptedQty'] ?? 0),
      todayAcceptedGrns: Number(t?.['todayAcceptedGrns'] ?? 0),
      todayRejectedQty: Number(t?.['todayRejectedQty'] ?? 0),
    };

    return {
      metrics,
      pending,
      completed,
      pendingTotal: Number(counts?.['pendingTotal'] ?? 0),
      completedTotal: Number(counts?.['completedTotal'] ?? 0),
    };
  });
}
