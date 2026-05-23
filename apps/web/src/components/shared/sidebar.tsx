// Innovic ERP sidebar — port of the legacy HTML's #sidebar structure.
// 220px fixed width, white surface, collapsible department sections,
// active-item indicator (cyan left-border + cyan text + gradient bg).
//
// Per memory feedback_ui_match_legacy_html.md: data layout 1:1 from
// legacy; chrome (this nav) matches legacy too post-2026-05-19 prompt.
//
// Hamburger on mobile (<768px) collapses the sidebar off-screen; the
// .sb-open class on the root element slides it back in. Triggered from
// TopBar.

import { Link, useLocation } from '@tanstack/react-router';
import { useState } from 'react';
import { useSession } from '@/lib/session';

interface NavItem {
  to: string;
  label: string;
  icon: string; // emoji glyph (matches legacy)
}

interface NavSubGroup {
  label?: string;
  items: NavItem[];
}

interface NavSection {
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
const SECTIONS: readonly NavSection[] = [
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
          { to: '/planning-dashboard', label: 'Planning Dashboard', icon: '📊' },
          { to: '/planning', label: 'SO/JW Planning', icon: '📋' },
          { to: '/so-overview', label: 'SO Overview', icon: '📊' },
          { to: '/so-status', label: 'SO Status Review', icon: '📊' },
          { to: '/assemblies', label: 'Assembly Tracker', icon: '📦' },
          { to: '/plans', label: 'Plans', icon: '📋' },
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
          { to: '/sales-orders', label: 'SO Master', icon: '📋' },
          { to: '/job-work-orders', label: 'JW Master', icon: '🔧' },
          { to: '/delivery-challans', label: 'Dispatch Register', icon: '📦' },
        ],
      },
      {
        label: 'Master',
        items: [{ to: '/clients', label: 'Client Master', icon: '🏢' }],
      },
      // Legacy sidebar L419–423 (Report group). Only the entries with a
      // shipped /route in React are listed; the rest land as their modules
      // ship per docs/PARITY/sales-sidebar.md §summary.
      {
        label: 'Report',
        items: [
          { to: '/so-timeline', label: 'SO Timeline', icon: '📅' },
          { to: '/pending-so-value', label: 'Pending SO Value', icon: '💰' },
          { to: '/reports?group=Sales', label: 'Sales Reports', icon: '📊' },
        ],
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
          { to: '/goods-receipt-notes', label: 'GRN (Goods Receipt)', icon: '📥' },
          { to: '/issue-register', label: 'Item Issue Register', icon: '📋' },
          { to: '/tool-issues', label: 'Tool Issue Register', icon: '🔧' },
          { to: '/party-grn', label: 'Party Material GRN', icon: '📥' },
          { to: '/jw-dc', label: 'JW Delivery Challan', icon: '📋' },
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
          { to: '/store-inventory', label: 'Store / Inventory', icon: '📦' },
          { to: '/store-transactions', label: 'Stock Ledger', icon: '📖' },
          { to: '/reports?group=Store', label: 'Store Reports', icon: '📊' },
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
          { to: '/op-entry', label: 'Op Entry', icon: '✚' },
          { to: '/op-entry/machines', label: 'Machine Op Entry', icon: '⚙' },
          { to: '/jc-ops', label: 'JC Operations', icon: '⨯' },
          { to: '/daily-report', label: 'Daily Report', icon: '📊' },
        ],
      },
      {
        label: 'Master',
        items: [
          { to: '/job-cards', label: 'Job Cards', icon: '▭' },
          { to: '/machines', label: 'Machine Master', icon: '⚙' },
          { to: '/operators', label: 'Operator Master', icon: '👷' },
        ],
      },
      {
        label: 'Report',
        items: [
          { to: '/production-dashboard', label: 'Production Dashboard', icon: '📊' },
          { to: '/shop-floor', label: 'Shop Floor', icon: '🏭' },
          { to: '/op-entry/running', label: 'Live Operations', icon: '🔴' },
          { to: '/job-queue', label: 'Job Queue', icon: '⬛' },
          { to: '/machine-loading', label: 'Machine Loading', icon: '▣' },
          { to: '/production-schedule', label: 'Production Schedule (Gantt)', icon: '📅' },
          { to: '/prod-so-list', label: 'SO List', icon: '📋' },
          { to: '/prod-jw-list', label: 'JW List', icon: '📋' },
          { to: '/reports?group=Production', label: 'Production Reports', icon: '📊' },
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
          { to: '/design-work-log', label: 'Daily Work Log', icon: '⏱' },
          { to: '/bom-masters', label: 'BOM Master', icon: '📦' },
          { to: '/design-tracker', label: 'Design Tracker', icon: '🎨' },
          { to: '/route-cards', label: 'Route Cards', icon: '🗒' },
          { to: '/reports?group=Design', label: 'Design Reports', icon: '📊' },
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
          { to: '/qc-dashboard', label: 'QC Dashboard', icon: '🛡️' },
          { to: '/incoming-qc', label: 'Incoming QC', icon: '🔬' },
          { to: '/nc-register', label: 'NC Register', icon: '⚠️' },
          { to: '/capa', label: 'CAPA', icon: '🛡' },
          { to: '/qc-call-register', label: 'QC Call Register', icon: '📋' },
          { to: '/tpi', label: 'TPI Inspection', icon: '🔍' },
          { to: '/qc-command', label: 'QC Command Center', icon: '🔬' },
          { to: '/so-qc-status', label: 'SO QC Status', icon: '📋' },
          { to: '/qc-history', label: 'QC History', icon: '📊' },
          { to: '/qc-docs', label: 'QC Documents', icon: '🗃' },
        ],
      },
      {
        label: 'Master',
        items: [
          { to: '/qc-processes', label: 'QC Process Master', icon: '⚙' },
          { to: '/report-master', label: 'Report Master', icon: '📄' },
        ],
      },
    ],
  },
  {
    key: 'purchase',
    label: 'Purchase',
    modClass: 'purchase',
    icon: '🛒',
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
        label: 'Master',
        items: [{ to: '/cost-centers', label: 'Cost Center Master', icon: '🏢' }],
      },
    ],
  },
  {
    key: 'system',
    label: 'Reports',
    modClass: 'system',
    icon: '📊',
    groups: [
      {
        items: [
          { to: '/reports', label: 'Reports', icon: '📊' },
          { to: '/saved-reports', label: 'Saved Reports', icon: '✨' },
        ],
      },
      {
        label: 'Admin',
        items: [
          { to: '/users', label: 'User Management', icon: '👥' },
          { to: '/settings', label: 'Settings', icon: '⚙' },
        ],
      },
    ],
  },
] as const;

