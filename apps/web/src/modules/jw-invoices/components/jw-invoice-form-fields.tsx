// Tiny labelled-field helpers for the New JW Invoice modal. Split out so the
// modal file clears the 400-line rule. Pure presentation, no state.

/** A label (small uppercase caption) above any form control. */
export function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <div>
      <div
        className="text3"
        style={{
          fontSize: 11,
          textTransform: 'uppercase',
          letterSpacing: '0.05em',
          marginBottom: 4,
        }}
      >
        {label}
      </div>
      {children}
    </div>
  );
}

/** A read-only amount tile in the live totals preview. `accent` = green Total. */
export function PreviewCell({
  label,
  value,
  accent,
}: {
  label: string;
  value: string;
  accent?: boolean;
}): React.JSX.Element {
  return (
    <div>
      <div
        className="text3"
        style={{
          fontSize: 11,
          textTransform: 'uppercase',
          letterSpacing: '0.05em',
          marginBottom: 4,
        }}
      >
        {label}
      </div>
      <div
        className="mono fw-700"
        style={{ fontSize: 16, color: accent ? 'var(--green)' : 'var(--text)' }}
      >
        {value}
      </div>
    </div>
  );
}
