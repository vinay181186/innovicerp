// Route Card form — Drawing Rev + Drawing (Item + Drawing Rev register, owner
// model 2026-10-31). Kept out of route-card-form.tsx, which is already long.
//
// One Route Card per Item + Rev: ABC/1 and ABC/2 may each have their own card,
// and a repeat order for ABC/1 reuses ABC/1's card. So the form is blocked only
// when the register already names a card for THIS Item + Rev — not, as before,
// whenever the item had any card at all.
//
// Drawing Rev is asked for MAKE items only (items.procurementType 'make'). On
// Edit it is read-only once set; an old card made before the register has none
// and may set it once ("Set Drawing Rev").
//
// ADR-323 — the card has NO drawing file box. On a NEW card for a make item the
// drawing PDF is compulsory and lives in the Drawing Register:
//   Rev found with a PDF → file name + "📎 View drawing" (new tab), no message
//   Rev found, no PDF    → stop banner + "Click here to upload it" (new tab)
//   Rev not found        → stop banner + "Click here to add it" (new tab)
//   no Drawing Register Entry right → "Ask Design — needs the Drawing Register right."
// Save stays off with the reason while the drawing is missing. The look-up is
// re-read whenever the window regains focus, so coming back from the other tab
// clears the banner without retyping. An old card opened for Edit is not checked.

import type { RouteCard } from '@innovic/shared';
import {
  itemRevLabel,
  routeCardDrawingMissingMessage,
  routeCardRevMissingMessage,
} from '@innovic/shared';
import { Link } from '@tanstack/react-router';
import { fileNameFromPath } from '@/components/shared/file-preview-modal';
import { effectiveFormPerms, useMyAccess } from '@/lib/access-control';
import { useItem } from '@/modules/items/api';
import { cleanDrawingRev, useItemRevisionLookup } from '@/modules/item-revisions/api';
import { ViewDrawingLink } from '@/modules/item-revisions/components/drawing-rev-field';
import { Banner } from '@/ui/feedback';

export interface RcBlockingCard {
  id: string;
  code: string;
  label: string;
}

/** The register's drawing for this Item + Rev, when it has a PDF. */
export interface RcDrawingFile {
  itemRevisionId: string;
  path: string;
}

/** ADR-323 — why a NEW card cannot be saved yet (drawing missing). */
export type RcDrawingMissing =
  | { kind: 'rev'; label: string; itemId: string; rev: string }
  | { kind: 'file'; label: string; itemRevisionId: string };

/** What the Route Card form needs to know about the picked item's Drawing Rev. */
export function useRcItemRev(args: {
  itemId: string;
  itemCode: string;
  drawingRev: string;
  mode: 'create' | 'edit';
  routeCard: RouteCard | null | undefined;
}): {
  /** null while the item is still loading. */
  isMake: boolean | null;
  revLocked: boolean;
  blockingCard: RcBlockingCard | null;
  /** Why Save is off, or null. */
  revError: string | null;
  drawingFile: RcDrawingFile | null;
  drawingMissing: RcDrawingMissing | null;
} {
  const { itemId, itemCode, drawingRev, mode, routeCard } = args;
  const { data: item } = useItem(itemId || undefined);
  const isMake = itemId && item ? item.procurementType === 'make' : itemId ? null : false;
  // Create: re-read on every return to the window (the user may have added the
  // Rev / uploaded the PDF in another tab).
  const lookup = useItemRevisionLookup(isMake ? itemId : null, drawingRev, {
    freshOnFocus: mode === 'create',
  });
  const cleaned = cleanDrawingRev(drawingRev);
  // Only an answer for the Rev now typed counts (the look-up is debounced).
  // A found Rev must be the one now typed: during the debounce the previous
  // answer is still in hand and must not switch Save on.
  const found = lookup.data?.revision ?? null;
  const answered = Boolean(
    isMake && cleaned && lookup.data && (!found || found.drawingRev.toUpperCase() === cleaned),
  );
  const rev = answered ? (lookup.data?.revision ?? null) : null;
  const blockingCard =
    isMake && rev?.routeCardId && rev.routeCardId !== routeCard?.id
      ? { id: rev.routeCardId, code: rev.routeCardCode ?? 'A Route Card', label: rev.label }
      : null;
  const revLocked = mode === 'edit' && Boolean(routeCard?.drawingRev);
  const drawingFile = rev?.drawingFilePath
    ? { itemRevisionId: rev.id, path: rev.drawingFilePath }
    : null;
  const label = rev?.label ?? itemRevLabel(itemCode, cleaned);
  let drawingMissing: RcDrawingMissing | null = null;
  if (mode === 'create' && answered && lookup.data?.revRequired !== false) {
    if (!rev) drawingMissing = { kind: 'rev', label, itemId, rev: cleaned };
    else if (!rev.drawingFilePath) drawingMissing = { kind: 'file', label, itemRevisionId: rev.id };
  }
  let revError: string | null = null;
  if (isMake) {
    if (drawingRev.trim() && !cleaned) revError = 'Drawing Rev: letters, digits, . - / only.';
    // Compulsory on a new card. An old card opened for Edit may be saved
    // without one — the hand-fix list asks for it before a new PRO uses it.
    else if (mode === 'create' && !cleaned) revError = 'Drawing Rev is required.';
    else if (mode === 'create' && !answered) {
      revError = lookup.isError
        ? `Could not check ${label} in the Drawing Register. Try again.`
        : `Checking ${label} in the Drawing Register…`;
    } else if (drawingMissing) {
      revError =
        drawingMissing.kind === 'rev'
          ? routeCardRevMissingMessage(drawingMissing.label)
          : routeCardDrawingMissingMessage(drawingMissing.label);
    }
  }
  return { isMake, revLocked, blockingCard, revError, drawingFile, drawingMissing };
}

