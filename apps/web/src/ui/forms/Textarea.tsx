// Textarea — multi-line text (remarks, address, notes).
//
// Always sits in a FormField of size "full": two rows minimum, resizes
// vertically only, stops growing at 240px. The theme's .innovic-textarea opts
// out of the shared 28px control height and owns all of that.

import { forwardRef } from 'react';
import { cx } from './class-names';

export type TextareaProps = React.TextareaHTMLAttributes<HTMLTextAreaElement>;

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea(
  { className, rows = 2, ...rest },
  ref,
) {
  return (
    // Two rows is the floor — a one-line textarea reads as a broken input.
    <textarea
      ref={ref}
      rows={Math.max(2, rows)}
      className={cx('innovic-textarea', className)}
      {...rest}
    />
  );
});
