// SortHeader — the click-to-sort column label that goes inside a <th>.
//
// Behaviour ported verbatim from `components/shared/sortable-th.tsx` (SortTh /
// nextSort): three-state cycle asc → desc → none, driven by the caller's sort
// state (normally URL search params) so SERVER-paginated lists re-query the API
// rather than sorting only the visible page. Glyphs are identical to
// `components/shared/sortable-head.tsx` on purpose — ▲ asc, ▼ desc, ↕ idle,
// var(--cyan) when active, 30% opacity when idle.
//
// This does NOT replace `sortable-head.tsx`. That one is the CLIENT-side
// TanStack Table model (getCanSort / getToggleSortingHandler) for grids whose
// rows are already loaded. The two sort models stay distinct — merging them
// breaks one or the other (audit/02-element-inventory.md §D.6).
//
// Why `SortDir` and `nextSort()` are DECLARED here and not imported from
// `components/shared/sortable-th.tsx`: this file SUPERSEDES that one
// (design-ref/README.md source mapping), and audit §D.5 records sortable-th.tsx
// as dead code with zero importers, to be deleted. Importing the helper from it
// would make the canonical library depend on the legacy file it replaces and
// keep that file alive. The duplication is resolved in the other direction, in
// the migration phase: sortable-th.tsx is deleted, or it imports `nextSort`
// from here. Until then these 6 lines are the canonical copy.

import type { CSSProperties, ReactElement, ReactNode } from 'react';

export type SortDir = 'asc' | 'desc';

export interface SortState<F extends string = string> {
  sortBy?: F | undefined;
  sortDir?: SortDir | undefined;
}

/**
 * Three-state toggle: clicking a new field sorts asc, the same field asc → desc,
 * and desc → unsorted. Pure — feed the result back into the caller's state.
 */
export function nextSort<F extends string>(field: F, current: SortState<F>): SortState<F> {
  if (current.sortBy !== field) return { sortBy: field, sortDir: 'asc' };
  if (current.sortDir === 'asc') return { sortBy: field, sortDir: 'desc' };
  return { sortBy: undefined, sortDir: undefined };
}

/** The `aria-sort` value a <th> should carry for this column. */
export function ariaSortValue(
  active: boolean,
  dir: SortDir | undefined,
): 'ascending' | 'descending' | 'none' {
  if (!active) return 'none';
  return dir === 'desc' ? 'descending' : 'ascending';
}

export interface SortHeaderProps {
  // `?: X | undefined` — the repo runs exactOptionalPropertyTypes.
  /** The column label. Normally a string; any node is allowed. */
  label: ReactNode;
  /** True when this column is the one currently sorted. */
  active?: boolean | undefined;
  /** Direction shown while active. Default `asc`. */
  dir?: SortDir | undefined;
  onSort?: (() => void) | undefined;
}

const WRAP_STYLE: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 'var(--sp-1)',
  cursor: 'pointer',
};

export function SortHeader({
  label,
  active = false,
  dir = 'asc',
  onSort,
}: SortHeaderProps): ReactElement {
  const glyphStyle: CSSProperties = {
    fontSize: 'var(--fs-xs)',
    opacity: active ? 1 : 0.3,
    color: active ? 'var(--cyan)' : 'inherit',
  };

  return (
    <span
      role="button"
      tabIndex={0}
      onClick={onSort}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onSort?.();
        }
      }}
      style={WRAP_STYLE}
    >
      {label}
      <span aria-hidden="true" style={glyphStyle}>
        {active ? (dir === 'desc' ? '▼' : '▲') : '↕'}
      </span>
    </span>
  );
}
