// Innovic ERP header navigation (2026-09-21) — replaces the 220px left sidebar
// and the old top bar with ONE band, --topbar-height tall (48px since the
// Phase 2 token pass; it was 54px before): logo → Dashboard → every module as
// a dropdown → search → sync → password → sign out → who is signed in.
//
// Markup follows design-ref/components/navigation/TopNav.jsx one-for-one —
// `.topnav` > `.tn-logo` / `.tn-item` / `.tn-sec` > button + `▾ .tn-caret` /
// `.tn-menu(.flip)` > `.tn-col` > `.tn-col-label` + `.tn-link` >
// `.tn-link-icon`, then `.tn-right` > right cluster + `.tn-avatar`. Two
// things here have no counterpart in the reference and are deliberate app
// additions: the `tn-mod-<dept>` / `open` hooks on `.tn-sec`, and the access gating below.
//
// Same data as before: SECTIONS / ORDERED_SECTIONS in nav-sections.ts still
// feed the breadcrumbs and the open-page tabs, so a page named here is named
// everywhere. Same gates as before: a module shows only for someone with
// department access (admin sees all), and a page inside it hides when the
// user's access does not grant VIEW on its form key ("Hide page").
//
// The module button carries no icon: with twelve modules, the labels alone
// are what fit a 1366px screen beside the search box; the pages inside the
// dropdown keep their icons. Tasks & Alerts and System Settings read "Tasks"
// and "Settings" on the button for the same reason — the dropdown heading and
// the breadcrumb still say the full name.
//
// One dropdown open at a time. Picking a page navigates but LEAVES THE MENU
// OPEN (user, 2026-09-21): the operator can move between a module's pages
// from the same card without re-opening it, and the card closes when they
// click anywhere outside it, press Escape, or open another module. The
// button for the module the current page lives in is highlighted whether or
// not its menu is open, so the header always says where you are.

import { Link, useLocation } from '@tanstack/react-router';
import { useEffect, useRef, useState } from 'react';
import { GlobalSearch } from '@/components/shared/global-search';
import { canViewForm, useMyAccess } from '@/lib/access-control';
import { INNOVIC_LOGO_DATA_URI } from '@/lib/print/letterhead-logo';
import { roleLabel } from '@/lib/role-label';
import { signOut, useSession } from '@/lib/session';
import { usePendingTimeChangeCount } from '@/modules/op-entry/api';
import { Icon } from '@/ui/core';
import { initials, ORDERED_SECTIONS, shouldShowSection, type NavSection } from './nav-sections';

const OPEN_KEY_STORAGE = 'innovic.topnav.open';

/** What the module button says. Only two are shortened; every other module
 *  keeps its own name. */
const BUTTON_LABEL: Record<string, string> = {
  tasks: 'Tasks',
  system: 'Settings',
};

function sectionContains(sec: NavSection, pathname: string): boolean {
  return sec.groups.some((g) =>
    g.items.some((i) => pathname === i.to || pathname.startsWith(i.to + '/')),
  );
}

