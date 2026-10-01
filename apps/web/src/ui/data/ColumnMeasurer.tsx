// The fit engine's ruler (ADR-199). A hidden, auto-layout copy of the sheet —
// same classes, same header and cell content — so fonts, letter-spacing,
// padding, badges and buttons all count. Header and body are two separate
// tables: a header's width must not be inflated by its values, and in an
// auto-layout table the first body row's cells are already each column's
// widest content.
//
// What it draws: the first MEASURE_ROWS rows, plus the `extraRows` the engine
// picked from the rest as the longest values per column (see
// pickOutlierRows), so a long code on row 900 still sets its column's width.
//
// Cost control: it re-renders ONLY when `signature` changes (rows, column
// ids, density, fonts, sort, container width) — not on every render of the
// page around it — and it measures in a requestAnimationFrame after commit,
// so a measurement never runs inside the render that caused it.

import { memo, useLayoutEffect, useRef } from 'react';
import type { ReactElement, ReactNode } from 'react';

import { cellValue, colId } from './data-table-cells';
import { headContent, tdClass, thClass, thStyle, type SortProps } from './data-table-head';
import type { DataTableColumn } from './data-table-types';

export const MEASURE_ROWS = 200;
/** id of the Action column in measurements. */
export const ACTIONS_ID = '__actions';

export interface Measured {
  head: Record<string, number>;
  content: Record<string, number>;
}

interface Props<T> extends SortProps {
  /** Everything the measurement depends on, as one string. */
  signature: string;
  columns: DataTableColumn<T>[];
  rows: T[];
  extraRows: T[];
  rowActions?: ((row: T, index: number) => ReactNode) | undefined;
  rowActionsHeader?: ReactNode | undefined;
  tableClass: string | undefined;
  onMeasured: (m: Measured) => void;
}

function MeasurerImpl<T>({
  columns,
  rows,
  extraRows,
  rowActions,
  rowActionsHeader,
  tableClass,
  onMeasured,
  sortBy,
  sortDir,
  onSort,
  signature,
}: Props<T>): ReactElement {
  const ref = useRef<HTMLDivElement>(null);
  const sample = [...rows.slice(0, MEASURE_ROWS), ...extraRows];
  const ids = columns.map((c, i) => colId(c, i));
  if (rowActions) ids.push(ACTIONS_ID);
  const idsRef = useRef(ids);
  idsRef.current = ids;
  const cbRef = useRef(onMeasured);
  cbRef.current = onMeasured;

  useLayoutEffect(() => {
    const frame = requestAnimationFrame(() => {
      const el = ref.current;
      if (!el) return;
      const ths = el.querySelectorAll<HTMLElement>('thead th');
      const tds = el.querySelectorAll<HTMLElement>('tbody tr:first-child > td');
      const head: Record<string, number> = {};
      const content: Record<string, number> = {};
      idsRef.current.forEach((id, i) => {
        const th = ths[i];
        const td = tds[i];
        // +2: half-pixel borders of the grid, and rounding.
        head[id] = th ? Math.ceil(th.getBoundingClientRect().width) + 2 : 0;
        content[id] = td ? Math.ceil(td.getBoundingClientRect().width) + 2 : 0;
      });
      cbRef.current({ head, content });
    });
    return () => cancelAnimationFrame(frame);
  }, [signature]);

  const sort = { sortBy, sortDir, onSort };
  return (
    <div className="dt-measure" aria-hidden="true">
      <div ref={ref} className="dt-measure-inner">
        <table className={tableClass}>
          <thead>
            <tr>
              {columns.map((c, i) => (
                <th key={i} className={thClass(c)} style={thStyle(c)}>
                  {headContent(c, sort)}
                </th>
              ))}
              {rowActions ? <th>{rowActionsHeader}</th> : null}
            </tr>
          </thead>
        </table>
        {sample.length > 0 ? (
          <table className={tableClass}>
            <tbody>
              {sample.map((row, ri) => (
                <tr key={ri}>
                  {columns.map((c, ci) => (
                    <td key={ci} className={tdClass(c)}>
                      {ci === 0 ? (
                        <button type="button" className="dt-exp" tabIndex={-1}>
                          ▸
                        </button>
                      ) : null}
                      {cellValue(c, row, ri)}
                    </td>
                  ))}
                  {rowActions ? <td className="dt-k-actions">{rowActions(row, ri)}</td> : null}
                </tr>
              ))}
            </tbody>
          </table>
        ) : null}
      </div>
    </div>
  );
}

// Only the signature decides a re-render: columns / rowActions are new
// closures on most page renders but draw the same thing.
export const ColumnMeasurer = memo(
  MeasurerImpl,
  (a, b) => a.signature === b.signature,
) as typeof MeasurerImpl;
