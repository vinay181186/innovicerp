// The Store screens' pop-up: the shared Modal (ui/feedback) at the width these
// boxes have always been, shared by ± Adjust, Reorder, Manual Receipt and the
// reservation drill-down.

import { Modal } from '@/ui/feedback';

export function ModalShell({
  onClose,
  title,
  footer,
  confirmExit = true,
  children,
}: {
  onClose: () => void;
  title: string;
  footer?: React.ReactNode;
  /** Off for a read-only box, or once the form's work is already sent. */
  confirmExit?: boolean;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <Modal
      title={title}
      onClose={onClose}
      footer={footer}
      maxWidth="min(1100px, 96vw)"
      confirmExit={confirmExit}
    >
      {children}
    </Modal>
  );
}
