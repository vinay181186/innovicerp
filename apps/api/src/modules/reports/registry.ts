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
import { designEngineerWorkloadReport } from './definitions/design-engineer-workload';
import { designIssueAgingReport } from './definitions/design-issue-aging';
import { designProjectSummaryReport } from './definitions/design-project-summary';
import { grnQcLogReport } from './definitions/grn-qc-log';
import { itemTrackerReport } from './definitions/item-tracker';
import { itemsOnHandReport } from './definitions/items-on-hand';
import { jcAgeingReport } from './definitions/jc-ageing';
import { jcStatusSummaryReport } from './definitions/jc-status-summary';
import { ncSummaryByReasonReport } from './definitions/nc-summary-by-reason';
import { openPoAgeingReport } from './definitions/open-po-ageing';
import { operatorProductivityReport } from './definitions/operator-productivity';
import { productionItemTrackerReport } from './definitions/production-item-tracker';
import { productionSoLineTrackerReport } from './definitions/production-so-line-tracker';
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
  [itemTrackerReport.definition.slug]: itemTrackerReport,
  [operatorProductivityReport.definition.slug]: operatorProductivityReport,
  [jcStatusSummaryReport.definition.slug]: jcStatusSummaryReport,
  [soOpenBacklogReport.definition.slug]: soOpenBacklogReport,
  [vendorPoSummaryReport.definition.slug]: vendorPoSummaryReport,
  [stockMovementLogReport.definition.slug]: stockMovementLogReport,
  [jcAgeingReport.definition.slug]: jcAgeingReport,
  [grnQcLogReport.definition.slug]: grnQcLogReport,
  [designProjectSummaryReport.definition.slug]: designProjectSummaryReport,
  [designEngineerWorkloadReport.definition.slug]: designEngineerWorkloadReport,
  [designIssueAgingReport.definition.slug]: designIssueAgingReport,
  [productionItemTrackerReport.definition.slug]: productionItemTrackerReport,
  [productionSoLineTrackerReport.definition.slug]: productionSoLineTrackerReport,
};

export function listReportDefinitions(): ReportDefinition[] {
  return Object.values(REPORTS).map((r) => r.definition);
}
