// Breadcrumb trail shown at the top of every authenticated screen. Derived from
// the sidebar nav config (SECTIONS) so the path always matches the menu:
//   Home › <Section> › <Screen>  (+ New / Edit / Detail for sub-routes)
// Rendered once in the shared shell (_authenticated.tsx), so it covers all
// modules with no per-screen wiring.

import { Link, useLocation } from '@tanstack/react-router';
import { SECTIONS } from './sidebar';

interface Crumb {
  label: string;
  to?: string;
}

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

export function Breadcrumbs(): React.JSX.Element {
  const { pathname } = useLocation();
  const crumbs = buildCrumbs(pathname);

  return (
    <nav
      aria-label="Breadcrumb"
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        flexWrap: 'wrap',
        fontSize: 12,
        color: 'var(--text3)',
        marginBottom: 12,
      }}
    >
      {crumbs.map((c, i) => {
        const last = i === crumbs.length - 1;
        return (
          <span key={`${c.label}-${i}`} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            {c.to && !last ? (
              <Link to={c.to} style={{ color: 'var(--cyan)', textDecoration: 'none' }}>
                {c.label}
              </Link>
            ) : (
              <span style={{ color: last ? 'var(--text)' : 'var(--text3)', fontWeight: last ? 700 : 400 }}>
                {c.label}
              </span>
            )}
            {!last ? <span style={{ color: 'var(--text3)' }}>›</span> : null}
          </span>
        );
      })}
    </nav>
  );
}
