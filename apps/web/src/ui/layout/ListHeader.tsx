// ListHeader — the ONE header band at the top of every list / register page.
//
// Canonical list page: ListHeader → (StatStrip | StatusPills) → DataTable |
// DocCard list → ListFooter. ~97 screens hand-roll this band today; none may
// keep their own copy after migration.
//
// Anatomy — TWO rows, ERPNext style (owner decision 2026-09-26: "we already
// have filter dropdowns and still there are capsules, which makes the layout
// odd"):
//   sticky band on --bg
//   ├─ row 1 left  : .section-hdr title (module emoji first) + "N vendors · open only"
//   ├─ row 1 right : tools (view toggle / Export / secondary buttons) → ⟳ Updating… → primary
//   └─ row 2       : FILTER BAR — search → `filters` (every filter the same
//                    width) → Clear
//   children : anything else that belongs in the band (rare; NOT status
//              capsules — a status filter is a dropdown in `filters` whose
//              option labels carry the counts, e.g. "Open (40)").
//
// The search box is the shared SearchInput by default; a list with its own
// search control (debounced, server-driven, multi-field) passes `searchSlot`
// instead. Filter selects / date boxes go in `filters`, buttons in `tools`.
//
// The band itself (sticky rule, title row, children slot) is HeaderBand, shared
// with PageHeader so a list header and a form header cannot drift apart.

import type { ReactNode } from 'react';
import { SearchInput } from '../forms/SearchInput';
import { HeaderBand } from './header-band';

export interface ListHeaderProps {
  /** Page title, named after the paper document: "SO Master", "GRN (Goods Receipt)". */
  title: string;
  /** Module emoji from the nav, e.g. 🏭 — identity only, never a control icon. */
  icon?: string | undefined;
  /** Total matching records; omit to hide the count line. */
  count?: number | undefined;
  /** Singular noun for the count line: "order", "vendor", "GRN". */
  noun?: string | undefined;
  /** Plural when it is not noun + "s". */
  nounPlural?: string | undefined;
  /** Active filter, rendered as "· open only". */
  filterNote?: ReactNode | undefined;
  search?: string | undefined;
  onSearch?: ((v: string) => void) | undefined;
  searchPlaceholder?: string | undefined;
  /** Own search control — rendered instead of the built-in SearchInput. */
  searchSlot?: ReactNode | undefined;
  /** Shows the "⟳ Updating…" note while a background refetch runs. */
  updating?: boolean | undefined;
  /** Title-row controls: view toggle, Export, secondary buttons. NOT filters. */
  tools?: ReactNode | undefined;
  /** Filter-bar controls after the search box: Selects and date boxes. Each
   *  gets the same width (`.list-filterbar` in innovic-theme.css). */
  filters?: ReactNode | undefined;
  /** Shows "Clear" at the end of the filter bar; called to reset every filter
   *  (and the search). Pass it whenever the page has filters. */
  onClearFilters?: (() => void) | undefined;
  /** Enables Clear only while something is filtered. Default: enabled. */
  filtersActive?: boolean | undefined;
  /** Primary action button — always last, always btn-primary. */
  primary?: ReactNode | undefined;
  sticky?: boolean | undefined;
  /** StatStrip or StatusPills row. */
  children?: ReactNode | undefined;
}

export function ListHeader({
  title,
  icon,
  count,
  noun = 'record',
  nounPlural,
  filterNote,
  search,
  onSearch,
  searchPlaceholder = 'Search this list…',
  searchSlot,
  updating = false,
  tools,
  filters,
  onClearFilters,
  filtersActive = true,
  primary,
  sticky = true,
  children,
}: ListHeaderProps): React.JSX.Element {
  const plural = nounPlural ?? `${noun}s`;
  const searchBox =
    searchSlot ??
    (onSearch ? (
      <SearchInput value={search} onChange={onSearch} placeholder={searchPlaceholder} />
    ) : null);
  const hasBar = searchBox != null || filters != null || onClearFilters != null;
  return (
    <HeaderBand
      title={title}
      icon={icon}
      sticky={sticky}
      nowrapTitle
      under={
        count != null ? (
          <>
            {count} {count === 1 ? noun : plural}
            {filterNote ? (
              <>
                {' · '}
                <span className="text2">{filterNote}</span> only
              </>
            ) : null}
          </>
        ) : null
      }
      actions={
        <>
          {tools}
          {updating ? (
            <span
              className="text3"
              style={{ fontSize: 'var(--fs-xs)', fontFamily: 'var(--mono)', whiteSpace: 'nowrap' }}
            >
              ⟳ Updating…
            </span>
          ) : null}
          {primary}
        </>
      }
    >
      {hasBar ? (
        <div className="list-filterbar" role="search">
          {searchBox}
          {filters}
          {onClearFilters ? (
            <button
              type="button"
              className="btn btn-ghost"
              onClick={onClearFilters}
              disabled={!filtersActive}
            >
              Clear
            </button>
          ) : null}
        </div>
      ) : null}
      {children}
    </HeaderBand>
  );
}
