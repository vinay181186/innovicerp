// Click-to-sort column header (ISSUE-016). Ports legacy sTh()/sArr() behaviour
// to our server-paginated master lists: clicking a header cycles asc → desc →
// none, driving an `orderBy` on the API rather than sorting only the visible
// page. Render as a columnDef header: `header: () => <SortTh ... />`.

import type { ReactElement } from 'react';

export type SortDir = 'asc' | 'desc';

/** Three-state toggle used by list pages to update their sort search params. */
export function nextSort<F extends string>(
  field: F,
  current: { sortBy?: F | undefined; sortDir?: SortDir | undefined },
): { sortBy: F | undefined; sortDir: SortDir | undefined } {
  if (current.sortBy !== field) return { sortBy: field, sortDir: 'asc' };
  if (current.sortDir === 'asc') return { sortBy: field, sortDir: 'desc' };
  return { sortBy: undefined, sortDir: undefined };
}

export function SortTh<F extends string>({
  label,
  field,
  sortBy,
  sortDir,
  onSort,
}: {
  label: string;
  field: F;
  sortBy: F | undefined;
  sortDir: SortDir | undefined;
  onSort: (field: F) => void;
}): ReactElement {
  const active = sortBy === field;
  return (
    <span
      role="button"
      tabIndex={0}
      onClick={() => onSort(field)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onSort(field);
        }
      }}
      style={{ display: 'inline-flex', alignItems: 'center', gap: 4, cursor: 'pointer' }}
    >
      {label}
      <span
        aria-hidden
        style={{ fontSize: 9, opacity: active ? 1 : 0.3, color: active ? 'var(--cyan)' : 'inherit' }}
      >
        {active ? (sortDir === 'desc' ? '▼' : '▲') : '↕'}
      </span>
    </span>
  );
}
