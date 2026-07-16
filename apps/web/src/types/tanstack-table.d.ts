// Module augmentation for TanStack Table, shared by every list page.
//
// `tdClass` exists because legacy puts cell classes on the <td> itself, while
// `flexRender` only renders the cell's inner content — so a class like `td-ctr`
// set inside a cell renderer lands on a <span> and silently does nothing
// (`.td-ctr` is `text-align:center`, which needs a block container — see
// ISSUE-020). Column defs declare `meta: { tdClass }` and the list's flexRender
// loop applies it: <td className={cell.column.columnDef.meta?.tdClass}>.
//
// This declaration lives here, once. Do NOT re-declare it in a route file:
// it is a GLOBAL augmentation, so N copies only typecheck while every copy stays
// byte-identical, and the failure when one drifts is obscure. Four list pages had
// their own copy before this file existed.
//
// The `import type` is load-bearing: without a top-level import this .d.ts would
// not be a module, and `declare module` would REPLACE @tanstack/react-table's
// types instead of augmenting them.

import type { RowData } from '@tanstack/react-table';

declare module '@tanstack/react-table' {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  interface ColumnMeta<TData extends RowData, TValue> {
    /** Class applied to the rendered <td>, matching legacy's cell markup. */
    tdClass?: string;
  }
}
