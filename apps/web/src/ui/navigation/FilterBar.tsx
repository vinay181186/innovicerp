// FilterBar — the register / board filter strip
// (design-ref/components/navigation/FilterBar.*), derived from the Task
// Board's TaskFilters (modules/tasks/components/board-filters.tsx, ADR-176).
//
// One panel holding the search box plus N dropdowns. The grid is
// "search 2fr + auto-fit filter columns", so the selects reflow onto a second
// row instead of squeezing: the search box never drops below --field-lg
// (224px, the token named for search/name fields) and each select never drops
// below --field-md (144px, the token named for filter selects).
//
// It composes the kit's own primitives rather than re-spelling their markup —
// SearchInput is THE one search box, Select is THE one native dropdown.
//
// House rule: the FIRST option of each select names the filter — "All Status",
// "All Priority", "Assigned By: All", "Due Date: All" — so a filter that is
// off still says what it filters.
//
// Presentational only: the caller owns every value and hands the setters down,
// so /__ui-kit can render it with no data fetch.

import { SearchInput } from '../forms/SearchInput';
import { Select, type SelectOption } from '../forms/Select';

export interface FilterDef {
  key: string;
  /** Current value, when the caller owns it. It must be one of `options`'
   *  values — for the plain-string shape that means the option text itself
   *  ("All Status"), NOT "". Omitted, the select is uncontrolled and rests on
   *  its first option, which by house rule is the filter-naming one. */
  value?: string;
  onChange?: (v: string) => void;
  /** A plain string is used as both value and label. */
  options: ReadonlyArray<string | SelectOption>;
  /** Accessible name — defaults to the first option's label, which by house
   *  rule already names the filter. */
  label?: string;
  disabled?: boolean;
}

export interface FilterBarProps {
  search?: string;
  onSearch?: (v: string) => void;
  placeholder?: string;
  /** Pause after the last keystroke before onSearch fires. */
  searchDebounceMs?: number;
  filters: FilterDef[];
  /** Extra controls (a reset button, a count) pinned after the selects. */
  children?: React.ReactNode;
}

function optLabel(o: string | SelectOption): string {
  return typeof o === 'string' ? o : o.label;
}

export function FilterBar({
  search,
  onSearch,
  placeholder = 'Search this list…',
  searchDebounceMs,
  filters,
  children,
}: FilterBarProps): React.JSX.Element {
  return (
    <div
      className="panel"
      style={{
        display: 'grid',
        gridTemplateColumns:
          'minmax(var(--field-lg), 2fr) repeat(auto-fit, minmax(var(--field-md), 1fr))',
        gap: 'var(--sp-2)',
        padding: 'var(--sp-2)',
        marginBottom: 'var(--panel-gap)',
      }}
    >
      <SearchInput
        value={search}
        onChange={onSearch}
        placeholder={placeholder}
        aria-label={placeholder}
        debounceMs={searchDebounceMs}
        width="full"
      />

      {filters.map((f) => {
        const first = f.options[0];
        const name = f.label ?? (first ? optLabel(first) : f.key);
        return (
          <Select
            key={f.key}
            aria-label={name}
            options={f.options}
            disabled={f.disabled ?? false}
            style={{ minWidth: 0 }}
            /* Controlled ONLY when the caller actually owns the value, which is
               what design-ref does (FilterBar.jsx: `value={f.value}`).
               Both accepted option shapes have to land on a real option:
                 • {value,label} — the Task Board shape, whose first option is
                   literally value="" ("All Status").
                 • plain string  — the shape FilterBar.prompt.md documents
                   (['All Status','To Do','In Progress']), where the first
                   option's value IS "All Status" and NO option has value "".
               An unconditional `value={f.value ?? ''}` forced selectedIndex to
               -1 for that second shape and the dropdown rendered BLANK — on
               /__ui-kit too, where no value is passed at all. Omitting the
               attribute instead leaves the select on its own first option, so
               an off filter still names itself and stays operable. */
            {...(f.value === undefined ? {} : { value: f.value })}
            onChange={(e) => f.onChange?.(e.target.value)}
          />
        );
      })}

      {children}
    </div>
  );
}