function initials(email: string | undefined): string {
  if (!email) return '??';
  const local = email.split('@')[0] ?? '';
  const parts = local.split(/[._-]/).filter(Boolean);
  if (parts.length >= 2) return (parts[0]![0]! + parts[1]![0]!).toUpperCase();
  return local.slice(0, 2).toUpperCase();
}

export function Sidebar(): React.JSX.Element {
  const { data: me } = useSession();
  const { pathname } = useLocation();

  // Sections collapsed by default per legacy UX — but the section
  // containing the current route auto-opens so the active item is
  // visible on cold load. Persisting across navigations: keep
  // collapsed/open state per-section in React state, seed it from
  // pathname.
  const initialOpen = new Set<string>();
  for (const sec of SECTIONS) {
    if (
      sec.groups.some((g) =>
        g.items.some((i) => pathname === i.to || pathname.startsWith(i.to + '/')),
      )
    ) {
      initialOpen.add(sec.key);
    }
  }
  const [openSections, setOpenSections] = useState<Set<string>>(initialOpen);

  const toggle = (key: string): void => {
    setOpenSections((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const isActive = (to: string): boolean => pathname === to || pathname.startsWith(to + '/');

  return (
    <aside id="sidebar">
      <div className="sb-logo">
        <Link to="/" className="block no-underline">
          <div className="sb-company">INNOVIC ERP</div>
          <div className="sb-sub">manufacturing</div>
        </Link>
      </div>

      <a
        className={`sb-item ${pathname === '/' ? 'active' : ''}`}
        onClick={() => undefined}
        style={{ cursor: 'pointer' }}
      >
        <Link
          to="/"
          className="flex w-full items-center gap-[10px] no-underline text-inherit"
          style={{ color: 'inherit' }}
        >
          <span className="sb-icon">◆</span>
          <span>Dashboard</span>
        </Link>
      </a>

      {SECTIONS.map((sec) => {
        const open = openSections.has(sec.key);
        return (
          <div key={sec.key}>
            <div className={`sb-section sb-mod-${sec.modClass}`} onClick={() => toggle(sec.key)}>
              <span>
                {sec.icon} {sec.label}
              </span>
              <span
                style={{
                  fontSize: 9,
                  transition: 'transform .15s',
                  transform: open ? 'rotate(90deg)' : 'none',
                }}
              >
                ▶
              </span>
            </div>
            {open ? (
              <div>
                {sec.groups.map((grp, gi) => (
                  <div key={gi}>
                    {grp.label ? <div className="sb-grp">{grp.label}</div> : null}
                    {grp.items.map((it) => (
                      <Link
                        key={it.to}
                        to={it.to}
                        className={`sb-item ${isActive(it.to) ? 'active' : ''}`}
                      >
                        <span className="sb-icon">{it.icon}</span>
                        <span>{it.label}</span>
                      </Link>
                    ))}
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        );
      })}

      <div className="sb-bottom">
        <div className="sb-user" title={me?.email}>
          <div className="sb-avatar">{initials(me?.email)}</div>
          <div style={{ minWidth: 0 }}>
            <div
              className="sb-uname"
              style={{
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                maxWidth: 130,
              }}
            >
              {me?.email ?? 'Not signed in'}
            </div>
            <div className="sb-urole">{me?.role ?? ''}</div>
          </div>
        </div>
      </div>
    </aside>
  );
}
