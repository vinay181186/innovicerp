// Innovic ERP navigation data — the modules, their groups and pages, in the
// order the header shows them. This used to live inside the left sidebar
// (components/shared/sidebar.tsx); the sidebar is gone (header navigation,
// 2026-09-21) but the breadcrumbs, the open-page tabs and the header menus
// all still read the SAME list, so a page named here is named everywhere.

import { canOpenPage } from '@innovic/shared';
import { hasDeptAccess, type AccessDeptKey, type EffectiveAccess } from '@/lib/access-control';

export interface NavItem {
  to: string;
  label: string;
  icon: string; // emoji glyph (matches legacy)
  // ADR-234: whether the link shows is decided by the page it opens — its rule
  // in PAGE_ACCESS (packages/shared/src/lib/page-access.ts), read by
  // canOpenPage in menuGroups() below. No per-item tick lives here any more, so the
  // menu, the route guard and every next-step link can never disagree.
  // Query string for the link, e.g. { group: 'Sales' } on a department's
  // "Reports" link → /reports?group=Sales. An item with `search` matches the
  // current page only when the URL carries the same values (see
  // navItemMatches); the breadcrumbs and open-page tabs skip such items, so
  // /reports is always named by the plain Reports-section entry.
  search?: Record<string, string>;
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
          { to: '/planning', label: 'SO/JWSO Planning', icon: '📋' },
          { to: '/ml-plans', label: 'Multi-Level Plan', icon: '🧩' },
          { to: '/so-overview', label: 'SO Overview', icon: '📊' },
          { to: '/so-status', label: 'SO Status Detail', icon: '📊' },
          { to: '/assemblies', label: 'Assembly Tracker', icon: '📦' },
          { to: '/plans', label: 'Plans Available for Production', icon: '📋' },
        ],
      },
      {
        // ADR-205: a route card is what turns a plan into a Job Card, so it is
        // planning's own master, not the drawing office's. Moved out of Design
        // and listed here only (owner, 2026-10-03).
        label: 'Master',
        items: [{ to: '/route-cards', label: 'Route Card Master', icon: '🗒' }],
      },
      {
        label: 'Report',
        items: [{ to: '/reports', search: { group: 'Planning' }, label: 'Reports', icon: '📊' }],
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
          { to: '/sales-orders', label: 'SO Master', icon: '📋' },
          { to: '/job-work-orders', label: 'JWSO Master', icon: '🔧' },
          // Finished-goods customer dispatch (bills against SO lines). The
          // vendor job-work outward DC register lives under Purchase →
          // "OSP Outward DC" (/delivery-challans), not here. NOTE: "JWSO" =
          // sales job-work (client supplies material); the vendor/OSP side
          // keeps "JW"/"OSP" wording to stay distinct.
          { to: '/customer-dispatches', label: 'Customer Dispatch', icon: '🚚' },
        ],
      },
      {
        label: 'Master',
        items: [{ to: '/clients', label: 'Customer Master', icon: '🏢' }],
      },
      // Pending SO Value (a price-gated revenue report) is filed under the
      // Reports section, not a Sales menu item — see the Reports block below.
      {
        label: 'Report',
        items: [{ to: '/reports', search: { group: 'Sales' }, label: 'Reports', icon: '📊' }],
      },
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
          { to: '/goods-receipt-notes', label: 'GRN', icon: '📥' },
          { to: '/issue-register', label: 'Item Issue Register', icon: '📋' },
          { to: '/stock-counts', label: 'Stock Count', icon: '🧮' },
          { to: '/instruments', label: 'Instrument Register', icon: '📏' },
          { to: '/party-grn', label: 'Party GRN', icon: '📥' },
          { to: '/customer-material-returns', label: 'Customer Material Return', icon: '📤' },
          // Owner 2026-10-03: OSP Outward DC sits in Store → Entry. Access is still
          // decided by ospdc_create (Purchase tier) — only the menu position moved.
          { to: '/delivery-challans', label: 'OSP Outward DC', icon: '🚛' },
        ],
      },
      {
        label: 'Master',
        items: [
          { to: '/items', label: 'Item Master', icon: '◉' },
          { to: '/party-material', label: 'Party Material Master', icon: '🏭' },
        ],
      },
      {
        label: 'Report',
        items: [
          { to: '/store-inventory', label: 'Store Inventory', icon: '📦' },
          { to: '/reorder-list', label: 'Reorder List', icon: '🔁' },
          { to: '/party-stock-ledger', label: 'Party Stock Ledger', icon: '📒' },
          { to: '/reports', search: { group: 'Store' }, label: 'Reports', icon: '📊' },
        ],
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
          { to: '/production-orders/new', label: 'New Production Order', icon: '🏭' },
          { to: '/op-entry', label: 'Op Entry', icon: '✚' },
          { to: '/jc-ops', label: 'JC Operations', icon: '⨯' },
          { to: '/daily-report', label: 'Daily Production Report', icon: '📊' },
          { to: '/production-orders/close', label: 'Close Production Order', icon: '🔒' },
        ],
      },
      {
        label: 'Master',
        items: [
          // In the order the work flows: a plan becomes a Production Order,
          // which becomes a Job Card. Same screen and same name under Planning
          // (owner decision 2026-09-30: "Plans Available for Production" in both menus).
          { to: '/plans', label: 'Plans Available for Production', icon: '📋' },
          { to: '/production-orders', label: 'Production Orders', icon: '🏭' },
          { to: '/job-cards', label: 'Job Cards', icon: '▭' },
          { to: '/machines', label: 'Machine Master', icon: '⚙' },
          { to: '/operators', label: 'Operator Master', icon: '👷' },
          { to: '/raw-material', label: 'Raw Material Master', icon: '▬' },
        ],
      },
      {
        label: 'Report',
        items: [
          { to: '/production-dashboard', label: 'Production Dashboard', icon: '📊' },
          { to: '/op-entry/running', label: 'Live Operations', icon: '🔴' },
          { to: '/job-queue', label: 'Job Queue', icon: '⬛' },
          { to: '/machine-loading', label: 'Machine Loading', icon: '▣' },
          { to: '/production-schedule', label: 'Production Schedule', icon: '📅' },
          { to: '/reports', search: { group: 'Production' }, label: 'Reports', icon: '📊' },
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
          { to: '/design-projects', label: 'Design Projects', icon: '📋' },
          { to: '/design-issues', label: 'Design Issues', icon: '⚠' },
          { to: '/design-work-log', label: 'Design Work Log', icon: '⏱' },
          { to: '/bom-masters', label: 'BOM Master', icon: '📦' },
          { to: '/ml-boms', label: 'Multi-Level BOM', icon: '🧩' },
          { to: '/design-tracker', label: 'Design Tracker', icon: '🎨' },
          // Route Card Master moved to Planning > Master (ADR-205). It is
          // listed there and nowhere else — one page, one place in the menu.
        ],
      },
      {
        label: 'Report',
        items: [{ to: '/reports', search: { group: 'Design' }, label: 'Reports', icon: '📊' }],
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
          { to: '/qc-call-register', label: 'QC Call Register', icon: '📋' },
          { to: '/qc-command', label: 'QC Center', icon: '🔬' },
          { to: '/incoming-qc', label: 'Incoming QC', icon: '🔬' },
          { to: '/qc-docs', label: 'QC Documents', icon: '🗃' },
          { to: '/nc-register', label: 'NC Register', icon: '⚠️' },
        ],
      },
      {
        label: 'Master',
        items: [
          { to: '/qc-processes', label: 'QC Process Master', icon: '⚙' },
          { to: '/tpi-masters', label: 'TPI Master', icon: '🔍' },
        ],
      },
      {
        label: 'Report',
        items: [{ to: '/reports', search: { group: 'Quality' }, label: 'Reports', icon: '📊' }],
      },
    ],
  },
  {
    key: 'purchase',
    label: 'Purchase',
    modClass: 'purchase',
    icon: '🛒',
    // Mirrors legacy sidebar Purchase block (HTML L520-525 area):
    // PR / PO / Outsource Jobs / Service PO under Entry (OSP Outward DC moved to
    // Store → Entry, owner 2026-10-03), Vendor under
    // Master, SC Dashboard under Report.
    groups: [
      {
        label: 'Entry',
        items: [
          { to: '/purchase-requests', label: 'Purchase Requests', icon: '📄' },
          { to: '/purchase-orders', label: 'Purchase Orders', icon: '📋' },
        ],
      },
      {
        label: 'Master',
        items: [{ to: '/vendors', label: 'Vendor Master', icon: '🚚' }],
      },
      // Supply Chain Dashboard (a price-gated PO/GRN report) is filed under the
      // Reports section, not a Purchase menu item — see the Reports block below.
      {
        label: 'Report',
        items: [{ to: '/reports', search: { group: 'Purchase' }, label: 'Reports', icon: '📊' }],
      },
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
          { to: '/task-board', search: { view: 'daylog' }, label: 'Day Log', icon: '📝' },
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
        items: [{ to: '/invoices', label: 'Invoices', icon: '📄' }],
      },
      {
        label: 'Master',
        items: [{ to: '/cost-centers', label: 'Cost Centre Master', icon: '🏢' }],
      },
      {
        label: 'Report',
        items: [
          { to: '/so-costing', label: 'SO Costing', icon: '💰' },
          { to: '/stock-valuation', label: 'Stock Valuation', icon: '📦' },
          { to: '/reports', search: { group: 'Finance' }, label: 'Reports', icon: '📊' },
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
          { to: '/approval-config', label: 'Approval Rules', icon: '⚖' },
          // The rules live next door in Approval Rules; this is the
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

/** Does this nav item point at the page the user is on? A plain item matches
 *  its path and anything under it (/job-cards → /job-cards/123). An item with
 *  `search` matches only its exact path AND the same query values, so the
 *  eight department "Reports" links (/reports?group=…) light up one at a time. */
export function navItemMatches(
  it: NavItem,
  pathname: string,
  search: Record<string, unknown> | undefined,
): boolean {
  if (it.search) {
    if (pathname !== it.to) return false;
    return Object.entries(it.search).every(([k, v]) => String(search?.[k] ?? '') === v);
  }
  return pathname === it.to || pathname.startsWith(it.to + '/');
}

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

/** ADR-234: the groups of one module's menu this user sees — each link only if
 *  the user may open the page it leads to (PAGE_ACCESS, the rule the route
 *  guard uses too), and a group with nothing left is dropped. Read by the
 *  header menu and by the page-access test, so both see the same menu. */
export function menuGroups(
  sec: NavSection,
  eff: EffectiveAccess | null | undefined,
  isSuperAdmin: boolean,
): NavSubGroup[] {
  return sec.groups
    .map((grp) => ({
      ...grp,
      items: grp.items.filter((it) => canOpenPage(eff, isSuperAdmin, it.to)),
    }))
    .filter((grp) => grp.items.length > 0);
}
