// Item badge — the ONE way an item is shown with its product image
// (user decision 2026-09-21, mock-up JC-List-3D-Image-Mockup.html).
//
//   [ 3D render ]  CODE/REV          ← mono, bold; purple in lists, --text on the item page
//                  Item name         ← quiet, one line, ellipsis
//
// The picture is a fixed square so every row lines up: 40 px in table rows,
// 56 px on cards and page headers, 96 px on the Item Master page
// (ITEM_IMAGE_SIZES). It is cropped to fill the box (object-fit: cover), shows
// the grey Package icon when the item has no image, and clicking it opens the
// image large in the shared FilePreviewModal. Clicking the text does whatever
// the caller wants (`onClick`) — usually nothing, the row handles that.
//
// This is the PRODUCT IMAGE, not the drawing. Drawings stay on the SO / JWSO
// line, are logged on every view and go through `@/lib/drawing-url`; this link
// comes from the long-lived, unlogged `/item-images/url` via useItemImageUrl.
//
// The revision, when given, is the CUSTOMER'S drawing revision off the order
// line, written `CODE/REV` by the shared helper. Never pass `items.revision`.
//
// Tokens only — the box copies the inline style the old JC-list PartThumb used.

import { ITEM_IMAGE_SIZES } from '@innovic/shared';
import { Package } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useItemImageUrl } from '@/lib/item-image';
import { itemCodeWithRev } from '@/lib/item-code';
import { FilePreviewModal } from './file-preview-modal';

export type ItemBadgeSize = keyof typeof ITEM_IMAGE_SIZES;

/** Type scale per box size: code / name font sizes, icon size. */
const SCALE: Record<ItemBadgeSize, { code: number; name: number; icon: number; radius: number }> = {
  row: { code: 12, name: 11, icon: 16, radius: 4 },
  card: { code: 14, name: 12, icon: 20, radius: 4 },
  page: { code: 16, name: 13, icon: 28, radius: 6 },
};

export interface ItemBadgeProps {
  code: string | null | undefined;
  name?: string | null;
  imagePath: string | null | undefined;
  /** The order line's drawing revision — rendered as `CODE/REV`. Omit for masters. */
  revision?: string | null;
  size?: ItemBadgeSize;
  /** Hide the name line (code only). Default: shown. */
  showName?: boolean;
  /** Colour of the code text. Lists use purple (the JC list's code colour);
   *  the item page passes `var(--text)`. */
  codeColor?: string;
  /** Widest the name may grow before it clips. Default 200 on rows, none on the page. */
  nameMaxWidth?: number | 'none';
  /** Clicking the TEXT (code · name). The image box has its own click (preview). */
  onClick?: () => void;
  /** Lets a list wrap the code text in its own <Link>. Receives the CODE/REV string. */
  renderCode?: (codeText: string) => React.ReactNode;
  /** Extra content under the name (e.g. "Job Card … · JWSO …" on a card header). */
  children?: React.ReactNode;
  className?: string;
  style?: React.CSSProperties;
}

/** Just the picture box — used on its own by the item form's image field. */
export function ItemImageBox({
  imagePath,
  size = 'row',
  alt,
  onOpen,
}: {
  imagePath: string | null | undefined;
  size?: ItemBadgeSize;
  alt?: string;
  /** Override the click. Default opens the preview modal. */
  onOpen?: () => void;
}): React.JSX.Element {
  const px = ITEM_IMAGE_SIZES[size];
  const sc = SCALE[size];
  const hasImage = Boolean(imagePath);
  const { data: url } = useItemImageUrl(imagePath);
  const [previewOpen, setPreviewOpen] = useState(false);
  // A load failure hides the <img> so the Package icon shows through — as
  // STATE, reset whenever the signed URL is refreshed, so a fresh link gets a
  // fresh try (an imperative display:none would have stuck for ever).
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [url]);

  const open = (): void => {
    if (!hasImage) return;
    if (onOpen) onOpen();
    else setPreviewOpen(true);
  };

  return (
    <>
      <div
        role={hasImage ? 'button' : undefined}
        tabIndex={hasImage ? 0 : undefined}
        title={hasImage ? 'Product image' : 'No product image'}
        aria-label={hasImage ? 'Open product image' : undefined}
        onClick={(e) => {
          if (!hasImage) return;
          // The box sits inside clickable rows and cards — opening the picture
          // must not also open the row.
          e.stopPropagation();
          e.preventDefault();
          open();
        }}
        onKeyDown={(e) => {
          if (!hasImage) return;
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            e.stopPropagation();
            open();
          }
        }}
        style={{
          position: 'relative',
          width: px,
          height: px,
          flexShrink: 0,
          borderRadius: sc.radius,
          border: '1px solid var(--border)',
          background: 'var(--bg4)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: 'var(--text3)',
          overflow: 'hidden',
          cursor: hasImage ? 'zoom-in' : 'default',
        }}
      >
        <Package size={sc.icon} />
        {hasImage && url && !failed ? (
          <img
            src={url}
            alt={alt ?? ''}
            loading="lazy"
            style={{
              position: 'absolute',
              inset: 0,
              width: '100%',
              height: '100%',
              objectFit: 'cover',
              background: 'var(--bg4)',
            }}
            onError={() => setFailed(true)}
          />
        ) : null}
      </div>
      {previewOpen && imagePath ? (
        // The modal is portaled to <body>, but React events still bubble up the
        // component tree — stop them here so a click inside the preview never
        // reaches the row/card the badge sits in.
        <span
          onClick={(e) => e.stopPropagation()}
          onMouseDown={(e) => e.stopPropagation()}
          onKeyDown={(e) => e.stopPropagation()}
        >
          <FilePreviewModal
            storagePath={imagePath}
            kind="file"
            fileType="image/*"
            onClose={() => setPreviewOpen(false)}
          />
        </span>
      ) : null}
    </>
  );
}

export function ItemBadge({
  code,
  name,
  imagePath,
  revision,
  size = 'row',
  showName = true,
  codeColor = 'var(--purple)',
  nameMaxWidth,
  onClick,
  renderCode,
  children,
  className,
  style,
}: ItemBadgeProps): React.JSX.Element {
  const sc = SCALE[size];
  const codeText = itemCodeWithRev(code, revision);
  const nameText = name?.trim() || '';
  const maxW = nameMaxWidth ?? (size === 'page' ? 'none' : 200);

  return (
    <div
      className={className}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: size === 'page' ? 12 : 8,
        textAlign: 'left',
        minWidth: 0,
        maxWidth: '100%',
        ...style,
      }}
    >
      <ItemImageBox imagePath={imagePath} size={size} alt={nameText || codeText} />
      <div
        style={{ minWidth: 0, cursor: onClick ? 'pointer' : undefined }}
        onClick={onClick}
        role={onClick ? 'button' : undefined}
      >
        <div
          className="mono fw-700"
          style={{
            color: codeColor,
            fontSize: sc.code,
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            lineHeight: 1.2,
          }}
          title={codeText}
        >
          {renderCode ? renderCode(codeText) : codeText}
        </div>
        {showName ? (
          <div
            className="text2"
            style={{
              fontSize: sc.name,
              maxWidth: maxW,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              lineHeight: 1.25,
            }}
            title={nameText}
          >
            {nameText || '—'}
          </div>
        ) : null}
        {children}
      </div>
    </div>
  );
}
