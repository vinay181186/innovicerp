// The "Assembled By" box on the Assembly Tracker's Start panel: Planning people
// from Access Control (the logins that may make a Planning entry), mirroring the
// Production "Issued To" picker. The whole list comes in one small response, so
// the picker's own substring filter does the searching — no server ?search=.
// `value` is the chosen user id, or null while nobody is picked.
//
// It lives in the assembly module deliberately: the Production one was never
// lifted to a shared folder and that refactor is not part of this change.

import { useMemo } from 'react';
import { SearchableSelect } from '@/ui/forms';
import { usePlanningUserOptions } from '../../planning-users/api';
import { NO_SERVER_SEARCH, toPlanningSearchOptions } from '../../planning-users/options';

export function PlanningUserPicker({
  id,
  value,
  onChange,
  valueLabel,
}: {
  id: string;
  value: string | null;
  onChange: (id: string | null) => void;
  /** Name of an already-set value, for a row the list may not carry. */
  valueLabel?: string | undefined;
}): React.JSX.Element {
  const { data, isFetching } = usePlanningUserOptions();
  const options = useMemo(() => toPlanningSearchOptions(data?.options ?? []), [data]);
  return (
    <SearchableSelect
      id={id}
      value={value}
      valueLabel={valueLabel}
      onChange={onChange}
      options={options}
      onSearch={NO_SERVER_SEARCH}
      loading={isFetching}
      placeholder="🔍 Planning person name…"
      emptyText="No matching person"
    />
  );
}
