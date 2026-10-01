// Public types of <DataTable>. Split out of DataTable.tsx (ADR-199, Phase 3)
// so the component, the classic renderer and the fit engine can share them
// without one file growing past the 400-line ceiling. DataTable.tsx re-exports
// every name here, so `import { type DataTableColumn } from '@/ui/data'` is
// unchanged for the screens.

import type { ReactNode } from 'react';

import type { SortDir } from './SortHeader';

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
 * Default: align 'right' -> num; ellipsis -> text; otherwise code.
 */
export type DataTableColumnKind = 'text' | 'code' | 'num' | 'date' | 'badge' | 'actions';

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
  /** Cell holds controls — swallow the click so it never opens the row. */
  stopRowClick?: boolean | undefined;
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
  rowClassName?: ((row: T, index: number) => string | undefined) | undefined;
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

  className?: string | undefined;
  wrapClassName?: string | undefined;
  /** @deprecated `list` renders the retired unruled look — un-migrated screens only. */
  variant?: 'sheet' | 'list' | undefined;
}
