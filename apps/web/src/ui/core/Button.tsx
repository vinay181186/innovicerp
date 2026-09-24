// Button — the ONE action control (design-ref/components/core/Button.jsx).
//
// Composes the theme's own class vocabulary: `.btn` + `.btn-{variant}` (+
// `.btn-sm`, `.btn-icon`). All sizing comes from innovic-theme.css —
// height `--control-h` 28px, sm `--control-h-sm` 24px, 13px/600 Barlow,
// 6px radius — so this component adds NO sizing of its own.
//
// One primary button per toolbar, top-right (design-ref README, "Uniformity").

import type { ButtonHTMLAttributes, CSSProperties, ReactNode } from 'react';
import './core.css';
import { Icon } from './Icon';

export type ButtonVariant = 'primary' | 'success' | 'danger' | 'ghost';
export type ButtonSize = 'md' | 'sm';

/**
 * Everything a Button takes EXCEPT `iconOnly` / `title`. Those two are paired
 * up by the union below, and IconButton builds on this base rather than on the
 * union (Omit does not distribute usefully over one).
 */
export interface ButtonBaseProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'title'> {
  /** primary = Innovic blue · success/danger sit on the dark "2" tone · ghost = white outlined. */
  variant?: ButtonVariant;
  /** md = 13px/28px (default) · sm = 11px/24px. */
  size?: ButtonSize;
  /** Leading node — an <Icon>, never an emoji (emoji are for page identity only). */
  icon?: ReactNode;
  /** Pill-shaped status-filter chip — the ONLY place a 999px radius is allowed. */
  pill?: boolean;
  /** Shows a spinner in the icon slot and blocks the click. */
  loading?: boolean;
  children?: ReactNode;
}

/**
 * `iconOnly` FORCES `title`. design-ref/README.md "Iconography" ends with the
 * rule verbatim — "Icon-only buttons always carry a `title`" — and a square
 * button with no label and no tooltip is unusable by mouse and by screen
 * reader alike. IconButton was not enough on its own: nothing stopped a
 * Phase-4 migrator reaching for `<Button iconOnly>` across the 229 `.btn`
 * call sites, so the type now refuses it.
 */
export type ButtonProps =
  | (ButtonBaseProps & { iconOnly?: false | undefined; title?: string })
  | (ButtonBaseProps & { iconOnly: true; title: string });

/**
 * Status-filter chips are the one pill in the system (design-ref README,
 * "Corners"). design-ref/components/core/Button.jsx:4 overrides the radius,
 * the padding and the font size and NOTHING ELSE, so `.btn`'s
 * `height: var(--control-h)` (28px) survives and a chip lines up with the
 * SearchInput and the ghost buttons beside it in a list toolbar — the exact
 * row design-ref/components/core/core.card.html:14 renders, and what
 * design-ref/components/layout/StatusPills.jsx:6 does too.
 *
 * 999px is the reference's own literal. There is no `--radius-pill` in
 * apps/web/src/styles/tokens.css or in any design-ref/tokens/*.css, and a
 * `var(--radius-pill, 999px)` fallback only dressed the literal up as a token
 * that does not exist. If Foundation wants the token, it gets added there
 * first and this line follows.
 */
const PILL_STYLE: CSSProperties = {
  borderRadius: 999,
  padding: 'var(--sp-1) var(--sp-3)',
  fontSize: 'var(--fs-xs)',
};

export function Button(props: ButtonProps) {
  // The union is a constraint on the CALLER; inside, the two branches are one
  // shape, so widen once rather than narrowing at every read.
  const {
    variant = 'primary',
    size = 'md',
    icon,
    iconOnly = false,
    pill = false,
    loading = false,
    disabled = false,
    type = 'button',
    className,
    style,
    children,
    ...rest
  } = props as ButtonBaseProps & { iconOnly?: boolean; title?: string };

  const cls = [
    'btn',
    `btn-${variant}`,
    size === 'sm' ? 'btn-sm' : '',
    iconOnly ? 'btn-icon' : '',
    className,
  ]
    .filter(Boolean)
    .join(' ');

  // `.spin` is ui/core's own rule (core.css). ui/ must not use a Tailwind
  // utility: Tailwind is being stripped from this app, and a primitive that
  // stops spinning when it goes is a primitive coupled to the wrong thing.
  const leading = loading ? (
    <Icon name="loader-2" size={size === 'sm' ? 12 : 13} className="spin" />
  ) : (
    icon
  );

  return (
    <button
      type={type}
      className={cls}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      style={pill ? { ...PILL_STYLE, ...style } : style}
      {...rest}
    >
      {leading}
      {children}
    </button>
  );
}
