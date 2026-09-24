// Innovic ERP navigation data — the modules, their groups and pages, in the
// order the header shows them. This used to live inside the left sidebar
// (components/shared/sidebar.tsx); the sidebar is gone (header navigation,
// 2026-09-21) but the breadcrumbs, the open-page tabs and the header menus
// all still read the SAME list, so a page named here is named everywhere.

import { hasDeptAccess, type AccessDeptKey, type AccessFormKey } from '@/lib/access-control';

export interface NavItem {
  to: string;
  label: string;
  icon: string; // emoji glyph (matches legacy)
  // When set, this link is hidden for a user whose access does not grant VIEW
  // on this form key — the "Hide page" per-page switch (Access Control → Config).
  // Items without a formKey are always shown to anyone who can see the section,
  // exactly as before. Wired for Purchase first; add keys to widen it.
  formKey?: AccessFormKey;
}

export interface NavSubGroup {
  label?: string;
  items: NavItem[];
}

export interface NavSection {
  key: string;
  label: string;
  modClass:
    | 'planning'
    | 'sales'
    | 'store'
    | 'design'
    | 'production'
    | 'qc'
    | 'purchase'
    | 'finance'
    | 'tasks'
    | 'system';
  icon: string; // emoji prefix matching legacy
  groups: NavSubGroup[];
}

