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
import { ncBySoJcReport } from './definitions/nc-by-so-jc';
import { ncRegisterAllReport } from './definitions/nc-register-all';
import { ncSummaryByReasonReport } from './definitions/nc-summary-by-reason';
import { openPoAgeingReport } from './definitions/open-po-ageing';
import { operatorProductivityReport } from './definitions/operator-productivity';
import { productionItemTrackerReport } from './definitions/production-item-tracker';
import { productionOrdersReport } from './definitions/production-orders';
import { productionSoLineTrackerReport } from './definitions/production-so-line-tracker';
import { soOpenBacklogReport } from './definitions/so-open-backlog';
import { stockMovementLogReport } from './definitions/stock-movement-log';
import { vendorPoSummaryReport } from './definitions/vendor-po-summary';
import { poLineAnalysisReport } from './definitions/po-line-analysis';
import { procurementTrackerReport } from './definitions/procurement-tracker';
import { prPendingToOrderReport } from './definitions/pr-pending-to-order';
import { vendorPerformanceReport } from './definitions/vendor-performance';
import { ospAtVendorReport } from './definitions/osp-at-vendor';
import { stockBalanceReport } from './definitions/stock-balance';
import { projectedStockReport } from './definitions/projected-stock';
import { reservedStockReport } from './definitions/reserved-stock';
import { inspectionSummaryReport } from './definitions/inspection-summary';
import { firstPassYieldReport } from './definitions/first-pass-yield';
import { vendorRejectionReport } from './definitions/vendor-rejection';
import { soLineAnalysisReport } from './definitions/so-line-analysis';
import { lateDeliveryReport } from './definitions/late-delivery';
import { jwsoBalanceReport } from './definitions/jwso-balance';
import { unplannedSoLinesReport } from './definitions/unplanned-so-lines';
import { designHoursVsEstimateReport } from './definitions/design-hours-vs-estimate';
import { wipByOperationReport } from './definitions/wip-by-operation';
import { machineUtilisationReport } from './definitions/machine-utilisation';
import { receivableAgeingReport } from './definitions/receivable-ageing';
import { dispatchedNotInvoicedReport } from './definitions/dispatched-not-invoiced';
import { gstSalesRegisterReport } from './definitions/gst-sales-register';
import { hsnOutwardSummaryReport } from './definitions/hsn-outward-summary';
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
  [ncBySoJcReport.definition.slug]: ncBySoJcReport,
  [ncRegisterAllReport.definition.slug]: ncRegisterAllReport,
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
  [productionOrdersReport.definition.slug]: productionOrdersReport,
  // Department P1 reports (ERPNext study, 2026-09-26).
  [soLineAnalysisReport.definition.slug]: soLineAnalysisReport,
  [lateDeliveryReport.definition.slug]: lateDeliveryReport,
  [jwsoBalanceReport.definition.slug]: jwsoBalanceReport,
  [unplannedSoLinesReport.definition.slug]: unplannedSoLinesReport,
  [designHoursVsEstimateReport.definition.slug]: designHoursVsEstimateReport,
  [wipByOperationReport.definition.slug]: wipByOperationReport,
  [machineUtilisationReport.definition.slug]: machineUtilisationReport,
  [receivableAgeingReport.definition.slug]: receivableAgeingReport,
  [dispatchedNotInvoicedReport.definition.slug]: dispatchedNotInvoicedReport,
  [gstSalesRegisterReport.definition.slug]: gstSalesRegisterReport,
  [hsnOutwardSummaryReport.definition.slug]: hsnOutwardSummaryReport,
  [poLineAnalysisReport.definition.slug]: poLineAnalysisReport,
  [procurementTrackerReport.definition.slug]: procurementTrackerReport,
  [prPendingToOrderReport.definition.slug]: prPendingToOrderReport,
  [vendorPerformanceReport.definition.slug]: vendorPerformanceReport,
  [ospAtVendorReport.definition.slug]: ospAtVendorReport,
  [stockBalanceReport.definition.slug]: stockBalanceReport,
  [projectedStockReport.definition.slug]: projectedStockReport,
  [reservedStockReport.definition.slug]: reservedStockReport,
  [inspectionSummaryReport.definition.slug]: inspectionSummaryReport,
  [firstPassYieldReport.definition.slug]: firstPassYieldReport,
  [vendorRejectionReport.definition.slug]: vendorRejectionReport,
};

export function listReportDefinitions(): ReportDefinition[] {
  return Object.values(REPORTS).map((r) => r.definition);
}
