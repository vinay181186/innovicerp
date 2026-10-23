// ADR-252 — "does this QC entry need its report before it saves?" for the
// Submit QC screens (Op Entry, TPI, QC Call Register). The rule itself is the
// shared qcReportMandatory(); the server enforces it anyway — this only says
// so before the click.

import { qcProcessForOperation, qcReportMandatory } from '@innovic/shared';
import { useQcProcessesList } from './api';

export interface QcReportRule {
  required: boolean;
  /** Report Type name of the op's QC process (null when none). */
  reportName: string | null;
}

export function useQcReportRule(
  operation: string | null | undefined,
  acceptedQty: number,
  /** False skips the fetch (e.g. a production op on the shared Op Entry form). */
  enabled = true,
): QcReportRule {
  const { data } = useQcProcessesList(
    { limit: 200, offset: 0 },
    { staleTime: 5 * 60_000, enabled },
  );
  // Disabled = this op has no QC process rule at all. Ignore any list another
  // screen left in the cache, or a same-named process would wrongly apply.
  const processes = enabled ? (data?.items ?? []) : [];
  const p = qcProcessForOperation(operation, processes);
  return {
    required: qcReportMandatory(operation, acceptedQty, processes),
    reportName: p?.reportTypeName ?? null,
  };
}

/** The reason Submit is disabled, or null. */
export function reportMissingReason(rule: QcReportRule, hasReport: boolean): string | null {
  if (!rule.required || hasReport) return null;
  return `Attach the ${rule.reportName ?? 'QC'} report first — it is a mandatory report for this QC step.`;
}

/** "<Report> report — mandatory" line above the attach control. */
export function QcReportRequiredNote({
  rule,
  hasReport,
}: {
  rule: QcReportRule;
  hasReport: boolean;
}): React.JSX.Element | null {
  if (!rule.required) return null;
  return (
    <div
      className="form-label"
      style={{ color: hasReport ? 'var(--green2)' : 'var(--red2)', marginBottom: 4 }}
    >
      {rule.reportName ?? 'QC'} report — mandatory{hasReport ? ' ✓' : ''}
    </div>
  );
}
