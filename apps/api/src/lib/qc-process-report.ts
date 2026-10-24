// ADR-252 — which Report Type a job-card QC op produces, in SQL.
//
// ONE fragment for every server reader (Submit QC block, QC Documents upload,
// QC Dossier / Matrix / SO QC Status, the dashboard "Reports to upload" list).
// The match is the shared rule qcProcessKey (packages/shared lib/qc-report.ts):
// trimmed, case-insensitive equality of the op name and the QC process code.
// A process whose report type is deleted or Inactive produces no report.

import type { QcProcessReport } from '@innovic/shared';
import { type SQL, sql } from 'drizzle-orm';
import type { DbTransaction } from '../db/with-user-context';

const ALIAS = /^[a-z_][a-z0-9_]*(\.[a-z_][a-z0-9_]*)?$/;

/** `LEFT JOIN LATERAL (...) <as> ON TRUE` giving `<as>.report_type_id`,
 *  `<as>.report_name`, `<as>.mandatory` for the op name held in `operationCol`
 *  (an SQL column reference written in this codebase, never user input). */
export function qcProcessReportJoin(cid: string, operationCol: string, as: string): SQL {
  if (!ALIAS.test(operationCol) || !ALIAS.test(as)) {
    throw new Error(`qcProcessReportJoin: bad alias "${operationCol}" / "${as}"`);
  }
  return sql`LEFT JOIN LATERAL (
      SELECT r.id AS report_type_id, r.name AS report_name,
             COALESCE(r.default_mandatory, false) AS mandatory
      FROM public.qc_processes qp
      JOIN public.report_types r
        ON r.id = qp.report_type_id AND r.deleted_at IS NULL AND r.status = 'Active'
      WHERE qp.company_id = ${cid}::uuid AND qp.deleted_at IS NULL
        AND lower(btrim(qp.code)) = lower(btrim(${sql.raw(operationCol)}))
      ORDER BY qp.created_at
      LIMIT 1
    ) ${sql.raw(as)} ON TRUE`;
}

/** The QC process report for one op name, or null when no process with a live
 *  report type matches. Shape = the shared QcProcessReport, so the shared
 *  qcReportMandatory rule can be applied to it unchanged. */
export async function loadQcProcessReport(
  tx: DbTransaction,
  cid: string,
  operation: string | null,
): Promise<QcProcessReport | null> {
  if (!operation?.trim()) return null;
  const rows = (await tx.execute(sql`
    SELECT x.op AS code, pr.report_type_id::text AS "reportTypeId",
           pr.report_name AS "reportTypeName", pr.mandatory AS "reportMandatory"
    FROM (SELECT ${operation}::text AS op) x
    ${qcProcessReportJoin(cid, 'x.op', 'pr')}
  `)) as unknown as Array<{
    code: string;
    reportTypeId: string | null;
    reportTypeName: string | null;
    reportMandatory: boolean | null;
  }>;
  const r = rows[0];
  if (!r?.reportTypeId) return null;
  return {
    code: r.code,
    reportTypeId: r.reportTypeId,
    reportTypeName: r.reportTypeName,
    reportMandatory: r.reportMandatory === true,
  };
}
