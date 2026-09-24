// Barrel for apps/web/src/ui/core — the design system's core primitives.
// CORE ONLY. ui/forms, ui/data, ui/feedback, ui/layout and ui/navigation each
// have their own index.ts; nothing from those folders belongs here.

export { Badge, type BadgeProps, type BadgeTone } from './Badge';
export {
  Button,
  type ButtonBaseProps,
  type ButtonProps,
  type ButtonSize,
  type ButtonVariant,
} from './Button';
export { Icon, ICON_NAMES, type IconName, type IconProps } from './Icon';
export { IconButton, type IconButtonProps } from './IconButton';
export {
  PriorityText,
  type Priority,
  type PriorityTextProps,
  StatusBadge,
  type StatusBadgeProps,
  type StatusKind,
} from './StatusBadge';
export { SyncDot, type SyncDotProps, type SyncState } from './SyncDot';
export { Tag, type TagProps, type TagTone } from './Tag';
