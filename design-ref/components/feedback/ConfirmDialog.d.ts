import * as React from 'react';
/** 420px alert dialog — the exit guard every create/edit form raises on ESC / back / outside click. Cancel is focused. */
export interface ConfirmDialogProps {
  title?: string;
  message?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  onConfirm?: () => void;
  onCancel?: () => void;
  tone?: 'danger' | 'primary';
  /** Render without overlay (previews) */
  inline?: boolean;
}
export declare function ConfirmDialog(props: ConfirmDialogProps): React.JSX.Element;
