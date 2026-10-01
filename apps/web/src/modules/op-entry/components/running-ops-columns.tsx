// Live operations board columns (ADR-199 fit table). Moved out of
// running-ops-board.tsx so both the "Running now" and "Recent" tables share one
// set of render helpers and neither file grows past the 400-line ceiling.
//
// The display is the only thing that changed: every start / stop mutation, the
// machine split (ADR-164) and the Started-By audit line (ADR-197) are preserved
// exactly, now rendered through DataTable columns instead of hand-written <td>s.

import type { RunningOp } from '@innovic/shared';
import { opSrNo } from '@innovic/shared';
import { Link } from '@tanstack/react-router';
import { ActualMachineCell, PlannedMachineCell } from '@/components/shared/machine-split';
import { fmtDateAndTime, fmtDateTime } from '@/lib/date';
import { itemCodeWithRev } from '@/lib/item-code';
import type { DataTableColumn } from '@/ui/data';
import { RunningOpStatusBadge } from './status-badge';

/** GET /op-entry/running-ops rows carry `startedByName` — the logged-in user
 *  who pressed Start (ADR-197) — which the shared RunningOp type does not
 *  declare yet. `operatorName` is the operator on the floor. */
export type RunningOpRow = RunningOp & { startedByName?: string | null };

/** The JC number, as a way INTO that card rather than a code to copy and hunt
 *  for on another screen. Colour, mono face and weight are inherited from the
 *  cell it sits in, so the code keeps exactly the identity it has on every other
 *  board. A JC number is short, so it stays on one line. */
function JcLink({ id, code }: { id: string; code: string }): React.JSX.Element {
  return (
    <Link
      to="/job-cards/$id"
      params={{ id }}
      title="View job card status"
      style={{ color: 'inherit', textDecoration: 'none', whiteSpace: 'nowrap' }}
    >
      {code}
    </Link>
  );
}

/** Columns moved into the ▸ detail row by default: the CUSTOMER's PO line, the
 *  free-text item name and the planned machine. The user can bring any of them
 *  back from the Columns menu. The JC number (first column) is always pinned. */
export const RUNNING_OPS_DEFAULT_HIDDEN = ['client_po_line_no', 'item_name', 'planned_machine'];

/** True when a different person pressed Start than the operator on the floor. */
function startedByDiffers(r: RunningOpRow): string | null {
  const startedBy = r.startedByName?.trim() ?? '';
  const differs =
    startedBy !== '' && startedBy.toLowerCase() !== (r.operatorName ?? '').trim().toLowerCase();
  return differs ? startedBy : null;
}

/** POL · Item Code · Item Name — the three cells that identify the part. Shared
 *  by both tables so the look cannot drift between them. */
const polColumn: DataTableColumn<RunningOpRow> = {
  // POL — the line number printed on the CUSTOMER's own purchase order,
  // immediately before the item. '—' when there is no sales order behind it.
  id: 'client_po_line_no',
  kind: 'code',
  header: 'POL',
  headColor: 'var(--purple)',
  className: 'mono fw-700',
  render: (r) => <span style={{ color: 'var(--purple)' }}>{r.clientPoLineNo ?? '—'}</span>,
};

const itemCodeColumn: DataTableColumn<RunningOpRow> = {
  // A JC number says WHICH JOB; only this says WHICH PART. The code carries
  // the customer's drawing revision as CODE/REV through the one shared helper.
  id: 'item_code',
  kind: 'code',
  header: 'Item Code',
  className: 'mono fw-700',
  render: (r) => (
    <span style={{ color: 'var(--text)', whiteSpace: 'nowrap' }}>
      {itemCodeWithRev(r.itemCode, r.itemRevision)}
    </span>
  ),
};

const itemNameColumn: DataTableColumn<RunningOpRow> = {
  id: 'item_name',
  kind: 'text',
  header: 'Item Name',
  align: 'left',
  ellipsis: true,
  render: (r) => r.itemName ?? '—',
  title: (r) => r.itemName ?? '',
};

