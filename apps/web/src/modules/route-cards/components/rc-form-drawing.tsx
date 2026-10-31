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

import type { RouteCard } from '@innovic/shared';
import { itemRevLabel } from '@innovic/shared';
import { Link } from '@tanstack/react-router';
import { useItem } from '@/modules/items/api';
import { cleanDrawingRev, useItemRevisionLookup } from '@/modules/item-revisions/api';
import { DrawingRevField } from '@/modules/item-revisions/components/drawing-rev-field';

export interface RcBlockingCard {
  id: string;
  code: string;
  label: string;
}

/** What the Route Card form needs to know about the picked item's Drawing Rev. */
export function useRcItemRev(args: {
  itemId: string;
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
} {
  const { itemId, drawingRev, mode, routeCard } = args;
  const { data: item } = useItem(itemId || undefined);
  const isMake = itemId && item ? item.procurementType === 'make' : itemId ? null : false;
  const lookup = useItemRevisionLookup(isMake ? itemId : null, drawingRev);
  const rev = lookup.data?.revision ?? null;
  const blockingCard =
    isMake && rev?.routeCardId && rev.routeCardId !== routeCard?.id
      ? { id: rev.routeCardId, code: rev.routeCardCode ?? 'A Route Card', label: rev.label }
      : null;
  const revLocked = mode === 'edit' && Boolean(routeCard?.drawingRev);
  const cleaned = cleanDrawingRev(drawingRev);
  let revError: string | null = null;
  if (isMake) {
    if (drawingRev.trim() && !cleaned) revError = 'Drawing Rev: letters, digits, . - / only.';
    // Compulsory on a new card. An old card opened for Edit may be saved
    // without one — the hand-fix list asks for it before a new PRO uses it.
    else if (mode === 'create' && !cleaned) revError = 'Drawing Rev is required.';
  }
  return { isMake, revLocked, blockingCard, revError };
}

/** Drawing Rev ★ · Drawing — sits after Item Code on the identity line. */
export function RcDrawingRevFields({
  itemId,
  itemCode,
  drawingRev,
  drawingFilePath,
  isMake,
  revLocked,
  mode,
  onRevChange,
  onFileChange,
}: {
  itemId: string;
  itemCode: string;
  drawingRev: string;
  drawingFilePath: string | null;
  isMake: boolean | null;
  revLocked: boolean;
  mode: 'create' | 'edit';
  onRevChange: (rev: string) => void;
  onFileChange: (path: string | null) => void;
}): React.JSX.Element | null {
  if (!itemId || !isMake) return null;
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
          className="innovic-input mono fw-xs"
          autoComplete="off"
          maxLength={32}
          style={{ textTransform: 'uppercase' }}
          placeholder={mode === 'edit' ? 'Set Drawing Rev' : 'e.g. 1, A'}
          value={drawingRev}
          onChange={(e) => onRevChange(e.target.value.toUpperCase())}
        />
      )}
      <span className="rc-id-lb">Drawing</span>
      <DrawingRevField
        itemId={itemId}
        itemCode={itemCode}
        rev={drawingRev}
        value={drawingFilePath}
        onChange={onFileChange}
        source="item_revision"
      />
    </>
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
