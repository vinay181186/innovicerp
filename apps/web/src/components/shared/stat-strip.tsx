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
  count: number;
  /** Token only (`var(--amber)` …). Defaults to the body colour. */
  color?: string | undefined;
  active: boolean;
  onClick: () => void;
  title?: string | undefined;
}

export function StatStrip({ items }: { items: StatStripItem[] }): React.JSX.Element {
  return (
    <div
      className="panel"
      style={{ display: 'flex', flexWrap: 'wrap', padding: 0, overflow: 'hidden' }}
    >
      {items.map((s, i) => (
        <button
          key={s.key}
          type="button"
          onClick={s.onClick}
          title={s.title ?? `Show ${s.label} only`}
          aria-pressed={s.active}
          style={{
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
            cursor: 'pointer',
            font: 'inherit',
          }}
        >
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
        </button>
      ))}
    </div>
  );
}
