// Every `tableKey` the fit engine knows (ADR-199). One register, so two
// screens can never share a saved layout by accident, and a renamed screen
// keeps its users' layouts. Keys are stable code identifiers (kebab-case,
// /^[a-z0-9][a-z0-9-]{0,63}$/ — packages/shared tableKeySchema), never labels.
// NEVER rename a value once shipped: it is the row key of every user's saved
// layout. Add new keys at the end of their group.

export const TABLE_KEYS = {
  // Masters
  itemsList: 'items-list',
  clientsList: 'clients-list',
  vendorsList: 'vendors-list',
  machinesList: 'machines-list',
  operatorsList: 'operators-list',
  costCentersList: 'cost-centers-list',
  qcProcessesList: 'qc-processes-list',
  tpiMastersList: 'tpi-masters-list',
  routeCardsList: 'route-cards-list',
  bomMasterList: 'bom-master-list',
  usersList: 'users-list',
  /** Multi-Level BOM list (ADR-225). */
  mlBomList: 'ml-bom-list',
  /** Multi-Level Plan list (ADR-225 phase 3). */
  mlPlanList: 'ml-plan-list',

  // Transactions
  jobCardsList: 'job-cards-list',
  invoicesList: 'invoices-list',
  plansNeedsPlanning: 'plans-needs-planning',
  soDetailLines: 'so-detail-lines',
  soDetailMilestones: 'so-detail-milestones',
  opLogList: 'op-log-list',
  tpiCompleted: 'tpi-completed',
  jcOpsBoard: 'jc-ops-board',
  ospAtVendorRegister: 'osp-at-vendor-register',
  qcHistoryPending: 'qc-history-pending',
  qcHistoryEntries: 'qc-history-entries',

  // Reports
  savedReportsList: 'saved-reports-list',

  // ADR-199 conversions — Purchase (batch P)
  prList: 'pr-list',
  outsourceJobs: 'outsource-jobs',
  poList: 'po-list',
  ospOutwardDc: 'osp-outward-dc',
  jwDcOutward: 'jw-dc-outward',
  jwDcInward: 'jw-dc-inward',
  approvalsPrPo: 'approvals-pr-po',
  approvalsOpEntry: 'approvals-op-entry',
  editApprovalsInbox: 'edit-approvals-inbox',

  // ADR-199 conversions — Store (batch S)
  grnList: 'grn-list',
  partyGrn: 'party-grn',
  partyMaterialIssues: 'party-material-issues',
  partyMaterials: 'party-materials',
  storeInventory: 'store-inventory',
  reorderList: 'reorder-list',
  reservationDrilldown: 'reservation-drilldown',
  stockLedger: 'stock-ledger',
  issueRegister: 'issue-register',
  toolIssues: 'tool-issues',
  toolHolders: 'tool-holders',
  toolWriteoffs: 'tool-writeoffs',
  stockCounts: 'stock-counts',
  instruments: 'instruments',

  // ADR-199 conversions — Sales (batch SA)
  soMaster: 'so-master',
  jwsoList: 'jwso-list',
  customerDispatches: 'customer-dispatches',
  jwReturns: 'jw-returns',
  soOverview: 'so-overview',
  assemblies: 'assemblies',
  jwInvoices: 'jw-invoices',

  // ADR-199 conversions — Planning / Finance (batch PF)
  planningList: 'planning-list',
  planningLineSearch: 'planning-line-search',
  plansList: 'plans-list',
  pendingSoValue: 'pending-so-value',
  soCosting: 'so-costing',
  soCycleTime: 'so-cycle-time',
  stockValuation: 'stock-valuation',
  /** Level 2 of SO/JWSO Planning: the lines of ONE order. */
  planningLines: 'planning-lines',

  // ADR-199 conversions — Production (batch PR)
  productionOrders: 'production-orders',
  jobQueue: 'job-queue',
  machineLoading: 'machine-loading',
  dailyReport: 'daily-report',
  opEntryShopFloor: 'op-entry-shop-floor',
  runningOps: 'running-ops',
  prodDashboardReady: 'prod-dashboard-ready',
  prodDashboardOpenJcs: 'prod-dashboard-open-jcs',
  prodDashboardMachinePending: 'prod-dashboard-machine-pending',
  prodDashboardBelowReorder: 'prod-dashboard-below-reorder',
  machineGroups: 'machine-groups',
  rawMaterialGrade: 'raw-material-grade',
  rawMaterialSize: 'raw-material-size',

  // ADR-199 conversions — Quality (batch Q)
  qcCallPending: 'qc-call-pending',
  qcCallCompleted: 'qc-call-completed',
  incomingQcPending: 'incoming-qc-pending',
  incomingQcDone: 'incoming-qc-done',
  qcCommandQueue: 'qc-command-queue',
  qcCommandFpy: 'qc-command-fpy',
  qcCommandInspector: 'qc-command-inspector',
  qcCommandPareto: 'qc-command-pareto',
  qcCommandRework: 'qc-command-rework',
  ncRegister: 'nc-register',
  capaList: 'capa-list',
  qcDocsMatrix: 'qc-docs-matrix',
  qcDocsRegister: 'qc-docs-register',
  qcDocsStatus: 'qc-docs-status',
  reportTypes: 'report-types',

  // ADR-199 conversions — Design / Tasks / System / Dashboards (batch D)
  designProjects: 'design-projects',
  designProjectTasks: 'design-project-tasks',
  designProjectIssues: 'design-project-issues',
  designProjectDcr: 'design-project-dcr',
  designProjectDcn: 'design-project-dcn',
  designIssues: 'design-issues',
  designTracker: 'design-tracker',
  taskBoard: 'task-board',
  dailyTaskReports: 'daily-task-reports',
  alertsDashboard: 'alerts-dashboard',
  alertDrill: 'alert-drill',
  activityLog: 'activity-log',
  trashList: 'trash-list',
  accessControlList: 'access-control-list',
  approvalHistory: 'approval-history',
  globalSearch: 'global-search',
  scDashboard: 'sc-dashboard',
  stuckDashboard: 'stuck-dashboard',
  homeOperator: 'home-operator',
} as const;

export type TableKey = (typeof TABLE_KEYS)[keyof typeof TABLE_KEYS];

// DYNAMIC COLUMN IDS (ADR-199 Wave A): a screen whose columns are generated from
// data (QC Docs matrix, Alert drill, saved-report results) keeps ITS tableKey
// fixed and registered above — only the generated column ids are dynamic. Those
// ids are built with dynId(prefix, seed) in dynamic-columns.ts as
// `<prefix>.<seed>` (a short code prefix + a STABLE field off the item, never
// the array index), so a saved layout survives the data changing. Column-id
// prefixes are a local naming choice per screen and are NOT registered here —
// this register is for tableKeys and per-record key prefixes only.

// Screens that keep one saved layout PER RECORD append a stable code id to a
// prefix registered here. Same rules as above: never rename a shipped prefix.
export const TABLE_KEY_PREFIXES = {
  /** One layout per report: `report-<slug>` (reports/$slug, ADR-199 Phase 4). */
  report: 'report-',
} as const;
