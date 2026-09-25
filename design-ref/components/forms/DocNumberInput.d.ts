import * as React from 'react';
/** Document-number field (IN-SO-26-0143…) with live ✓ available / ✕ duplicate / format feedback. */
export interface DocNumberInputProps {
  label?: string;
  /** Renders the ★ required marker used on document numbers */
  required?: boolean;
  value?: string;
  onChange?: (v: string) => void;
  state?: 'idle' | 'checking' | 'ok' | 'bad';
  /** Error text when state = bad */
  message?: string;
  /** Edit mode — code is immutable */
  readOnly?: boolean;
  placeholder?: string;
  /** Width on the 12-col FormGrid. Default 'sm' (doc numbers). */
  size?: 'xs' | 'sm' | 'md' | 'lg' | 'full';
}
export declare function DocNumberInput(props: DocNumberInputProps): React.JSX.Element;
