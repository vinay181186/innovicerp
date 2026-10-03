// Public types of <DataTable>. Split out of DataTable.tsx (ADR-199, Phase 3)
// so the component, the classic renderer and the fit engine can share them
// without one file growing past the 400-line ceiling. DataTable.tsx re-exports
// every name here, so `import { type DataTableColumn } from '@/ui/data'` is
// unchanged for the screens.

import type { ReactNode } from 'react';

import type { RenderLink } from '../layout/link-slot';
import type { RowMenuItem } from './row-menu-logic';
import type { SortDir } from './SortHeader';
import type { ServerSortFilter } from './sort-filter/server-state';

// Every optional prop below is written `?: X | undefined` on purpose. The repo
// runs `exactOptionalPropertyTypes: true`, so a plain `?: X` REJECTS a caller
// that passes the prop with an explicit undefined — which is exactly what the
// 114 screens migrating onto this table will do (`className={cond ? 'x' :
// undefined}`). Widening keeps the prop optional and lets undefined through.

/**
 * What a column holds — drives the fit engine (ADR-199, `tableKey` tables):
 *   text    long prose; shares the spare width, cut with "…" + tooltip
 *   code    doc no. / item code — exact width, never cut
 *   num     qty / money — exact width, never cut, right-aligned
 *   date    exact width, never cut
 *   badge   status chip — exact width, never cut
 *   actions buttons — exact width, never cut
 *   control an in-cell input / picker (a qty field, a Vendor picker) — exact
 *           width, NEVER shares spare width, NEVER drops into ▸, never clipped
 *           (so a dropdown / popover is not cut off), and swallows the row click
 *           on its own (the cell applies stopRowClick without the caller setting
 *           it). Effectively force-pinned in the Columns menu — it cannot be
 *           hidden or unpinned.
 * Default: align 'right' -> num; ellipsis -> text; otherwise code.
 */
export type DataTableColumnKind =
  | 'text'
  | 'code'
  | 'num'
  | 'date'
  | 'badge'
  | 'actions'
  | 'control';

export interface DataTableColumn<T> {
  header: ReactNode;
  /** Field read off the row when `render` is not given. */
  key?: string | undefined;
  /**
   * Stable column identity for the saved layout (ADR-199). Falls back to
   * `key`. Must match /^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/ — a code name,
   * never a screen label, so renaming a header keeps the user's layout.
   */
  id?: string | undefined;
  /** Column kind for the fit engine — see DataTableColumnKind. */
  kind?: DataTableColumnKind | undefined;
  /**
   * Floor in px for the measured width (fit engine only). For cells whose
   * content has no width of its own, e.g. a thumbnail that fills its cell.
   */
  minWidth?: number | undefined;
  /** Plain-text column name for the Columns picker when `header` is not a string. */
  label?: string | undefined;
  render?: ((row: T, index: number) => ReactNode) | undefined;
  /** % width. Widths should sum to 100 (fixed layout). Ignored when autoWidth or tableKey. */
  width?: string | undefined;
  /** Cells are centred by default. left = names / free text, right = money. */
  align?: 'left' | 'center' | 'right' | undefined;
  /** Extra td classes, e.g. `td-code`, `mono fw-700`. */
  className?: string | undefined;
  /** Extra th classes. */
  headClassName?: string | undefined;
  /**
   * Header colour for qty semantics — a token only:
   * var(--green) Dispatched/Accepted, var(--red) Balance/Rejected, var(--purple) CPO.
   */
  headColor?: string | undefined;
  /** Makes the header sortable. Passed back through DataTable's `onSort`. */
  sortField?: string | undefined;
  /** Short values that must stay on one line (doc no., date, qty, code). */
  nowrap?: boolean | undefined;
  /** Long text: clip to one line with an ellipsis and a title tooltip. */
  ellipsis?: boolean | undefined;
  /** Tooltip text for this cell. Defaults to the raw `key` value when it is text. */
  title?: ((row: T) => string) | undefined;
  /**
   * Sort & Filter (ADR-200): the value this column is sorted and filtered by.
   * Without it the menu reads what the cell SHOWS (the `key` field, else the
   * rendered text). Give it where the shown text is not the useful value.
   */
  filterValue?: ((row: T) => string | number | Date | null | undefined) | undefined;
  /** Sort & Filter: `false` = this column has no ▾ (e.g. a picture). */
  filterable?: boolean | undefined;
  /**
   * Sort & Filter SERVER mode (`sortFilterServer` on the table): the field this
   * column sorts / filters by in the endpoint's column map. A column without
   * one has no ▾ in server mode (a figure worked out per row).
   */
  sortFilterField?: string | undefined;
  /** Server mode: the field's type — default from `kind` (num / date / badge→list / text). */
  filterType?: 'text' | 'num' | 'date' | 'list' | undefined;
  /** Server mode, `list` columns: the tick list (stored value + label shown). */
  filterOptions?: ReadonlyArray<{ value: string; label: string }> | undefined;
  /** Cell holds controls — swallow the click so it never opens the row. */
  stopRowClick?: boolean | undefined;
  /**
   * This column's totals-row cell (fit engine, with `showTotals`). A node, or a
   * function given ALL loaded rows so it can sum them. Rendered in a `<tfoot>`
   * that follows the visible columns — a column moved into ▸ simply does not
   * emit its total, so the total always stays under its own column. `num`
   * columns right-align it. The `firstId` column shows `totalsLabel` instead.
   */
  total?: ReactNode | ((rows: T[]) => ReactNode) | undefined;
}

