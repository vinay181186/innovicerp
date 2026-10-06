// Pickers for the Item Issue slip — Job Card, Assembly (Equipment) SO and the
// "Issued To" Production person — each a SearchableSelect.
import { useMemo, useState } from 'react';
import { soNoWithInternal } from '@/lib/so-number';
import { SearchableSelect } from '@/ui/forms';
import { useProductionUserOptions } from '../../production-users/api';
import { NO_SERVER_SEARCH, toProductionSearchOptions } from '../../production-users/options';
import { useJobCardsList } from '../../job-cards/api';
import { useOperatorsList } from '../../operators/api';
import { useSalesOrdersList } from '../../sales-orders/api';

interface PickerProps {
  id: string;
  value: string | null;
  onChange: (id: string | null) => void;
  /** Code of an already-set value that may sit beyond the first page (deep link). */
  valueLabel?: string | undefined;
}

export function JobCardPicker({ id, value, onChange, valueLabel }: PickerProps): React.JSX.Element {
  const [search, setSearch] = useState('');
  const { data, isFetching } = useJobCardsList({
    search: search.trim() || undefined,
    limit: 30,
    offset: 0,
  });
  const options = useMemo(
    () =>
      (data?.items ?? []).map((jc) => ({
        id: jc.id,
        code: jc.code,
        name: `${jc.itemCode} · ${jc.orderQty} pcs`,
      })),
    [data],
  );
  return (
    <SearchableSelect
      id={id}
      value={value}
      valueLabel={valueLabel}
      onChange={onChange}
      options={options}
      onSearch={setSearch}
      loading={isFetching}
      placeholder="🔍 Job Card no. or item code…"
      emptyText="No matching Job Card"
    />
  );
}

export function SalesOrderPicker({
  id,
  value,
  onChange,
  valueLabel,
}: PickerProps): React.JSX.Element {
  const [search, setSearch] = useState('');
  const { data, isFetching } = useSalesOrdersList({
    search: search.trim() || undefined,
    type: 'equipment',
    limit: 30,
    offset: 0,
  });
  const options = useMemo(
    () =>
      (data?.items ?? []).map((so) => ({
        id: so.id,
        code: soNoWithInternal(so.code, so.internalSoNo),
        name: so.customerName ?? '',
      })),
    [data],
  );
  return (
    <SearchableSelect
      id={id}
      value={value}
      valueLabel={valueLabel}
      onChange={onChange}
      options={options}
      onSearch={setSearch}
      loading={isFetching}
      placeholder="🔍 Equipment SO no. or customer…"
      emptyText="No matching Equipment SO"
    />
  );
}

export function OperatorPicker({
  id,
  value,
  onChange,
  valueLabel,
}: PickerProps): React.JSX.Element {
  const [search, setSearch] = useState('');
  const { data, isFetching } = useOperatorsList({
    search: search.trim() || undefined,
    isActive: true,
    limit: 30,
    offset: 0,
  });
  const options = useMemo(
    () => (data?.operators ?? []).map((o) => ({ id: o.id, code: o.code, name: o.name })),
    [data],
  );
  return (
    <SearchableSelect
      id={id}
      value={value}
      valueLabel={valueLabel}
      onChange={onChange}
      options={options}
      onSearch={setSearch}
      loading={isFetching}
      placeholder="🔍 Operator code or name…"
      emptyText="No matching operator"
    />
  );
}

// The "Issued To" box: Production people from Access Control (the logins that may
// make a Production entry), mirroring the QC "QC By" picker. The whole list comes
// in one small response, so the picker's own substring filter does the searching
// — no server ?search=. Same props as the other pickers (value = the user id).
export function ProductionUserPicker({
  id,
  value,
  onChange,
  valueLabel,
}: PickerProps): React.JSX.Element {
  const { data, isFetching } = useProductionUserOptions();
  const options = useMemo(
    () => toProductionSearchOptions(data?.options ?? []),
    [data],
  );
  return (
    <SearchableSelect
      id={id}
      value={value}
      valueLabel={valueLabel}
      onChange={onChange}
      options={options}
      onSearch={NO_SERVER_SEARCH}
      loading={isFetching}
      placeholder="🔍 Production person name…"
      emptyText="No matching person"
    />
  );
}
