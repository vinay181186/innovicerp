// The fit engine (ADR-199, table standard) — what <DataTable tableKey="…">
// renders. Ported from Table-Standard-Prototype.html:
//   R1 every row is one line; text columns share the spare width and are cut
//      with "…" (hover shows the full text); codes / numbers / dates / badges /
//      actions get their exact measured width and are never cut.
//   R2 the table always fits its wrapper — no sideways scroll. When the
//      minimum widths do not fit, the rightmost unpinned column moves into ▸.
//   R3 ▸ on each row opens a detail row: every column that moved, plus the
//      full text of each visible text column. The caller's own renderExpanded
//      content follows it.
//   R4/R5 the toolbar + Columns popover; R6 the layout and density are saved
//      to the user's profile; R8 the Action column is always last and kept.

import {
  Fragment,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { CSSProperties, MouseEvent as ReactMouseEvent, ReactElement } from 'react';

import { useTableDensity } from '@/lib/use-ui-settings';
import { useTableLayout } from '@/lib/use-table-layout';

import { PageState } from '../layout/PageState';
import { ACTIONS_ID, ColumnMeasurer, type Measured } from './ColumnMeasurer';
import {
  cellTitle,
  cellValue,
  colId,
  colKind,
  colLabel,
  cx,
  defaultRowKey,
  stopRowClick,
} from './data-table-cells';
import { headContent, tdClass, thAriaSort, thClass, thStyle } from './data-table-head';
import type { DataTableColumnKind, DataTableProps } from './data-table-types';
import {
  canPin as canPinFn,
  columnWidth,
  fitColumns,
  type ColumnWidth,
  type FitInput,
} from './fit-layout';
import { TableToolbar } from './TableToolbar';
import './data-table-fit.css';

/** Fill in a missing `title` on a cut cell when the pointer reaches it. */
function autoTitle(e: ReactMouseEvent<HTMLTableSectionElement>): void {
  const td = (e.target as HTMLElement).closest('td');
  if (!td || td.title || td.parentElement?.parentElement !== e.currentTarget) return;
  if (td.scrollWidth > td.clientWidth) td.title = (td.textContent ?? '').trim();
}

function sameMeasured(a: Measured | null, b: Measured): boolean {
  if (!a) return false;
  const eq = (x: Record<string, number>, y: Record<string, number>) => {
    const kx = Object.keys(x);
    return kx.length === Object.keys(y).length && kx.every((k) => x[k] === y[k]);
  };
  return eq(a.head, b.head) && eq(a.content, b.content);
}

export function FitDataTable<T>(props: DataTableProps<T> & { tableKey: string }): ReactElement {
  const {
    tableKey,
    columns,
    rows,
    rowKey,
    density: densityProp = 'regular',
    editable = false,
    onRowClick,
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

  // ---- available width (R2: re-layout on every wrapper resize) ----
  const wrapRef = useRef<HTMLDivElement>(null);
  const [avail, setAvail] = useState(0);
  useLayoutEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const read = () => setAvail(Math.floor(el.clientWidth));
    read();
    const ro = new ResizeObserver(read);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // ---- measured widths (R2: re-measure on rows / columns / density / fonts) ----
  const [fontsTick, setFontsTick] = useState(0);
  useEffect(() => {
    let live = true;
    void document.fonts?.ready.then(() => live && setFontsTick(1));
    return () => {
      live = false;
    };
  }, []);
  const [measured, setMeasured] = useState<Measured | null>(null);
  const onMeasured = useCallback((m: Measured) => {
    setMeasured((prev) => (sameMeasured(prev, m) ? prev : m));
  }, []);

  const tableClass = cx(
    'innovic-table',
    'tbl-grid',
    densityProp === 'compact' && 'tbl-compact',
    editable && 'tbl-edit',
    className,
  );

  const widths = useMemo(() => {
    if (!measured) return null;
    const out: Record<string, ColumnWidth> = {};
    for (const [id, c] of byId) {
      out[id] = columnWidth(
        kinds[id] ?? 'code',
        measured.head[id] ?? 0,
        measured.content[id] ?? 0,
        c.minWidth ?? 0,
      );
    }
    return out;
  }, [measured, byId, kinds]);
  const actionsW =
    rowActions && measured
      ? Math.max(measured.head[ACTIONS_ID] ?? 0, measured.content[ACTIONS_ID] ?? 0)
      : 0;

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
  const hasDetail = dropped.length > 0 || textVisible.length > 0;

  const [open, setOpen] = useState<Set<string | number>>(() => new Set());
  const toggle = (k: string | number) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(k)) next.delete(k);
      else next.add(k);
      return next;
    });

  const nCols = visible.length + (rowActions ? 1 : 0);
  const hasRows = !loading && rows.length > 0;
  const keyOf = rowKey ?? defaultRowKey;
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
        onChange={layout.setLayout}
        onReset={layout.reset}
        density={density}
        onDensity={setDensity}
        saveFailed={layout.saveFailed}
        onRetrySave={layout.retrySave}
      />
      <div ref={wrapRef} className={cx('tbl-wrap', 'dt-fit-wrap', wrapClassName)} style={wrapStyle}>
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
          <tbody onMouseOver={autoTitle}>
            {loading ? (
              <PageState as="row" state="loading" colSpan={nCols} />
            ) : rows.length === 0 ? (
              <PageState as="row" state="empty" message={empty ?? emptyText} colSpan={nCols} />
            ) : (
              rows.map((row, ri) => {
                const rk = keyOf(row, ri);
                const isOpen = hasDetail && open.has(rk);
                const extra = renderExpanded?.(row, ri);
                const details = isOpen ? [...textVisible, ...dropped] : [];
                return (
                  <Fragment key={rk}>
                    <tr
                      className={cx(rowClassName?.(row, ri))}
                      onClick={onRowClick ? () => onRowClick(row, ri) : undefined}
                      style={onRowClick ? { cursor: 'pointer' } : undefined}
                    >
                      {visible.map((k) => {
                        const c = byId.get(k);
                        if (!c) return null;
                        return (
                          <td
                            key={k}
                            className={tdClass(c, `dt-k-${kinds[k] ?? 'code'}`)}
                            title={cellTitle(c, row)}
                            onClick={c.stopRowClick ? stopRowClick : undefined}
                          >
                            {k === firstId && hasDetail ? (
                              <button
                                type="button"
                                className="dt-exp"
                                aria-expanded={isOpen}
                                aria-label={isOpen ? 'Hide row details' : 'Show row details'}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  toggle(rk);
                                }}
                              >
                                {isOpen ? '▾' : '▸'}
                              </button>
                            ) : null}
                            {cellValue(c, row, ri)}
                          </td>
                        );
                      })}
                      {rowActions ? (
                        <td className="dt-k-actions" onClick={stopRowClick}>
                          {rowActions(row, ri)}
                        </td>
                      ) : null}
                    </tr>
                    {details.length > 0 ? (
                      <tr className="dt-detail-row">
                        <td colSpan={nCols}>
                          <div className="dt-detail-grid">
                            {details.map((k) => {
                              const c = byId.get(k);
                              if (!c) return null;
                              const i = ids.indexOf(k);
                              return (
                                <div key={k} className="dt-detail-item" title={cellTitle(c, row)}>
                                  <span className="dt-detail-label">{colLabel(c, i)}</span>
                                  {cellValue(c, row, ri)}
                                </div>
                              );
                            })}
                          </div>
                        </td>
                      </tr>
                    ) : null}
                    {extra ? (
                      <tr className="dt-caller-row">
                        <td colSpan={nCols} className="dt-expand-cell">
                          {extra}
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
      <ColumnMeasurer
        columns={columns}
        rows={rows}
        rowActions={rowActions}
        rowActionsHeader={rowActionsHeader}
        tableClass={cx(tableClass, 'tbl-auto')}
        densityToken={density}
        fontsTick={fontsTick}
        onMeasured={onMeasured}
        sortBy={sortBy}
        sortDir={sortDir}
        onSort={onSort}
      />
    </div>
  );
}
