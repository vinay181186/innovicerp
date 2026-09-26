// <QtyStrip> — the bordered figure group on a document card:
// TOTAL QTY · JC QTY · LINES, each a mono number over its label,
// hairline-divided inside one 6px-radius box.
//
// Fourteen files had their own local QtyBox / StatFact / MetricBox helper for
// exactly this; they all become this component.
//
// It is NOT a StatStrip. A StatStrip is the full-width row of counts that sits
// ABOVE a list and filters it; a QtyStrip is a small inline block of figures
// INSIDE a card or header and never filters anything.

export interface QtyItem {
  label: string;
  value: React.ReactNode;
  /** Token only. The qty colour rules: dispatched green, balance red, done
   *  muted — passed in by the caller, never guessed here. */
  color?: string | undefined;
  title?: string | undefined;
}

export interface QtyStripProps {
  items: QtyItem[];
  className?: string | undefined;
  style?: React.CSSProperties | undefined;
}

export function QtyStrip({ items, className, style }: QtyStripProps): React.JSX.Element {
  return (
    <div
      className={className}
      style={{
        display: 'inline-flex',
        border: '1px solid var(--border)',
        borderRadius: 'var(--radius)',
        ...style,
      }}
    >
      {items.map((it, i) => (
        <div
          key={`${it.label}-${i}`}
          title={it.title}
          style={{
            padding: 'var(--sp-1) var(--sp-3)',
            textAlign: 'center',
            // The 64px field step — every cell is at least as wide as a qty
            // field, so a 3-digit number and a 1-digit number line up.
            minWidth: 'var(--field-xs)',
            ...(i === 0 ? {} : { borderLeft: '1px solid var(--border)' }),
          }}
        >
          <div
            className="mono fw-700"
            style={{ fontSize: 'var(--fs-md)', color: it.color ?? 'var(--text)', lineHeight: 1.2 }}
          >
            {it.value === null || it.value === undefined || it.value === '' ? '—' : it.value}
          </div>
          <div
            className="mono text3"
            style={{
              fontSize: 'var(--fs-xs)',
            }}
          >
            {it.label}
          </div>
        </div>
      ))}
    </div>
  );
}

export interface FactProps {
  label: string;
  value: React.ReactNode;
  /** Token only. */
  color?: string | undefined;
  /** Render the value at the 16px step — a headline figure on a card. */
  big?: boolean | undefined;
  title?: string | undefined;
}

/** @deprecated The same shape as layout/ReadField (an 11px mono uppercase
 *  label over a 600-weight value). Use ReadField once it lands; this alias
 *  exists so the fourteen card files have one Fact to move to today. */
export function Fact({ label, value, color, big, title }: FactProps): React.JSX.Element {
  const empty = value === null || value === undefined || value === '';
  return (
    <div className="form-grp" title={title}>
      <span className="form-label">{label}</span>
      <div
        style={{
          fontWeight: 600,
          color: empty ? 'var(--text3)' : color,
          ...(big ? { fontSize: 'var(--fs-md)' } : {}),
        }}
      >
        {empty ? '—' : value}
      </div>
    </div>
  );
}
