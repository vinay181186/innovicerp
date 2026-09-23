// DataTable — THE Innovic table. One design for every list, register, nested
// line table and line editor: the ruled sheet `.innovic-table.tbl-grid`.
//
// Differences between tables are MODIFIERS, never a different look:
//   frozen    -> `.tbl-wrap.tbl-frozen`  pin the first column while scrolling sideways
//   autoWidth -> `.tbl-auto`             auto column widths + side scroll (wide registers)
//   density   -> `.tbl-compact`          nested line tables inside an expanded row
//   editable  -> `.tbl-edit`             inputs / selects in cells (line editors, routing)
//
// Fixed by the design (innovic-theme.css owns all of it):
//   2px --blue2 rules top & bottom - header Barlow Condensed 800 / 11px /
//   uppercase / --blue2 on --bg4, sticky - 1px --border2 gridlines - cream
//   (--sheet-cream) / white alternating rows - --bg4 hover - 13px cells, centred
//   (names left, money right) - Sr No first, Action last.
//
// WHAT THIS COMPONENT DOES NOT OWN — the canonical LIST composition is
//   ListHeader -> StatStrip|StatusPills -> DataTable -> ListFooter
// (design-ref/README.md "Uniformity rule"). Everything UNDER the table belongs
// to `ui/layout/ListFooter`: the count line ("Showing all 23 sales orders",
// "Showing first 1000 of 1240 — refine with search", the Prev/Next pager) and
// the 💡 interaction hint. This table used to draw its own copies of both — and
// its own, drifted, count-line wording — so a screen following the template
// rendered each of them twice. Pass `hint` and the counts to <ListFooter>
// instead; it is the one place that copy lives.
//
// Loading and empty are STATES OF THIS TABLE, drawn by the one state component
// `ui/feedback/PageState` (`as="row"`), so a table's "⟳ Loading…" and its empty
// line read exactly like every other surface's.
//
// Pure presentation: every input is a prop, so the component renders in every
// state without a data fetch.

import { isValidElement } from 'react';
import type { CSSProperties, MouseEvent, ReactElement, ReactNode } from 'react';

import { PageState } from '../layout/PageState';
import { SortHeader, ariaSortValue, type SortDir } from './SortHeader';

// Every optional prop below is written `?: X | undefined` on purpose. The repo
// runs `exactOptionalPropertyTypes: true`, so a plain `?: X` REJECTS a caller
// that passes the prop with an explicit undefined — which is exactly what the
// 114 screens migrating onto this table will do (`className={cond ? 'x' :
// undefined}`). Widening keeps the prop optional and lets undefined through.

export interface DataTableColumn<T> {
  header: ReactNode;
  /** Field read off the row when `render` is not given. */
  key?: string | undefined;
  render?: ((row: T, index: number) => ReactNode) | undefined;
  /** % width. Widths should sum to 100 (fixed layout). Ignored when autoWidth. */
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

