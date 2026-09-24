// IconButton — `.btn.btn-icon`, the row-action / toolbar button with no label.
//
// `title` is REQUIRED, not optional. design-ref/README.md "Iconography" ends
// with the rule verbatim: "Icon-only buttons always carry a `title`."
//
// Button's own `iconOnly: true` branch now demands a title too, so the rule
// holds even when someone reaches past this component. IconButton stays
// because it also fixes the defaults a row action always wants (ghost, icon
// required, aria-label mirrored from the title) in one place.

import type { ReactNode } from 'react';
import { Button, type ButtonBaseProps } from './Button';

export interface IconButtonProps extends Omit<ButtonBaseProps, 'children' | 'icon'> {
  /** The <Icon> to render. Required — an IconButton with no icon is just a Button. */
  icon: ReactNode;
  /** REQUIRED. Hover tooltip AND the accessible name. "View", "Edit", "Delete", "Print"… */
  title: string;
}

export function IconButton({
  icon,
  title,
  variant = 'ghost',
  'aria-label': ariaLabel,
  ...rest
}: IconButtonProps) {
  return (
    <Button
      {...rest}
      variant={variant}
      iconOnly
      icon={icon}
      title={title}
      aria-label={ariaLabel ?? title}
    />
  );
}
