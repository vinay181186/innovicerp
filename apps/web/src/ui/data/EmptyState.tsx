// EmptyState — the ONE empty / all-clear / error placeholder.
//
// Replaces the 539 ad-hoc `<div className="empty-state">` usages spread across
// 204 files. It owns nothing but the `.empty-state` class from
// innovic-theme.css plus a tone colour; every caller passes plain copy.
//
// Copy style (design-ref README, "Empty/state copy"): direct and instructive —
// "No orders — click + New SO/WO", "✅ All clear — nothing needs attention."

import type { CSSProperties, ReactElement, ReactNode } from 'react';

export type EmptyStateTone = 'muted' | 'ok' | 'error';

export interface EmptyStateProps {
  // `?: X | undefined` everywhere — the repo runs exactOptionalPropertyTypes,
  // so a plain `?: X` rejects a caller that passes an explicit undefined.
  /** Optional glyph above the message (`.empty-icon`, 28px). */
  icon?: ReactNode | undefined;
  /** muted (default) = --text3 · ok = --sig-ok · error = --red. */
  tone?: EmptyStateTone | undefined;
  /**
   * Tighter padding (--sp-3 instead of the standard --sp-6) for a quiet empty
   * line inside a nested panel or an expanded band.
   *
   * NOT for a table's empty row: that is `<PageState as="row" colSpan={n}>`,
   * which puts `.empty-state` on the <td> itself with the reference's --sp-5
   * (24px) — design-ref/components/data/DataTable.jsx renders the empty td with
   * `padding: 24`. DataTable does exactly that and never uses this prop.
   */
  inline?: boolean | undefined;
  className?: string | undefined;
  children?: ReactNode | undefined;
}

const TONE_COLOR: Record<EmptyStateTone, string | undefined> = {
  muted: undefined,
  ok: 'var(--sig-ok)',
  error: 'var(--red)',
};

export function EmptyState({
  icon,
  tone = 'muted',
  inline = false,
  className,
  children,
}: EmptyStateProps): ReactElement {
  const color = TONE_COLOR[tone];
  const style: CSSProperties = {};
  if (color !== undefined) {
    style.color = color;
    style.fontWeight = 700;
  }
  if (inline) style.padding = 'var(--sp-3)';

  const cls = className ? `empty-state ${className}` : 'empty-state';
  const hasStyle = Object.keys(style).length > 0;

  return (
    <div className={cls} style={hasStyle ? style : undefined}>
      {icon !== undefined && icon !== null ? <div className="empty-icon">{icon}</div> : null}
      {children}
    </div>
  );
}
