// The Grade and Size pickers used on every screen that plans or raises work:
// SO/JW Planning's Edit Plan modal, the Plan form, and the Job Card form.
//
// Both are the shared <SearchableSelect> (see the `searchable-field` skill) —
// never a hand-rolled dropdown or a <datalist>. Both are OPTIONAL everywhere, so
// neither label carries a ★. They are INDEPENDENT: the size list is never
// filtered by the picked grade.
//
// On pick the caller receives BOTH the master id and the text snapshot, and
// stores both — the snapshot is what an old plan/JC still prints after a master
// row is renamed or deactivated. On clear, both go null.

import { useMemo, useState } from 'react';
import { SearchableSelect } from '@/components/shared/searchable-select';
import { useMaterialGradesList, useMaterialSizesList } from '../api';

// The picker only ever shows a page of matches for what was typed, so it stays
// well under the endpoint's 1000 cap (server-side search, per the skill).
const PICK_LIMIT = 50;

export interface RawMaterialPickerProps {
  valueId: string | null;
  /** The stored text snapshot — shown while the row isn't in the current page. */
  valueText: string | null;
  onChange: (id: string | null, text: string | null) => void;
  disabled?: boolean | undefined;
  id?: string | undefined;
}

export function MaterialGradePicker({
  valueId,
  valueText,
  onChange,
  disabled,
  id,
}: RawMaterialPickerProps): React.JSX.Element {
  const [term, setTerm] = useState('');
  const list = useMaterialGradesList({
    ...(term.trim() ? { search: term.trim() } : {}),
    isActive: true,
    limit: PICK_LIMIT,
    offset: 0,
  });
  const options = useMemo(
    () => (list.data?.grades ?? []).map((g) => ({ id: g.id, code: g.code, name: g.name })),
    [list.data],
  );

  return (
    <SearchableSelect
      id={id}
      value={valueId}
      onChange={(picked) => {
        const opt = options.find((o) => o.id === picked);
        onChange(picked, opt?.name ?? null);
      }}
      onSearch={setTerm}
      loading={list.isFetching}
      options={options}
      // The saved value is the grade itself ("EN24"), not "GRD-001 — EN24".
      selectedLabel={(o) => o.name}
      valueLabel={valueText ?? undefined}
      placeholder="🔍 Grade — type or browse…"
      emptyText="No grades — add them in Raw Material Master"
      disabled={disabled}
    />
  );
}

export function MaterialSizePicker({
  valueId,
  valueText,
  onChange,
  disabled,
  id,
}: RawMaterialPickerProps): React.JSX.Element {
  const [term, setTerm] = useState('');
  const list = useMaterialSizesList({
    ...(term.trim() ? { search: term.trim() } : {}),
    isActive: true,
    limit: PICK_LIMIT,
    offset: 0,
  });
  const options = useMemo(
    () => (list.data?.sizes ?? []).map((s) => ({ id: s.id, code: s.code, name: s.name })),
    [list.data],
  );

  return (
    <SearchableSelect
      id={id}
      value={valueId}
      onChange={(picked) => {
        const opt = options.find((o) => o.id === picked);
        onChange(picked, opt?.name ?? null);
      }}
      onSearch={setTerm}
      loading={list.isFetching}
      options={options}
      selectedLabel={(o) => o.name}
      valueLabel={valueText ?? undefined}
      placeholder="🔍 Size — type or browse…"
      emptyText="No sizes — add them in Raw Material Master"
      disabled={disabled}
    />
  );
}

/** The ⌐RAW MATERIAL┐ bracket that groups the two pickers into one visual unit
 *  on the plan forms, so Grade and Size read as one thing next to the dates
 *  rather than two loose boxes. Caption only — it adds no field of its own. */
export function RawMaterialGroup({ children }: { children: React.ReactNode }): React.JSX.Element {
  return (
    <div
      style={{
        border: '1px solid var(--border)',
        borderRadius: 'var(--radius)',
        padding: '8px 10px 10px',
        background: 'var(--bg3)',
        minWidth: 0,
      }}
    >
      <div
        className="text3"
        style={{
          fontSize: 9,
          fontWeight: 700,
          textTransform: 'uppercase',
          letterSpacing: '.08em',
          fontFamily: 'var(--mono)',
          marginBottom: 6,
        }}
      >
        Raw Material
      </div>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
          gap: 8,
        }}
      >
        {children}
      </div>
    </div>
  );
}
