// FormGrid — the 12-column form grid (.form-grid-12).
//
// Every create/edit form lays its fields on this grid and sizes each one with
// FormField's `size` prop, chosen by what the field HOLDS, never by where it
// sits on the row. Each row must sum to 12; fill a short row by upsizing the
// widest field, never by stretching a short one.
//
// The grid folds on its OWN width (container query in the theme), so it
// behaves the same inside a narrow panel as on a full-width page.

import type { CSSProperties, ReactNode } from 'react';
import { cx } from './class-names';

export interface FormGridProps {
  /**
   * @deprecated Legacy equal-column grids (.form-grid / .form-grid-3 /
   * .form-grid-4), kept only for un-migrated markup. Omit it for the canonical
   * 12-column grid.
   */
  cols?: 2 | 3 | 4 | undefined;
  className?: string | undefined;
  style?: CSSProperties | undefined;
  children?: ReactNode | undefined;
}

const LEGACY_CLASS: Record<2 | 3 | 4, string> = {
  2: 'form-grid',
  3: 'form-grid-3',
  4: 'form-grid-4',
};

export function FormGrid({ cols, className, style, children }: FormGridProps): React.JSX.Element {
  return (
    <div className={cx(cols ? LEGACY_CLASS[cols] : 'form-grid-12', className)} style={style}>
      {children}
    </div>
  );
}
