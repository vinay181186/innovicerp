// The Grade and Size pickers, and the read-only display that replaces them.
//
// ADR-218: raw material has ONE author — the part's Route Card, or the BOM line
// for a BOM child. The PICKERS below are for those two screens. The four Plan
// screens now show the value through `MaterialValueDisplay` and cannot set it;
// the Job Card still carries a picker and is a later door to close.
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
  /** Needed where the picker sits in a TABLE CELL: the column header names the
   *  column, not the control, so without this a screen reader reads an unnamed
   *  combobox (BOM child lines). A form field with its own <label> omits it. */
  ariaLabel?: string | undefined;
}

export function MaterialGradePicker({
  valueId,
  valueText,
  onChange,
  disabled,
  id,
  ariaLabel,
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
      {...(ariaLabel ? { ariaLabel } : {})}
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
  ariaLabel,
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
      {...(ariaLabel ? { ariaLabel } : {})}
      placeholder="🔍 Size — type or browse…"
      emptyText="No sizes — add them in Raw Material Master"
      disabled={disabled}
    />
  );
}

/** ADR-218 — RM Grade / RM Size have exactly ONE author: the part's Route Card,
 *  or the BOM line for a BOM child. Every other screen SHOWS the value and
 *  cannot set it, so this is what the pickers are replaced with there: the
 *  stored value in a read-only box, or a quiet dash when there is none.
 *
 *  Read-only, not disabled: a read-only box keeps full-strength text (the value
 *  is there to be READ), and the grey fill alone says "not editable". */
export function MaterialValueDisplay({
  value,
  id,
  code,
}: {
  value: string | null | undefined;
  id?: string | undefined;
  /** The value is an item code — render it strong (mono, bold), as codes are
   *  rendered everywhere else in the app. */
  code?: boolean | undefined;
}): React.JSX.Element {
  const shown = value && value.trim() !== '' ? value : null;
  return (
    <input
      id={id}
      type="text"
      className={code && shown ? 'innovic-input mono fw-700' : 'innovic-input'}
      readOnly
      tabIndex={-1}
      value={shown ?? '—'}
      // Nothing set yet reads quiet; a real value reads at full strength.
      style={shown ? undefined : { color: 'var(--text3)' }}
    />
  );
}

/** The one line every screen that only DISPLAYS raw material carries, so the
 *  reader knows which screen owns the value (ADR-218). Both authors are named:
 *  a part takes it from its Route Card, a BOM child from its BOM line. */
export const RM_SOURCE_HELP =
  'From the Route Card — or the BOM line for a BOM child. Change it there.';

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
          fontSize: 11,
          fontWeight: 700,
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
