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

export interface StatStripItem {
  /** Stable key — usually the status value, or 'all' for the total. */
  key: string;
  label: string;
  /** String allowed so a strip can show a formatted total (`1,240.50`). */
  count: number | string;
  /** Token only (`var(--amber)` …). Defaults to the body colour. */
  color?: string | undefined;
  /** Small caption under the number, e.g. "pieces". */
  sub?: string | undefined;
  /** Omit on a read-only strip; see `onClick`. */
  active?: boolean | undefined;
  /** Omit when the stat is a plain total rather than a filter — the cell then
   *  renders as a <div>, so it is not announced as a control that does nothing. */
  onClick?: (() => void) | undefined;
  title?: string | undefined;
}

export function StatStrip({ items }: { items: StatStripItem[] }): React.JSX.Element {
  return (
    <div
      className="panel"
      style={{ display: 'flex', flexWrap: 'wrap', padding: 0, overflow: 'hidden' }}
    >
      {items.map((s, i) => {
        const interactive = typeof s.onClick === 'function';
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
              <div className="text3" style={{ fontSize: 11 }}>{s.sub}</div>
            ) : null}
          </>
        );
        return interactive ? (
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
