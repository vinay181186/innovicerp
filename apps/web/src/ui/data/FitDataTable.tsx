// The fit engine (ADR-199, table standard) — what <DataTable tableKey="…">
// renders. Ported from Table-Standard-Prototype.html:
//   R1 every row is one line; text columns share the spare width and are cut
//      with "…" (the app-wide cell-overflow-title helper adds the tooltip);
//      codes / numbers / dates / badges / actions get their exact measured
//      width — over ALL rows — and are never cut.
//   R2 the table always fits its wrapper — no sideways scroll. When the
//      minimum widths do not fit, the rightmost unpinned column leaves the
//      screen and the toolbar names it ("not on screen").
//   R3 no ▸ on any row (owner 2026-10-31): a cut cell shows its full text on
//      hover; the caller's renderExpanded content opens only by the caller's
//      own trigger (row click, ⋯ item).
//   R4/R5 the toolbar + Columns popover; R6 the layout and density are saved
//      to the user's profile; R8 the Action column is always last and kept.
// Measuring lives in use-fit-measure.ts, the body rows in FitRows.tsx.

import { Children, cloneElement, isValidElement, useLayoutEffect, useMemo } from 'react';
import type { CSSProperties, ReactElement, ReactNode } from 'react';

import { useTableLayout } from '@/lib/use-table-layout';
import { useTableDensity } from '@/lib/use-ui-settings';

import { PageState } from '../layout/PageState';
import { ColumnMeasurer } from './ColumnMeasurer';
import { colId, colKind, colLabel, cx, defaultRowKey } from './data-table-cells';
import { FitFoot } from './data-table-foot';
import { headContent, thAriaSort, thClass, thStyle } from './data-table-head';
import type { DataTableColumnKind, DataTableProps } from './data-table-types';
import { canPin as canPinFn, fitColumns, type FitInput } from './fit-layout';
import { FitRows } from './FitRows';
import { SelectAllCheckbox, SelectionBar, useRowSelection } from './FitSelection';
import { lockedLeadIds } from './lead-columns';
import { TableToolbar } from './TableToolbar';
import { useFitMeasure } from './use-fit-measure';
import './data-table-fit.css';

