// Job Card detail — the ONE picture frame at the left of the fact block
// (jobcard-detail-mockup.html, owner decision #1, 06-Oct-2026): a frame as tall
// as the identity line plus the fact rows, with a Photo | Drawing switch under
// it. Click the frame to open the picture full size.
//
//   Photo    the Item Master's product image (jc.itemImagePath) — the same
//            picture the old header tile showed through ItemBadge, fetched the
//            same way (useItemImageUrl: long-lived, unlogged) and opened the same
//            way (FilePreviewModal, kind "file").
//   Drawing  the drawing this card is made to (useJcDrawing, resolved by the
//            caller): its thumbnail when the file is an image; a PDF / DWG has
//            none, so the frame names the file instead. Opening it goes through
//            the caller's drawing preview, which logs the view as a drawing.
//
// Starts on Photo; an item with no photo starts on Drawing; with neither the
// frame says "No picture" and is not clickable. Tokens only.
import { FileText, Package } from 'lucide-react';
import { useEffect, useState } from 'react';
import { FilePreviewModal } from '@/components/shared/file-preview-modal';
import { useItemImageUrl } from '@/lib/item-image';
import type { JcDrawingRef } from './jc-view-summary';

type ThumbMode = 'photo' | 'drawing';

export function JcItemThumb({
  imagePath,
  drawing,
  onOpenDrawing,
  itemLabel,
}: {
  /** jc.itemImagePath — null when the item has no product image. */
  imagePath: string | null;
  /** The resolved drawing ref (null when the card has no drawing). */
  drawing: JcDrawingRef | null;
  /** Opens the page's drawing preview (kind "drawing", logged). */
  onOpenDrawing: () => void;
  /** CODE/REV · name, for the alt text. */
  itemLabel: string;
}): React.JSX.Element {
  const hasPhoto = Boolean(imagePath);
  const hasDrawing = Boolean(drawing);
  const [chosen, setChosen] = useState<ThumbMode>(hasPhoto ? 'photo' : 'drawing');
  // The side asked for may have nothing behind it (the photo was removed, the
  // drawing has not loaded yet) — show the other one rather than an empty frame.
  const mode: ThumbMode =
    chosen === 'photo' && !hasPhoto
      ? 'drawing'
      : chosen === 'drawing' && !hasDrawing && hasPhoto
        ? 'photo'
        : chosen;

  const { data: photoUrl } = useItemImageUrl(imagePath);
  const [photoFailed, setPhotoFailed] = useState(false);
  useEffect(() => setPhotoFailed(false), [photoUrl]);
  const [photoOpen, setPhotoOpen] = useState(false);

  const canOpen = mode === 'photo' ? hasPhoto : hasDrawing;
  const open = (): void => {
    if (!canOpen) return;
    if (mode === 'photo') setPhotoOpen(true);
    else onOpenDrawing();
  };

  let body: React.ReactNode;
  if (mode === 'photo' && hasPhoto) {
    body =
      photoUrl && !photoFailed ? (
        <img
          className="jc-thumb-img"
          src={photoUrl}
          alt={`${itemLabel} — product image`}
          onError={() => setPhotoFailed(true)}
        />
      ) : (
        <Package size={36} aria-hidden="true" />
      );
  } else if (mode === 'drawing' && drawing) {
    body = drawing.thumbUrl ? (
      <img className="jc-thumb-img" src={drawing.thumbUrl} alt={`${drawing.label} drawing`} />
    ) : (
      // A PDF / DWG drawing has no thumbnail — name the file instead.
      <span className="jc-thumb-file">
        <FileText size={30} aria-hidden="true" />
        <span className="jc-thumb-file-name">{drawing.fileName}</span>
      </span>
    );
  } else {
    body = <span className="jc-thumb-none">No picture</span>;
  }

  const title =
    mode === 'photo' && hasPhoto
      ? 'Product image — click to open full size'
      : mode === 'drawing' && drawing
        ? `${drawing.label} — ${drawing.fileName}. Click to open.`
        : 'This item has no product image and this Job Card has no drawing';

  return (
    <aside className="jc-thumbs" aria-label="Item picture">
      {canOpen ? (
        <button
          type="button"
          className="jc-thumb"
          onClick={open}
          title={title}
          aria-label={mode === 'photo' ? 'Open item photo full size' : 'Open the drawing'}
        >
          {body}
          <span className="jc-thumb-zoom" aria-hidden="true">
            ⤢
          </span>
        </button>
      ) : (
        <div className="jc-thumb is-empty" title={title}>
          {body}
        </div>
      )}
      <div className="jc-thumb-sw" role="group" aria-label="Picture shown">
        <button
          type="button"
          className={mode === 'photo' ? 'on' : undefined}
          aria-pressed={mode === 'photo'}
          disabled={!hasPhoto}
          title={hasPhoto ? 'Show the product image' : 'This item has no product image'}
          onClick={() => setChosen('photo')}
        >
          Photo
        </button>
        <button
          type="button"
          className={mode === 'drawing' ? 'on' : undefined}
          aria-pressed={mode === 'drawing'}
          disabled={!hasDrawing}
          title={hasDrawing ? 'Show the drawing' : 'No drawing on this Job Card'}
          onClick={() => setChosen('drawing')}
        >
          Drawing
        </button>
      </div>
      {photoOpen && imagePath ? (
        <FilePreviewModal
          storagePath={imagePath}
          kind="file"
          fileType="image/*"
          onClose={() => setPhotoOpen(false)}
        />
      ) : null}
    </aside>
  );
}