export interface DataTableProps<T> {
  columns: DataTableColumn<T>[];
  rows: T[];
  /** Stable React key per row. Defaults to `row.id`, then the index. */
  rowKey?: ((row: T, index: number) => string | number) | undefined;

  /**
   * Turns on the fit engine (ADR-199): the table always fits its width, drops
   * the rightmost unpinned columns into a ▸ detail row when it cannot, and
   * shows the Columns / density toolbar. The key names the user's saved
   * layout — register it in ui/data/table-keys.ts. Without it the table
   * renders exactly as before.
   */
  tableKey?: string | undefined;
  /** Default pinned column ids (fit engine). Column 0 is always pinned. */
  defaultPinned?: string[] | undefined;
  /** Default hidden column ids (fit engine). */
  defaultHidden?: string[] | undefined;

  /* ---- modifiers ---- */
  /**
   * @deprecated No-op, kept so existing callers still compile. The first
   * column of EVERY table is pinned now (owner rule, ADR-199) — the stylesheet
   * does it for every `.tbl-wrap`, so there is nothing to switch on or off.
   */
  frozen?: boolean | undefined;
  /** `compact` = nested line table inside an expanded row / card. */
  density?: 'regular' | 'compact' | undefined;
  /** Cells hold inputs / selects. */
  editable?: boolean | undefined;
  /** Auto column widths + side scroll, for very wide registers. */
  autoWidth?: boolean | undefined;

  /* ---- behaviour ---- */
  onRowClick?: ((row: T, index: number) => void) | undefined;
  /**
   * Per-row gate on `onRowClick` (ADR-199). Return false for a row that must NOT
   * open — a cancelled line, a disabled record — and that row loses its click,
   * its pointer cursor and its clickable hover wash, while every other row stays
   * clickable. The row's ▸ detail toggle, its checkboxes / inputs and its
   * rowActions still work (they stop the row click already). No effect unless
   * `onRowClick` is set; defaults to clickable.
   */
  isRowClickable?: ((row: T, index: number) => boolean) | undefined;
  rowClassName?: ((row: T, index: number) => string | undefined) | undefined;
  /**
   * A group heading drawn as a full-width row BEFORE this row (ADR-203) —
   * e.g. "VMC-1 · 9 jobs · 12.5 h" above that machine's jobs, so a page shows
   * ONE table (one frozen header) instead of a table per group. Return null
   * for a row that continues the group above. `prev` is the row drawn just
   * before (undefined for the first row of the page). The heading row is not
   * a data row: no click, no tick-box, no ▸, no ⋯.
   */
  groupRow?: ((row: T, index: number, prev: T | undefined) => ReactNode) | undefined;
  /**
   * Content revealed IN PLACE under a row — a BOM's part list, a route card's
   * operation sequence. Return null/undefined for a row that is collapsed; the
   * caller owns the open/closed set and the ▸ chevron that toggles it.
   *
   * NOT in design-ref/components/data/DataTable.d.ts — a deliberate app
   * extension, for the same reason `footer` is one: bom-master and route-cards
   * both draw this today as a hand-written second <tr> with a colSpan cell, and
   * neither could move onto DataTable without it. DataTable supplies the <tr>
   * and the full-width <td>; the caller supplies only what goes inside.
   */
  renderExpanded?: ((row: T, index: number) => ReactNode) | undefined;
  /**
   * Fit engine (`tableKey`) only: the engine's ▸ is the ONE expand control on
   * a row. It opens the engine's detail AND calls this, so the caller can
   * open its own `renderExpanded` content for the same row. A caller with
   * renderExpanded must not draw a chevron of its own in a keyed table — a
   * hidden or dropped column would take it away.
   */
  onToggleExpanded?: ((row: T, index: number) => void) | undefined;
  /** Any CSS length — `400` (px) or `calc(100vh - 220px)`. Overrides .tbl-wrap. */
  maxHeight?: number | string | undefined;

  /* ---- sort (server-paginated model — see SortHeader) ---- */
  sortBy?: string | undefined;
  sortDir?: SortDir | undefined;
  onSort?: ((field: string) => void) | undefined;

