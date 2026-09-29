// Raw-material ITEM + qty per piece (ADR-193 phase 3a). Used on the Route Card
// (source of truth) and the Plan (prefilled snapshot). Only item types marked
// jobMaterial in ITEM_TYPE_RULES (Raw Material / Component) are offered; the
// server checks the same rule. Required on a Job Card = qty per piece × JC qty.
import { ITEM_TYPE_RULES, type ItemType } from '@innovic/shared';
import { useMemo, useState } from 'react';
import { useItemsList } from '@/modules/items/api';
import { SearchableSelect } from '@/ui/forms';

export interface RmItemValue {
  rawMaterialItemId: string | null;
  rawMaterialItemCode: string | null;
  /** Kept as typed text while editing; converted by rmItemToInput. */
  rmQtyPerPiece: string;
}

export function rmItemToInput(v: RmItemValue): {
  rawMaterialItemId: string | null;
  rmQtyPerPiece: number | null;
} {
  const q = Number(v.rmQtyPerPiece);
  return {
    rawMaterialItemId: v.rawMaterialItemId,
    rmQtyPerPiece: v.rawMaterialItemId && v.rmQtyPerPiece.trim() !== '' && q > 0 ? q : null,
  };
}

export function RmItemFields(props: {
  value: RmItemValue;
  onChange: (v: RmItemValue) => void;
  disabled?: boolean;
}): React.JSX.Element {
  const { value, onChange, disabled } = props;
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
  const isFetching = rm.isFetching || comp.isFetching;
  const options = useMemo(
    () =>
      all
        .filter((it) => ITEM_TYPE_RULES[it.itemType as ItemType]?.jobMaterial)
        .map((it) => ({ id: it.id, code: it.code, name: it.name })),
    [all],
  );
  return (
    <>
      <div className="form-grp">
        <label className="form-label">RM Item</label>
        <SearchableSelect
          id="rm-item"
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
          loading={isFetching}
          disabled={disabled}
          placeholder="🔍 Raw Material / Component item…"
          emptyText="No Raw Material / Component item"
        />
      </div>
      <div className="form-grp">
        <label className="form-label">RM Qty per piece</label>
        <input
          className="innovic-input mono"
          type="number"
          step="any"
          min={0}
          disabled={disabled || !value.rawMaterialItemId}
          value={value.rmQtyPerPiece}
          placeholder={value.rawMaterialItemId ? 'e.g. 0.25' : 'pick the RM item first'}
          onWheel={(e) => (e.target as HTMLInputElement).blur()}
          onChange={(e) => onChange({ ...value, rmQtyPerPiece: e.target.value })}
        />
      </div>
    </>
  );
}
