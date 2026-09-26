// ui/layout — the page-level compositions every screen is built from.
//
//   LIST   = ListHeader → (StatStrip | StatusPills) → DataTable | DocCard list → ListFooter
//   DETAIL = DetailHeader (+ ReadGrid / ReadField) → Panels → RelatedDocs (+ Timeline)
//   FORM   = PageHeader (Save / Cancel) → Panel(FormGrid) → Panel(line table) → ConfirmDialog
//   HOME   = WorkList · AttentionList · StatRow · QuickLinks
//
// Other groups append their own exports below; never overwrite this file.

export { PageHeader } from './PageHeader';
export type { PageHeaderProps } from './PageHeader';

export { ListHeader } from './ListHeader';
export type { ListHeaderProps } from './ListHeader';

export { ListFooter } from './ListFooter';
export type { ListFooterProps } from './ListFooter';

export { RowActions } from './RowActions';
export type { RowActionsProps, RowDeleteConfirm } from './RowActions';

export { DetailHeader, ReadGrid, ReadField } from './DetailHeader';
export type {
  DetailHeaderProps,
  ReadGridProps,
  ReadFieldProps,
  ReadFieldSize,
} from './DetailHeader';

export { DocCard, LinesPanel } from './DocCard';
export type { DocCardProps, LinesPanelProps } from './DocCard';

export { WorkList, AttentionList, StatRow, QuickLinks } from './WorkList';
export type {
  WorkItem,
  WorkListProps,
  AttentionItem,
  AttentionListProps,
  StatRowProps,
  QuickLink,
  QuickLinksProps,
  Severity,
} from './WorkList';

export { LinkSlot } from './link-slot';
export type { LinkSlotProps, RenderLink, RenderLinkArgs } from './link-slot';

// Moved here from feedback/ and navigation/ to match design-ref/README.md's
// component index, which lists PageState and StatusPills (+ ViewToggle) under
// layout/ — they are page-level patterns, not notices or navigation chrome.
export {
  PageState,
  type PageStateKind,
  type PageStatePlacement,
  type PageStateProps,
} from './PageState';
export { StatusPills, ViewToggle } from './StatusPills';
export type { StatusPillOption, StatusPillsProps, ViewToggleProps } from './StatusPills';

// ERPNext gap report 2026-09-26: one primary button + an Actions drop-down on
// detail headers, and Ctrl+S on every create/edit form.
export { ActionMenu } from './ActionMenu';
export type { ActionMenuItem, ActionMenuProps } from './ActionMenu';
export { useSaveShortcut } from './use-save-shortcut';
