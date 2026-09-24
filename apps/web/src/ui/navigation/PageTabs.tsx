// PageTabs — the browser-style open-pages strip that sits under the top bar
// (design-ref/components/navigation/PageTabs.*). One tab per visited module
// page, the current one highlighted with a 2px blue top edge, each with a ×
// to close it.
//
// Purely presentational: the caller owns the tab list, the active key and both
// handlers. Phase 3 wires the shell's `useOpenTabs` store into it — this file
// deliberately knows nothing about the store, the router or the nav config so
// the /__ui-kit page can render every state without a data fetch.
//
// Behaviour carried over from the live components/shared/open-tabs-bar.tsx
// (audit/02 §D.9), which stays untouched until Phase 3 swaps the shell:
//   • Renders `null` — not empty chrome — when there are zero tabs.
//   • NO overflow / scroll / max-tab logic here. The cap lives in the store
//     (MAX_TABS = 8, stores/open-tabs.ts); the strip's `overflow:hidden` and
//     the tabs' `flex:0 1 auto` in `.pagetabs`/`.pgtab` keep one row.
//   • NO border of its own. `.pagetabs`' `border-bottom` is the chrome's ONE
//     closing hairline — adding another here would double it.
//   • The × does preventDefault + stopPropagation so closing never also
//     selects (and, on a linked tab, never follows the link).
//   • `renderLink` exists so the shell can keep rendering each tab as a real
//     router <Link>: middle-click / ctrl-click / "open in new tab" must keep
//     working, which an onClick+navigate() tab would break. It takes the kit's
//     one RenderLink shape (ui/layout/link-slot) widened by two optional
//     fields (see PageTabRenderLink), so the same `(p) => <Link {...p} />` the
//     layout primitives get works here too.
//
// Precedence per tab, mirroring LinkSlot: `to` + renderLink → the caller's
// link · `to` alone → <a href> · neither → a keyboard-operable div firing
// `onSelect`. `onSelect` fires on ALL THREE, as design-ref's PageTabs does —
// on the two linked paths it rides alongside the navigation rather than
// replacing it.
//
// KNOWN DEVIATION (not fixed here): `.pgtab-close` is a <button> inside the
// tab, and on both linked paths the tab is an <a>, so a button nests inside a
// link — invalid HTML. design-ref dodges it only because its tab is a <div>;
// the live open-tabs-bar.tsx has the same nesting. Fixing it means moving the
// × out of the link and hanging `.pgtab`'s padding / hover / active rules off
// a new wrapper — a re-cut of the markup contract with innovic-theme.css
// (:298-353), i.e. a redesign, not an adherence fix. Left for Phase 3.

import type { RenderLinkArgs } from '../layout/link-slot';
import { isPlainLeftClick } from '../is-plain-left-click';

export interface PageTab {
  /** Stable identity — the nav base route in the shell (e.g. "/job-cards"). */
  key: string;
  /** Human label from the nav config (e.g. "JWSO Master"). */
  label: string;
  /** Emoji page icon from the nav config. */
  icon?: string;
  /** Exact last-visited path under this tab — the click target, so clicking a
   *  tab returns you to where you were in that section. */
  to?: string;
}

/** ui/layout/link-slot's RenderLinkArgs plus the two things a page tab has to
 *  carry that a dashboard row does not: the active tab's `aria-current`, and
 *  the `onSelect` click. The kit's own `RenderLink` is assignable to this, so
 *  the canonical `(p) => <Link {...p} />` — which spreads both onto the
 *  anchor — still typechecks; a renderer that destructures only the narrow
 *  fields simply drops them, exactly as it does today. Phase 3 should promote
 *  the two fields into RenderLinkArgs itself (that file belongs to ui/layout). */
export type PageTabRenderLinkArgs = RenderLinkArgs & {
  'aria-current'?: 'page' | undefined;
  onClick?: (() => void) | undefined;
};

export type PageTabRenderLink = (args: PageTabRenderLinkArgs) => React.ReactNode;

export interface PageTabsProps {
  tabs: PageTab[];
  activeKey?: string;
  /** Fired when a tab is chosen — on every path, linked or not. */
  onSelect?: (key: string) => void;
  onClose?: (key: string) => void;
  /** Router link renderer, e.g. `(p) => <Link {...p} />`. Used only for tabs
   *  that carry `to`. */
  renderLink?: PageTabRenderLink;
}

export function PageTabs({
  tabs,
  activeKey,
  onSelect,
  onClose,
  renderLink,
}: PageTabsProps): React.JSX.Element | null {
  // Zero tabs renders nothing at all, so the shell shows no empty band.
  if (tabs.length === 0) return null;

  return (
    /* Class only, no id: the stylesheet matches either (#pagetabs, .pagetabs)
       and nothing in the app keys off the id (grepped), while a hard-coded id
       cannot be rendered twice on one page — which /__ui-kit must do — and
       collides with the still-live components/shared/open-tabs-bar.tsx until
       Phase 3 swaps the shell. */
    <nav className="pagetabs" aria-label="Open pages">
      {tabs.map((t) => {
        const active = t.key === activeKey;
        const current = active ? ('page' as const) : undefined;
        const className = `pgtab${active ? ' active' : ''}`;
        const select = (): void => onSelect?.(t.key);
        const inner = (
          <>
            {t.icon ? (
              <span className="pgtab-icon" aria-hidden>
                {t.icon}
              </span>
            ) : null}
            <span className="pgtab-label">{t.label}</span>
            <button
              type="button"
              className="pgtab-close"
              aria-label={`Close ${t.label}`}
              /* README rules block: icon-only buttons always carry a title. */
              title={`Close ${t.label}`}
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                onClose?.(t.key);
              }}
            >
              ×
            </button>
          </>
        );

        if (t.to && renderLink) {
          return (
            <span key={t.key} style={{ display: 'contents' }}>
              {renderLink({
                to: t.to,
                className,
                title: t.label,
                /* The active tab must announce itself on the path production
                   actually uses, not only on the fallbacks. */
                ...(current ? { 'aria-current': current } : {}),
                /* Rides alongside the router's navigation so `onSelect` is not
                   a dead prop once the shell supplies `to`. */
                onClick: select,
                children: inner,
              })}
            </span>
          );
        }

        if (t.to) {
          return (
            <a
              key={t.key}
              href={t.to}
              className={className}
              title={t.label}
              {...(current ? { 'aria-current': current } : {})}
              /* No preventDefault: here the href IS the navigation, and
                 onSelect only reports which tab was chosen. A modifier click
                 opens the tab elsewhere, so this view's selection is unchanged
                 and must not be reported. */
              onClick={(e): void => {
                if (!isPlainLeftClick(e)) return;
                select();
              }}
            >
              {inner}
            </a>
          );
        }

        return (
          <div
            key={t.key}
            className={className}
            title={t.label}
            role="button"
            {...(current ? { 'aria-current': current } : {})}
            tabIndex={0}
            onClick={select}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                select();
              }
            }}
          >
            {inner}
          </div>
        );
      })}
    </nav>
  );
}
