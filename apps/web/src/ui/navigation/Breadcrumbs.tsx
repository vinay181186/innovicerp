// Breadcrumbs — the 11px trail under the page tabs
// (design-ref/components/navigation/Breadcrumbs.*):
//   Home › Sales & CRM › SO Master › Detail
// Links are blue, the current (last) crumb is bold navy and never a link.
//
// Purely presentational: the caller builds the trail. The live
// components/shared/breadcrumbs.tsx derives it from nav-sections.ts by
// longest-base match — that derivation stays there (and must stay in sync with
// PageTabs' own longest-match resolution, audit/02 §D.9); Phase 3 moves it onto
// this component. Nothing here touches the router, so /__ui-kit can render it.
//
// Layout (flex, gap, font-size, and the page gutter it must share with
// #content) lives in CSS on `.breadcrumbs`, not inline — sitting outside
// #content it has to carry #content's own --content-pad, which an inline style
// cannot follow.

// Precedence per crumb, mirroring LinkSlot: `to` + renderLink → the caller's
// router link · `to` alone → <a href> · neither → plain text. The last crumb
// is always plain text.

import type { RenderLink } from '../layout/link-slot';
import { isPlainLeftClick } from '../is-plain-left-click';

export interface Crumb {
  label: string;
  /** Target path. Present = this crumb is a link (except when it is the last
   *  one — the page you are already on is never linked). */
  to?: string;
}

export interface BreadcrumbsProps {
  crumbs: Crumb[];
  /** Fired when a crumb link is clicked in the router-free <a> fallback.
   *  Supplying it means the handler OWNS the click: the <a>'s own navigation
   *  is suppressed, so the SPA is not reloaded. */
  onNavigate?: (crumb: Crumb) => void;
  /** Router link renderer, e.g. `(p) => <Link {...p} />` — the kit's one
   *  RenderLink shape (ui/layout/link-slot), so middle-click / ctrl-click /
   *  "open in new tab" keep working. */
  renderLink?: RenderLink;
}

const LINK_STYLE: React.CSSProperties = {
  color: 'var(--text-link)',
  textDecoration: 'none',
  cursor: 'pointer',
};

/** True for a plain left-click with no modifier — the only click an in-page
 *  handler may swallow. Ctrl/cmd/shift/middle-click must stay the browser's,
 *  so "open in new tab" on a crumb keeps working. */
export function Breadcrumbs({
  crumbs,
  onNavigate,
  renderLink,
}: BreadcrumbsProps): React.JSX.Element | null {
  if (crumbs.length === 0) return null;

  return (
    /* Class only, no id: the stylesheet matches either (#breadcrumbs,
       .breadcrumbs) and nothing in the app keys off the id (grepped), while a
       hard-coded id cannot be rendered twice on one page — which /__ui-kit
       must do to show "Breadcrumbs (any depth)" — and collides with the still
       -live components/shared/breadcrumbs.tsx until Phase 3 retires it. */
    <nav className="breadcrumbs" aria-label="Breadcrumb">
      {crumbs.map((c, i) => {
        const last = i === crumbs.length - 1;
        const linked = Boolean(c.to) && !last;
        return (
          <span
            key={`${c.label}-${i}`}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--sp-1)' }}
          >
            {linked && c.to ? (
              (renderLink?.({
                to: c.to,
                style: LINK_STYLE,
                children: c.label,
              }) ?? (
                <a
                  style={LINK_STYLE}
                  href={c.to}
                  onClick={(e) => {
                    /* With onNavigate the caller navigates, so the browser must
                       NOT also follow href — that would full-page reload the
                       SPA on top of the handler. Without it the href is the
                       only navigation there is, so it is left alone. */
                    if (!onNavigate || !isPlainLeftClick(e)) return;
                    e.preventDefault();
                    onNavigate(c);
                  }}
                >
                  {c.label}
                </a>
              ))
            ) : (
              <span
                className={last ? 'fw-700' : 'text3'}
                {...(last ? { 'aria-current': 'page' as const } : {})}
                style={last ? { color: 'var(--text)' } : undefined}
              >
                {c.label}
              </span>
            )}
            {!last ? (
              <span className="text3" aria-hidden>
                ›
              </span>
            ) : null}
          </span>
        );
      })}
    </nav>
  );
}
