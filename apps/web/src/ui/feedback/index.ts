// Barrel for apps/web/src/ui/feedback — modals, dialogs, notices and toasts.
// APPEND to this file; never overwrite it (other Phase 2 groups add here too).

export { Banner, type BannerProps, type BannerTone } from './Banner';
export { ConfirmDialog, type ConfirmDialogProps } from './ConfirmDialog';
export {
  FilePreview,
  filePreviewKind,
  type FilePreviewKind,
  type FilePreviewProps,
} from './FilePreview';
export {
  Modal,
  type ModalProps,
  type ModalSize,
  Z_OVERLAY,
  Z_OVERLAY_ABOVE_MODAL,
  Z_TOAST,
} from './Modal';
export {
  Toast,
  type ToastApi,
  type ToastItem,
  type ToastKind,
  type ToastOptions,
  type ToastProps,
  ToastProvider,
  type ToastProviderProps,
  ToastStack,
  type ToastStackProps,
  useToast,
} from './Toast';