const opColumn: DataTableColumn<RunningOpRow> = {
  id: 'op_seq',
  kind: 'code',
  header: 'Op',
  className: 'mono',
  render: (r) => opSrNo(r.opSeq),
};

const operationColumn: DataTableColumn<RunningOpRow> = {
  id: 'operation',
  kind: 'text',
  header: 'Operation',
  ellipsis: true,
  render: (r) => r.operation,
  title: (r) => r.operation,
};

/** ADR-164 — the session's machine is the ACTUAL; the op's jc_ops machine is the
 *  PLAN. Each gets its own column on every in-house row; an OSP session has no
 *  machine. */
const plannedMachineColumn: DataTableColumn<RunningOpRow> = {
  id: 'planned_machine',
  kind: 'code',
  header: 'Planned Machine',
  className: 'mono text3',
  render: (r) => (r.isOsp ? 'OSP' : <PlannedMachineCell planned={r.plannedMachineCode} />),
};

const actualMachineColumn: DataTableColumn<RunningOpRow> = {
  id: 'actual_machine',
  kind: 'code',
  header: 'Actual Machine',
  className: 'mono text3',
  render: (r) =>
    r.isOsp ? (
      '—'
    ) : (
      <ActualMachineCell planned={r.plannedMachineCode} activeRunningMachineCode={r.machineCode} />
    ),
};

/** Operator on the floor, plus "Started By" inline (one line) when someone else
 *  pressed Start (ADR-197). */
const operatorColumn: DataTableColumn<RunningOpRow> = {
  id: 'operator',
  kind: 'text',
  header: 'Operator',
  align: 'left',
  ellipsis: true,
  render: (r) => {
    const startedBy = startedByDiffers(r);
    return (
      <>
        {r.operatorName ?? '—'}
        {startedBy ? <span className="text3"> · by {startedBy}</span> : null}
      </>
    );
  },
  title: (r) => {
    const startedBy = startedByDiffers(r);
    return startedBy
      ? `${r.operatorName ?? '—'} — Started By: ${startedBy}`
      : (r.operatorName ?? '');
  },
};

/** "Running now": the live sessions. First column (JC No.) is always pinned;
 *  the Stop action is added by the board as the trailing ⋯ menu. */
export function runningNowColumns(): DataTableColumn<RunningOpRow>[] {
  return [
    {
      id: 'jc_no',
      kind: 'code',
      header: 'JC No.',
      className: 'td-code cyan',
      render: (r) => <JcLink id={r.jobCardId} code={r.jobCardCode} />,
    },
    opColumn,
    operationColumn,
    itemCodeColumn,
    actualMachineColumn,
    operatorColumn,
    {
      id: 'started',
      kind: 'date',
      header: 'Started',
      className: 'mono',
      render: (r) => fmtDateAndTime(r.startDate, r.startTime),
    },
    polColumn,
    itemNameColumn,
    plannedMachineColumn,
  ];
}

/** "Recent": the last finished / cancelled sessions. Same layout as Running now
 *  but Ended + Op Status replace Started + the Stop action. */
export function recentOpsColumns(): DataTableColumn<RunningOpRow>[] {
  return [
    {
      id: 'jc_no',
      kind: 'code',
      header: 'JC No.',
      className: 'td-code',
      render: (r) => <JcLink id={r.jobCardId} code={r.jobCardCode} />,
    },
    opColumn,
    operationColumn,
    itemCodeColumn,
    actualMachineColumn,
    operatorColumn,
    {
      id: 'ended',
      kind: 'date',
      header: 'Ended',
      className: 'mono text3',
      render: (r) => fmtDateTime(r.endedAt),
    },
    {
      id: 'op_status',
      kind: 'badge',
      header: 'Op Status',
      render: (r) => <RunningOpStatusBadge status={r.status} />,
    },
    polColumn,
    itemNameColumn,
    plannedMachineColumn,
  ];
}
