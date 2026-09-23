import * as React from 'react';
/**
 * Innovic button — 13px/600 Barlow, 6px radius, ~32px tall (matches inputs).
 * @startingPoint section="Core" subtitle="Primary / success / danger / ghost buttons" viewport="700x220"
 */
export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  /** primary = Innovic blue; success/danger sit on the dark "2" tone; ghost = white outlined */
  variant?: 'primary' | 'success' | 'danger' | 'ghost';
  size?: 'md' | 'sm';
  /** Leading icon node (lucide icon or glyph) */
  icon?: React.ReactNode;
  iconOnly?: boolean;
  /** Pill-shaped status-filter chip (used for status filters above lists) */
  pill?: boolean;
  disabled?: boolean;
  children?: React.ReactNode;
}
export declare function Button(props: ButtonProps): React.JSX.Element;