// Section + item structure mirrors legacy HTML L399–500. Items that
// don't have a shipped route in /apps/web yet are omitted; we add them
// as routes ship rather than rendering dead links.
export const SECTIONS: readonly NavSection[] = [
  {
    key: 'planning',
    label: 'Planning',
    modClass: 'planning',
    icon: '📋',
    // Items mirror legacy sidebar L401–405 in order + labels + icons.
    // /plans (React-only convenience index) is appended below the legacy
    // five so the legacy list stays in canonical order at the top.
    // /job-cards moved to Production per legacy L459 (dept:'production').
    groups: [
      {
        items: [
          { to: '/planning', label: 'SO/JWSO Planning', icon: '📋', formKey: 'plan_create' },
          { to: '/so-overview', label: 'SO Overview', icon: '📊' },
          { to: '/so-status', label: 'SO Status Review', icon: '📊' },
          { to: '/assemblies', label: 'Assembly Tracker', icon: '📦' },
          { to: '/plans', label: 'Plans', icon: '📋', formKey: 'plan_create' },
        ],
      },
    ],
  },
  {
    key: 'sales',
    label: 'Sales & CRM',
    modClass: 'sales',
    icon: '💰',
    groups: [
      {
        label: 'Entry',
        items: [
          { to: '/sales-orders', label: 'SO Master', icon: '📋', formKey: 'so_create' },
          { to: '/job-work-orders', label: 'JWSO Master', icon: '🔧', formKey: 'jw_create' },
          // Finished-goods customer dispatch (bills against SO lines). The
          // vendor job-work outward DC register lives under Purchase →
          // "OSP Outward DC" (/delivery-challans), not here. NOTE: "JWSO" =
          // sales job-work (client supplies material); the vendor/OSP side
          // keeps "JW"/"OSP" wording to stay distinct.
          { to: '/customer-dispatches', label: 'Customer Dispatch', icon: '🚚', formKey: 'dispatch_create' },
        ],
      },
      {
        label: 'Master',
        items: [{ to: '/clients', label: 'Customer Master', icon: '🏢', formKey: 'client_create' }],
      },
      // Pending SO Value (a price-gated revenue report) is filed under the
      // Reports section, not a Sales menu item — see the Reports block below.
    ],
  },
  {
    key: 'store',
    label: 'Store',
    modClass: 'store',
    icon: '🏬',
    // Mirrors legacy sidebar L427–439 verbatim.
    groups: [
      {
        label: 'Entry',
        items: [
          { to: '/goods-receipt-notes', label: 'GRN (Goods Receipt)', icon: '📥', formKey: 'grn_create' },
          { to: '/issue-register', label: 'Item Issue Register', icon: '📋', formKey: 'issue_create' },
          { to: '/party-grn', label: 'Party Material', icon: '📥', formKey: 'party_create' },
        ],
      },
      {
        label: 'Master',
        items: [
          { to: '/items', label: 'Item Master', icon: '◉', formKey: 'item_create' },
          { to: '/party-material', label: 'Party Material Master', icon: '🏭', formKey: 'party_create' },
        ],
      },
      {
        label: 'Report',
        items: [{ to: '/store-inventory', label: 'Store / Inventory', icon: '📦' }],
      },
    ],
  },
  {
    key: 'production',
    label: 'Production',
    modClass: 'production',
    icon: '🏭',
    // Mirrors legacy sidebar L453–470 verbatim. Order matches legacy.
    groups: [
      {
        label: 'Entry',
        items: [
          // In the order the work flows (user, 2026-09-19): a Production
          // Order is raised first (ADR-170: Plan + Route Card + Target Date →
          // JC), then the shop floor books against it, then it is closed.
          { to: '/production-orders/new', label: 'Create Production Order', icon: '🏭', formKey: 'prodorder_create' },
          { to: '/op-entry', label: 'Op Entry', icon: '✚', formKey: 'op_entry' },
          { to: '/jc-ops', label: 'JC Operations', icon: '⨯', formKey: 'jc_create' },
          { to: '/daily-report', label: 'Daily Report', icon: '📊' },
          { to: '/production-orders/close', label: 'Close Production Order', icon: '🔒', formKey: 'prodorder_create' },
        ],
      },
      {
        label: 'Master',
        items: [
          // In the order the work flows: a plan becomes a Production Order,
          // which becomes a Job Card. Plans also stays under Planning under its
          // own name; here it is worded for what Production does with the
          // list — pick the plans that are ready to run.
          { to: '/plans', label: 'Plans Available for Production', icon: '📋', formKey: 'plan_create' },
          { to: '/production-orders', label: 'Production Orders', icon: '🏭', formKey: 'prodorder_create' },
          { to: '/job-cards', label: 'Job Cards', icon: '▭', formKey: 'jc_create' },
          { to: '/machines', label: 'Machine Master', icon: '⚙', formKey: 'machine_create' },
          { to: '/operators', label: 'Operator Master', icon: '👷', formKey: 'operator_create' },
          { to: '/raw-material', label: 'Raw Material Master', icon: '▬', formKey: 'rawmat_create' },
        ],
      },
      {
        label: 'Report',
        items: [
          { to: '/production-dashboard', label: 'Production Dashboard', icon: '📊' },
          { to: '/op-entry/running', label: 'Live Operations', icon: '🔴' },
          { to: '/job-queue', label: 'Job Queue', icon: '⬛' },
          { to: '/machine-loading', label: 'Machine Loading', icon: '▣' },
          { to: '/production-schedule', label: 'Production Schedule (Gantt)', icon: '📅' },
        ],
      },
    ],
  },
  {
    key: 'design',
    label: 'Design',
    modClass: 'design',
    icon: '📐',
    // Mirrors legacy sidebar L443–449 verbatim (ungrouped — no group labels).
    groups: [
      {
        items: [
          { to: '/design-projects', label: 'Design Projects', icon: '📋', formKey: 'dsnproj_create' },
          { to: '/design-issues', label: 'Design Issues', icon: '⚠', formKey: 'dsnissue_create' },
          { to: '/design-work-log', label: 'Daily Work Log', icon: '⏱', formKey: 'dsnworklog_create' },
          { to: '/bom-masters', label: 'BOM Master', icon: '📦', formKey: 'bom_create' },
          { to: '/design-tracker', label: 'Design Tracker', icon: '🎨', formKey: 'design_create' },
          { to: '/route-cards', label: 'Route Cards', icon: '🗒', formKey: 'routecard_create' },
        ],
      },
    ],
  },
  {
    key: 'qc',
    label: 'Quality',
    modClass: 'qc',
    icon: '✅',
    groups: [
      {
        items: [
          { to: '/qc-call-register', label: 'QC Call Register', icon: '📋', formKey: 'qc_submit' },
          { to: '/qc-command', label: 'QC Command Center', icon: '🔬', formKey: 'qc_submit' },
          { to: '/incoming-qc', label: 'Incoming QC', icon: '🔬', formKey: 'qc_incoming' },
          { to: '/qc-docs', label: 'QC Documents', icon: '🗃', formKey: 'qcdocs_upload' },
          { to: '/nc-register', label: 'NC Register', icon: '⚠️', formKey: 'nc_dispose' },
        ],
      },
      {
        label: 'Master',
        items: [
          { to: '/qc-processes', label: 'QC Process Master', icon: '⚙', formKey: 'qcprocess_create' },
          { to: '/tpi-masters', label: 'TPI Master', icon: '🔍', formKey: 'tpimaster_create' },
        ],
      },
    ],
  },
  {
    key: 'purchase',
    label: 'Purchase',
    modClass: 'purchase',
    icon: '🛒',
    // Mirrors legacy sidebar Purchase block (HTML L520-525 area):
    // PR / PO / Outsource Jobs / OSP DC / Service PO under Entry, Vendor under
    // Master, SC Dashboard under Report.
    groups: [
      {
        label: 'Entry',
        items: [
          { to: '/purchase-requests', label: 'Purchase Requests', icon: '📄', formKey: 'pr_create' },
          { to: '/purchase-orders', label: 'Purchase Orders', icon: '📋', formKey: 'po_create' },
          { to: '/delivery-challans', label: 'OSP Outward DC', icon: '🚛', formKey: 'ospdc_create' },
        ],
      },
      {
        label: 'Master',
        items: [{ to: '/vendors', label: 'Vendor Master', icon: '🚚', formKey: 'vendor_create' }],
      },
      // Supply Chain Dashboard (a price-gated PO/GRN report) is filed under the
      // Reports section, not a Purchase menu item — see the Reports block below.
    ],
  },
  {
    key: 'tasks',
    label: 'Tasks & Alerts',
    modClass: 'tasks',
    icon: '🔔',
    groups: [
      {
        items: [
          { to: '/task-board', label: 'Task Board', icon: '📋' },
          { to: '/daily-task-reports', label: 'Daily Task Reports', icon: '📝' },
          { to: '/alerts', label: 'Alerts', icon: '🔔' },
          { to: '/activity-log', label: 'Activity Log', icon: '📜' },
        ],
      },
    ],
  },
  {
    key: 'finance',
    label: 'Finance',
    modClass: 'finance',
    icon: '💰',
    groups: [
      {
        label: 'Entry',
        items: [{ to: '/invoices', label: 'Invoices', icon: '📄', formKey: 'invoice_create' }],
      },
      {
        label: 'Master',
        items: [{ to: '/cost-centers', label: 'Cost Centre Master', icon: '🏢', formKey: 'cc_create' }],
      },
      {
        label: 'Report',
        items: [
          { to: '/so-costing', label: 'SO Costing', icon: '💰' },
          { to: '/stock-valuation', label: 'Stock Valuation', icon: '📦' },
        ],
      },
    ],
  },
  // Reports section — reporting tools only. Ungated (every authenticated
  // role consumes reports). Note: per-dept Reports links (Sales Reports,
  // Store Reports, etc.) live under their respective dept sections; this
  // section is the cross-dept report runner + ad-hoc saved reports.
  {
    key: 'reports',
    label: 'Reports',
    modClass: 'system',
    icon: '📊',
    groups: [
      {
        items: [
          { to: '/reports', label: 'Reports', icon: '📊' },
          { to: '/saved-reports', label: 'Saved Reports', icon: '✨' },
          { to: '/pending-so-value', label: 'Pending SO Value', icon: '💰' },
          { to: '/sc-dashboard', label: 'Supply Chain Dashboard', icon: '🔗' },
          { to: '/stuck-dashboard', label: 'Stuck Dashboard', icon: '⚠' },
          { to: '/so-cycle-time', label: 'SO Cycle Time', icon: '⏱' },
        ],
      },
    ],
  },
  // System Settings — admin tooling. Mirror of legacy `⚙ System Settings`
  // (HTML L516-524). Dept key `system` from ACCESS_DEPTS gates visibility
  // for non-admin / non-fullAccess users. Admin always sees it.
  {
    key: 'system',
    label: 'System Settings',
    modClass: 'system',
    icon: '⚙',
    groups: [
      {
        items: [
          { to: '/users', label: 'User Management', icon: '👥' },
          { to: '/access-control', label: 'Access Control', icon: '🔒' },
          { to: '/approval-config', label: 'Approval Configuration', icon: '⚖' },
          // The rules live next door in Approval Configuration; this is the
          // queue of things waiting on a manager (ADR-130).
          { to: '/approvals', label: 'Approvals', icon: '✅' },
          { to: '/print-templates', label: 'Print Templates', icon: '📄' },
          { to: '/op-log', label: 'Operation Log', icon: '☰' },
          { to: '/trash', label: 'Trash', icon: '🗑' },
          { to: '/settings', label: 'Settings', icon: '⚙' },
          { to: '/backup', label: 'Backup & Export', icon: '💾' },
        ],
      },
    ],
  },
] as const;

