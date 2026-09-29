// Type-to-search user picker for Assigned To / Reassign — the shared
// SearchableSelect over the board's user options. The option list is small
// (active users of one company) and arrives whole from /tasks/user-options,
// so the search term filters it here rather than round-tripping.

import type { TaskUserOption } from '@innovic/shared';
import { useMemo, useState } from 'react';
import { SearchableSelect } from '@/components/shared/searchable-select';
import { roleLabel } from '@/lib/role-label';

export function UserPicker({
  users,
  value,
  onChange,
  loading = false,
  placeholder = 'Select User',
  excludeId,
}: {
  users: TaskUserOption[];
  value: string | null;
  onChange: (id: string | null) => void;
  loading?: boolean | undefined;
  placeholder?: string | undefined;
  /** Hide one user (Reassign hides the current assignee). */
  excludeId?: string | null | undefined;
}): React.JSX.Element {
  const [term, setTerm] = useState('');
  const options = useMemo(() => {
    const t = term.trim().toLowerCase();
    return users
      .filter((u) => u.id !== excludeId)
      .filter(
        (u) => !t || `${u.name} ${u.role ?? ''} ${u.mainDept ?? ''}`.toLowerCase().includes(t),
      )
      .map((u) => ({
        id: u.id,
        name: u.role ? `${u.name} (${roleLabel(u.role)})` : u.name,
        searchText: u.mainDept,
      }));
  }, [users, term, excludeId]);
  const current = users.find((u) => u.id === value);
  return (
    <SearchableSelect
      value={value}
      valueLabel={
        current
          ? current.role
            ? `${current.name} (${roleLabel(current.role)})`
            : current.name
          : undefined
      }
      options={options}
      onSearch={setTerm}
      loading={loading}
      placeholder={placeholder}
      onChange={onChange}
    />
  );
}
