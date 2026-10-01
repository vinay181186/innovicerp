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
