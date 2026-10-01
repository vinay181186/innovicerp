// Matrix view columns (ADR-199 fit table, tableKey qcDocsMatrix). DYNAMIC
// columns: one chip column per QC op (decision #14), built with the engine's
// dynamicColumns() helper so each op-chip column gets a STABLE id seeded off the
// op's name (the only stable identity the QcMatrixResponse exposes — qcColumns
// is a string[] of distinct op names, never an array index), so a saved layout
// survives the op set changing. Moved out of routes/list.tsx for the 400-line
// ceiling.
//
// Visible, first pinned: Ln / JC No. · Item Code · one chip per op · Overall.
// Default in the ▸ expand (defaultHidden): POL · Item Name · Order Qty — plus
// the full per-op detail, which the page supplies through renderExpanded.

import type { QcMatrixRow } from '@innovic/shared';
import { itemCodeWithRev } from '@/lib/item-code';
import { dynamicColumns, type DataTableColumn } from '@/ui/data';
import { MatrixOpChip, OverallChip } from './matrix-cells';

/** Ids the matrix hides into the ▸ detail by default (decision #14). */
export const MATRIX_DETAIL_IDS = ['pol', 'item_name', 'order_qty'];

export function buildMatrixColumns(qcColumns: string[]): DataTableColumn<QcMatrixRow>[] {
  const opCols = dynamicColumns<string, QcMatrixRow>('qcop', qcColumns, (op, i) => ({
    idSeed: op,
    header: op,
    kind: 'badge',
    nowrap: true,
    headColor: 'var(--green2)',
    render: (row) => {
      const cell = row.cells[i];
      return cell ? <MatrixOpChip cell={cell} /> : <span style={{ color: 'var(--text3)' }}>—</span>;
    },
  }));

  return [
    {
      // First column — pinned by the table standard (ADR-199). Carries the row's
      // identity: our line number and the Job Card it is for.
      id: 'ln_jc',
      header: 'Ln / JC No.',
      label: 'Ln / JC No.',
      nowrap: true,
      render: (row) => (
        <span>
          <span className="mono fw-700" style={{ color: 'var(--cyan)' }}>
            {row.lineNo}
          </span>
          {row.jcCode ? (
            <>
              {' '}
              <span className="mono" style={{ fontSize: 11, color: 'var(--cyan)' }}>
                {row.jcCode}
              </span>
            </>
          ) : (
            <span style={{ color: 'var(--text3)', fontSize: 11 }}> —</span>
          )}
        </span>
      ),
    },
    {
      id: 'item_code',
      kind: 'code',
      header: 'Item Code',
      nowrap: true,
      className: 'td-code mono fw-700',
      render: (row) => itemCodeWithRev(row.itemCode, row.itemRevision, ''),
    },
    // Hidden-by-default detail columns — surfaced in the ▸ expand.
    {
      id: 'pol',
      header: 'POL',
      label: 'POL',
      headColor: 'var(--purple)',
      render: (row) => (
        <span className="mono fw-700" style={{ color: 'var(--purple)', fontSize: 11 }}>
          {row.clientPoLineNo ?? '—'}
        </span>
      ),
    },
    {
      id: 'item_name',
      header: 'Item Name',
      label: 'Item Name',
      align: 'left',
      ellipsis: true,
      render: (row) => row.itemName ?? '',
      title: (row) => row.itemName ?? '',
    },
    {
      id: 'order_qty',
      kind: 'num',
      header: 'Order Qty',
      label: 'Order Qty',
      align: 'right',
      className: 'mono fw-700',
      render: (row) => row.orderQty,
    },
    ...opCols,
    {
      id: 'overall',
      kind: 'badge',
      header: 'Overall',
      nowrap: true,
      render: (row) => <OverallChip row={row} />,
    },
  ];
}
