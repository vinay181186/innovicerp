// DrawingRevPicker — "which Item + Drawing Rev bucket?" for a stock write on a
// MAKE item (Phase C): Manual Adjust and the Stock Count line. Options are the
// item's Revs (ABC/1, ABC/2 …) from GET /item-revisions?itemId= plus
// "No Rev (old stock)" — the blank bucket that holds stock made before the
// register. An item with no Revs at all (Buy item / RM, or a make item never
// given one) needs no choice: `useItemRevOptions().required` is false and the
// write goes without an itemRevisionId, exactly as before.

import { itemRevLabel } from '@innovic/shared';
import { SearchableSelect } from '@/ui/forms';
import { useItemRevisions } from '../api';

/** The option id of the blank (no-Rev) bucket. Never sent to the server —
 *  `pickedRevisionId` turns it into null. */
export const NO_REV_OPTION = '__no_rev__';

/** The picker value → the `itemRevisionId` a write sends (null = blank bucket). */
export function pickedRevisionId(value: string | null): string | null {
  return !value || value === NO_REV_OPTION ? null : value;
}

export function useItemRevOptions(itemId: string | null | undefined) {
  const q = useItemRevisions(
    { ...(itemId ? { itemId } : {}), limit: 200 },
    { enabled: Boolean(itemId) },
  );
  const revs = itemId ? (q.data?.items ?? []) : [];
  const options = [
    ...revs.map((r) => ({
      id: r.id,
      code: itemRevLabel(r.itemCode, r.drawingRev),
      name: r.drawingNo ?? '',
    })),
    { id: NO_REV_OPTION, code: 'No Rev', name: 'old stock' },
  ];
  return { required: revs.length > 0, options, loading: q.isFetching, error: q.error };
}

export function DrawingRevPicker({
  itemId,
  value,
  onChange,
  id,
  ariaLabel = 'Drawing Rev',
}: {
  itemId: string | null | undefined;
  /** An itemRevisionId, NO_REV_OPTION, or null (not chosen yet). */
  value: string | null;
  onChange: (value: string | null) => void;
  id?: string;
  ariaLabel?: string;
}): React.JSX.Element | null {
  const { required, options, loading, error } = useItemRevOptions(itemId);
  if (!itemId || !required) return null;
  return (
    <SearchableSelect
      id={id}
      ariaLabel={ariaLabel}
      value={value}
      onChange={onChange}
      options={options}
      loading={loading}
      error={error}
      placeholder="Select Drawing Rev…"
      emptyText="No Drawing Rev"
      selectedLabel={(o) => (o.id === NO_REV_OPTION ? 'No Rev (old stock)' : (o.code ?? o.name))}
    />
  );
}
