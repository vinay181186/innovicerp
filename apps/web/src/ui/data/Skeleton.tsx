// Skeleton — a loading placeholder bar for a surface that wants the SHAPE of
// the content it is waiting for (a card, a header block).
//
// It is NOT the table's loading state: DataTable draws `<PageState as="row"
// state="loading">` like every other surface, so one ⟳ Loading… line is the
// app's single loading look. Use this only where a shimmering bar genuinely
// says more than that line would.

import type { CSSProperties, ReactElement } from 'react';

import './skeleton.css';

export interface SkeletonProps {
  // `?: X | undefined` — the repo runs exactOptionalPropertyTypes.
  /** Any CSS length — default `100%`. Use a token or a %, never a raw px. */
  width?: string | undefined;
  /** Any CSS length — default `var(--sp-3)` (12px, the nearest step on the
   *  spacing scale; a font-size token is not a box dimension). */
  height?: string | undefined;
  /** Corner radius — default `var(--radius-sm)`. */
  radius?: string | undefined;
  /** Render N stacked bars with a --sp-1 gap. Default 1. */
  lines?: number | undefined;
  className?: string | undefined;
}

export function Skeleton({
  width = '100%',
  height = 'var(--sp-3)',
  radius,
  lines = 1,
  className,
}: SkeletonProps): ReactElement {
  const style: CSSProperties = { width, height };
  if (radius !== undefined) style.borderRadius = radius;

  const cls = className ? `skeleton ${className}` : 'skeleton';

  if (lines <= 1) return <span className={cls} style={style} aria-hidden="true" />;

  return (
    <span className="skeleton-lines" aria-hidden="true">
      {Array.from({ length: lines }, (_, i) => (
        <span
          key={i}
          className={cls}
          style={i === lines - 1 ? { ...style, width: '70%' } : style}
        />
      ))}
    </span>
  );
}
