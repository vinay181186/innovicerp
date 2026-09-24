// <Panel> — the surface every screen section sits on, and the single most
// reused shape in the app (180 hand-written `.panel` blocks today).
//
//   .panel
//     .panel-hdr    → .panel-title (Barlow Condensed 16px) + optional actions
//     .panel-body   → 12px padding, or flush for a full-bleed table
//
// It owns no colour, radius or border of its own: every rule comes from the
// `.panel*` classes in innovic-theme.css, so a panel can never drift from the
// theme by being rebuilt inline on one screen.
//
// Two deliberate options:
//   `bodyPadding="none"`  a table fills the panel edge to edge — a ruled sheet
//                         inside 12px of padding reads as a box in a box.
//   `accent`              the 4px left bar the SO / document cards use
//                         (blue open · red late · green done). Token only.
//
// MIGRATION NOTE: `bodyPadding` is `'default' | 'none'` here, not the
// reference's `number | string` (design-ref/components/data/Panel.d.ts). A raw
// px prop is exactly what the house rules ban, so the two named choices stay —
// but a copy-paste from Panel.prompt.md (`bodyPadding={0}`) will not compile.
// Rewrite it as `bodyPadding="none"`.

export interface PanelProps {
  /** Worn by an h2.panel-title — panel titles ARE a page’s headings. */
  title?: React.ReactNode | undefined;
  /** Right of the header — small buttons, a badge, a count. */
  actions?: React.ReactNode | undefined;
  /** 'default' = .panel-body (12px). 'none' = flush, for a full-bleed table. */
  bodyPadding?: 'default' | 'none' | undefined;
  /** 4px left accent bar. A token only — `var(--blue)`, `var(--red2)`, … */
  accent?: string | undefined;
  /** Extra class on the body wrapper (e.g. `tbl-wrap` for a scrolling table). */
  bodyClassName?: string | undefined;
  className?: string | undefined;
  style?: React.CSSProperties | undefined;
  bodyStyle?: React.CSSProperties | undefined;
  id?: string | undefined;
  children?: React.ReactNode | undefined;
}

export function Panel({
  title,
  actions,
  bodyPadding = 'default',
  accent,
  bodyClassName,
  className,
  style,
  bodyStyle,
  id,
  children,
}: PanelProps): React.JSX.Element {
  const hasHeader = title !== undefined && title !== null && title !== false;
  const hasActions = actions !== undefined && actions !== null && actions !== false;
  return (
    <section
      id={id}
      className={['panel', className].filter(Boolean).join(' ')}
      style={{
        // `var(--sp-1)` is the 4px step — the bar is a token, not a magic number.
        ...(accent ? { borderLeft: `var(--sp-1) solid ${accent}` } : {}),
        ...style,
      }}
    >
      {hasHeader || hasActions ? (
        <div className="panel-hdr">
          {/* A header with actions but no title still needs the left slot, or
              justify-content:space-between pushes the buttons to the left —
              but it takes an empty <div>, never an empty <h2>. `.panel-title`
              is a real heading so screen readers can navigate the page by its
              outline; a blank heading pollutes that outline. */}
          {hasHeader ? <h2 className="panel-title">{title}</h2> : <div />}
          {hasActions ? (
            <div style={{ display: 'flex', gap: 'var(--sp-1)', alignItems: 'center' }}>
              {actions}
            </div>
          ) : null}
        </div>
      ) : null}
      <div
        className={[bodyPadding === 'none' ? null : 'panel-body', bodyClassName]
          .filter(Boolean)
          .join(' ')}
        style={bodyStyle}
      >
        {children}
      </div>
    </section>
  );
}
