// ListHeader — the ONE header band at the top of every list / register page.
//
// Canonical list page: ListHeader → (StatStrip | StatusPills) → DataTable |
// DocCard list → ListFooter. ~97 screens hand-roll this band today; none may
// keep their own copy after migration.
//
// Anatomy (design-ref/components/layout/ListHeader.jsx):
//   sticky band on --bg
//   ├─ left  : .section-hdr title (module emoji first) + "N vendors · open only"
//   └─ right : search → tools (filters / Export) → ⟳ Updating… → primary action
//   children : the StatStrip or StatusPills row, inside the sticky band
//
// The search box is the shared SearchInput by default; a list with its own
// search control (debounced, server-driven, multi-field) passes `searchSlot`
// instead. Filter selects always come in through `tools` — this component never
// owns a filter.
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
  /** Extra toolbar controls (filter Selects, Export) — placed after search. */
  tools?: ReactNode | undefined;
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
  primary,
  sticky = true,
  children,
}: ListHeaderProps): React.JSX.Element {
  const plural = nounPlural ?? `${noun}s`;
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
          {searchSlot ??
            (onSearch ? (
              <SearchInput value={search} onChange={onSearch} placeholder={searchPlaceholder} />
            ) : null)}
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
      {children}
    </HeaderBand>
  );
}
