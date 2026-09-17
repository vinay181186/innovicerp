// <PlanPicker> — the Plan field on the Create / Close Production Order screens.
// Same shape as components/shared/vendor-picker.tsx with the hook swapped:
// owns its search state, server-searched via /plans?search=, hands the caller
// the picked plan ROW (not just the id) so the screen can show its summary.
//
//   mode 'create' → plans waiting for a Production Order (`poPending=true`)
//   mode 'close'  → route-card-driven plans that already HAVE one
//                   (`opsSource=route_card`, kept when productionOrderId is set)

import { useState } from 'react';
import { SearchableSelect } from '@/components/shared/searchable-select';
import { type PlanPickerItem, planPickerLabel, usePlanPickerList } from '../api';

export interface PlanPickerProps {
  id?: string | undefined;
  mode: 'create' | 'close';
  value: string | null;
  onChange: (plan: PlanPickerItem | null) => void;
  disabled?: boolean | undefined;
  labelText?: string | undefined;
  error?: string | undefined;
}

export function PlanPicker({
  id = 'planId',
  mode,
  value,
  onChange,
  disabled = false,
  labelText = 'Plan',
  error,
}: PlanPickerProps): React.JSX.Element {
  const [search, setSearch] = useState('');
  const { data, isFetching } = usePlanPickerList(
    mode === 'create'
      ? {
          poPending: true,
          ...(search.trim() ? { search: search.trim() } : {}),
          limit: 50,
          offset: 0,
        }
      : {
          // Plans with an OPEN Production Order — filtered on the server so an
          // old plan is never cut off by the page size.
          derivedStatus: 'in_production',
          ...(search.trim() ? { search: search.trim() } : {}),
          limit: 50,
          offset: 0,
        },
  );
  const items = data?.items ?? [];
  const plans = mode === 'close' ? items.filter((p) => p.productionOrderId !== null) : items;

  // Held separately so the picked plan still reads correctly once it scrolls
  // out of the current search page.
  const [label, setLabel] = useState('');
  const selected = plans.find((p) => p.id === value);

  return (
    <div className="form-grp">
      <label className="form-label" htmlFor={id}>
        {labelText}
        <span className="req">★</span>
      </label>
      <SearchableSelect
        id={id}
        value={value}
        onChange={(next) => {
          const p = plans.find((x) => x.id === next) ?? null;
          setLabel(p ? planPickerLabel(p) : '');
          onChange(p);
        }}
        onSearch={setSearch}
        loading={isFetching}
        disabled={disabled}
        options={plans.map((p) => ({
          id: p.id,
          code: p.code,
          name: planPickerLabel(p).slice(p.code.length + 3),
          searchText: [p.productionOrderCode, p.jcCode].filter(Boolean).join(' '),
        }))}
        placeholder={
          mode === 'create'
            ? '🔍 Type plan no, item code or SO no…'
            : '🔍 Type plan no, PO no, item or SO no…'
        }
        valueLabel={selected ? planPickerLabel(selected) : label || undefined}
        emptyText={
          mode === 'create'
            ? 'No plan is waiting for a Production Order'
            : 'No plan with a Production Order matches'
        }
      />
      {error ? <div className="form-error">{error}</div> : null}
    </div>
  );
}
