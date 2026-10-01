// Columns for the two shop-floor "By Machine" list tables (ADR-199 fit table):
// "Pending Jobs for this Machine" (ready to process → ▶ Start) and "Made on
// this Machine" (history, read-only). Moved out of machine-op-entry-view.tsx so
// that file stays under the 400-line ceiling and the two tables share identical
// part-identifying cells.
//
// Display only: the ▶ Start action, its permission gate and the pending-ops
// filter all stay in the section/view. These builders just describe cells.

import type { JcOpEnriched } from '@innovic/shared';
import { opSrNo } from '@innovic/shared';
import { Link } from '@tanstack/react-router';
import { itemCodeWithRev } from '@/lib/item-code';
import type { DataTableColumn } from '@/ui/data';

/** One op this machine actually produced on, with THAT machine's share of the
 *  completed qty pulled out of the op's per-machine breakdown. */
export interface MadeHereRow {
  op: JcOpEnriched;
  qty: number;
}

/** POL and Item Name open in the ▸ detail by default; the JC No. (first column)
 *  is always pinned. */
export const PENDING_OPS_DEFAULT_HIDDEN = ['client_po_line_no', 'item_name'];

/** The JC number is a LINK to the card: naming a job an operator cannot open
 *  from here made them re-find it by hand, which on this screen is one more
 *  chance to land on the wrong one. */
function jcLink(op: JcOpEnriched): React.JSX.Element {
  return (
    <Link
      to="/job-cards/$id"
      params={{ id: op.jobCardId }}
      style={{ color: 'var(--cyan)', textDecoration: 'none' }}
      title="Open this job card"
    >
      {op.jobCardCode}
    </Link>
  );
}

/** POL · Item Code · Item Name, read off a JcOpEnriched. `pick` lets the
 *  Made-here table reuse them against its { op, qty } row shape. */
function identityColumns<T>(pick: (row: T) => JcOpEnriched): DataTableColumn<T>[] {
  return [
    {
      // POL — the CUSTOMER's own PO line number, before the item code.
      id: 'client_po_line_no',
      kind: 'code',
      header: 'POL',
      headColor: 'var(--purple)',
      className: 'mono fw-700',
      render: (row) => (
        <span style={{ color: 'var(--purple)' }}>{pick(row).clientPoLineNo ?? '—'}</span>
      ),
    },
    {
      // Purple mono is how CODE/REV is written wherever an item code sits beside
      // a document number on this screen. Blank (not '—') when the join brought
      // nothing back: a dash reads as "this part has no code", never true here.
      id: 'item_code',
      kind: 'code',
      header: 'Item Code',
      className: 'mono fw-700',
      render: (row) => {
        const op = pick(row);
        return (
          <span style={{ color: 'var(--purple)' }}>
            {itemCodeWithRev(op.itemCode, op.itemRevision, '')}
          </span>
        );
      },
    },
    {
      id: 'item_name',
      kind: 'text',
      header: 'Item Name',
      align: 'left',
      ellipsis: true,
      className: 'text2',
      render: (row) => pick(row).itemName ?? '',
      title: (row) => pick(row).itemName ?? '',
    },
  ];
}

/** "Pending Jobs for this Machine" — the ready-to-process list. The ▶ Start
 *  button is added by the section as the trailing Action column. */
export function pendingOpsColumns(): DataTableColumn<JcOpEnriched>[] {
  const self = (op: JcOpEnriched): JcOpEnriched => op;
  return [
    {
      id: 'jc_no',
      kind: 'code',
      header: 'JC No.',
      className: 'mono fw-700 cyan',
      render: (op) => jcLink(op),
    },
    {
      id: 'op_seq',
      kind: 'code',
      header: 'Op',
      className: 'mono fw-700',
      render: (op) => `Op ${opSrNo(op.opSeq)}`,
    },
    {
      id: 'operation',
      kind: 'text',
      header: 'Operation',
      ellipsis: true,
      className: 'fw-700',
      render: (op) => op.operation,
      title: (op) => op.operation,
    },
    {
      id: 'available',
      kind: 'num',
      header: 'Available',
      align: 'right',
      headColor: 'var(--amber2)',
      className: 'mono fw-700 amber',
      render: (op) => op.available,
    },
    ...identityColumns<JcOpEnriched>(self),
  ];
}

/** "Made on this Machine" — history only, no Start. Keyless table. */
export function madeHereColumns(): DataTableColumn<MadeHereRow>[] {
  const pick = (row: MadeHereRow): JcOpEnriched => row.op;
  return [
    {
      id: 'jc_no',
      kind: 'code',
      header: 'JC No.',
      className: 'mono fw-700 cyan',
      render: (row) => jcLink(row.op),
    },
    {
      id: 'op_seq',
      kind: 'code',
      header: 'Op',
      className: 'mono',
      render: (row) => `Op ${opSrNo(row.op.opSeq)}`,
    },
    {
      id: 'operation',
      kind: 'text',
      header: 'Operation',
      ellipsis: true,
      render: (row) => row.op.operation,
      title: (row) => row.op.operation,
    },
    {
      id: 'completed',
      kind: 'num',
      header: 'Completed',
      align: 'right',
      headColor: 'var(--green2)',
      className: 'mono fw-700 green',
      render: (row) => row.qty,
    },
    ...identityColumns<MadeHereRow>(pick),
  ];
}
