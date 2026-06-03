// Dashboard widget + quick-link registries (static UI metadata shared by the
// home server [for dept gating + computing widget data] and the web [for
// rendering cards/chips + the Customize chooser]). Mirror of legacy
// _dashWidgets (L3495) + _allQuickLinks (L3347).
//
// `key`/`page` double as the stored config id. We use these stable string keys
// (legacy widget keys; our route paths for quick links) so a saved layout
// survives. `navPage` is always our route path.

export interface DashboardWidgetDef {
  key: string;
  label: string;
  desc: string;
  icon: string;
  color: string;
  dept: string | null; // null = no dept gate (visible to all)
  navPage: string;
}

// Order matches legacy _dashWidgets. quick_links is special (full-width,
// rendered from the quick-link registry, not a data widget).
export const DASHBOARD_WIDGETS: readonly DashboardWidgetDef[] = [
  { key: 'open_sos', label: 'Open SOs', desc: 'Total open SOs, quantities, due soon', icon: '📦', color: '#22C55E', dept: 'sales', navPage: '/sales-orders' },
  { key: 'jc_status', label: 'Job Card Status', desc: 'Open, In Progress, Complete counts', icon: '📝', color: '#06B6D4', dept: 'production', navPage: '/job-cards' },
  { key: 'running_machines', label: 'Running Machines', desc: 'Active machines with current job', icon: '🏭', color: '#06B6D4', dept: 'production', navPage: '/shop-floor' },
  { key: 'machine_loading', label: 'Machine Loading', desc: 'Utilization per machine', icon: '⚙', color: '#06B6D4', dept: 'production', navPage: '/machine-loading' },
  { key: 'qc_pending', label: 'QC Pending', desc: 'Items waiting for QC inspection', icon: '🔬', color: '#EF4444', dept: 'qc', navPage: '/qc-command' },
  { key: 'stock_alerts', label: 'Stock Alerts', desc: 'Low stock items', icon: '📦', color: '#F59E0B', dept: 'store', navPage: '/store-inventory' },
  { key: 'pr_pending', label: 'PR Status', desc: 'Purchase request summary', icon: '📋', color: '#2563EB', dept: 'purchase', navPage: '/purchase-requests' },
  { key: 'po_status', label: 'PO Status', desc: 'Open purchase orders summary', icon: '🛒', color: '#2563EB', dept: 'purchase', navPage: '/purchase-orders' },
  { key: 'cost_summary', label: 'Cost Summary', desc: 'Total costs across SOs', icon: '💰', color: '#0D9488', dept: 'finance', navPage: '/so-costing' },
  { key: 'my_tasks', label: 'My Tasks', desc: 'Your assigned tasks summary', icon: '📋', color: '#7C3AED', dept: 'tasks', navPage: '/task-board' },
  { key: 'so_progress', label: 'SO Progress', desc: 'Top 5 SOs by progress', icon: '📊', color: '#8B5CF6', dept: 'planning', navPage: '/so-overview' },
  { key: 'grn_pending', label: 'GRN Pending QC', desc: 'GRNs awaiting QC clearance', icon: '📥', color: '#F59E0B', dept: 'store', navPage: '/goods-receipt-notes' },
  { key: 'daily_quick', label: 'Quick Report', desc: 'Quick link to daily report', icon: '📝', color: '#7C3AED', dept: 'tasks', navPage: '/daily-task-reports' },
  { key: 'my_alerts', label: 'My Alerts', desc: 'Pending actions across departments', icon: '🔔', color: '#EF4444', dept: null, navPage: '/alerts' },
  { key: 'quick_links', label: 'Quick Access Links', desc: 'Shortcut buttons to key pages', icon: '🚀', color: '#64748B', dept: null, navPage: '/' },
] as const;

export interface DashboardQuickLinkDef {
  page: string; // our route path (also the stored config id)
  label: string;
  icon: string;
  color: string;
  dept: string | null;
}

