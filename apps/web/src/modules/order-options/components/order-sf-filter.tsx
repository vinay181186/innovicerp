// <OrderSfFilter> — <OrderSelect> as a list filter: the pick is one tick-list
// filter on the list's Sort & Filter state (ADR-200), so it travels in `sf`,
// survives a refresh, goes back to page 1 and is emptied by the page's Clear.

import type { QcDossierOrderKind } from '@innovic/shared';
import { BLANK, isUsable } from '@/ui/data/sort-filter/filter-model';
import type { ServerSortFilter } from '@/ui/data/sort-filter/server-state';
import { OrderSelect } from './order-select';

export function OrderSfFilter({
  sf,
  field,
  columnField,
  kind,
}: {
  sf: ServerSortFilter;
  /** The endpoint's sf field holding the order code. */
  field: string;
  /** The SO No. column's own field when it differs from `field` (it prints
   *  "/lineNo"): a pick or × replaces that column's ▾ filter, so the two never AND
   *  into an empty list. */
  columnField?: string | undefined;
  kind?: QcDossierOrderKind | undefined;
}): React.JSX.Element {
  const held = sf.value.filters[field];
  const value =
    held?.kind === 'values' && held.values.length === 1 && held.values[0] !== BLANK
      ? (held.values[0] ?? null)
      : null;
  const heldColumn = columnField ? sf.value.filters[columnField] : undefined;

  return (
    <OrderSelect
      value={value}
      kind={kind}
      // The same column's ▾ holds a filter the box cannot show: × still clears it.
      extraActive={
        (!!held && value === null && isUsable(held)) || (!!heldColumn && isUsable(heldColumn))
      }
      onChange={(option) => {
        // Nothing to remove (× on typed text only): stay on this page.
        if (!option && !held && !heldColumn) return;
        sf.onChange((s) => {
          const filters = { ...s.filters };
          if (option) filters[field] = { kind: 'values', values: [option.code] };
          else delete filters[field];
          if (columnField) delete filters[columnField];
          return { ...s, filters };
        });
      }}
    />
  );
}
