// Linked Task picker — the viewer's own open tasks / to-dos, from
// GET /day-logs/task-options (server-side search), through the shared
// SearchableSelect. Shows the task code in the box once picked.

import { useMemo, useState } from 'react';
import { SearchableSelect, type SearchableOption } from '@/components/shared/searchable-select';
import { useDayLogTaskOptions } from '../api';
import { taskCode } from '../lib/format';

export function TaskPicker({
  value,
  valueLabel,
  onChange,
  disabled,
  id,
}: {
  value: string | null;
  /** Label of the pre-filled task ("TSK-0042 · …"), for ▶ Continue. */
  valueLabel?: string | null | undefined;
  onChange: (id: string | null, label: string | null) => void;
  disabled?: boolean | undefined;
  id?: string | undefined;
}): React.JSX.Element {
  const [search, setSearch] = useState('');
  const q = useDayLogTaskOptions(search, !disabled);
  const options: SearchableOption[] = useMemo(
    () =>
      (q.data ?? []).map((o) => ({
        id: o.id,
        code: taskCode(o.label),
        name: o.label.split(' · ').slice(1).join(' · ') || o.label,
      })),
    [q.data],
  );
  return (
    <SearchableSelect
      id={id}
      ariaLabel="Linked Task"
      value={value}
      valueLabel={valueLabel ? taskCode(valueLabel) : undefined}
      selectedLabel={(o) => o.code ?? o.name}
      onChange={(v) => {
        const hit = (q.data ?? []).find((o) => o.id === v);
        onChange(v, hit?.label ?? null);
      }}
      options={options}
      onSearch={setSearch}
      loading={q.isFetching}
      error={q.error}
      placeholder="Linked Task (optional)"
      emptyText="No open task or to-do"
      disabled={disabled}
      clearable
    />
  );
}
