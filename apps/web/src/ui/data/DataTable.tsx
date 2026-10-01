// DataTable — THE Innovic table (ADR-199, table standard 2026-10-01). One
// design for every list, register, nested line table and line editor: the
// ruled sheet `.innovic-table.tbl-grid`.
//
// The standard (innovic-theme.css owns the look):
//   2px --blue2 rules top & bottom - header Barlow Condensed 800 / 11px /
//   uppercase / --blue2 on --bg4, sticky - 1px --border gridlines - white rows
//   (the white comes from the table; body cells are see-through, only sticky /
//   pinned cells paint their own background) - --bg4 hover - 13px cells,
//   centred (names left, numbers right) - every row one line - the FIRST
//   column is always pinned (the stylesheet does it for every .tbl-wrap) -
//   Sr No / code first, Action last.
//
// Modifiers, never a different look:
//   autoWidth -> `.tbl-auto`     auto column widths + side scroll (wide registers)
//   density   -> `.tbl-compact`  nested line tables inside an expanded row
//   editable  -> `.tbl-edit`     inputs / selects in cells (line editors, routing)
//   frozen    -> obsolete no-op; the first column is always pinned now
//
// FIT ENGINE — pass `tableKey` (register it in ./table-keys.ts) and the table:
//   - always fits its width, no sideways scroll: columns are measured, text
//     columns share the spare room and are cut with "…" (hover shows it all),
//     codes / numbers / dates / badges / actions are never cut;
//   - moves the rightmost unpinned columns into a ▸ detail row when the
//     screen is too narrow (column 0 and the Action column never move);
//   - shows a toolbar: what moved, Comfortable | Compact (one user setting,
//     `body.density-compact`), and Columns ▾ (order, show / hide, 📌 pin);
//   - saves the layout and the density to the user's profile.
// See FitDataTable.tsx. Without `tableKey` the table renders as it always has.
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

import { Fragment } from 'react';
import type { CSSProperties, ReactElement } from 'react';

import { useTableDensity } from '@/lib/use-ui-settings';

import { PageState } from '../layout/PageState';
import { cellTitle, cellValue, cx, defaultRowKey, stopRowClick } from './data-table-cells';
import { headContent, tdClass, thAriaSort, thClass, thStyle } from './data-table-head';
import type { DataTableColumn, DataTableProps } from './data-table-types';
import { FitDataTable } from './FitDataTable';
import {
  RowCheckbox,
  SelectAllCheckbox,
  SelectionBar,
  selColWidth,
  useRowSelection,
} from './FitSelection';

export type { DataTableColumn, DataTableColumnKind, DataTableProps } from './data-table-types';
export { stopRowClick } from './data-table-cells';

export function DataTable<T>(props: DataTableProps<T>): ReactElement {
  const { tableKey } = props;
  if (tableKey !== undefined && props.variant !== 'list') {
    return <FitDataTable {...props} tableKey={tableKey} />;
  }
  return <ClassicDataTable {...props} />;
}

