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

  // Reports
  savedReportsList: 'saved-reports-list',
} as const;

export type TableKey = (typeof TABLE_KEYS)[keyof typeof TABLE_KEYS];
