// <ItemBadge> — the ONE way an item is shown anywhere in the app.
//
//   [ product image ]  CODE/REV      ← mono, fw-700, purple in lists
//                      Item name     ← quiet, one line, ellipsis
//
// THE ITEM CODE IS THE PRIMARY IDENTIFIER on every screen: it renders
// `mono fw-700` in a strong colour and is NEVER dimmed to `--text3`. The name
// is the quiet line, not the other way round.
//
// Ported from `components/shared/item-badge.tsx`. Everything the audit marks
// as must-not-change (02 §D.5) is preserved:
//   · the picture and the text have TWO SEPARATE click handlers, and the
//     picture's one calls stopPropagation/preventDefault — badges sit inside
//     clickable rows and cards, and opening the image must not open the row;
//   · keyboard support on the picture only when there IS a picture to open
//     (role=button, tabIndex, Enter/Space);
//   · object-fit: cover at every size EXCEPT `tile`, which shows the whole
//     render (contain + air) because it is a header picture, not a thumbnail;
//   · the row layout pins the box flush left in a width:100% flex container,
//     so the picture sits at the same x in every row of a list whatever the
//     length of the code and name beside it (it used to "dance");
//   · the failed-image fallback is STATE, reset whenever the URL changes, so
//     a fresh signed link gets a fresh try.
//
// Difference from the shared component this replaces: it is PURE. It takes a
// resolved `src` instead of a storage path, and calls `onOpenImage` instead of
// owning a preview modal — fetching the signed URL and opening the preview
// stay in the app wrapper, so this primitive renders in the UI kit and in
// tests with no query client behind it.

import { useEffect, useState } from 'react';
import { itemCodeWithRev } from '@/lib/item-code';
import { Icon } from '../core/Icon';

export type ItemBadgeSize = 'row' | 'card' | 'page' | 'tile';

/** Box edge in px, per the design reference: a table-row thumbnail, a card /
 *  page-header picture, the Item Master page, and the 120px Job Card header
 *  tile. Fixed sizes are the point — every row in a list lines up.
 *
 *  `row` is 40, DECIDED BY THE USER 2026-09-23 against the running app's 48.
 *  ITEM_IMAGE_SIZES (packages/shared) still reads { row: 48, card: 56, page: 96 };
 *  that is the OLD value and this component is the new source of truth, so when
 *  Phase 4 wires a list onto ItemBadge the row gets 8px shorter and the 48px
 *  signed image is downscaled into a 40px box. Both are intended. Do NOT
 *  "restore" 48 from packages/shared — reconcile ITEM_IMAGE_SIZES to 40 instead,
 *  in the same change that removes the last direct reader of it. */
const BOX_PX: Record<ItemBadgeSize, number> = { row: 40, card: 56, page: 96, tile: 120 };

/** Type + geometry per box size. Font sizes are scale tokens only (11/13/16);
 *  the icon px and the radius follow the box. */
const SCALE: Record<ItemBadgeSize, { code: string; name: string; icon: number; radius: string }> = {
  row: { code: 'var(--fs-sm)', name: 'var(--fs-xs)', icon: 16, radius: 'var(--radius-sm)' },
  card: { code: 'var(--fs-md)', name: 'var(--fs-sm)', icon: 20, radius: 'var(--radius-sm)' },
  page: { code: 'var(--fs-md)', name: 'var(--fs-sm)', icon: 28, radius: 'var(--radius)' },
  tile: { code: 'var(--fs-md)', name: 'var(--fs-sm)', icon: 40, radius: 'var(--radius2)' },
};

export interface ItemImageBoxProps {
  /** Resolved image URL. Omit for the grey Package icon. */
  src?: string | null | undefined;
  size?: ItemBadgeSize | undefined;
  alt?: string | undefined;
  /**
   * Clicking the picture. Omit and the box is inert (no cursor, no role, no
   * tab stop) — a control that does nothing must not be announced as one.
   *
   * WRAPPER INVARIANT: pass `onOpen` WHENEVER you pass `src`. The shared
   * component this replaces always opened its own FilePreviewModal, so a
   * picture was always clickable; this one is pure, so the app wrapper owns
   * the preview. A wrapper that passes `src` without `onOpen` renders a dead,
   * unfocusable picture, and TypeScript cannot catch it.
   */
  onOpen?: (() => void) | undefined;
  /** Fill the parent edge to edge — pinned to all four edges of a
   *  `position: relative` parent (a Thumbnail column's cell), with no border
   *  or rounding: the gridlines frame it. */
  fill?: boolean | undefined;
}