/** Drawing Rev ★ · Item Name · Drawing — sits after Item Code on the identity
 *  line. Item Name goes between the two (owner 2026-11-24), and alone when the
 *  item has no Drawing Rev (not a make item, or none picked yet). The Drawing
 *  is read-only: the PDF's name and "📎 View drawing" when the register has it. */
export function RcDrawingRevFields({
  itemId,
  itemCode,
  drawingRev,
  drawingFile,
  isMake,
  revLocked,
  mode,
  onRevChange,
  itemName,
}: {
  itemId: string;
  itemCode: string;
  drawingRev: string;
  drawingFile: RcDrawingFile | null;
  isMake: boolean | null;
  revLocked: boolean;
  mode: 'create' | 'edit';
  onRevChange: (rev: string) => void;
  itemName: React.ReactNode;
}): React.JSX.Element {
  if (!itemId || !isMake) return <>{itemName}</>;
  return (
    <>
      <label className="rc-id-lb" htmlFor="rc-drawing-rev">
        Drawing Rev{mode === 'create' ? <span className="req">★</span> : null}
      </label>
      {revLocked ? (
        <span className="mono fw-700" title="Drawing Rev is fixed once set">
          {itemRevLabel(itemCode, drawingRev)}
        </span>
      ) : (
        <input
          id="rc-drawing-rev"
          className="innovic-input mono"
          autoComplete="off"
          maxLength={32}
          style={{ textTransform: 'uppercase' }}
          placeholder={mode === 'edit' ? 'Set Drawing Rev' : '1, A'}
          value={drawingRev}
          onChange={(e) => onRevChange(e.target.value.toUpperCase())}
        />
      )}
      {itemName}
      {drawingFile ? (
        <>
          <span className="rc-id-lb">Drawing</span>
          <span className="mono" title={fileNameFromPath(drawingFile.path)}>
            {fileNameFromPath(drawingFile.path)}
          </span>
          <ViewDrawingLink itemRevisionId={drawingFile.itemRevisionId} />
        </>
      ) : null}
    </>
  );
}

/** ADR-323 — the stop banner on a NEW card while its drawing is missing. The
 *  link opens the Drawing Register in a new tab; without the Drawing Register
 *  Entry right the user is told to ask Design instead. */
export function RcDrawingMissingBanner({
  missing,
}: {
  missing: RcDrawingMissing;
}): React.JSX.Element {
  const { data: eff } = useMyAccess();
  const mayAdd = effectiveFormPerms(eff, 'drawingreg_create').entry;
  const message =
    missing.kind === 'rev'
      ? routeCardRevMissingMessage(missing.label)
      : routeCardDrawingMissingMessage(missing.label);
  let action: React.ReactNode;
  if (!mayAdd) {
    action = <span className="fw-700">Ask Design — needs the Drawing Register right.</span>;
  } else if (missing.kind === 'rev') {
    action = (
      <Link
        to="/drawing-register"
        search={{ page: 1, new: 1, itemId: missing.itemId, rev: missing.rev }}
        target="_blank"
        rel="noopener"
        className="fw-700"
      >
        Click here to add it
      </Link>
    );
  } else {
    action = (
      <Link
        to="/drawings/$itemRevisionId"
        params={{ itemRevisionId: missing.itemRevisionId }}
        search={{ upload: 1 }}
        target="_blank"
        rel="noopener"
        className="fw-700"
      >
        Click here to upload it
      </Link>
    );
  }
  return (
    <Banner tone="error" role="alert" accent title={message}>
      {action}
    </Banner>
  );
}

/** The "already exists" banner body's link. */
export function RcBlockingLink({ card }: { card: RcBlockingCard }): React.JSX.Element {
  return (
    <Link to="/route-cards/$id" params={{ id: card.id }} className="td-code">
      {card.code}
    </Link>
  );
}
