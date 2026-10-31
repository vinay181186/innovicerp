// ADR-252 — the QC Process Master's Report Type link: the joined read every
// QC Process response uses, the create / update check, and the name the
// edit-approval Before -> After shows.

import { and, eq, getTableColumns, isNull, sql } from 'drizzle-orm';
import { qcProcesses, reportTypes } from '../../db/schema';
import type { DbTransaction } from '../../db/with-user-context';
import { NotFoundError, ValidationError } from '../../lib/errors';
import type { QcProcess } from './schema';

// ADR-252 — every read returns the process's Report Type (name + compulsory
// flag) beside its id. A deleted or Inactive report type reads as none, the
// same rule Submit QC applies (lib/qc-process-report.ts).
export const liveReportType = and(
  eq(reportTypes.id, qcProcesses.reportTypeId),
  isNull(reportTypes.deletedAt),
  eq(reportTypes.status, 'Active'),
);
export const PROCESS_COLUMNS = {
  ...getTableColumns(qcProcesses),
  reportTypeName: sql<string | null>`${reportTypes.name}`,
  reportMandatory: sql<boolean>`COALESCE(${reportTypes.defaultMandatory}, false)`,
  reportLastStageOnly: sql<boolean>`COALESCE(${reportTypes.lastStageOnly}, false)`,
};

export async function readProcess(tx: DbTransaction, id: string): Promise<QcProcess> {
  const rows = await tx
    .select(PROCESS_COLUMNS)
    .from(qcProcesses)
    .leftJoin(reportTypes, liveReportType)
    .where(and(eq(qcProcesses.id, id), isNull(qcProcesses.deletedAt)))
    .limit(1);
  const row = rows[0];
  if (!row) throw new NotFoundError('QC Process not found. Refresh the page.');
  return row as unknown as QcProcess;
}

/** A Report Type id sent on create / update must be a live, Active report
 *  type of this company; null clears the link. */
export async function assertReportType(
  tx: DbTransaction,
  companyId: string,
  reportTypeId: string | null | undefined,
): Promise<void> {
  if (!reportTypeId) return;
  const rows = await tx
    .select({ id: reportTypes.id })
    .from(reportTypes)
    .where(
      and(
        eq(reportTypes.id, reportTypeId),
        eq(reportTypes.companyId, companyId),
        isNull(reportTypes.deletedAt),
        eq(reportTypes.status, 'Active'),
      ),
    )
    .limit(1);
  if (rows.length === 0) {
    throw new ValidationError('Report Type not found or inactive. Pick the Report Type again.');
  }
}

/** Report Type name for the edit-approval Before -> After (ADR-252): the
 *  approver reads "DIR", never a uuid. */
export async function reportTypeNameOf(
  tx: DbTransaction,
  reportTypeId: string | null | undefined,
): Promise<string | null> {
  if (!reportTypeId) return null;
  const rows = await tx
    .select({ name: reportTypes.name })
    .from(reportTypes)
    .where(eq(reportTypes.id, reportTypeId))
    .limit(1);
  return rows[0]?.name ?? null;
}
