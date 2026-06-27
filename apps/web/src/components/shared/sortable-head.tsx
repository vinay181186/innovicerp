// Excel-style client-side sortable header row for TanStack data grids.
//
// Drop-in replacement for a list's hand-rolled `<thead>`: render
// `<SortableHead table={table} />` after enabling `getSortedRowModel()` on the
// table. Any column with a sort accessor (accessorKey / accessorFn) becomes
// clickable and cycles asc → desc → none, sorting the loaded rows in the
// browser. Columns with `enableSorting: false` (expanders, action buttons,
// in-header filters) render plain. The ▲▼/↕ indicator matches SortTh so the
// whole app feels consistent.

import { type Table, flexRender } from '@tanstack/react-table';
import type { ReactElement } from 'react';

export function SortableHead<T>({ table }: { table: Table<T> }): ReactElement {
  return (
    <thead>
      {table.getHeaderGroups().map((hg) => (
        <tr key={hg.id}>
          {hg.headers.map((header) => {
            const canSort = header.column.getCanSort();
            const sorted = header.column.getIsSorted(); // 'asc' | 'desc' | false
            return (
              <th
                key={header.id}
                onClick={canSort ? header.column.getToggleSortingHandler() : undefined}
                style={canSort ? { cursor: 'pointer', userSelect: 'none' } : undefined}
                aria-sort={sorted === 'asc' ? 'ascending' : sorted === 'desc' ? 'descending' : undefined}
              >
                {header.isPlaceholder ? null : (
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                    {flexRender(header.column.columnDef.header, header.getContext())}
                    {canSort ? (
                      <span
                        aria-hidden
                        style={{
                          fontSize: 9,
                          opacity: sorted ? 1 : 0.3,
                          color: sorted ? 'var(--cyan)' : 'inherit',
                        }}
                      >
                        {sorted === 'desc' ? '▼' : sorted === 'asc' ? '▲' : '↕'}
                      </span>
                    ) : null}
                  </span>
                )}
              </th>
            );
          })}
        </tr>
      ))}
    </thead>
  );
}
