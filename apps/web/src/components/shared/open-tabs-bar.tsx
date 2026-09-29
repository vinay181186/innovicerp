// ERP-style open-pages tab bar. Renders one tab per section the user has
// visited (Dashboard, Customer Dispatch, JWSO Master, …), the current page
// highlighted, each with a × to close it. Sits between the topbar and the
// breadcrumb in the shell (routes/_authenticated.tsx) as fixed chrome above
// the scroller — same reasoning as the breadcrumb (it must not scroll away).
//
// Labels + icons come from the header `SECTIONS` nav — the same source the
// breadcrumb uses — so every route shows the name the user already knows. State
// lives in the persisted `useOpenTabs` store, so the tab set survives a reload.
// The MAX_TABS = 8 cap lives in that store (stores/open-tabs.ts), not here:
// the strip never scrolls, so the cap is what keeps it to one row.
//
// Phase 3: this file is now a thin ADAPTER. All the markup lives in the
// primitive ui/navigation/PageTabs — this file keeps only the three things the
// primitive must not know about: `resolve()` (route → nav section, longest-`to`
// match, kept in sync with breadcrumbs.tsx's own longest-base match per
// audit/02 §D.9), the store, and the router. `renderLink={(p) => <Link {...p} />}`
// is what keeps a tab a real TanStack <Link>: SPA navigation, and middle-click /
// ctrl-click / "open in new tab" still handled by the browser.
import { Link, useLocation, useNavigate } from '@tanstack/react-router';
import { useEffect } from 'react';
import { useOpenTabs } from '@/stores/open-tabs';
import { PageTabs, type PageTab } from '@/ui/navigation';
import { SECTIONS } from './nav-sections';

// Flatten the nav once: every {to,label,icon}, longest `to` first so the base
// match below prefers the most specific route (mirrors breadcrumbs' longest-
// base-match).
// Items with a query string (the department "Reports" links, /reports?group=…)
// are skipped: they share a path with the Reports-section entry, which names
// the tab.
const NAV_ITEMS = SECTIONS.flatMap((s) => s.groups.flatMap((g) => g.items))
  .filter((it) => !it.search)
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

  // The × already did preventDefault + stopPropagation inside PageTabs, so
  // closing never also follows the tab's link.
  const onClose = (base: string): void => {
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

  // The store's tab shape → the primitive's. `base` is the identity (one tab
  // per nav section); `path` is the click target (the last URL visited under
  // that section), which is why they are two different fields.
  const items: PageTab[] = tabs.map((t) => ({
    key: t.base,
    label: t.label,
    icon: t.icon,
    to: t.path,
  }));

  return (
    /* id AND class: the stylesheet matches either (#pagetabs, .pagetabs).
       The class is the name the design system uses; the id is kept because
       other code may still key off it, so the primitive takes it as a prop. */
    <PageTabs
      id="pagetabs"
      tabs={items}
      activeKey={current.base}
      onClose={onClose}
      renderLink={(p) => <Link {...p} />}
    />
  );
}