export function FitDataTable<T>(props: DataTableProps<T> & { tableKey: string }): ReactElement {
  const {
    tableKey,
    columns,
    rows,
    rowKey,
    density: densityProp = 'regular',
    editable = false,
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
    loading = false,
    footer,
    showTotals = false,
    totalsLabel = 'Total',
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
    defaultPinned,
    defaultHidden,
  } = props;

  // `showTotals` is the aligned totals row; `footer` is the legacy raw-tfoot
  // escape hatch. Both at once is a mistake — `showTotals` wins.
  if (import.meta.env.DEV && showTotals && footer) {
    console.warn('[DataTable] `showTotals` and `footer` are both set; `showTotals` wins.');
  }

  const ids = useMemo(() => columns.map((c, i) => colId(c, i)), [columns]);
  const firstId = ids[0] ?? 'col-0';
  const byId = useMemo(
    () => new Map(columns.map((c, i) => [ids[i] ?? `col-${i}`, c])),
    [columns, ids],
  );
  const kinds = useMemo(() => {
    const out: Record<string, DataTableColumnKind> = {};
    columns.forEach((c, i) => (out[ids[i] ?? `col-${i}`] = colKind(c)));
    return out;
  }, [columns, ids]);

  // The six lead columns (ui/data/lead-columns.tsx) are one locked block.
  const leadIds = useMemo(
    () => (columns[0]?.lead ? lockedLeadIds(columns, ids) : []),
    [columns, ids],
  );
  const layout = useTableLayout(tableKey, ids, {
    pins: defaultPinned,
    hidden: defaultHidden,
    locked: leadIds,
  });
  const { density, setDensity } = useTableDensity();

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

  const tableClass = cx(
    'innovic-table',
    'tbl-grid',
    densityProp === 'compact' && 'tbl-compact',
    editable && 'tbl-edit',
    selectable && 'dt-has-sel',
    className,
  );
  const measure = useFitMeasure({
    columns,
    ids,
    kinds,
    rows,
    hasActions: rowActions !== undefined,
    selectable,
    density,
    styleKey: [density, tableClass, sortBy, sortDir].join('|'),
  });
  const { widths, avail, actionsW, selW } = measure;

  const fitInput: FitInput | null =
    widths && avail > 0
      ? {
          order: layout.order,
          pins: layout.pins,
          hidden: layout.hidden,
          firstId,
          kinds,
          widths,
          avail,
          actionsW,
          selW,
          locked: leadIds,
        }
      : null;
  // Cheap (one pass over at most 80 columns) — no memo needed.
  const fit = fitInput ? fitColumns(fitInput) : null;
  const visible = fit?.visible ?? layout.order.filter((k) => !layout.hidden.includes(k));
  const dropped = fit?.dropped ?? [];

  // After every draw: if a never-cut cell (code / num / date / badge /
  // actions) overflows, its content changed since it was measured — ask for
  // one re-measure (use-fit-measure caps it at one per measurement input).
  const { wrapRef, requestRemeasure } = measure;
  useLayoutEffect(() => {
    const table = wrapRef.current?.querySelector('table');
    if (!fit || !table) return;
    const cells = table.querySelectorAll<HTMLElement>(
      ':scope > tbody > tr > td.dt-k-code, :scope > tbody > tr > td.dt-k-num, :scope > tbody > tr > td.dt-k-date, :scope > tbody > tr > td.dt-k-badge, :scope > tbody > tr > td.dt-k-actions',
    );
    for (const td of cells) {
      if (td.scrollWidth > td.clientWidth + 1) {
        requestRemeasure();
        return;
      }
    }
  });

  // Spare width once every column shows its full content (fit-layout `fill`).
  // No data column takes it: the Action column does, with ⋯ kept at its left
  // edge — so ⋯ sits next to the last data column and the empty space trails
  // after it. A table with no Action column gets an empty trailing cell of
  // that width instead, so the sheet (header line, row lines, row colour)
  // still runs edge to edge while every data column stays tight.
  const fill = fit?.fill ?? 0;
  const spare = fill > 0 && !rowActions;
  const nCols = visible.length + (rowActions ? 1 : 0) + (selectable ? 1 : 0) + (spare ? 1 : 0);
  const hasRows = !loading && rows.length > 0;
  const wrapStyle: CSSProperties | undefined = maxHeight !== undefined ? { maxHeight } : undefined;
  const sort = { sortBy, sortDir, onSort };
  const pickerCols = ids.map((id, i) => ({
    id,
    label: colLabel(columns[i] ?? { header: '' }, i),
    // A `control` column is force-pinned by its kind: not hide-able, not
    // unpinnable — the Columns menu treats it like the always-first column.
    control: kinds[id] === 'control',
    lead: leadIds.includes(id),
  }));
  const canPin = (id: string) => (fitInput ? canPinFn(fitInput, id) : true);
  // Pins the data first column just after the tick-box column (see the sticky
  // re-scope in innovic-theme.css for `.dt-has-sel`).
  const tableStyle: CSSProperties = {
    ...(selectable ? ({ '--dt-sel-w': `${selW}px` } as CSSProperties) : {}),
  };

  return (
    <div className="dt-fit-root">
      {selectable && selectionActions ? (
        <SelectionBar
          selectedCount={selection.selectedKeys.size}
          selectedRows={selection.selectedRows}
          actions={selectionActions}
        />
      ) : null}
      <TableToolbar
        columns={pickerCols}
        layout={layout}
        firstId={firstId}
        lockedCount={Math.max(1, leadIds.length)}
        dropped={dropped}
        warn={fit?.warn ?? false}
        canPin={canPin}
        onOp={layout.apply}
        density={density}
        onDensity={setDensity}
        saveFailed={layout.saveFailed}
        onRetrySave={layout.retrySave}
        loadFailed={layout.loadFailed}
        onRetryLoad={layout.retryLoad}
      />
      <div
        ref={measure.wrapRef}
        className={cx('tbl-wrap', 'dt-fit-wrap', wrapClassName)}
        style={wrapStyle}
      >
        <table
          className={cx(
            tableClass,
            'dt-fit',
            !fit && 'dt-fit-pending',
            fill > 0 && rowActions && 'dt-act-fill',
          )}
          style={tableStyle}
        >
          {fit ? (
            <colgroup>
              {selectable ? <col className="dt-sel-col" style={{ width: selW }} /> : null}
              {visible.map((k) => (
                <col key={k} style={{ width: fit.w[k] }} />
              ))}
              {rowActions ? <col style={{ width: actionsW + fill }} /> : null}
              {spare ? <col style={{ width: fill }} /> : null}
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
              {visible.map((k) => {
                const c = byId.get(k);
                if (!c) return null;
                return (
                  <th
                    key={k}
                    scope="col"
                    className={thClass(c)}
                    style={thStyle(c)}
                    aria-sort={thAriaSort(c, sort)}
                  >
                    {headContent(c, sort)}
                    {k !== firstId && layout.pins.includes(k) ? (
                      <span className="dt-pin-mark" aria-label="pinned">
                        📌
                      </span>
                    ) : null}
                  </th>
                );
              })}
              {rowActions ? <th scope="col">{rowActionsHeader}</th> : null}
              {spare ? <th className="dt-spare" aria-hidden="true" /> : null}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <PageState as="row" state="loading" colSpan={nCols} />
            ) : rows.length === 0 ? (
              <PageState as="row" state="empty" message={empty ?? emptyText} colSpan={nCols} />
            ) : (
              <FitRows
                rows={rows}
                keyOf={keyOf}
                byId={byId}
                kinds={kinds}
                visible={visible}
                nCols={nCols}
                onRowClick={onRowClick}
                isRowClickable={isRowClickable}
                rowClassName={rowClassName}
                groupRow={props.groupRow}
                renderExpanded={renderExpanded}
                rowActions={rowActions}
                selectable={selectable}
                selection={selection}
                spare={spare}
              />
            )}
          </tbody>
          {showTotals && hasRows ? (
            <FitFoot
              rows={rows}
              visible={visible}
              byId={byId}
              kinds={kinds}
              firstId={firstId}
              totalsLabel={totalsLabel}
              selectable={selectable}
              hasActions={rowActions !== undefined}
              spare={spare}
            />
          ) : footer && hasRows ? (
            <tfoot>{spare ? withSpareCell(footer) : footer}</tfoot>
          ) : null}
        </table>
      </div>
      <ColumnMeasurer
        signature={measure.signature}
        columns={columns}
        rows={rows}
        extraRows={measure.extraRows}
        rowActions={rowActions}
        rowActionsHeader={rowActionsHeader}
        tableClass={cx(tableClass, 'tbl-auto')}
        onMeasured={measure.onMeasured}
        sortBy={sortBy}
        sortDir={sortDir}
        onSort={onSort}
      />
    </div>
  );
}

/** The caller's raw footer rows, each given the empty trailing cell so a
 *  total row runs to the edge like the rows above it. Only top-level <tr>
 *  elements are reached (the one caller, the report grid, passes one). */
function withSpareCell(footer: ReactNode): ReactNode {
  return Children.map(footer, (tr) =>
    isValidElement<{ children?: ReactNode }>(tr) && tr.type === 'tr'
      ? cloneElement(
          tr,
          undefined,
          tr.props.children,
          <td key="dt-spare" className="dt-spare" aria-hidden="true" />,
        )
      : tr,
  );
}
