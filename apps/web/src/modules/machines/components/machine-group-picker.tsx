// The Machine Group picker used on the machine form — VMC, CNC, Lathe…
//
// It is the shared <SearchableSelect> (see the `searchable-field` skill), never a
// bare <select> or a hand-rolled datalist: type-to-search, opens on focus,
// scrolls, matches anywhere in the label, keyboard nav — all for free.
//
// The group master carries ONE value (`code` IS the name the shop floor reads),
// so the option renders that single word and no "CODE — Name" pair. Only ACTIVE
// groups are offered; a retired group stays readable on machines already linked
// to it because the caller passes the stored text as `valueLabel`.
//
// The first row of the list is an explicit "— None —", so a machine can be taken
// back to having no group at all. Picking it reports `null` — never `undefined`,
// which on a PATCH means "leave this field alone" and would silently do nothing.

import { useMemo, useState } from 'react';
import { SearchableSelect } from '@/components/shared/searchable-select';
import { useMachineGroupsList } from '../api';

// The picker only ever shows a page of matches for what was typed, so it stays
// well under the endpoint's 1000 cap (server-side search, per the skill).
const PICK_LIMIT = 50;

// Sentinel id for the "no group" row. Never sent anywhere — it is translated to
// null the moment it is picked.
const NONE_ID = '__none__';
const NONE_LABEL = '— None —';

export interface MachineGroupPickerProps {
  /** The selected group id, or null when the machine has no group. */
  valueId: string | null;
  /** The group text already stored on this machine — shown on an edit form
   *  before the page containing that row has loaded. */
  valueText?: string | null | undefined;
  /** Called with the picked group id, or `null` for "no group" — which the
   *  machine form must submit as null, not undefined. */
  onChange: (id: string | null) => void;
  disabled?: boolean | undefined;
  id?: string | undefined;
}

export function MachineGroupPicker({
  valueId,
  valueText,
  onChange,
  disabled,
  id,
}: MachineGroupPickerProps): React.JSX.Element {
  const [term, setTerm] = useState('');
  const list = useMachineGroupsList({
    ...(term.trim() ? { search: term.trim() } : {}),
    isActive: true,
    limit: PICK_LIMIT,
    offset: 0,
  });
  const options = useMemo(
    () => [
      { id: NONE_ID, name: NONE_LABEL },
      ...(list.data?.groups ?? []).map((g) => ({ id: g.id, name: g.code })),
    ],
    [list.data],
  );

  return (
    <SearchableSelect
      id={id}
      value={valueId}
      // The sentinel row and a cleared box both mean the same thing: no group.
      onChange={(picked) => onChange(picked === NONE_ID ? null : picked)}
      onSearch={setTerm}
      loading={list.isFetching}
      options={options}
      // One value, so the input shows the group itself — 'VMC', not 'VMC — VMC'.
      selectedLabel={(o) => o.name}
      valueLabel={valueText ?? undefined}
      placeholder="🔍 Machine group — type or browse…"
      emptyText="No machine groups — add them on the Machine Groups tab"
      disabled={disabled}
    />
  );
}