export function ItemImageBox({
  src,
  size = 'row',
  alt,
  onOpen,
  fill = false,
}: ItemImageBoxProps): React.JSX.Element {
  const px = BOX_PX[size];
  const sc = SCALE[size];
  const tile = size === 'tile';
  const hasImage = Boolean(src);
  // A load failure hides the <img> so the Package icon shows through — as
  // STATE, reset whenever the URL changes, so a fresh link gets a fresh try
  // (an imperative display:none would have stuck for ever).
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [src]);

  const openable = hasImage && typeof onOpen === 'function';

  return (
    <div
      role={openable ? 'button' : undefined}
      tabIndex={openable ? 0 : undefined}
      title={hasImage ? 'Product image' : 'No product image'}
      aria-label={openable ? 'Open product image' : undefined}
      onClick={
        openable
          ? (e): void => {
              // The box sits inside clickable rows and cards — opening the
              // picture must not also open the row.
              e.stopPropagation();
              e.preventDefault();
              onOpen();
            }
          : undefined
      }
      onKeyDown={
        openable
          ? (e): void => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                e.stopPropagation();
                onOpen();
              }
            }
          : undefined
      }
      style={{
        position: fill ? 'absolute' : 'relative',
        inset: fill ? 0 : undefined,
        width: fill ? '100%' : px,
        height: fill ? '100%' : px,
        flexShrink: 0,
        borderRadius: fill ? 0 : sc.radius,
        border: fill ? 'none' : '1px solid var(--border)',
        background: tile ? 'var(--bg3)' : 'var(--bg4)',
        // No shadow, at any size. The reference .jsx lifts the tile with a raw
        // `rgba(20,40,70,.08)`, but colours are tokens only and tokens.css
        // carries shadows for floating layers alone (--shadow-modal / -toast /
        // -drawer, "panels carry no shadow at all"). A 120px picture on a page
        // header is not a floating layer; its 1px --border is its edge.
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: 'var(--text3)',
        overflow: 'hidden',
        cursor: openable ? 'zoom-in' : 'default',
      }}
    >
      {/* The one control-icon source — never lucide-react directly. */}
      <Icon name="package" size={sc.icon} />
      {hasImage && !failed ? (
        <img
          src={src ?? ''}
          alt={alt ?? ''}
          loading="lazy"
          style={{
            position: 'absolute',
            inset: 0,
            width: '100%',
            height: '100%',
            // Tile: the whole render, never cropped, with a little air round
            // it. Every other size fills its box.
            objectFit: tile ? 'contain' : 'cover',
            padding: tile ? 'var(--sp-2)' : undefined,
            boxSizing: 'border-box',
            background: tile ? 'var(--bg3)' : 'var(--bg4)',
          }}
          onError={() => setFailed(true)}
        />
      ) : null}
    </div>
  );
}

export interface ItemBadgeProps {
  code: string | null | undefined;
  /** The ORDER LINE's drawing revision — rendered `CODE/REV`. Omit on masters
   *  and on purchase papers, which have no SO line behind them. */
  revision?: string | null | undefined;
  name?: string | null | undefined;
  /** Resolved product-image URL. Omit for the grey Package icon. */
  src?: string | null | undefined;
  /** row 40 · card 56 · page 96 · tile 120 (contain + padding). */
  size?: ItemBadgeSize | undefined;
  showName?: boolean | undefined;
  /** Hide the picture. A list that gives the thumbnail its OWN column renders
   *  <ItemThumbnailCell> there and the badge with showImage={false} beside it. */
  showImage?: boolean | undefined;
  /** Colour of the code. Lists use purple; the item page passes `var(--text)`.
   *  Never a faint colour — the code is the main thing on the row. */
  codeColor?: string | undefined;
  /** Widest the name may grow before it clips. Default 200 on row/card. */
  nameMaxWidth?: number | 'none' | undefined;
  /** Clicking the TEXT (code · name). The picture has its own click. */
  onClick?: (() => void) | undefined;
  /** Clicking the PICTURE — usually "open it large". Pass it whenever you
   *  pass `src`; see the wrapper invariant on ItemImageBoxProps.onOpen. */
  onOpenImage?: (() => void) | undefined;
  /** Lets a list wrap the code text in its own <Link>. Gets `CODE/REV`. */
  renderCode?: ((codeText: string) => React.ReactNode) | undefined;
  /** Extra lines under the name (e.g. "Job Card … · JWSO …" on a card). */
  children?: React.ReactNode | undefined;
  className?: string | undefined;
  style?: React.CSSProperties | undefined;
}

