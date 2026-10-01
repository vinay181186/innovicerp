// The fit engine's body rows (ADR-199): one data row per record with the ▸
// toggle at the start of its first cell, then — when open — the detail row
// (prototype layout: LABEL value items, one line each) followed by the
// caller's own renderExpanded content. Split out of FitDataTable.tsx.

import { Fragment, useState } from 'react';
import type { ReactElement, ReactNode } from 'react';

import { cellTitle, cellValue, colLabel, cx, stopRowClick } from './data-table-cells';
import { tdClass } from './data-table-head';
import type { DataTableColumn, DataTableColumnKind } from './data-table-types';

export interface FitRowsProps<T> {
  rows: T[];
  keyOf: (row: T, index: number) => string | number;
  ids: string[];
  byId: Map<string, DataTableColumn<T>>;
  kinds: Record<string, DataTableColumnKind>;
  firstId: string;
  visible: string[];
  /** Shown in the detail row, in this order: full text of visible text
   *  columns, then the columns moved to ▸, then the ones the user hid. */
  detailIds: string[];
  nCols: number;
  onRowClick?: ((row: T, index: number) => void) | undefined;
  rowClassName?: ((row: T, index: number) => string | undefined) | undefined;
  renderExpanded?: ((row: T, index: number) => ReactNode) | undefined;
  onToggleExpanded?: ((row: T, index: number) => void) | undefined;
  rowActions?: ((row: T, index: number) => ReactNode) | undefined;
}

export function FitRows<T>(p: FitRowsProps<T>): ReactElement {
  const [open, setOpen] = useState<Set<string | number>>(() => new Set());
  const toggle = (k: string | number, row: T, ri: number) => {
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(k)) next.delete(k);
      else next.add(k);
      return next;
    });
    // One ▸ per row: it opens the caller's own expanded content too.
    p.onToggleExpanded?.(row, ri);
  };

  return (
    <>
      {p.rows.map((row, ri) => {
        const rk = p.keyOf(row, ri);
        const isOpen = open.has(rk);
        const extra = p.renderExpanded?.(row, ri);
        return (
          <Fragment key={rk}>
            <tr
              className={cx(p.rowClassName?.(row, ri))}
              onClick={p.onRowClick ? () => p.onRowClick?.(row, ri) : undefined}
              style={p.onRowClick ? { cursor: 'pointer' } : undefined}
            >
              {p.visible.map((k) => {
                const c = p.byId.get(k);
                if (!c) return null;
                return (
                  <td
                    key={k}
                    className={tdClass(c, `dt-k-${p.kinds[k] ?? 'code'}`)}
                    title={cellTitle(c, row)}
                    onClick={c.stopRowClick ? stopRowClick : undefined}
                  >
                    {k === p.firstId ? (
                      <button
                        type="button"
                        className="dt-exp"
                        aria-expanded={isOpen}
                        aria-label={isOpen ? 'Hide row details' : 'Show row details'}
                        onClick={(e) => {
                          e.stopPropagation();
                          toggle(rk, row, ri);
                        }}
                      >
                        {isOpen ? '▾' : '▸'}
                      </button>
                    ) : null}
                    {cellValue(c, row, ri)}
                  </td>
                );
              })}
              {p.rowActions ? (
                <td className="dt-k-actions" onClick={stopRowClick}>
                  {p.rowActions(row, ri)}
                </td>
              ) : null}
            </tr>
            {isOpen && (p.detailIds.length > 0 || !extra) ? (
              <tr className="dt-detail-row">
                <td colSpan={p.nCols}>
                  {p.detailIds.length > 0 ? (
                    <div className="dt-detail-grid">
                      {p.detailIds.map((k) => {
                        const c = p.byId.get(k);
                        if (!c) return null;
                        return (
                          <div key={k} className="dt-detail-item" title={cellTitle(c, row)}>
                            <span className="dt-detail-label">{colLabel(c, p.ids.indexOf(k))}</span>
                            {cellValue(c, row, ri)}
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <span className="dt-detail-none">Every column is on screen.</span>
                  )}
                </td>
              </tr>
            ) : null}
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
