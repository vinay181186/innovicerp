// Pickers for the Item Issue slip — Job Card, Assembly (Equipment) SO and
// Operator — each a server-searched SearchableSelect.
import { useMemo, useState } from 'react';
import { SearchableSelect } from '@/ui/forms';
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
        code: so.code,
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
