// ERP-style open-pages tab bar. Renders one tab per section the user has
// visited (Dashboard, Customer Dispatch, JWSO Master, …), the current page
// highlighted, each with a × to close it. Sits between the breadcrumb and
// #content in the shell (routes/_authenticated.tsx) as fixed chrome above the
// scroller — same reasoning as the breadcrumb (it must not scroll away).
//
// Labels + icons come from the sidebar `SECTIONS` nav — the same source the
// breadcrumb uses — so every route shows the name the user already knows. State
// lives in the persisted `useOpenTabs` store, so the tab set survives a reload.
import { Link, useLocation, useNavigate } from '@tanstack/react-router';
import { useEffect } from 'react';
import { useOpenTabs } from '@/stores/open-tabs';
import { SECTIONS } from './sidebar';

// Flatten the nav once: every {to,label,icon}, longest `to` first so the base
// match below prefers the most specific route (mirrors breadcrumbs' longest-
// base-match).
const NAV_ITEMS = SECTIONS.flatMap((s) => s.groups.flatMap((g) => g.items))
  .slice()
  .sort((a, b) => b.to.length - a.to.length);

function humanize(seg: string): string {
  return seg.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Map a pathname to its nav section: the longest `to` the path exactly is or
 *  sits under. Falls back to the first path segment for any route not in the
 *  nav, so every visited page still gets a tab. */
function resolve(pathname: string): { base: string; label: string; icon: string } {
  for (const it of NAV_ITEMS) {
    if (pathname === it.to || (it.to !== '/' && pathname.startsWith(`${it.to}/`))) {
      return { base: it.to, label: it.label, icon: it.icon };
    }
  }
  const seg = pathname.split('/').filter(Boolean)[0] ?? '';
  return { base: `/${seg}`, label: seg ? humanize(seg) : 'Home', icon: '📄' };
}

export function OpenTabsBar(): React.JSX.Element | null {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const tabs = useOpenTabs((s) => s.tabs);
  const openTab = useOpenTabs((s) => s.openTab);
  const closeTab = useOpenTabs((s) => s.closeTab);

  const current = resolve(pathname);

  // Record / refresh the tab for the page we're on now.
  useEffect(() => {
    openTab({ base: current.base, label: current.label, icon: current.icon, path: pathname });
  }, [pathname, current.base, current.label, current.icon, openTab]);

  if (tabs.length === 0) return null;

  const onClose = (e: React.MouseEvent, base: string): void => {
    e.preventDefault();
    e.stopPropagation();
    const idx = tabs.findIndex((t) => t.base === base);
    const wasActive = base === current.base;
    closeTab(base);
    // Closing the active tab must navigate away, else the effect above would
    // immediately re-add it (we'd still be on its route). Fall to the left
    // neighbour, then the first remaining tab, then the dashboard.
    if (wasActive) {
      const rest = tabs.filter((t) => t.base !== base);
      const target = rest[idx - 1] ?? rest[0];
      void navigate({ to: target ? target.path : '/' });
    }
  };

  return (
    <div id="pagetabs">
      {tabs.map((t) => {
        const active = t.base === current.base;
        return (
          <Link key={t.base} to={t.path} className={`pgtab${active ? ' active' : ''}`} title={t.label}>
            <span aria-hidden>{t.icon}</span>
            <span className="pgtab-label">{t.label}</span>
            <button
              type="button"
              className="pgtab-close"
              aria-label={`Close ${t.label}`}
              onClick={(e) => onClose(e, t.base)}
            >
              ×
            </button>
          </Link>
        );
      })}
    </div>
  );
}
