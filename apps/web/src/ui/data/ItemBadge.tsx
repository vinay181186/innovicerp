// <ItemBadge> — ONE copy (owner 2026-11-04): components/shared/item-badge.tsx is
// the badge every real screen uses, so the UI kit's export points at it rather
// than carrying a second one that can drift.

export {
  ItemBadge,
  ItemImageBox,
  ItemThumbnailCell,
  ItemThumbnailHeader,
  THUMBNAIL_COL_WIDTH,
  type ItemBadgeProps,
  type ItemBadgeSize,
} from '@/components/shared/item-badge';
