// Breadcrumb trail shown at the top of every authenticated screen. Derived from
// the header nav config (SECTIONS, nav-sections.ts) so the path always matches the menu:
//   Home › <Section> › <Screen>  (+ New / Edit / Detail for sub-routes)
// Rendered once in the shared shell (_authenticated.tsx), so it covers all
// modules with no per-screen wiring.
//
// Phase 3: this file is now a thin ADAPTER. All the markup lives in the
// primitive ui/navigation/Breadcrumbs — this file keeps only the two things
// the primitive must not know about: the route→trail derivation below, and the
// router. `renderLink={(p) => <Link {...p} />}` is what keeps a crumb a real
// TanStack <Link>: SPA navigation, and middle-click / ctrl-click / "open in
// new tab" still handled by the browser. The exported name and the (empty)
// props are unchanged — _authenticated.tsx imports this, not the primitive.
//
// buildCrumbs' longest-base match must stay in sync with open-tabs-bar.tsx's
// own `resolve()` (audit/02 §D.9) — same nav data, same rule, two callers.

import { Link, useLocation, useMatches } from '@tanstack/react-router';
import '@/routes/static-data';
import { Breadcrumbs as BreadcrumbsView, type Crumb } from '@/ui/navigation';
import { SECTIONS } from './nav-sections';

function humanize(seg: string): string {
  return seg.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

function buildCrumbs(pathname: string): Crumb[] {
  if (pathname === '/') return [{ label: 'Home' }];

  // Find the most specific (longest base path) matching nav item.
  let best: { section: string; item: string; base: string } | null = null;
  for (const sec of SECTIONS) {
    for (const grp of sec.groups) {
      for (const it of grp.items) {
        // Query-specific aliases (a department's "Reports" link) share their
        // path with the Reports-section entry; that entry names the crumb.
        if (it.search) continue;
        const base = it.to.split('?')[0] ?? it.to;
        if (pathname === base || pathname.startsWith(base + '/')) {
          if (!best || base.length > best.base.length) {
            best = { section: sec.label, item: it.label, base };
          }
        }
      }
    }
  }

  const crumbs: Crumb[] = [{ label: 'Home', to: '/' }];
  if (!best) {
    const seg = pathname.split('/').filter(Boolean)[0] ?? '';
    if (seg) crumbs.push({ label: humanize(seg) });
    return crumbs;
  }

  crumbs.push({ label: best.section });
  crumbs.push({ label: best.item, to: best.base });

  // Sub-route action (e.g. /job-cards/new, /job-cards/<id>/edit).
  const suffix = pathname.slice(best.base.length).split('/').filter(Boolean);
  if (suffix.length > 0) {
    const last = suffix[suffix.length - 1]!;
    crumbs.push({ label: last === 'new' ? 'New' : last === 'edit' ? 'Edit' : 'Detail' });
  }
  return crumbs;
}

export function Breadcrumbs(): React.JSX.Element | null {
  const { pathname } = useLocation();
  // A route flagged `staticData: { ownCrumbs: true }` prints its own trail
  // (the Reports pages: Reports › <Dept> › <Report>, ADR-191); the generic
  // "Home › Reports › Detail" above it would be a second one. See
  // routes/static-data.ts.
  const ownCrumbs = useMatches({
    select: (matches) => matches.some((m) => m.staticData.ownCrumbs === true),
  });
  if (ownCrumbs) return null;
  const crumbs = buildCrumbs(pathname);

  return (
    /* Layout lives in CSS (#breadcrumbs, .breadcrumbs) rather than inline:
       sitting outside #content it must carry #content's own horizontal padding
       (var(--content-pad)), which an inline style cannot follow. Both the id
       and the class are carried on purpose — the stylesheet's selectors are
       dual, the class is the one the design system names, and other code may
       still key off the id, so the primitive takes the id as a prop. */
    <BreadcrumbsView id="breadcrumbs" crumbs={crumbs} renderLink={(p) => <Link {...p} />} />
  );
}
