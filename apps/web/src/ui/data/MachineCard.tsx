// <MachineCard> — the shop-floor machine tile: code, name, 🟢 Running / ⚪ Idle
// and, when it is running, the job card, the part (CODE/REV) and the operation.
//
// Lay a grid of them out with
//   `grid-template-columns: repeat(auto-fill, minmax(140px, 1fr))`.
//
// Five places drew their own version of this tile (Op Entry's card, its form
// and its modal, Machine Loading — whose `.mach-card` carried a code comment
// saying it was never ported to the theme — and the Daily Report). This is the
// one of them, on tokens.
//
// Why the part shows as a CODE and not a name: at a 140px track a free-text
// part name is an ellipsis with two letters in front of it, which looks like
// information and is not. `CODE/REV` is short and fixed-shape, so it fits; the
// full name and the customer's PO line ride in the tooltip (`itemTitle`) for
// the one tile you are actually asking about.
//
// `extra` is the slot for the ⚙N machine-split chip — the marker that says the
// completed qty was not all made on the machine named here. It renders under
// the operation line so the tile's shape is unchanged when there is no split.
//
// Two element kinds, decided by `onSelect` (the same rule as StatStrip, audit
// D.7): with it the tile is a <button aria-pressed>, a real toggle; without it
// — the read-only tiles on the Daily Report and Machine Loading — it is a
// <div>, because a screen reader must not announce a picker that does nothing.

export interface MachineCardProps {
  /** Machine code — the identifier, mono and bold. */
  code: string;
  /** Machine name / model, the quiet second line. */
  name?: string | null | undefined;
  running?: boolean | undefined;
  /** Job card code on the machine right now. */
  jobCard?: React.ReactNode | undefined;
  /** `CODE/REV` of the part on the machine — already formatted by the caller. */
  itemCode?: string | null | undefined;
  /** Tooltip for the part line: name, and the customer's PO line if there is one. */
  itemTitle?: string | undefined;
  /** e.g. "Op10: CNC Turning". */
  operation?: React.ReactNode | undefined;
  selected?: boolean | undefined;
  onSelect?: (() => void) | undefined;
  /** Slot under the running lines — the ⚙N split chip, a badge, a progress bar. */
  extra?: React.ReactNode | undefined;
  title?: string | undefined;
  className?: string | undefined;
  style?: React.CSSProperties | undefined;
}

export function MachineCard({
  code,
  name,
  running = false,
  jobCard,
  itemCode,
  itemTitle,
  operation,
  selected = false,
  onSelect,
  extra,
  title,
  className,
  style,
}: MachineCardProps): React.JSX.Element {
  const tileStyle: React.CSSProperties = {
    display: 'block',
    width: '100%',
    // No minWidth: the tile's width is the grid track's
    // (`repeat(auto-fill, minmax(140px, 1fr))`). A 144px floor here — the
    // --field-md step — overflowed a track that had resolved to its own 140px
    // minimum by 4px.
    border: `2px solid ${selected ? 'var(--cyan)' : 'var(--border)'}`,
    borderRadius: 'var(--radius2)',
    background: selected ? 'var(--cyan3)' : 'var(--bg3)',
    padding: 'var(--sp-3)',
    textAlign: 'left',
    transition: 'all var(--ease-fast, 0.15s)',
    font: 'inherit',
    color: 'inherit',
    ...style,
  };

  const body = (
    <>
      <div className="mono cyan" style={{ fontWeight: 800, fontSize: 'var(--fs-sm)' }}>
        {code}
      </div>
      {name ? (
        <div
          className="text3"
          style={{
            fontSize: 'var(--fs-xs)',
            marginBottom: 'var(--sp-1)',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
          title={name}
        >
          {name}
        </div>
      ) : null}
      <div
        style={{
          fontSize: 'var(--fs-xs)',
          fontWeight: 700,
          color: running ? 'var(--green)' : 'var(--text3)',
        }}
      >
        {running ? '🟢 Running' : '⚪ Idle'}
      </div>
      {running ? (
        <>
          {jobCard ? (
            <div
              className="mono text2"
              style={{ fontSize: 'var(--fs-xs)', marginTop: 'var(--sp-1)' }}
            >
              {jobCard}
            </div>
          ) : null}
          {itemCode ? (
            <div
              className="mono"
              style={{
                fontSize: 'var(--fs-xs)',
                color: 'var(--purple)',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
              title={itemTitle ?? itemCode}
            >
              {itemCode}
            </div>
          ) : null}
          {operation ? (
            <div
              className="text3"
              style={{ fontSize: 'var(--fs-xs)', overflow: 'hidden', textOverflow: 'ellipsis' }}
            >
              {operation}
            </div>
          ) : null}
        </>
      ) : null}
      {extra ? <div style={{ marginTop: 'var(--sp-1)' }}>{extra}</div> : null}
    </>
  );

  if (onSelect) {
    return (
      <button
        type="button"
        onClick={onSelect}
        aria-pressed={selected}
        title={title}
        className={className}
        style={{ ...tileStyle, cursor: 'pointer' }}
      >
        {body}
      </button>
    );
  }

  return (
    <div title={title} className={className} style={tileStyle}>
      {body}
    </div>
  );
}
