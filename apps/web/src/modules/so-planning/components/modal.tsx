// so-planning's name for the ONE shared pop-up (ui/feedback/Modal). The closing
// rule, Esc, focus and scroll lock all live there. Its "sm" here has always meant
// the standard `.modal` width, so it maps to the shared "md".

import type { PropsWithChildren, ReactNode } from 'react';
import { Modal as SharedModal } from '@/ui/feedback';

interface ModalProps {
  title: string;
  size?: 'sm' | 'lg';
  onClose: () => void;
  footer?: ReactNode;
  /** Opened from another pop-up. */
  elevated?: boolean;
  /** Off once the form's work is already sent (held for approval). */
  confirmExit?: boolean;
}

export function Modal({
  title,
  size = 'sm',
  onClose,
  footer,
  elevated = false,
  confirmExit = true,
  children,
}: PropsWithChildren<ModalProps>): JSX.Element {
  return (
    <SharedModal
      title={title}
      size={size === 'lg' ? 'lg' : 'md'}
      onClose={onClose}
      footer={footer}
      elevated={elevated}
      confirmExit={confirmExit}
    >
      {children}
    </SharedModal>
  );
}
