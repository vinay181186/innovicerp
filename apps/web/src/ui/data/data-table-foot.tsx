// Totals row for the table engine (ADR-199 Wave B). A `<tfoot>` that iterates
// the SAME `visible` columns (and the same leading / trailing spacers) the
// header uses, emitting one cell per visible column. A column currently moved
// into the ▸ detail simply does not emit its total — so a total always sits
// under its own column and stays aligned, which the raw `footer` escape hatch
// could not guarantee. Split out of FitDataTable.tsx to keep it under 400 lines.

import type { ReactElement, ReactNode } from 'react';

import { tdClass } from './data-table-head';
import type { DataTableColumn, DataTableColumnKind } from './data-table-types';

export interface FitFootProps<T> {
  /** All loaded rows — handed to a `total` function so it can sum them. */
  rows: T[];
  /** The on-screen columns, in order, as the header drew them. */
  visible: string[];
  byId: Map<string, DataTableColumn<T>>;
  kinds: Record<string, DataTableColumnKind>;
  firstId: string;
  /** Shown in the first column's cell (default "Total"). */
  totalsLabel: ReactNode;
  /** A leading tick-box column is present — emit its spacer cell. */
  selectable: boolean;
  /** A trailing Action column is present — emit its spacer cell. */
  hasActions: boolean;
}

export function FitFoot<T>(p: FitFootProps<T>): ReactElement {
  return (
    <tfoot>
      <tr className="row-total">
        {p.selectable ? <td className="dt-sel-col" aria-hidden="true" /> : null}
        {p.visible.map((k) => {
          const c = p.byId.get(k);
          if (!c) return null;
          const numeric = p.kinds[k] === 'num';
          const content: ReactNode =
            k === p.firstId
              ? p.totalsLabel
              : typeof c.total === 'function'
                ? c.total(p.rows)
                : (c.total ?? null);
          return (
            <td key={k} className={tdClass(c, numeric ? 'td-num' : undefined)}>
              {content}
            </td>
          );
        })}
        {p.hasActions ? <td aria-hidden="true" /> : null}
      </tr>
    </tfoot>
  );
}
