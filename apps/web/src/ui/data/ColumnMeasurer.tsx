// The fit engine's ruler (ADR-199). A hidden, auto-layout copy of the sheet —
// same classes, same header and cell content — so fonts, letter-spacing,
// padding, badges and buttons all count. Header and body are two separate
// tables: a header's width must not be inflated by its values, and in an
// auto-layout table the first body row's cells are already each column's
// widest content. Only the first MEASURE_ROWS rows are drawn.
//
// It is memoised and measures after each of its own renders, so it re-measures
// exactly when its inputs change (rows, columns, density, fonts) and not on
// the table's own state changes (expand, popover).

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
  columns: DataTableColumn<T>[];
  rows: T[];
  rowActions?: ((row: T, index: number) => ReactNode) | undefined;
  rowActionsHeader?: ReactNode | undefined;
  tableClass: string | undefined;
  /** Not drawn — only here so a change re-renders (and re-measures). */
  densityToken: string;
  fontsTick: number;
  onMeasured: (m: Measured) => void;
}

function MeasurerImpl<T>({
  columns,
  rows,
  rowActions,
  rowActionsHeader,
  tableClass,
  onMeasured,
  sortBy,
  sortDir,
  onSort,
}: Props<T>): ReactElement {
  const ref = useRef<HTMLDivElement>(null);
  const sample = rows.slice(0, MEASURE_ROWS);
  const ids = columns.map((c, i) => colId(c, i));
  if (rowActions) ids.push(ACTIONS_ID);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ths = el.querySelectorAll<HTMLElement>('thead th');
    const tds = el.querySelectorAll<HTMLElement>('tbody tr:first-child > td');
    const head: Record<string, number> = {};
    const content: Record<string, number> = {};
    ids.forEach((id, i) => {
      const th = ths[i];
      const td = tds[i];
      // +2: half-pixel borders of the collapsed grid, and rounding.
      head[id] = th ? Math.ceil(th.getBoundingClientRect().width) + 2 : 0;
      content[id] = td ? Math.ceil(td.getBoundingClientRect().width) + 2 : 0;
    });
    onMeasured({ head, content });
  });

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

export const ColumnMeasurer = memo(MeasurerImpl) as typeof MeasurerImpl;
