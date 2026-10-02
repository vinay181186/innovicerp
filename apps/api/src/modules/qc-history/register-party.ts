// QC Call Register — the Party GRN half (ADR-203): customer material received
// against a JWSO line, waiting for / booked through Incoming QC. Mirrors
// register-incoming.ts — the register pages these rows in the SAME SQL as the
// company GRN lines and the job-card ops, so every half needs its keys here.
//
// Pending is the same rule as party-grn/service.ts isPendingQc / PENDING_QC_SQL:
// qc_at NULL and nothing accepted or rejected. Lines booked before QC existed
// (grandfathered by 0173: accepted = received, qc_at NULL) are neither pending
// nor completed here — they never went through QC.

import { type SQL, sql } from 'drizzle-orm';
import type { PartyGrnQcRow } from '@innovic/shared';
import { likeEscape } from '../../lib/list-query';

function pgrnJoins(): SQL {
  return sql`
    FROM public.party_grn_lines pgl
    JOIN public.party_grn pg ON pg.id = pgl.party_grn_id AND pg.deleted_at IS NULL
    LEFT JOIN public.job_work_order_lines jwl ON jwl.id = pgl.jw_line_id
    LEFT JOIN public.job_work_orders jw ON jw.id = COALESCE(jwl.job_work_order_id, pg.job_work_order_id)
    LEFT JOIN public.clients c ON c.id = COALESCE(pg.client_id, jw.client_id) AND c.deleted_at IS NULL
    LEFT JOIN public.items part ON part.id = jwl.item_id
    LEFT JOIN public.items rm ON rm.id = jwl.rm_item_id
    LEFT JOIN public.party_materials pm ON pm.id = pgl.party_material_id
    LEFT JOIN public.users u ON u.id = pgl.qc_by`;
}

/** Party GRN lines waiting for Incoming QC. */
export function pgrnPendingFrom(companyId: string): SQL {
  return sql`${pgrnJoins()}
    WHERE pgl.company_id = ${companyId}::uuid
      AND pgl.deleted_at IS NULL
      AND pgl.qc_at IS NULL
      AND pgl.accepted_qty = 0
      AND pgl.rejected_qty = 0`;
}

/** Party GRN lines whose Incoming QC is booked. */
export function pgrnCompletedFrom(companyId: string): SQL {
  return sql`${pgrnJoins()}
    WHERE pgl.company_id = ${companyId}::uuid
      AND pgl.deleted_at IS NULL
      AND pgl.qc_at IS NOT NULL`;
}

const CUSTOMER = sql`COALESCE(c.name, jw.customer_name, pg.client_code_text)`;
const JW_CODE = sql`COALESCE(jw.code, pg.jw_code_text)`;
const PART_CODE = sql`COALESCE(part.code, jwl.item_code_text)`;
const PM_CODE = sql`COALESCE(pm.code, pgl.party_material_code_text)`;
/** QC day in IST (qc_at is a UTC timestamp). */
const QC_DAY = sql`(pgl.qc_at AT TIME ZONE 'Asia/Kolkata')::date`;

/** Pending qty of a pending Party GRN line — the whole received qty. */
export const PGRN_PENDING_QTY = sql`pgl.received_qty`;

/** When the line was inspected — the completed register's newest-first key. */
export const PGRN_DONE_AT = sql`pgl.qc_at`;

const PGRN_COMMON = sql`
  pgl.id AS "partyGrnLineId", pg.id AS "partyGrnId", pg.code AS "partyGrnNo",
  pg.grn_date AS "grnDate", ${CUSTOMER} AS "customerName", ${JW_CODE} AS "jwCode",
  jwl.line_no AS "jwLineNo", ${PART_CODE} AS "partCode", jwl.revision::text AS "partRevision",
  rm.code AS "rmItemCode", COALESCE(rm.name, pgl.party_material_name) AS "rmItemName",
  ${PM_CODE} AS "partyMaterialCode",
  pgl.received_qty AS "receivedQty", pgl.accepted_qty AS "acceptedQty",
  pgl.rejected_qty AS "rejectedQty", pgl.reject_reason AS "rejectReason",
  COALESCE(u.full_name, u.email) AS "qcByName"`;

export const PGRN_PENDING_SELECT = sql`${PGRN_COMMON},
  ${PGRN_PENDING_QTY} AS "pendingQty", NULL::date AS "qcDate",
  GREATEST(0, (CURRENT_DATE - pg.grn_date))::int AS "waitDays"`;

export const PGRN_COMPLETED_SELECT = sql`${PGRN_COMMON},
  0 AS "pendingQty", ${QC_DAY} AS "qcDate",
  GREATEST(0, (${QC_DAY} - pg.grn_date))::int AS "waitDays"`;

/** `AND (… ILIKE …)` over PGRN no., JWSO code, part code, RM code, customer. */
export function pgrnSearchWhere(term: string | undefined): SQL {
  const q = (term ?? '').trim().replace(/\s+/g, ' ');
  if (q === '') return sql``;
  const p = `%${likeEscape(q)}%`;
  const cols = [sql`pg.code`, JW_CODE, PART_CODE, sql`rm.code`, CUSTOMER, PM_CODE];
  return sql`AND (${sql.join(
    cols.map((col) => sql`${col} ILIKE ${p} ESCAPE '\\'`),
    sql` OR `,
  )})`;
}

type Raw = Record<string, unknown>;
const s = (v: unknown): string | null => (v as string | null) ?? null;

function dateOnly(v: unknown): string | null {
  if (v == null) return null;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return String(v).slice(0, 10);
}

export function toPgrnRow(r: Raw): PartyGrnQcRow {
  return {
    partyGrnLineId: r['partyGrnLineId'] as string,
    partyGrnId: r['partyGrnId'] as string,
    partyGrnNo: r['partyGrnNo'] as string,
    grnDate: dateOnly(r['grnDate']) ?? '',
    customerName: s(r['customerName']),
    jwCode: s(r['jwCode']),
    jwLineNo: r['jwLineNo'] != null ? Number(r['jwLineNo']) : null,
    partCode: s(r['partCode']),
    partRevision: s(r['partRevision']),
    rmItemCode: s(r['rmItemCode']),
    rmItemName: s(r['rmItemName']),
    partyMaterialCode: s(r['partyMaterialCode']),
    receivedQty: Number(r['receivedQty'] ?? 0),
    pendingQty: Number(r['pendingQty'] ?? 0),
    acceptedQty: Number(r['acceptedQty'] ?? 0),
    rejectedQty: Number(r['rejectedQty'] ?? 0),
    rejectReason: s(r['rejectReason']),
    qcDate: dateOnly(r['qcDate']),
    qcByName: s(r['qcByName']),
    waitDays: Number(r['waitDays'] ?? 0),
  };
}