function ClassicDataTable<T>({
  columns,
  rows,
  rowKey,
  density = 'regular',
  editable = false,
  autoWidth = false,
  onRowClick,
  isRowClickable,
  rowClassName,
  renderExpanded,
  maxHeight,
  sortBy,
  sortDir,
  onSort,
  rowActions,
  rowActionsHeader = 'Action',
  rowActionsWidth = '10%',
  loading = false,
  footer,
  selectable = false,
  selectedKeys,
  onToggleRow,
  onToggleAll,
  isRowSelectable,
  selectionActions,
  emptyText = 'No records',
  empty,
  className,
  wrapClassName,
  variant = 'sheet',
}: DataTableProps<T>): ReactElement {
  const legacy = variant === 'list';
  const { density: userDensity } = useTableDensity();
  const keyOf = rowKey ?? defaultRowKey;
  const selection = useRowSelection({
    rows,
    keyOf,
    selectable,
    selectedKeys,
    isRowSelectable,
    onToggleRow,
    onToggleAll,
  });
  const selW = selectable ? selColWidth(userDensity) : 0;

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
    selectable && 'dt-has-sel',
    className,
  );
  const tableStyle: CSSProperties | undefined = selectable
    ? ({ '--dt-sel-w': `${selW}px` } as CSSProperties)
    : undefined;

  const hasRows = !loading && rows.length > 0;

  const wrapStyle: CSSProperties = {};
  if (maxHeight !== undefined) wrapStyle.maxHeight = maxHeight;
  // No `overflowX: hidden` any more: the sheet sizes columns to content
  // (auto layout, 2026-09-26), so a table wider than the screen must scroll
  // inside .tbl-wrap rather than clip its right-hand columns.

  const showColgroup = !autoWidth && (selectable || cols.some((c) => c.width !== undefined));
  const sort = { sortBy, sortDir, onSort };
  const spanCols = cols.length + (selectable ? 1 : 0);

  return (
    <>
      {selectable && selectionActions ? (
        <SelectionBar
          selectedCount={selection.selectedKeys.size}
          selectedRows={selection.selectedRows}
          actions={selectionActions}
        />
      ) : null}
      <div
        className={cx('tbl-wrap', wrapClassName)}
        style={Object.keys(wrapStyle).length > 0 ? wrapStyle : undefined}
      >
        <table className={tableClass} style={tableStyle}>
          {showColgroup ? (
            <colgroup>
              {selectable ? <col className="dt-sel-col" style={{ width: selW }} /> : null}
              {cols.map((c, i) => (
                <col key={i} style={c.width === undefined ? undefined : { width: c.width }} />
              ))}
            </colgroup>
          ) : null}

          <thead>
            <tr>
              {selectable ? (
                <th scope="col" className="dt-sel-col">
                  <SelectAllCheckbox
                    checked={selection.allSelected}
                    indeterminate={selection.someSelected}
                    disabled={selection.selectableKeys.length === 0}
                    onToggle={selection.toggleAll}
                  />
                </th>
              ) : null}
              {cols.map((c, i) => (
                <th
                  key={i}
                  scope="col"
                  className={thClass(c)}
                  style={thStyle(c)}
                  aria-sort={thAriaSort(c, sort)}
                >
                  {headContent(c, sort)}
                </th>
              ))}
            </tr>
          </thead>

          <tbody>
            {loading ? (
              <PageState as="row" state="loading" colSpan={spanCols} />
            ) : rows.length === 0 ? (
              <PageState as="row" state="empty" message={empty ?? emptyText} colSpan={spanCols} />
            ) : (
              rows.map((row, ri) => {
                const expanded = renderExpanded?.(row, ri);
                const clickable = !!onRowClick && (isRowClickable?.(row, ri) ?? true);
                const rk = keyOf(row, ri);
                const selected = selectable && selection.isSelected(rk);
                return (
                  <Fragment key={rk}>
                    <tr
                      className={cx(
                        rowClassName?.(row, ri),
                        selected && 'row-selected',
                        !!onRowClick && !clickable && 'dt-row-static',
                      )}
                      onClick={clickable ? () => onRowClick?.(row, ri) : undefined}
                      style={clickable ? { cursor: 'pointer' } : undefined}
                    >
                      {selectable ? (
                        <td className="dt-sel-col" onClick={stopRowClick}>
                          {selection.canSelect(row, ri) ? (
                            <RowCheckbox
                              checked={selected}
                              onToggle={() => selection.toggleRow(rk, row, ri)}
                            />
                          ) : null}
                        </td>
                      ) : null}
                      {cols.map((c, ci) => {
                        const tdStyle: CSSProperties = {};
                        if (c.ellipsis) {
                          tdStyle.overflow = 'hidden';
                          tdStyle.textOverflow = 'ellipsis';
                          tdStyle.whiteSpace = 'nowrap';
                        } else if (c.nowrap) {
                          tdStyle.whiteSpace = 'nowrap';
                        }
                        return (
                          <td
                            key={ci}
                            className={tdClass(c)}
                            style={Object.keys(tdStyle).length > 0 ? tdStyle : undefined}
                            title={cellTitle(c, row)}
                            onClick={c.stopRowClick ? stopRowClick : undefined}
                          >
                            {cellValue(c, row, ri)}
                          </td>
                        );
                      })}
                    </tr>
                    {/* The reveal is a second row spanning the whole sheet — it
                      is part of the row above it, so it never takes a row
                      click of its own. */}
                    {expanded ? (
                      <tr>
                        <td
                          colSpan={spanCols}
                          style={{ padding: 0, background: 'var(--bg3)', textAlign: 'left' }}
                        >
                          {expanded}
                        </td>
                      </tr>
                    ) : null}
                  </Fragment>
                );
              })
            )}
          </tbody>
          {footer && hasRows ? <tfoot>{footer}</tfoot> : null}
        </table>
      </div>
    </>
  );
}
