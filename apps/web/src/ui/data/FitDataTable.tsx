// The fit engine (ADR-199, table standard) — what <DataTable tableKey="…">
// renders. Ported from Table-Standard-Prototype.html:
//   R1 every row is one line; text columns share the spare width and are cut
//      with "…" (the app-wide cell-overflow-title helper adds the tooltip);
//      codes / numbers / dates / badges / actions get their exact measured
//      width — over ALL rows — and are never cut.
//   R2 the table always fits its wrapper — no sideways scroll. When the
//      minimum widths do not fit, the rightmost unpinned column moves into ▸.
//   R3 ▸ on every row opens a detail row: full text of the visible text
//      columns, the columns moved to ▸, and the columns the user hid. It is
//      the row's ONE expand control — it also opens the caller's own
//      renderExpanded content (onToggleExpanded).
//   R4/R5 the toolbar + Columns popover; R6 the layout and density are saved
//      to the user's profile; R8 the Action column is always last and kept.
// Measuring lives in use-fit-measure.ts, the body rows in FitRows.tsx.

import { useLayoutEffect, useMemo, useState } from 'react';
import type { CSSProperties, ReactElement } from 'react';

import { useTableLayout } from '@/lib/use-table-layout';
import { useTableDensity } from '@/lib/use-ui-settings';

import { PageState } from '../layout/PageState';
import { ColumnMeasurer } from './ColumnMeasurer';
import { colId, colKind, colLabel, cx, defaultRowKey } from './data-table-cells';
import { headContent, thAriaSort, thClass, thStyle } from './data-table-head';
import type { DataTableColumnKind, DataTableProps } from './data-table-types';
import { canPin as canPinFn, fitColumns, type FitInput } from './fit-layout';
import { FitRows } from './FitRows';
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
    onToggleExpanded,
    maxHeight,
    sortBy,
    sortDir,
    onSort,
    rowActions,
    rowActionsHeader = 'Action',
    loading = false,
    footer,
    emptyText = 'No records',
    empty,
    className,
    wrapClassName,
    defaultPinned,
    defaultHidden,
  } = props;

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

  const layout = useTableLayout(tableKey, ids, { pins: defaultPinned, hidden: defaultHidden });
  const { density, setDensity } = useTableDensity();

  const tableClass = cx(
    'innovic-table',
    'tbl-grid',
    densityProp === 'compact' && 'tbl-compact',
    editable && 'tbl-edit',
    className,
  );
  const measure = useFitMeasure({
    columns,
    ids,
    kinds,
    rows,
    hasActions: rowActions !== undefined,
    styleKey: [density, tableClass, sortBy, sortDir].join('|'),
  });
  const { widths, avail, actionsW } = measure;

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
        }
      : null;
  // Cheap (one pass over at most 80 columns) — no memo needed.
  const fit = fitInput ? fitColumns(fitInput) : null;
  const visible = fit?.visible ?? layout.order.filter((k) => !layout.hidden.includes(k));
  const dropped = fit?.dropped ?? [];
  const textVisible = visible.filter((k) => k !== firstId && kinds[k] === 'text');
  const userHidden = layout.order.filter((k) => layout.hidden.includes(k));
  const detailIds = [...textVisible, ...dropped, ...userHidden];

  // Which rows' ▸ detail is open — kept here, not in FitRows, so it outlives
  // a loading / empty pass (e.g. searching to nothing and back).
  const [openKeys, setOpenKeys] = useState<Set<string | number>>(() => new Set());

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

  const nCols = visible.length + (rowActions ? 1 : 0);
  const hasRows = !loading && rows.length > 0;
  const wrapStyle: CSSProperties | undefined = maxHeight !== undefined ? { maxHeight } : undefined;
  const sort = { sortBy, sortDir, onSort };
  const pickerCols = ids.map((id, i) => ({ id, label: colLabel(columns[i] ?? { header: '' }, i) }));
  const canPin = (id: string) => (fitInput ? canPinFn(fitInput, id) : true);

  return (
    <div className="dt-fit-root">
      <TableToolbar
        columns={pickerCols}
        layout={layout}
        firstId={firstId}
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
        <table className={cx(tableClass, 'dt-fit', !fit && 'dt-fit-pending')}>
          {fit ? (
            <colgroup>
              {visible.map((k) => (
                <col key={k} style={{ width: fit.w[k] }} />
              ))}
              {rowActions ? <col style={{ width: actionsW }} /> : null}
            </colgroup>
          ) : null}
          <thead>
            <tr>
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
                keyOf={rowKey ?? defaultRowKey}
                ids={ids}
                byId={byId}
                kinds={kinds}
                firstId={firstId}
                visible={visible}
                detailIds={detailIds}
                nCols={nCols}
                onRowClick={onRowClick}
                isRowClickable={isRowClickable}
                rowClassName={rowClassName}
                renderExpanded={renderExpanded}
                onToggleExpanded={onToggleExpanded}
                rowActions={rowActions}
                openKeys={openKeys}
                setOpenKeys={setOpenKeys}
              />
            )}
          </tbody>
          {footer && hasRows ? <tfoot>{footer}</tfoot> : null}
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