export function TopNav(): React.JSX.Element {
  const { data: me } = useSession();
  const { pathname } = useLocation();
  const { data: eff } = useMyAccess();
  const isAdmin = me?.role === 'admin';
  // Badge on System Settings → Approvals (ADR-130). Only fetched for someone
  // who can actually decide; everyone else gets 0 and no request.
  const pendingApprovals = usePendingTimeChangeCount(isAdmin || me?.role === 'manager');

  // Which module's menu is open. Remembered in sessionStorage so it survives
  // a page reload (user, 2026-09-21: pick a page, then pick "Create SO" from
  // the same card — the exit guard / reload must not swallow the card). The
  // tab's own storage, so a second browser tab starts closed.
  const [openKey, setOpenKeyState] = useState<string | null>(() => {
    try {
      return window.sessionStorage.getItem(OPEN_KEY_STORAGE);
    } catch {
      return null;
    }
  });
  const setOpenKey = (next: string | null | ((prev: string | null) => string | null)): void => {
    setOpenKeyState((prev) => {
      const v = typeof next === 'function' ? next(prev) : next;
      try {
        if (v) window.sessionStorage.setItem(OPEN_KEY_STORAGE, v);
        else window.sessionStorage.removeItem(OPEN_KEY_STORAGE);
      } catch {
        // storage blocked: the menu still works for this render
      }
      return v;
    });
  };
  // Whether the open menu must anchor to its button's RIGHT edge: measured
  // when it opens, from where the button actually sits, so a menu near the
  // right of the screen opens leftwards and one near the left never does —
  // whatever the count of modules this user can see.
  const [flip, setFlip] = useState(false);
  const navRef = useRef<HTMLElement>(null);

  // Close on a click outside the header or on Escape. Registered only while a
  // menu is open, so an idle header adds no listeners.
  useEffect(() => {
    if (!openKey) return;
    const onDown = (e: MouseEvent): void => {
      const t = e.target as Element | null;
      if (!t || (navRef.current && navRef.current.contains(t))) return;
      // A click inside a dialog (the exit-guard's "leave this page?" box, a
      // confirm) is not the operator leaving the menu: they are answering a
      // question the pick raised. The card stays until they click the page.
      if (t.closest('.overlay, [role="dialog"], [role="alertdialog"]')) return;
      setOpenKey(null);
    };
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setOpenKey(null);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [openKey]);

  const visible = ORDERED_SECTIONS.filter((sec) => shouldShowSection(sec.key, isAdmin, eff));

  return (
    /* id AND class: the stylesheet's selector is dual (#topnav, .topnav).
       The class is the name the design system uses; the id is kept because
       the global-search width rules key off it (#topnav .innovic-input
       .gs-input, twice, at two breakpoints). */
    <nav id="topnav" className="topnav" ref={navRef} aria-label="Main">
      <Link to="/" className="tn-logo" title="Innovic ERP — Dashboard">
        <img src={INNOVIC_LOGO_DATA_URI} alt="Innovic" />
      </Link>

      <Link to="/" className={`tn-item${pathname === '/' ? ' active' : ''}`}>
        Dashboard
      </Link>

      {visible.map((sec) => {
        const here = sectionContains(sec, pathname);
        const open = openKey === sec.key;
        const items = sec.groups
          .map((grp) => ({
            label: grp.label,
            // "Hide page": a link with a formKey vanishes when the user's access
            // does not grant VIEW on it. Admin bypasses; links without a formKey
            // are always shown.
            items: grp.items.filter((it) => isAdmin || !it.formKey || canViewForm(eff, it.formKey)),
          }))
          .filter((grp) => grp.items.length > 0);
        return (
          <div key={sec.key} className={`tn-sec tn-mod-${sec.modClass}${open ? ' open' : ''}`}>
            <button
              type="button"
              className={`tn-item${here || open ? ' active' : ''}`}
              aria-haspopup="menu"
              aria-expanded={open}
              onClick={(e) => {
                const r = e.currentTarget.getBoundingClientRect();
                setFlip(r.left + r.width / 2 > window.innerWidth / 2);
                setOpenKey((prev) => (prev === sec.key ? null : sec.key));
              }}
            >
              {BUTTON_LABEL[sec.key] ?? sec.label}
              <span className="tn-caret" aria-hidden>
                ▾
              </span>
            </button>
            {open ? (
              <div className={`tn-menu${flip ? ' flip' : ''}`} role="menu" aria-label={sec.label}>
                {items.map((grp, gi) => (
                  <div key={gi} className="tn-col">
                    {grp.label ? <div className="tn-col-label">{grp.label}</div> : null}
                    {grp.items.map((it) => {
                      const on = pathname === it.to || pathname.startsWith(it.to + '/');
                      return (
                        <Link
                          key={it.to}
                          to={it.to}
                          role="menuitem"
                          className={`tn-link${on ? ' on' : ''}`}
                        >
                          <span className="tn-link-icon" aria-hidden>
                            {it.icon}
                          </span>
                          <span>{it.label}</span>
                          {/* Only the Approvals item carries a count today. It is
                              0 (and the query disabled) for anyone who cannot
                              approve, so it never nags an operator. */}
                          {it.to === '/approvals' && pendingApprovals > 0 ? (
                            <span className="badge b-amber" style={{ marginLeft: 'auto' }}>
                              {pendingApprovals}
                            </span>
                          ) : null}
                        </Link>
                      );
                    })}
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        );
      })}

      <div className="tn-right">
        <GlobalSearch />
        <Link
          to="/change-password"
          className="btn btn-ghost btn-sm tn-iconbtn"
          title="Change your password"
        >
          <Icon name="key-round" size={15} />
        </Link>
        <button
          type="button"
          className="btn btn-ghost btn-sm tn-iconbtn"
          onClick={() => void signOut()}
          title="Sign out"
        >
          <Icon name="log-out" size={15} />
        </button>
        <span
          className="tn-avatar"
          title={me?.email ? `${me.email} · ${roleLabel(me.role)}` : 'Not signed in'}
        >
          {initials(me?.email)}
        </span>
      </div>
    </nav>
  );
}
