import * as React from 'react';
/** File inputs: attach (📎 chip — QC reports), drawing (native file input + 📎 preview button), image (96px preview box + Choose/Remove). */
export interface FileFieldProps {
  variant?: 'attach' | 'drawing' | 'image';
  label?: string;
  /** Currently attached file name */
  fileName?: string | null;
  busy?: boolean;
  error?: string;
  help?: string;
  accept?: string;
  onPick?: (file: File) => void;
  onRemove?: () => void;
  onView?: () => void;
}
export declare function FileField(props: FileFieldProps): React.JSX.Element;