// Sidebar section display order (user preference 2026-06-14 — overrides the
// legacy menu order). Dashboard is the fixed top item, then:
// Sales, Design, Planning, Production, Purchase, QC, Store, Finance, Tasks,
// Reports, Settings.
const SECTION_ORDER: readonly string[] = [
  'sales',
  'design',
  'planning',
  'production',
  'purchase',
  'qc',
  'store',
  'finance',
  'tasks',
  'reports',
  'system',
];
export const ORDERED_SECTIONS: readonly NavSection[] = [...SECTIONS].sort(
  (a, b) => SECTION_ORDER.indexOf(a.key) - SECTION_ORDER.indexOf(b.key),
);

export function initials(email: string | undefined): string {
  if (!email) return '??';
  const local = email.split('@')[0] ?? '';
  const parts = local.split(/[._-]/).filter(Boolean);
  if (parts.length >= 2) return (parts[0]![0]! + parts[1]![0]!).toUpperCase();
  return local.slice(0, 2).toUpperCase();
}

// Section keys that are NEVER dept-gated (always visible to authenticated
// users regardless of matrix). 'tasks' has no equivalent dept key in the
// legacy registry and is plumbing every role needs (alerts + activity log).
// Nothing is ungated any more. 'tasks' and 'reports' used to bypass the matrix
// entirely — a decision taken before the tier model existed — so every account,
// including one nobody had configured yet, saw the task board, every
// department's alert drill-downs, the full activity log and 19 cross-department
// reports. Both are ordinary ACCESS_DEPTS entries now and gate like the rest:
// invisible until an admin grants them.

// Admin sees every section regardless of matrix (legacy behavior — admin
// is the only role with implicit dept access on the home routing too).
export function shouldShowSection(
  sectionKey: string,
  isAdmin: boolean,
  eff: Parameters<typeof hasDeptAccess>[0],
): boolean {
  if (isAdmin) return true;
  // Section keys align 1:1 with ACCESS_DEPTS keys.
  return hasDeptAccess(eff, sectionKey as AccessDeptKey);
}
