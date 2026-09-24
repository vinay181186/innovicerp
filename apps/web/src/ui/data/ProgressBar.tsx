// <ProgressBar> — the thin completion bar (JC progress, machine utilisation,
// QC coverage). Sixteen screens hand-rolled an outer/inner div pair; this is
// the one of them.
//
// All of the look lives in `.prog-wrap` / `.prog-bar` (6px track on --bg5,
// 4px radius, 0.4s ease on width) — the only thing passed in is how full it is
// and which token colours the fill.

export interface ProgressBarProps {
  /** 0–100. Anything outside is clamped, so a rounding error can never paint
   *  a bar past the end of its track or into negative width. */
  value: number;
  /** Fill colour, token only — `var(--green)`, `var(--amber)`, … */
  color?: string | undefined;
  /** Track height in px. Omit to keep the theme's 6px.
   *  A raw px prop is normally banned, but this one is the reference's own API
   *  (design-ref/components/data/ProgressBar.d.ts:8 `height?: number`,
   *  ProgressBar.jsx:2 defaults it to 6) — the bar's track is geometry, and a
   *  10px utilisation bar beside a 6px one is a documented size, not a spacing
   *  decision. Omitted by default, so `.prog-wrap`'s 6px still rules. */
  height?: number | undefined;
  /** What the bar is measuring, for screen readers and the hover tooltip. */
  label?: string | undefined;
  className?: string | undefined;
  style?: React.CSSProperties | undefined;
}

export function ProgressBar({
  value,
  color = 'var(--blue)',
  height,
  label,
  className,
  style,
}: ProgressBarProps): React.JSX.Element {
  const pct = Math.max(0, Math.min(100, Number.isFinite(value) ? value : 0));
  return (
    <div
      className={['prog-wrap', className].filter(Boolean).join(' ')}
      role="progressbar"
      aria-valuenow={Math.round(pct)}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={label}
      title={label ? `${label} — ${Math.round(pct)}%` : `${Math.round(pct)}%`}
      style={{ ...(height === undefined ? {} : { height }), ...style }}
    >
      <div className="prog-bar" style={{ width: `${pct}%`, background: color }} />
    </div>
  );
}