  /* ---- modifiers ---- */
  /** Pin the first column while the table scrolls sideways. */
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

/** Stop a click on an in-row control from also firing the row's `onRowClick`. */
export function stopRowClick(e: MouseEvent): void {
  e.stopPropagation();
}

function cx(...parts: Array<string | false | undefined>): string | undefined {
  const out = parts.filter(Boolean).join(' ');
  return out.length > 0 ? out : undefined;
}

function readField<T>(row: T, key: string): unknown {
  return (row as unknown as Record<string, unknown>)[key];
}

function cellValue<T>(col: DataTableColumn<T>, row: T, index: number): ReactNode {
  if (col.render) return col.render(row, index);
  if (col.key === undefined) return null;
  const v = readField(row, col.key);
  if (v === null || v === undefined) return null;
  if (typeof v === 'string' || typeof v === 'number') return v;
  // React renders a boolean as nothing — say so, rather than printing "false".
  if (typeof v === 'boolean') return null;
  if (isValidElement(v)) return v;
  // A Date or a plain object handed in as a column value would throw "Objects
  // are not valid as a React child" and take the page down; show its text.
  return String(v);
}

function cellTitle<T>(col: DataTableColumn<T>, row: T): string | undefined {
  if (col.title) return col.title(row);
  if (!col.ellipsis || col.key === undefined) return undefined;
  const v = readField(row, col.key);
  return typeof v === 'string' || typeof v === 'number' ? String(v) : undefined;
}

function defaultRowKey<T>(row: T, index: number): string | number {
  const id = row !== null && typeof row === 'object' ? readField(row, 'id') : undefined;
  return typeof id === 'string' || typeof id === 'number' ? id : index;
}

export function DataTable<T>({
  columns,
  rows,
  rowKey,
  frozen = false,
  density = 'regular',
  editable = false,
  autoWidth = false,
  onRowClick,
  rowClassName,
  maxHeight,
  sortBy,
  sortDir,
  onSort,
  rowActions,
  rowActionsHeader = 'Action',
  rowActionsWidth = '10%',
  loading = false,
  footer,
  emptyText = 'No records',
  empty,
  className,
  wrapClassName,
  variant = 'sheet',
}: DataTableProps<T>): ReactElement {
  const legacy = variant === 'list';

  const cols: Array<DataTableColumn<T>> = rowActions
    ? [
        ...columns,
        {
          header: rowActionsHeader,
          // Always a width: under `table-layout: fixed`, a width-less <col>
          // beside sized ones resolves to 0 and the Action column collapses.
          width: rowActionsWidth,
          nowrap: true,
          stopRowClick: true,
          render: (row: T, index: number) => rowActions(row, index),
        },
      ]
    : columns;

  const tableClass = cx(
    'innovic-table',
    !legacy && 'tbl-grid',
    density === 'compact' && 'tbl-compact',
    editable && 'tbl-edit',
    autoWidth && 'tbl-auto',
    className,
  );

  // A loading or empty table is ONE full-width cell. `.tbl-frozen` makes
  // `tbody td:first-child` sticky at left:0 with the pinned-column drop shadow
  // (innovic-theme.css), which would pin that message to the left edge instead
  // of centring it across the sheet — and there is no first column to pin.
  const hasRows = !loading && rows.length > 0;
  const pinFirstCol = frozen && hasRows;

  const wrapStyle: CSSProperties = {};
  if (maxHeight !== undefined) wrapStyle.maxHeight = maxHeight;
  if (!autoWidth && !pinFirstCol) wrapStyle.overflowX = 'hidden';

  const showColgroup = !autoWidth && cols.some((c) => c.width !== undefined);
  const keyOf = rowKey ?? defaultRowKey;

  return (
    <div
      className={cx('tbl-wrap', pinFirstCol && 'tbl-frozen', wrapClassName)}
      style={Object.keys(wrapStyle).length > 0 ? wrapStyle : undefined}
    >
      <table className={tableClass}>
        {showColgroup ? (
          <colgroup>
            {cols.map((c, i) => (
              <col key={i} style={c.width === undefined ? undefined : { width: c.width }} />
            ))}
          </colgroup>
        ) : null}

        <thead>
          <tr>
            {cols.map((c, i) => {
              const field = c.sortField;
              const sortable = onSort !== undefined && field !== undefined;
              const active = sortable && sortBy === field;
              return (
                <th
                  key={i}
                  scope="col"
                  className={cx(
                    c.align === 'left' && 'th-left',
                    c.align === 'right' && 'th-right',
                    c.headClassName,
                  )}
                  style={c.headColor === undefined ? undefined : { color: c.headColor }}
                  aria-sort={sortable ? ariaSortValue(active, sortDir) : undefined}
                >
                  {sortable && field !== undefined && onSort !== undefined ? (
                    <SortHeader
                      label={c.header}
                      active={active}
                      dir={sortDir ?? 'asc'}
                      onSort={() => onSort(field)}
                    />
                  ) : (
                    c.header
                  )}
                </th>
              );
            })}
          </tr>
        </thead>

        <tbody>
          {loading ? (
            <PageState as="row" state="loading" colSpan={cols.length} />
          ) : rows.length === 0 ? (
            <PageState as="row" state="empty" message={empty ?? emptyText} colSpan={cols.length} />
          ) : (
            rows.map((row, ri) => (
              <tr
                key={keyOf(row, ri)}
                className={cx(rowClassName?.(row, ri))}
                onClick={onRowClick ? () => onRowClick(row, ri) : undefined}
                style={onRowClick ? { cursor: 'pointer' } : undefined}
              >
                {cols.map((c, ci) => {
                  const tdStyle: CSSProperties = {};
                  if (c.ellipsis) {
                    tdStyle.overflow = 'hidden';
                    tdStyle.textOverflow = 'ellipsis';
                    tdStyle.whiteSpace = 'nowrap';
                  } else if (c.nowrap) {
                    tdStyle.whiteSpace = 'nowrap';
                  }
                  const title = cellTitle(c, row);
                  return (
                    <td
                      key={ci}
                      className={cx(
                        c.className,
                        c.align === 'left' && 'td-left',
                        c.align === 'right' && 'td-num',
                      )}
                      style={Object.keys(tdStyle).length > 0 ? tdStyle : undefined}
                      title={title}
                      onClick={c.stopRowClick ? stopRowClick : undefined}
                    >
                      {cellValue(c, row, ri)}
                    </td>
                  );
                })}
              </tr>
            ))
          )}
        </tbody>
        {footer && hasRows ? <tfoot>{footer}</tfoot> : null}
      </table>
    </div>
  );
}
