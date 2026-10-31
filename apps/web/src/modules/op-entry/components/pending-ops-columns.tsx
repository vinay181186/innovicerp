// Columns for the two shop-floor "By Machine" list tables (ADR-199 fit table):
// "Pending Jobs for this Machine" (ready to process → ▶ Start) and "Made on
// this Machine" (history, read-only). Moved out of machine-op-entry-view.tsx so
// that file stays under the 400-line ceiling and the two tables share identical
// part-identifying cells.
//
// Display only: the ▶ Start action, its permission gate and the pending-ops
// filter all stay in the section/view. These builders just describe cells.

import { ActionLink } from '@/components/shared/action-link';
import type { JcOpEnriched } from '@innovic/shared';
import { opSrNo } from '@innovic/shared';
import { leadColumns, type DataTableColumn } from '@/ui/data';

/** One op this machine actually produced on, with THAT machine's share of the
 *  completed qty pulled out of the op's per-machine breakdown. */
export interface MadeHereRow {
  op: JcOpEnriched;
  qty: number;
}

/** Nothing hidden by default — the six lead columns are always shown (owner
 *  rule 2026-10-31). Kept as the section's defaultHidden hook. */
export const PENDING_OPS_DEFAULT_HIDDEN: string[] = [];

/** The JC number is a LINK to the card: naming a job an operator cannot open
 *  from here made them re-find it by hand, which on this screen is one more
 *  chance to land on the wrong one. */
function jcLink(op: JcOpEnriched): React.JSX.Element {
  return (
    <ActionLink
      fallback="text"
      to="/job-cards/$id"
      params={{ id: op.jobCardId }}
      style={{ color: 'var(--cyan)', textDecoration: 'none' }}
      title="Open this job card"
    >
      {op.jobCardCode}
    </ActionLink>
  );
}

/** The six lead columns (owner rule 2026-10-31), read off a JcOpEnriched.
 *  `pick` lets the Made-here table reuse them against its { op, qty } row
 *  shape. Spread FIRST — `doc` (the JC No.) is drawn first and locked with
 *  the block; Op and the rest follow Item Name (ADR-261 amendment 31-Oct). */
function identityColumns<T>(
  pick: (row: T) => JcOpEnriched,
  doc: DataTableColumn<T>,
): DataTableColumn<T>[] {
  return leadColumns<T>({
    doc,
    soNo: (row) => pick(row).soCode,
    internalSoNo: (row) => pick(row).soInternalNo,
    pol: (row) => pick(row).clientPoLineNo,
    createdOn: (row) => pick(row).createdAt,
    itemCode: (row) => pick(row).itemCode,
    itemRev: (row) => pick(row).itemRevision,
    itemName: (row) => pick(row).itemName,
  });
}

/** "Pending Jobs for this Machine" — the ready-to-process list. The ▶ Start
 *  button is added by the section as the trailing Action column. */
export function pendingOpsColumns(): DataTableColumn<JcOpEnriched>[] {
  const self = (op: JcOpEnriched): JcOpEnriched => op;
  return [
    ...identityColumns<JcOpEnriched>(self, {
      id: 'jc_no',
      kind: 'code',
      header: 'JC No.',
      className: 'mono fw-700 cyan',
      render: (op) => jcLink(op),
    }),
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
  ];
}

/** "Made on this Machine" — history only, no Start. Keyless table. */
export function madeHereColumns(): DataTableColumn<MadeHereRow>[] {
  const pick = (row: MadeHereRow): JcOpEnriched => row.op;
  return [
    ...identityColumns<MadeHereRow>(pick, {
      id: 'jc_no',
      kind: 'code',
      header: 'JC No.',
      className: 'mono fw-700 cyan',
      render: (row) => jcLink(row.op),
    }),
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
  ];
}
