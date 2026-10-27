// The SO / JWSO picker of a Work row (draft or edit): the shared
// type-to-search SearchableSelect over GET /day-logs/order-options. Shows the
// order code once picked; the list reads "IN-SO-00012 — SO-1045 · Customer".

import type { DayLogOrder } from '@innovic/shared';
import { useState } from 'react';
import { SearchableSelect } from '@/components/shared/searchable-select';
import { useDayLogOrderOptions } from '../api';

export function OrderSelect({
  value,
  onChange,
  disabled,
  id,
  fill = false,
}: {
  value: DayLogOrder | null;
  onChange: (o: DayLogOrder | null) => void;
  disabled?: boolean | undefined;
  id?: string | undefined;
  /** Fill the parent's width (My Day Log's sheet cell). */
  fill?: boolean | undefined;
}): React.JSX.Element {
  const [search, setSearch] = useState('');
  const orders = useDayLogOrderOptions(search);
  const options = (orders.data ?? []).map((o) => ({
    id: o.id,
    code: o.code,
    name: [o.ref, o.party].filter(Boolean).join(' · ') || (o.type === 'so' ? 'SO' : 'JWSO'),
  }));
  return (
    <div style={fill ? { width: '100%', minWidth: 0 } : { minWidth: 170 }}>
      <SearchableSelect
        id={id}
        ariaLabel="SO / JWSO"
        value={value?.id ?? null}
        valueLabel={value?.code}
        selectedLabel={(o) => o.code ?? o.name}
        options={options}
        onSearch={setSearch}
        loading={orders.isFetching}
        error={orders.error}
        placeholder={fill ? 'SO / JWSO' : 'SO / JWSO no. or customer'}
        disabled={disabled}
        clearable
        onChange={(pick) => {
          const o = orders.data?.find((x) => x.id === pick);
          onChange(o ? { type: o.type, id: o.id, code: o.code } : null);
        }}
      />
    </div>
  );
}
