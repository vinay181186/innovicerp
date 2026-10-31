// The fit engine's body rows (ADR-199): one data row per record, then the
// caller's own renderExpanded content when the caller has opened it (its own
// trigger — a row click or a ⋯ item). No ▸ on any row (owner 2026-10-31).
// Split out of FitDataTable.tsx.

import { Fragment } from 'react';
import type { ReactElement, ReactNode } from 'react';

import { cellTitle, cellValue, cx, stopRowClick } from './data-table-cells';
import { tdClass } from './data-table-head';
import type { DataTableColumn, DataTableColumnKind } from './data-table-types';
import { RowCheckbox, type RowSelectionModel } from './FitSelection';

export interface FitRowsProps<T> {
  rows: T[];
  keyOf: (row: T, index: number) => string | number;
  byId: Map<string, DataTableColumn<T>>;
  kinds: Record<string, DataTableColumnKind>;
  visible: string[];
  nCols: number;
  onRowClick?: ((row: T, index: number) => void) | undefined;
  isRowClickable?: ((row: T, index: number) => boolean) | undefined;
  rowClassName?: ((row: T, index: number) => string | undefined) | undefined;
  groupRow?: ((row: T, index: number, prev: T | undefined) => ReactNode) | undefined;
  renderExpanded?: ((row: T, index: number) => ReactNode) | undefined;
  rowActions?: ((row: T, index: number) => ReactNode) | undefined;
  /** A leading selection tick-box column is present. */
  selectable: boolean;
  /** The derived selection state (caller-owned set). */
  selection: RowSelectionModel<T>;
  /** An empty trailing cell takes the spare width (table with no ⋯). */
  spare: boolean;
}

export function FitRows<T>(p: FitRowsProps<T>): ReactElement {
  return (
    <>
      {p.rows.map((row, ri) => {
        const rk = p.keyOf(row, ri);
        const extra = p.renderExpanded?.(row, ri);
        const clickable = !!p.onRowClick && (p.isRowClickable?.(row, ri) ?? true);
        const selected = p.selectable && p.selection.isSelected(rk);
        const group = p.groupRow?.(row, ri, ri > 0 ? p.rows[ri - 1] : undefined);
        return (
          <Fragment key={rk}>
            {group !== null && group !== undefined && group !== false ? (
              <tr className="dt-group-row">
                <td colSpan={p.nCols}>{group}</td>
              </tr>
            ) : null}
            <tr
              className={cx(
                p.rowClassName?.(row, ri),
                selected && 'row-selected',
                !!p.onRowClick && !clickable && 'dt-row-static',
              )}
              onClick={clickable ? () => p.onRowClick?.(row, ri) : undefined}
              style={clickable ? { cursor: 'pointer' } : undefined}
            >
              {p.selectable ? (
                <td className="dt-sel-col" onClick={stopRowClick}>
                  {p.selection.canSelect(row, ri) ? (
                    <RowCheckbox
                      checked={selected}
                      onToggle={() => p.selection.toggleRow(rk, row, ri)}
                    />
                  ) : null}
                </td>
              ) : null}
              {p.visible.map((k) => {
                const c = p.byId.get(k);
                if (!c) return null;
                // A `control` cell (an in-cell input / picker) swallows the row
                // click on its own, so the caller need not set stopRowClick.
                const swallow = c.stopRowClick || p.kinds[k] === 'control';
                return (
                  <td
                    key={k}
                    className={tdClass(c, `dt-k-${p.kinds[k] ?? 'code'}`)}
                    title={cellTitle(c, row)}
                    onClick={swallow ? stopRowClick : undefined}
                  >
                    {cellValue(c, row, ri)}
                  </td>
                );
              })}
              {p.rowActions ? (
                <td className="dt-k-actions" onClick={stopRowClick}>
                  {p.rowActions(row, ri)}
                </td>
              ) : null}
              {p.spare ? <td className="dt-spare" aria-hidden="true" /> : null}
            </tr>
            {extra ? (
              <tr className="dt-caller-row">
                <td colSpan={p.nCols} className="dt-expand-cell">
                  {extra}
                </td>
              </tr>
            ) : null}
          </Fragment>
        );
      })}
    </>
  );
}