export function ItemBadge({
  code,
  revision,
  name,
  src,
  size = 'row',
  showName = true,
  showImage = true,
  codeColor = 'var(--purple)',
  nameMaxWidth,
  onClick,
  onOpenImage,
  renderCode,
  children,
  className,
  style,
}: ItemBadgeProps): React.JSX.Element {
  const sc = SCALE[size];
  const tile = size === 'tile';
  const codeText = itemCodeWithRev(code, revision);
  const nameText = name?.trim() ?? '';
  const maxW = nameMaxWidth ?? (size === 'page' || tile ? 'none' : 200);
  // In a table row the badge fills its cell and starts at its left edge, so
  // the picture box sits at the SAME x in every row whatever the text beside
  // it. Card, page and tile stay inline: they sit beside other things.
  const rowLayout = size === 'row';

  return (
    <div
      className={className}
      style={{
        display: rowLayout ? 'flex' : 'inline-flex',
        width: rowLayout ? '100%' : undefined,
        justifyContent: 'flex-start',
        flexDirection: 'row',
        // The tile top-aligns its text so code · name · extras read as a block
        // beside the 120px picture; every other size centres on the row.
        alignItems: tile ? 'flex-start' : 'center',
        gap: tile || size === 'page' ? 'var(--sp-3)' : 'var(--sp-2)',
        textAlign: 'left',
        minWidth: 0,
        maxWidth: '100%',
        ...style,
      }}
    >
      {showImage ? (
        <ItemImageBox src={src} size={size} alt={nameText || codeText} onOpen={onOpenImage} />
      ) : null}
      {/* The text block is a control only when it has a handler — and then a
          REACHABLE one: role="button" without tabIndex/Enter/Space is a button
          a keyboard user can neither reach nor press (§D.5). */}
      <div
        style={{ minWidth: 0, cursor: onClick ? 'pointer' : undefined }}
        onClick={onClick}
        role={onClick ? 'button' : undefined}
        tabIndex={onClick ? 0 : undefined}
        onKeyDown={
          onClick
            ? (e): void => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  onClick();
                }
              }
            : undefined
        }
      >
        <div
          className="mono fw-700"
          style={{
            color: codeColor,
            fontSize: sc.code,
            fontWeight: tile ? 800 : undefined,
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
              // Beside the tile the name may take two lines, then clamps —
              // long names must not push a page header about.
              whiteSpace: tile ? 'normal' : 'nowrap',
              display: tile ? '-webkit-box' : undefined,
              WebkitLineClamp: tile ? 2 : undefined,
              WebkitBoxOrient: tile ? 'vertical' : undefined,
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

/** Width of a list's Thumbnail column — a % like every other column, so a
 *  sheet's <colgroup> still sums to 100% and the Action column at the far
 *  right is never pushed off a narrow window. Take the 8% out of the item
 *  code · name column beside it. */
export const THUMBNAIL_COL_WIDTH = '8%';

/** The <th> of a list's Thumbnail column. */
export function ItemThumbnailHeader(): React.JSX.Element {
  return (
    <th
      style={{
        width: THUMBNAIL_COL_WIDTH,
        padding: 'var(--sp-2) var(--sp-0)',
        fontSize: 'var(--fs-xs)',
        overflow: 'hidden',
      }}
      title="Product image"
    >
      Thumbnail
    </th>
  );
}

export interface ItemThumbnailCellProps {
  src?: string | null | undefined;
  alt?: string | null | undefined;
  onOpen?: (() => void) | undefined;
}

/** The <td> of a list's Thumbnail column: the picture fills the whole cell
 *  edge to edge, the column's gridlines being its frame. Pair it with
 *  <ItemBadge showImage={false}> in the next column. */
export function ItemThumbnailCell({ src, alt, onOpen }: ItemThumbnailCellProps): React.JSX.Element {
  return (
    // A cell's `height` is a MINIMUM, so the row can never be shorter than the
    // picture box and still grows with a taller neighbour.
    <td style={{ padding: 0, position: 'relative', height: BOX_PX.row }}>
      <ItemImageBox src={src} size="row" alt={alt ?? ''} onOpen={onOpen} fill />
    </td>
  );
}
