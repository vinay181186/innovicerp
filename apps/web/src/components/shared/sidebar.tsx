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
    groups: [
      {
        items: [{ to: '/job-cards', label: 'Job Cards', icon: '🏭' }],
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
          { to: '/delivery-challans', label: 'Delivery Challans', icon: '📦' },
        ],
      },
      {
        label: 'Master',
        items: [{ to: '/clients', label: 'Client Master', icon: '🏢' }],
      },
    ],
  },
  {
    key: 'store',
    label: 'Store',
    modClass: 'store',
    icon: '🏬',
    groups: [
      {
        label: 'Entry',
        items: [{ to: '/goods-receipt-notes', label: 'GRN', icon: '📥' }],
      },
      {
        label: 'Master',
        items: [{ to: '/items', label: 'Item Master', icon: '◉' }],
      },
      {
        label: 'Report',
        items: [{ to: '/store-transactions', label: 'Stock Ledger', icon: '📖' }],
      },
    ],
  },
  {
    key: 'production',
    label: 'Production',
    modClass: 'production',
    icon: '🏭',
    groups: [
      {
        label: 'Entry',
        items: [
          { to: '/op-entry', label: 'Op Entry (JC)', icon: '🔧' },
          { to: '/op-entry/machines', label: 'Op Entry (Machine)', icon: '⚙️' },
          { to: '/op-entry/running', label: 'Live Operations', icon: '🔴' },
        ],
      },
      {
        label: 'Master',
        items: [
          { to: '/machines', label: 'Machines', icon: '⚙️' },
          { to: '/operators', label: 'Operators', icon: '👷' },
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
          { to: '/nc-register', label: 'NC Register', icon: '⚠️' },
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
