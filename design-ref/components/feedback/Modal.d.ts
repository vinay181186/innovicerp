import * as React from 'react';
/** Page-style modal: navy 45% overlay + 2px blur, bg3 header/footer bands, 8px radius. */
export interface ModalProps {
  open?: boolean;
  title: React.ReactNode;
  onClose?: () => void;
  footer?: React.ReactNode;
  size?: 'sm' | 'md' | 'lg';
  /** Render without the fixed overlay (for previews) */
  inline?: boolean;
  children?: React.ReactNode;
}
export declare function Modal(props: ModalProps): React.JSX.Element | null;
