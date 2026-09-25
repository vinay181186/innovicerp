// SyncDot — the 7px connection-status dot in the header band.
// Composes `.sync-dot` (+ `.offline` / `.error`) from innovic-theme.css:
// green synced · amber glowing offline · red save-failed.
//
// Today this is a bare `<span className="sync-dot" />` in
// components/shared/top-nav.tsx with no state and no caption.

import type { CSSProperties, ReactNode } from 'react';

export type SyncState = 'ok' | 'offline' | 'error';

const STATE_CLASS: Record<SyncState, string> = {
  ok: '',
  offline: 'offline',
  error: 'error',
};

/**
 * Read out to assistive tech ONLY when no visible caption is given. With a
 * caption the caption IS the name — an aria-label on top of it would override
 * what the user can see (visible-label / accessible-name mismatch).
 */
const STATE_TEXT: Record<SyncState, string> = {
  ok: 'Synced',
  offline: 'Offline',
  error: 'Save failed',
};

export interface SyncDotProps {
  state?: SyncState;
  /** Optional mono caption beside the dot, e.g. "SYNCED". */
  label?: ReactNode;
  className?: string;
  style?: CSSProperties;
}

const WRAP_STYLE: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 'var(--sp-1)',
  fontSize: 'var(--fs-xs)',
  color: 'var(--text3)',
  fontFamily: 'var(--mono)',
};

export function SyncDot({ state = 'ok', label, className, style }: SyncDotProps) {
  const dotCls = ['sync-dot', STATE_CLASS[state]].filter(Boolean).join(' ');
  // NOT role="status". design-ref/components/core/SyncDot.jsx sets no ARIA at
  // all, and role="status" is a live region: the header dot would re-announce
  // itself on every mount and every route change. This is a state indicator,
  // not an announcement. The dot only needs a name of its own when it has no
  // visible caption beside it.
  const bare = label === undefined || label === null || label === '';
  return (
    <span
      className={className}
      style={{ ...WRAP_STYLE, ...style }}
      role={bare ? 'img' : undefined}
      aria-label={bare ? STATE_TEXT[state] : undefined}
    >
      <span className={dotCls} />
      {label}
    </span>
  );
}