  /* ---- row actions: rendered as the last column ---- */
  rowActions?: ((row: T, index: number) => ReactNode) | undefined;
  rowActionsHeader?: ReactNode | undefined;
  /**
   * The ONE ⋯ row menu (owner spec 2026-10-01): when set, the last column
   * shows a ⋯ button listing these items. Wins over `rowActions` if both are
   * given. The column header is empty (read aloud as "Actions").
   */
  rowMenu?: ((row: T, index: number) => RowMenuItem[]) | undefined;
  /** Accessible name of a row's ⋯ button, e.g. `Actions for line 3`. Every ⋯ is
   *  called "Actions" by default, which is right when the row is a document the
   *  screen names elsewhere. Give this when a screenful of rows is otherwise
   *  indistinguishable to a screen reader — or to a test — and the row has a
   *  number of its own to say. */
  rowMenuLabel?: ((row: T, index: number) => string) | undefined;
  /** How a `rowMenu` item's `to` becomes an SPA link: `(p) => <Link {...p} />`. */
  renderLink?: RenderLink | undefined;
  /** % width of the Action column. Default 10% — budget the caller's own
   *  widths to 90 so the colgroup still sums to 100 under table-layout:fixed. */
  rowActionsWidth?: string | undefined;

  /* ---- states ---- */
  loading?: boolean | undefined;
  /** Copy for the empty row. Ignored when `empty` is given. */
  emptyText?: string | undefined;
  /** Full replacement for the empty row's message. */
  empty?: ReactNode | undefined;

  /**
   * A totals / summary row rendered in a `<tfoot>` under the body.
   *
   * NOT in design-ref/components/data/DataTable.d.ts -- this is a deliberate
   * app extension. Three shipped screens already render a `<tfoot>` totals row
   * (stock-valuation/routes/page.tsx, delivery-challans/routes/detail.tsx,
   * backup/routes/page.tsx) and could not migrate onto DataTable without it.
   * Pass the `<tr>`(s) only; DataTable supplies the `<tfoot>`.
   */
  footer?: ReactNode | undefined;

  /* ---- totals row (fit engine, ADR-199 Wave B) ---- */
  /**
   * Draw a totals `<tfoot>` row that follows the VISIBLE columns: each column's
   * `total` is emitted under its own column and moves with it when the column
   * drops into ▸, so the row never drifts out of alignment (the raw `footer`
   * escape hatch could not do this). Replaces a hand-written tfoot.
   * If both `showTotals` and `footer` are set, `showTotals` wins (dev-warn).
   */
  showTotals?: boolean | undefined;
  /** Label shown in the first column's totals cell. Default "Total". */
  totalsLabel?: ReactNode | undefined;

  /* ---- row selection: tick-boxes + bulk actions (fit engine, Wave B) ---- */
  /**
   * Add a leading tick-box column + a select-all header tick, and show a bulk
   * action strip above the table while anything is selected. The CALLER owns
   * the selected set (like the server-sort model) — pass `selectedKeys` and the
   * toggle handlers. Keys are the same `rowKey` the table already uses. The
   * leading column lives OUTSIDE the layout / Columns menu, so it can never be
   * reordered, hidden or dropped.
   */
  selectable?: boolean | undefined;
  /** The keys of the currently selected rows (caller-owned). */
  selectedKeys?: ReadonlySet<string | number> | undefined;
  /** One row's tick toggled. `next` is its new checked state. */
  onToggleRow?: ((key: string | number, row: T, next: boolean) => void) | undefined;
  /** The select-all tick toggled. `keys` are every selectable row's key. */
  onToggleAll?: ((next: boolean, keys: (string | number)[]) => void) | undefined;
  /** Per-row gate: return false for a row that cannot be selected (no tick-box). */
  isRowSelectable?: ((row: T, index: number) => boolean) | undefined;
  /**
   * The bulk-action content for the selection strip, given the loaded rows that
   * are selected. Free-form — the caller supplies its own buttons. BULK only;
   * per-row "⋯" menus are not drawn here.
   */
  selectionActions?: ((selectedRows: T[]) => ReactNode) | undefined;

  /**
   * Sort & Filter (ADR-200). Default: on for a regular table on a page with a
   * scope — the rows given here are filtered and sorted in the browser. Pass
   * `false` for a table whose rows are not the whole list (a server page) or
   * that must keep its order (a line editor). Line editors (`editable`) and
   * nested `compact` tables are off by default.
   */
  sortFilter?: boolean | undefined;
  /**
   * Sort & Filter on the SERVER (paged / capped lists): the page owns the
   * state and sends it with its request (`useServerSortFilter`). Rows are
   * drawn as given; only columns with `sortFilterField` get a ▾.
   */
  sortFilterServer?: ServerSortFilter | undefined;

  className?: string | undefined;
  wrapClassName?: string | undefined;
  /** @deprecated `list` renders the retired unruled look — un-migrated screens only. */
  variant?: 'sheet' | 'list' | undefined;
}
