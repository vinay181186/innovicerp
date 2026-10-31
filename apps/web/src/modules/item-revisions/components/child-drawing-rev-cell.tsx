// ChildDrawingRevCell — the "Drawing Rev" box on a BOM / ML BOM child line
// (D2, owner model 2026-10-31). A MAKE child part is named as Item + Drawing
// Rev (SHAFT/2); a Buy part carries no Rev, so the cell shows a dash and the
// line saves `childDrawingRev: null`.
//
// Under the box a one-line note says what SHAFT/<rev> is in the register:
// its drawing (opens the drawing page), "Not uploaded", or "new — will be
// created" when nobody has named that Rev yet. The server finds or creates
// the record on save; this only tells the user before they press Save.

import { itemRevLabel } from '@innovic/shared';
import { cleanDrawingRev, useItemRevisionLookup } from '../api';
import { DrawingStatusLink } from './item-rev-link';

export interface ChildDrawingRevCellProps {
  itemId: string | null | undefined;
  itemCode: string | null | undefined;
  /** Whether the child takes a Rev at all (items.procurement_type = 'make').
   *  Unknown (item not loaded yet) is treated as "takes one". */
  revRequired: boolean;
  value: string;
  onChange: (rev: string) => void;
  ariaLabel: string;
  id?: string;
}

export function ChildDrawingRevCell({
  itemId,
  itemCode,
  revRequired,
  value,
  onChange,
  ariaLabel,
  id,
}: ChildDrawingRevCellProps): React.JSX.Element {
  // Only a make part asks the register; a Buy part never has a Rev.
  const lookup = useItemRevisionLookup(revRequired ? itemId : null, value);
  if (!itemId) return <span className="text3">—</span>;
  if (!revRequired) {
    return (
      <span className="text3" title="Buy part — no Drawing Rev">
        —
      </span>
    );
  }
  const cleaned = cleanDrawingRev(value);
  const label = itemRevLabel(itemCode, cleaned);
  const revision = cleaned ? (lookup.data?.revision ?? null) : null;
  let note: React.ReactNode = null;
  if (cleaned && lookup.isFetching) note = <span className="text3">checking…</span>;
  else if (cleaned && lookup.data && !revision) note = <span className="text3">new — {label}</span>;
  else if (revision)
    note = (
      <DrawingStatusLink itemRevisionId={revision.id} drawingFilePath={revision.drawingFilePath} />
    );
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      <input
        id={id}
        className="innovic-input mono"
        style={{ maxWidth: '10ch' }}
        aria-label={ariaLabel}
        placeholder="e.g. 1"
        maxLength={32}
        value={value}
        onChange={(e) => onChange(e.target.value.toUpperCase())}
      />
      {note ? <span style={{ fontSize: 11, whiteSpace: 'nowrap' }}>{note}</span> : null}
    </div>
  );
}
