// <StatStrip> — the one way this app shows the counts above a list.
//
// Every list used to render its counts as N separate `.panel` cards in a
// flex row: each with its own padding, radius, shadow and a 2px coloured ring
// when active. That ate ~120px of height, centred its text against a
// left-aligned page, and the ring read as "this card is selected" rather than
// "this filter is on". Per the `styling` skill (Rule 3) the counts are now ONE
// horizontal strip inside ONE container — left-aligned label over its number,
// separated by a thin `var(--border)` divider, nothing else.
//
// It stays a filter control: each stat is a real <button> (so Enter/Space and
// focus come for free) and the active one is marked by colouring its label plus
// a 2px bottom border in its own colour — never by boxing the cell.
//
// Three cell kinds, decided by which prop is given:
//   `to`      → <Link>   navigates (dashboard KPIs)
//   `onClick` → <button> filters the list below it
//   neither   → <div>    a plain total, not announced as a control

import { Link } from '@tanstack/react-router';

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
  sub?: React.ReactNode;
  /** Omit on a read-only strip; see `onClick`. */
  active?: boolean | undefined;
  /** Omit when the stat is a plain total rather than a filter — the cell then
   *  renders as a <div>, so it is not announced as a control that does nothing. */
  onClick?: (() => void) | undefined;
  /** Navigation target. Renders a real <Link>, so middle-click, ctrl-click and
   *  "open in new tab" all work — an onClick handler that calls navigate()
   *  silently breaks all three. Mutually exclusive with `onClick`. */
  to?: string | undefined;
  title?: string | undefined;
}

export function StatStrip({ items }: { items: StatStripItem[] }): React.JSX.Element {
  return (
    <div
      className="panel"
      style={{ display: 'flex', flexWrap: 'wrap', padding: 0, overflow: 'hidden' }}
    >
      {items.map((s, i) => {
        const isLink = typeof s.to === 'string' && s.to.length > 0;
        const interactive = isLink || typeof s.onClick === 'function';
        const cellStyle: React.CSSProperties = {
          flex: '1 1 140px',
          minWidth: 120,
          textAlign: 'left',
          padding: '8px 16px',
          background: 'transparent',
          border: 'none',
          // The ONLY separator: a hairline between stats, none before the first.
          borderLeft: i === 0 ? 'none' : '1px solid var(--border)',
          // Active filter = coloured underline, not a ring around the cell.
          borderBottom: `2px solid ${s.active ? (s.color ?? 'var(--cyan)') : 'transparent'}`,
          cursor: interactive ? 'pointer' : 'default',
          font: 'inherit',
          ...(isLink ? { textDecoration: 'none', color: 'inherit', display: 'block' } : {}),
        };
        const body = (
          <>
            <div
              style={{
                fontSize: 10,
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
              style={{ fontSize: 22, lineHeight: 1.15, color: s.color ?? 'var(--text)' }}
            >
              {s.count}
            </div>
            {s.sub ? (
              <div className="text3" style={{ fontSize: 11 }}>
                {s.sub}
              </div>
            ) : null}
          </>
        );
        // A link is navigation, so no aria-pressed — that attribute claims the
        // control is a toggle, which would be a lie about where the click goes.
        if (isLink) {
          return (
            <Link
              key={s.key}
              to={s.to!}
              className="dash-link dash-cell"
              title={s.title ?? `Open ${s.label}`}
              style={cellStyle}
            >
              {body}
            </Link>
          );
        }
        return typeof s.onClick === 'function' ? (
          <button
            key={s.key}
            type="button"
            onClick={s.onClick}
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
