// Tag — the ONE square mono chip: linked document refs (link), UOM (neutral),
// revisions (rev). Smaller and squarer than Badge, which is the status chip.
// Composes `.tag` from innovic-theme.css; only the two colours are set here,
// and both come from tokens.
//
// Replaces the ~9 hand-rolled `.tag` spans and `.task-linked-ref`.

import type { CSSProperties, ReactNode } from 'react';

export type TagTone = 'link' | 'neutral' | 'rev';

interface TagColours {
  color: string;
  background: string;
}

const TONES: Record<TagTone, TagColours> = {
  /** A reference to another document — SO no., JC no., PO no. */
  link: { color: 'var(--blue)', background: 'var(--blue3)' },
  /** UOM and other plain inline facts. */
  neutral: { color: 'var(--text2)', background: 'var(--bg4)' },
  /** Item / drawing revision — purple is the revision colour system-wide. */
  rev: { color: 'var(--purple2)', background: 'var(--purple3)' },
};

export interface TagProps {
  tone?: TagTone;
  /** Override the text colour. Must be a token (`var(--purple2)`), never a hex. */
  color?: string;
  /** Override the background. Must be a token (`var(--purple3)`), never a hex. */
  bg?: string;
  /** Makes the tag activate on click, Enter and Space. */
  onClick?: () => void;
  title?: string;
  className?: string;
  style?: CSSProperties;
  children?: ReactNode;
}

export function Tag({
  tone = 'link',
  color,
  bg,
  onClick,
  title,
  className,
  style,
  children,
}: TagProps) {
  const base = TONES[tone];
  const merged: CSSProperties = {
    color: color ?? base.color,
    background: bg ?? base.background,
    ...(onClick ? { cursor: 'pointer' } : null),
    ...style,
  };
  const cls = ['tag', className].filter(Boolean).join(' ');

  if (!onClick) {
    return (
      <span className={cls} title={title} style={merged}>
        {children}
      </span>
    );
  }

  // A clickable tag is a real control: it takes focus and answers the keyboard,
  // so a linked-document chip is not mouse-only.
  return (
    <span
      className={cls}
      title={title}
      style={merged}
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onClick();
        }
      }}
    >
      {children}
    </span>
  );
}
