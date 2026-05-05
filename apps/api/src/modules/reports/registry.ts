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
import { grnQcLogReport } from './definitions/grn-qc-log';
import { itemsOnHandReport } from './definitions/items-on-hand';
import { jcAgeingReport } from './definitions/jc-ageing';
import { jcStatusSummaryReport } from './definitions/jc-status-summary';
import { ncSummaryByReasonReport } from './definitions/nc-summary-by-reason';
import { openPoAgeingReport } from './definitions/open-po-ageing';
import { operatorProductivityReport } from './definitions/operator-productivity';
import { soOpenBacklogReport } from './definitions/so-open-backlog';
import { stockMovementLogReport } from './definitions/stock-movement-log';
import { vendorPoSummaryReport } from './definitions/vendor-po-summary';
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
  [itemsOnHandReport.definition.slug]: itemsOnHandReport,
  [operatorProductivityReport.definition.slug]: operatorProductivityReport,
  [jcStatusSummaryReport.definition.slug]: jcStatusSummaryReport,
  [soOpenBacklogReport.definition.slug]: soOpenBacklogReport,
  [vendorPoSummaryReport.definition.slug]: vendorPoSummaryReport,
  [stockMovementLogReport.definition.slug]: stockMovementLogReport,
  [jcAgeingReport.definition.slug]: jcAgeingReport,
  [grnQcLogReport.definition.slug]: grnQcLogReport,
};

export function listReportDefinitions(): ReportDefinition[] {
  return Object.values(REPORTS).map((r) => r.definition);
}
