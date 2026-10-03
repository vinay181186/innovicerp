// TPI service (QC Wave 3) — read-only.
//
// GET /tpi           — pending TPI ops (QC ops with "TPI" in the operation name
//                      + qc_pending>0) + completed TPI records (op_log where
//                      is_tpi, last 200). Older callers.
// GET /tpi/pending   — pending TPI ops, one page + total (ADR-201).
// GET /tpi/completed — completed TPI records, one page + total (ADR-201).
// Mirrors legacy renderTPI (HTML L21381). The TPI submit reuses op-entry
// submitQcLog (isTpi + tpi metadata). RLS via base tables. No migration here.

import { type SQL, sql } from 'drizzle-orm';
import type {
  ListTpiQuery,
  TpiCompletedListResponse,
  TpiCompletedRow,
  TpiPendingListResponse,
  TpiPendingRow,
  TpiResponse,
} from '@innovic/shared';
import { type AuthContext, withUserContext } from '../../db/with-user-context';
import { AuthorizationError } from '../../lib/errors';
import { likeEscape } from '../../lib/list-query';

function requireCompany(user: AuthContext): string {
  if (!user.companyId) throw new AuthorizationError('User is not assigned to a company');
  return user.companyId;
}

function dateLike(v: unknown): string | null {
  if (v == null) return null;
  return v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10);
}

type Raw = Record<string, unknown>;
const rows = (r: unknown): Raw[] => r as Raw[];
const s = (v: unknown): string | null => (v as string | null) ?? null;

// The SO-line joins: the customer's drawing revision (never items.revision,
// cast to text for pre-0119 databases) and POL (the CUSTOMER's PO line, never
// our sol.line_no) ride the same sol LEFT JOIN that yields the SO code.
const SO_JOINS = sql`
  LEFT JOIN public.items i ON i.id = jc.item_id
  LEFT JOIN public.sales_order_lines sol
    ON sol.id = jc.source_so_line_id AND sol.deleted_at IS NULL
  LEFT JOIN public.job_work_order_lines rev_jwl
    ON rev_jwl.id = jc.source_jw_line_id AND rev_jwl.deleted_at IS NULL
  LEFT JOIN public.sales_orders so
    ON so.id = sol.sales_order_id AND so.deleted_at IS NULL`;

function pendingFrom(companyId: string): SQL {
  return sql`
    FROM public.v_jc_op_status vos
    JOIN public.jc_ops jo ON jo.id = vos.jc_op_id AND jo.deleted_at IS NULL
    JOIN public.job_cards jc ON jc.id = vos.job_card_id AND jc.deleted_at IS NULL
    ${SO_JOINS}
    WHERE vos.company_id = ${companyId}::uuid
      AND (vos.qc_required OR vos.op_type = 'qc')
      AND vos.qc_pending > 0
      AND UPPER(jo.operation) LIKE '%TPI%'`;
}

function completedFrom(companyId: string): SQL {
  return sql`
    FROM public.op_log ol
    JOIN public.jc_ops jo ON jo.id = ol.jc_op_id AND jo.deleted_at IS NULL
    JOIN public.job_cards jc ON jc.id = jo.job_card_id AND jc.deleted_at IS NULL
    ${SO_JOINS}
    WHERE ol.company_id = ${companyId}::uuid
      AND ol.is_tpi = true`;
}

const PENDING_SELECT = sql`
  vos.jc_op_id AS "jcOpId", jc.code AS "jcCode", vos.op_seq AS "opSeq",
  so.code AS "soCode", so.internal_so_no AS "soInternalNo", i.code AS "itemCode",
  COALESCE(sol.revision::text, rev_jwl.revision::text) AS "itemRevision",
  sol.client_po_line_no AS "clientPoLineNo", i.name AS "itemName",
  jo.operation, jc.order_qty AS "orderQty", vos.qc_pending AS "qcPending",
  jo.qc_call_date AS "callDate",
  GREATEST(0, (CURRENT_DATE - COALESCE(jo.qc_call_date, jc.jc_date)))::int AS "waitDays"`;
const PENDING_ORDER = sql`jc.code, vos.op_seq, vos.jc_op_id`;

const COMPLETED_SELECT = sql`
  ol.id AS "logId", jc.code AS "jcCode", jo.op_seq AS "opSeq",
  so.code AS "soCode", so.internal_so_no AS "soInternalNo", i.code AS "itemCode",
  COALESCE(sol.revision::text, rev_jwl.revision::text) AS "itemRevision",
  sol.client_po_line_no AS "clientPoLineNo", i.name AS "itemName",
  jo.operation, ol.qty AS "accepted", ol.reject_qty AS "rejected",
  jo.qc_call_date AS "callDate", ol.log_date AS "attendedDate",
  CASE WHEN jo.qc_call_date IS NOT NULL THEN (ol.log_date - jo.qc_call_date)::int ELSE NULL END AS "respDays",
  ol.tpi_inspector AS "inspector", ol.tpi_organization AS "organization",
  ol.tpi_cert_no AS "certNo",
  ol.qc_report_path AS "qcReportPath", ol.qc_report_name AS "qcReportName"`;
const COMPLETED_ORDER = sql`ol.log_date DESC, ol.id DESC`;

