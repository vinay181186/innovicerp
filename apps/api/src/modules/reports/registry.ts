// Reports registry (T-041a).
//
// Each report is a (definition, run) pair. The registry exports REPORTS as a
// map keyed by slug. Definitions are the static metadata returned by GET
// /reports; run is the function the service layer invokes after parsing
// query params + applying generic filter validation.
//
// Adding a new report = drop a new file under reports/definitions/, register
// it here, and ensure tests cover it. No DSL, no codegen — hand-written SQL.

import type { DbTransaction } from '../../db/with-user-context';
import { dailyOpLogReport } from './definitions/daily-op-log';
import { ncSummaryByReasonReport } from './definitions/nc-summary-by-reason';
import { openPoAgeingReport } from './definitions/open-po-ageing';
import type { ReportColumn, ReportDefinition, ReportRow } from './schema';

export interface ReportRunContext {
  tx: DbTransaction;
  companyId: string;
  filters: Record<string, string>;
}

export interface ReportRunResult {
  columns: ReportColumn[];
  rows: ReportRow[];
}

export interface RegisteredReport {
  definition: ReportDefinition;
  run: (ctx: ReportRunContext) => Promise<ReportRunResult>;
}

export const REPORTS: Record<string, RegisteredReport> = {
  [dailyOpLogReport.definition.slug]: dailyOpLogReport,
  [ncSummaryByReasonReport.definition.slug]: ncSummaryByReasonReport,
  [openPoAgeingReport.definition.slug]: openPoAgeingReport,
};

export function listReportDefinitions(): ReportDefinition[] {
  return Object.values(REPORTS).map((r) => r.definition);
}
