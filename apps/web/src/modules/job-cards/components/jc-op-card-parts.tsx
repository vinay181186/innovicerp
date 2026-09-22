// Shared visual pieces of the Operations Detail op card, used by BOTH the
// read-only card (jc-op-card.tsx) and the editable card (jc-op-edit-card.tsx)
// so the two screens cannot drift apart visually.
//
// Presentation only — these components hold no JC logic and compute nothing.

/** Small uppercase section caption inside a card ("QUANTITIES", "SETUP", …). */
export const secLabel: React.CSSProperties = {
  fontSize: 9,
  color: 'var(--text3)',
  textTransform: 'uppercase',
  letterSpacing: '.08em',
  fontWeight: 700,
  marginBottom: 5,
};

/** One QUANTITIES tile: big number over a small uppercase caption. `sub` holds
 *  the caller's extra lines (QC accepted / rejected / pending) unchanged. */
export function QtyTile({
  label,
  value,
  color,
  highlight = false,
  sub,
}: {
  label: string;
  value: React.ReactNode;
  color: string;
  highlight?: boolean;
  sub?: React.ReactNode;
}): React.JSX.Element {
  return (
    <div
      style={{
        minWidth: 48,
        padding: '5px 8px',
        textAlign: 'center',
        borderRadius: 6,
        border: `1px solid ${highlight ? 'var(--amber)' : 'var(--border)'}`,
        background: highlight ? 'var(--amber3)' : 'var(--bg3)',
      }}
    >
      <div className="mono fw-700" style={{ fontSize: 14, color, lineHeight: 1.2 }}>
        {value}
      </div>
      <div style={{ fontSize: 8, letterSpacing: '.06em', color: 'var(--text3)', fontWeight: 700 }}>
        {label}
      </div>
      {sub ?? null}
    </div>
  );
}

/** Labelled wrapper for an editable SETUP field (edit card). */
export function SetupField({
  label,
  width,
  children,
}: {
  label: string;
  width: number;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <div style={{ width }}>
      <div style={{ fontSize: 9, color: 'var(--text3)', marginBottom: 2 }}>{label}</div>
      {children}
    </div>
  );
}

/** One quantity CHIP on the VIEW card's expanded body (JC-Detail-Restyle-
 *  Mockup.html, 2026-09-21): mono number over a tiny uppercase caption, in a
 *  bordered box that fills its grid cell. `highlight` tints it amber (pieces
 *  waiting); `sub` holds the caller's extra lines unchanged. The EDIT card
 *  keeps QtyTile above. */
export function QtyChip({
  label,
  value,
  color,
  highlight = false,
  sub,
  title,
}: {
  label: string;
  value: React.ReactNode;
  color: string;
  highlight?: boolean;
  sub?: React.ReactNode;
  title?: string | undefined;
}): React.JSX.Element {
  return (
    <div
      title={title}
      style={{
        minWidth: 0,
        padding: 7,
        textAlign: 'center',
        borderRadius: 8,
        border: `1px solid ${highlight ? 'var(--amber)' : 'var(--border)'}`,
        background: highlight ? 'var(--amber3)' : 'var(--bg2)',
      }}
    >
      <div className="mono" style={{ fontSize: 16, fontWeight: 800, color, lineHeight: 1.2 }}>
        {value}
      </div>
      <div
        style={{
          fontSize: 9.5,
          letterSpacing: '.04em',
          textTransform: 'uppercase',
          color: 'var(--text3)',
          marginTop: 2,
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
        }}
        title={label}
      >
        {label}
      </div>
      {sub ?? null}
    </div>
  );
}