/** `AND (… ILIKE …)` over every text the two lists show. */
function searchWhere(term: string | undefined, completed: boolean): SQL {
  const q = (term ?? '').trim().replace(/\s+/g, ' ');
  if (q === '') return sql``;
  const p = `%${likeEscape(q)}%`;
  const cols = [
    sql`jc.code`,
    sql`so.code`,
    // ADR-207: the SO's Internal SO No. finds its rows too.
    sql`so.internal_so_no`,
    sql`sol.client_po_line_no`,
    sql`i.code`,
    sql`COALESCE(sol.revision::text, rev_jwl.revision::text)`,
    sql`i.name`,
    sql`jo.operation`,
    ...(completed ? [sql`ol.tpi_inspector`, sql`ol.tpi_organization`, sql`ol.tpi_cert_no`] : []),
  ];
  return sql`AND (${sql.join(
    cols.map((c) => sql`${c} ILIKE ${p} ESCAPE '\\'`),
    sql` OR `,
  )})`;
}

function toPending(r: Raw): TpiPendingRow {
  return {
    jcOpId: r['jcOpId'] as string,
    jcCode: r['jcCode'] as string,
    opSeq: Number(r['opSeq']),
    soCode: s(r['soCode']),
    soInternalNo: s(r['soInternalNo']),
    itemCode: s(r['itemCode']),
    itemRevision: s(r['itemRevision']),
    clientPoLineNo: s(r['clientPoLineNo']),
    itemName: s(r['itemName']),
    operation: s(r['operation']) ?? '',
    orderQty: Number(r['orderQty'] ?? 0),
    qcPending: Number(r['qcPending'] ?? 0),
    callDate: dateLike(r['callDate']),
    waitDays: Number(r['waitDays'] ?? 0),
  };
}

function toCompleted(r: Raw): TpiCompletedRow {
  return {
    logId: r['logId'] as string,
    jcCode: r['jcCode'] as string,
    opSeq: Number(r['opSeq']),
    soCode: s(r['soCode']),
    soInternalNo: s(r['soInternalNo']),
    itemCode: s(r['itemCode']),
    itemRevision: s(r['itemRevision']),
    clientPoLineNo: s(r['clientPoLineNo']),
    itemName: s(r['itemName']),
    operation: s(r['operation']) ?? '',
    accepted: Number(r['accepted'] ?? 0),
    rejected: Number(r['rejected'] ?? 0),
    callDate: dateLike(r['callDate']),
    attendedDate: dateLike(r['attendedDate']) ?? '',
    respDays: r['respDays'] != null ? Number(r['respDays']) : null,
    inspector: s(r['inspector']),
    organization: s(r['organization']),
    certNo: s(r['certNo']),
    qcReportPath: s(r['qcReportPath']),
    qcReportName: s(r['qcReportName']),
  };
}

/** Pending TPI ops — one page, total over the same WHERE. */
export async function listTpiPending(
  input: ListTpiQuery,
  user: AuthContext,
): Promise<TpiPendingListResponse> {
  const companyId = requireCompany(user);
  const where = sql`${pendingFrom(companyId)} ${searchWhere(input.search, false)}`;
  return withUserContext(user, async (tx) => {
    const page = await tx.execute(sql`
      SELECT ${PENDING_SELECT} ${where} ORDER BY ${PENDING_ORDER}
      LIMIT ${input.limit} OFFSET ${input.offset}`);
    const cnt = await tx.execute(sql`SELECT COUNT(*)::int AS n ${where}`);
    return { items: rows(page).map(toPending), total: Number(rows(cnt)[0]?.['n'] ?? 0) };
  });
}

/** Completed TPI records — one page, total over the same WHERE (no 200 cap). */
export async function listTpiCompleted(
  input: ListTpiQuery,
  user: AuthContext,
): Promise<TpiCompletedListResponse> {
  const companyId = requireCompany(user);
  const where = sql`${completedFrom(companyId)} ${searchWhere(input.search, true)}`;
  return withUserContext(user, async (tx) => {
    const page = await tx.execute(sql`
      SELECT ${COMPLETED_SELECT} ${where} ORDER BY ${COMPLETED_ORDER}
      LIMIT ${input.limit} OFFSET ${input.offset}`);
    const cnt = await tx.execute(sql`SELECT COUNT(*)::int AS n ${where}`);
    return { items: rows(page).map(toCompleted), total: Number(rows(cnt)[0]?.['n'] ?? 0) };
  });
}

/** The whole feed (older callers): every pending op + the last 200 records. */
export async function getTpi(user: AuthContext): Promise<TpiResponse> {
  const companyId = requireCompany(user);
  return withUserContext(user, async (tx) => {
    const pendingRows = await tx.execute(sql`
      SELECT ${PENDING_SELECT} ${pendingFrom(companyId)} ORDER BY ${PENDING_ORDER}`);
    const compRows = await tx.execute(sql`
      SELECT ${COMPLETED_SELECT} ${completedFrom(companyId)} ORDER BY ${COMPLETED_ORDER}
      LIMIT 200`);
    return {
      pending: rows(pendingRows).map(toPending),
      completed: rows(compRows).map(toCompleted),
    };
  });
}
