// <StatStrip> — the ONE way this app shows counts above a list.
//
// Ported from `components/shared/stat-strip.tsx`; the behaviour below is
// deliberate and must not be simplified (audit 02 §D.7).
//
// Every list used to render its counts as N separate `.panel` cards in a flex
// row, each with its own padding, radius and a 2px coloured ring when active.
// That ate ~120px of height and the ring read as "this card is selected"
// rather than "this filter is on". The counts are now ONE horizontal strip
// inside ONE container — left-aligned label over its number, separated by a
// thin `var(--border)` divider, nothing else.
//
// Three cell kinds, decided by which prop is given:
//   `to`      → a real link  navigates (dashboard KPIs) — keeps middle-click,
//                        ctrl-click and "open in new tab" working, which an
//                        onClick + navigate() silently breaks.
//   `onClick` → <button> filters the list below it (aria-pressed)
//   neither   → <div>    a plain total, not announced as a control
//
// The link is drawn through <LinkSlot>, NOT through the router: ui/ must render
// inside /__ui-kit and in tests with no RouterProvider behind it (see
// ui/layout/link-slot.tsx). A screen that wants a router link passes
// `renderLink={(p) => <Link {...p} />}`; without it the cell is a plain <a>.
// The filter cell keeps its own <button> because it must carry `aria-pressed`,
// which LinkSlot's button does not take.
//
// Active filter = the label in its own colour + a 2px bottom border in that
// colour. NEVER a ring or a box around the cell.
//
// StatCard and KpiTiles below are thin ALIASES of this component, not a second
// and third look: the legacy 2px-top-stripe KPI card and the Plans screen's
// 3px-top tiles are retired.

import { LinkSlot, type RenderLink } from '../layout/link-slot';

export interface StatStripItem {
  /** Stable key — usually the status value, or 'all' for the total. */
  key: string;
  label: string;
  /** String allowed so a strip can show a formatted total (`1,240.50`). */
  count: number | string;
  /** Token only (`var(--amber)` …). Defaults to the body colour. */
  color?: string | undefined;
  /** Caption under the number. ReactNode, not string, so a dashboard KPI can
   *  colour part of it — "3 overdue" in red is the whole point of that line. */
  sub?: React.ReactNode | undefined;
  /** Omit on a read-only strip; see `onClick`. */
  active?: boolean | undefined;
  /** Omit when the stat is a plain total rather than a filter — the cell then
   *  renders as a <div>, so it is not announced as a control that does nothing. */
  onClick?: (() => void) | undefined;
  /** Navigation target. Renders a real <Link>. Mutually exclusive with `onClick`. */
  to?: string | undefined;
  title?: string | undefined;
}

export interface StatStripProps {
  items: StatStripItem[];
  /** How a cell with `to` becomes a router link, e.g. `(p) => <Link {...p} />`.
   *  Omit and the cell is a plain <a href> — this component never imports the
   *  router itself. */
  renderLink?: RenderLink | undefined;
  className?: string | undefined;
  style?: React.CSSProperties | undefined;
}

export function StatStrip({
  items,
  renderLink,
  className,
  style,
}: StatStripProps): React.JSX.Element {
  return (
    <div
      className={['panel', className].filter(Boolean).join(' ')}
      style={{ display: 'flex', flexWrap: 'wrap', padding: 0, overflow: 'hidden', ...style }}
    >
      {items.map((s, i) => {
        const isLink = typeof s.to === 'string' && s.to.length > 0;
        const interactive = isLink || typeof s.onClick === 'function';
        const cellStyle: React.CSSProperties = {
          flex: '1 1 140px',
          minWidth: 120,
          textAlign: 'left',
          padding: 'var(--sp-2) var(--sp-4)',
          background: 'transparent',
          border: 'none',
          // The ONLY separator: a hairline between stats, none before the first.
          borderLeft: i === 0 ? 'none' : '1px solid var(--border)',
          // Active filter = coloured underline, not a ring around the cell.
          borderBottom: `2px solid ${s.active ? (s.color ?? 'var(--cyan)') : 'transparent'}`,
          cursor: interactive ? 'pointer' : 'default',
          font: 'inherit',
          // Every cell, not just the link: a <button> otherwise falls back to
          // the UA button colour for anything its children do not colour
          // (design-ref/components/data/StatStrip.jsx:10).
          color: 'inherit',
          ...(isLink ? { textDecoration: 'none', display: 'block' } : {}),
        };
        const body = (
          <>
            <div
              style={{
                fontSize: 'var(--fs-xs)',
                fontWeight: 700,
                textTransform: 'uppercase',
                letterSpacing: '0.06em',
                color: s.active ? (s.color ?? 'var(--cyan)') : 'var(--text3)',
              }}
            >
              {s.label}
            </div>
            <div
              className="mono fw-700"
              style={{
                fontSize: 'var(--fs-lg)',
                lineHeight: 1.15,
                color: s.color ?? 'var(--text)',
              }}
            >
              {s.count}
            </div>
            {s.sub ? (
              <div className="text3" style={{ fontSize: 'var(--fs-xs)' }}>
                {s.sub}
              </div>
            ) : null}
          </>
        );
        // A link is navigation, so no aria-pressed — that attribute claims the
        // control is a toggle, which would be a lie about where the click goes.
        if (isLink) {
          return (
            <LinkSlot
              key={s.key}
              to={s.to}
              renderLink={renderLink}
              className="dash-link dash-cell"
              title={s.title ?? `Open ${s.label}`}
              style={cellStyle}
            >
              {body}
            </LinkSlot>
          );
        }
        return typeof s.onClick === 'function' ? (
          <button
            key={s.key}
            type="button"
            onClick={s.onClick}
            // The same hover fill as the navigation cell beside it — without
            // these two classes one interactive cell lights up and its
            // neighbour does not (.dash-link.dash-cell:hover, innovic-theme.css).
            className="dash-link dash-cell"
            title={s.title ?? `Show ${s.label} only`}
            aria-pressed={s.active ?? false}
            style={cellStyle}
          >
            {body}
          </button>
        ) : (
          <div key={s.key} title={s.title} style={cellStyle}>
            {body}
          </div>
        );
      })}
    </div>
  );
}

export interface StatCardProps {
  label: string;
  value: number | string;
  sub?: React.ReactNode | undefined;
  /** Token name without the `--`: cyan · amber · green · red. */
  accent?: 'cyan' | 'amber' | 'green' | 'red' | undefined;
}

/** @deprecated A one-cell StatStrip. Group counts in ONE StatStrip instead —
 *  this alias exists only so a screen with a single lonely figure has a shape
 *  to use while it is migrated. */
export function StatCard({ label, value, sub, accent = 'cyan' }: StatCardProps): React.JSX.Element {
  return (
    <StatStrip items={[{ key: label, label, count: value, sub, color: `var(--${accent})` }]} />
  );
}

export interface KpiTile {
  key: string;
  label: string;
  value: number | string;
  color?: string | undefined;
  active?: boolean | undefined;
}

export interface KpiTilesProps {
  items: KpiTile[];
  onSelect?: ((key: string) => void) | undefined;
}

/** @deprecated Renders a StatStrip — use StatStrip directly. The Plans screen's
 *  3px-top tiles were a third count design; they are unified onto StatStrip. */
export function KpiTiles({ items, onSelect }: KpiTilesProps): React.JSX.Element {
  return (
    <StatStrip
      items={items.map((t) => ({
        key: t.key,
        label: t.label,
        count: t.value,
        color: t.color,
        active: t.active,
        onClick: onSelect ? (): void => onSelect(t.key) : undefined,
      }))}
    />
  );
}
