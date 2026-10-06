// The Route Card form's RM Item picker, as one cell of the Material row.
//
// Moved out of route-card-form.tsx unchanged in behaviour when the Material
// row took the detail page's order (RM Item · RM Grade · RM Size · RM Qty per
// piece, 2026-10-06 mock-up): RM Item is now the FIRST cell and RM Qty per
// piece the LAST, with Grade and Size between them, so the two can no longer
// be one fragment. The qty box lives in the form; this picker still clears it
// when the item is cleared, exactly as before.
//
// Behaviour, queries and state keys are the shared `RmItemFields`': only Raw
// Material / Component items are offered, the server checks the same rule, and
// the qty box stays disabled until an item is picked.

import { ITEM_TYPE_RULES, type ItemType } from '@innovic/shared';
import { useMemo, useState } from 'react';
import type { RmItemValue } from '@/components/shared/rm-item-fields';
import { useItemsList } from '@/modules/items/api';
import { FormField, SearchableSelect } from '@/ui/forms';

export function RouteCardRmItemField(props: {
  value: RmItemValue;
  onChange: (v: RmItemValue) => void;
}): React.JSX.Element {
  const { value, onChange } = props;
  const [search, setSearch] = useState('');
  // Two server-filtered queries (Raw Material, Component) — filtering 50 mixed
  // rows in the browser could hide every raw material behind assemblies.
  const term = search.trim() || undefined;
  const rm = useItemsList({ search: term, itemType: 'raw_material', limit: 30, offset: 0 });
  const comp = useItemsList({ search: term, itemType: 'component', limit: 30, offset: 0 });
  const all = useMemo(
    () => [...(rm.data?.items ?? []), ...(comp.data?.items ?? [])],
    [rm.data, comp.data],
  );
  const options = useMemo(
    () =>
      all
        .filter((it) => ITEM_TYPE_RULES[it.itemType as ItemType]?.jobMaterial)
        .map((it) => ({ id: it.id, code: it.code, name: it.name })),
    [all],
  );
  return (
    <FormField label="RM Item" htmlFor="rc-rm-item">
      <SearchableSelect
        id="rc-rm-item"
        value={value.rawMaterialItemId}
        valueLabel={value.rawMaterialItemCode ?? undefined}
        onChange={(id) => {
          const it = all.find((x) => x.id === id);
          onChange({
            ...value,
            rawMaterialItemId: id,
            rawMaterialItemCode: it?.code ?? null,
            rmQtyPerPiece: id ? value.rmQtyPerPiece : '',
          });
        }}
        options={options}
        onSearch={setSearch}
        loading={rm.isFetching || comp.isFetching}
        placeholder="🔍 Raw Material / Component item…"
        emptyText="No Raw Material / Component item"
      />
    </FormField>
  );
}
