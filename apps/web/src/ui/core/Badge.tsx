// Badge — the mono 11px uppercase chip on a pale wash, 4px radius.
// Composes `.badge` + `.b-{tone}` from innovic-theme.css. No colour is
// declared here; the nine tones are exactly the nine `.b-*` classes.
//
// IMPORTANT: never pick a tone by hand for a DOCUMENT STATUS — use
// <StatusBadge kind=… status=… />, which owns the enum → tone map. Badge is
// for the remaining non-status chips (PR type, op type, SVC/JW markers…).

import type { CSSProperties, ReactNode } from 'react';

export type BadgeTone =
  | 'green'
  | 'amber'
  | 'blue'
  | 'red'
  | 'grey'
  | 'cyan'
  | 'orange'
  | 'teal'
  | 'purple';

export interface BadgeProps {
  /** Defaults to grey — the neutral chip. */
  tone?: BadgeTone;
  children?: ReactNode;
  /** Hover tooltip, for a chip whose text is abbreviated. */
  title?: string;
  className?: string;
  style?: CSSProperties;
}

export function Badge({ tone = 'grey', children, title, className, style }: BadgeProps) {
  const cls = ['badge', `b-${tone}`, className].filter(Boolean).join(' ');
  return (
    <span className={cls} title={title} style={style}>
      {children}
    </span>
  );
}
