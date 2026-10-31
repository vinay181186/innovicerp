// ADR-252 — which report a QC step produces, and whether it is compulsory.
//
// A job-card QC op names its QC process by text (jc_ops.operation, copied from
// the QC Process Master code: "DIR", "Final Inspection" …). The QC Process
// Master row says which Report Type that process produces
// (qc_processes.report_type_id), and the Report Type says whether the report is
// compulsory (report_types.default_mandatory).
//
// ONE matching rule, used by the server (Submit QC block, Dossier, Matrix,
// dashboard) and by the screens (the "report required" hint): trimmed,
// case-insensitive equality of the op name and the process code. The server
// is the rule; a screen only uses this to say so before the click.

/** Normalised key for matching an op name to a QC process code. */
export function qcProcessKey(name: string | null | undefined): string {
  return (name ?? '').trim().toLowerCase();
}

export interface QcProcessReport {
  code: string;
  reportTypeId: string | null;
  reportTypeName: string | null;
  reportMandatory: boolean;
  /** Mandatory only on the card's LAST op (report_types.last_stage_only, owner
   *  rule 2026-10-31: a middle DIR is optional, the last stage is compulsory). */
  reportLastStageOnly: boolean;
}

/** The QC process behind a job-card op name, or null when none matches. */
export function qcProcessForOperation<T extends QcProcessReport>(
  operation: string | null | undefined,
  processes: readonly T[],
): T | null {
  const key = qcProcessKey(operation);
  if (!key) return null;
  return processes.find((p) => qcProcessKey(p.code) === key) ?? null;
}

/** True when a QC entry on this op must carry its report before it saves:
 *  the op's process produces a mandatory report, the entry accepts qty, and —
 *  for a "Last Stage Only" report — the op is the card's last op (highest live
 *  op_seq, the same "last op" stock credit uses). `isLastOp` is required so no
 *  caller can forget it; the server works it out inside the QC transaction. */
export function qcReportMandatory(
  operation: string | null | undefined,
  acceptedQty: number,
  processes: readonly QcProcessReport[],
  isLastOp: boolean,
): boolean {
  if (acceptedQty <= 0) return false;
  const p = qcProcessForOperation(operation, processes);
  if (!p?.reportTypeId || !p.reportMandatory) return false;
  return !p.reportLastStageOnly || isLastOp;
}

/** Folder for files that name no report type the master knows. */
export const QC_OTHER_FOLDER = 'Other';