// Mirror of legacy _allQuickLinks (page keys → our routes).
export const DASHBOARD_QUICK_LINKS: readonly DashboardQuickLinkDef[] = [
  { page: '/sales-orders', label: 'SO / WO Master', icon: '📦', color: '#22C55E', dept: 'sales' },
  { page: '/so-overview', label: 'SO Overview', icon: '📊', color: '#8B5CF6', dept: 'planning' },
  { page: '/so-status', label: 'SO Status Review', icon: '📊', color: '#8B5CF6', dept: 'planning' },
  { page: '/assemblies', label: 'Assembly Tracker', icon: '📦', color: '#14b8a6', dept: 'planning' },
  { page: '/planning', label: 'SO/JW Planning', icon: '📋', color: '#8B5CF6', dept: 'planning' },
  { page: '/job-cards', label: 'Job Cards', icon: '📝', color: '#06B6D4', dept: 'production' },
  { page: '/op-entry', label: 'Op Entry', icon: '▶️', color: '#06B6D4', dept: 'production' },
  { page: '/production-dashboard', label: 'Production Dashboard', icon: '🏭', color: '#06B6D4', dept: 'production' },
  { page: '/machine-loading', label: 'Machine Loading', icon: '⚙', color: '#06B6D4', dept: 'production' },
  { page: '/qc-dashboard', label: 'QC Call Register', icon: '🔬', color: '#EF4444', dept: 'qc' },
  { page: '/incoming-qc', label: 'Incoming QC', icon: '🔬', color: '#EF4444', dept: 'qc' },
  { page: '/qc-documents', label: 'QC Documents', icon: '🗃', color: '#EF4444', dept: 'qc' },
  { page: '/store-inventory', label: 'Store / Inventory', icon: '🏪', color: '#F59E0B', dept: 'store' },
  { page: '/items', label: 'Item Master', icon: '📦', color: '#F59E0B', dept: 'store' },
  { page: '/goods-receipt-notes', label: 'GRN', icon: '📥', color: '#F59E0B', dept: 'store' },
  { page: '/bom-master', label: 'BOM Master', icon: '📄', color: '#8B5CF6', dept: 'design' },
  { page: '/route-cards', label: 'Route Cards', icon: '📄', color: '#8B5CF6', dept: 'design' },
  { page: '/design-projects', label: 'Design Projects', icon: '📋', color: '#8B5CF6', dept: 'design' },
  { page: '/design-issues', label: 'Design Issues', icon: '⚠️', color: '#8B5CF6', dept: 'design' },
  { page: '/design-work-log', label: 'Daily Work Log', icon: '⏱️', color: '#8B5CF6', dept: 'design' },
  { page: '/purchase-requests', label: 'Purchase Requests', icon: '📋', color: '#2563EB', dept: 'purchase' },
  { page: '/purchase-orders', label: 'Purchase Orders', icon: '🛒', color: '#2563EB', dept: 'purchase' },
  { page: '/vendors', label: 'Vendor Master', icon: '🏭', color: '#2563EB', dept: 'purchase' },
  { page: '/cost-centers', label: 'Cost Centers', icon: '🏢', color: '#0D9488', dept: 'finance' },
  { page: '/so-costing', label: 'SO Costing', icon: '💰', color: '#0D9488', dept: 'finance' },
  { page: '/task-board', label: 'Task Board', icon: '📋', color: '#7C3AED', dept: 'tasks' },
  { page: '/daily-task-reports', label: 'Daily Reports', icon: '📝', color: '#7C3AED', dept: 'tasks' },
  { page: '/job-work-orders', label: 'JW Master', icon: '📦', color: '#22C55E', dept: 'sales' },
  { page: '/clients', label: 'Client Master', icon: '🧑', color: '#22C55E', dept: 'sales' },
  { page: '/customer-dispatches', label: 'Dispatch Register', icon: '🚚', color: '#22C55E', dept: 'sales' },
] as const;
