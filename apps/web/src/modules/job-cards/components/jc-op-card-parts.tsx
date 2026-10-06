// Shared visual pieces of the Operations Detail op card (jc-op-card.tsx). The
// editable op card that also used them has been replaced by the Edit page's
// operations table (jc-edit-op-row.tsx).
//
// Presentation only — these components hold no JC logic and compute nothing.

/** One quantity CHIP (JC-Detail-Restyle-Mockup.html, 2026-09-21): mono number
 *  over a small caption, in a bordered box that fills its grid cell.
 *  `highlight` tints it amber (pieces waiting); `sub` holds the caller's extra
 *  lines unchanged. Used by the read-only VIEW op card (jc-op-card.tsx). */
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
          fontSize: 11,
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
