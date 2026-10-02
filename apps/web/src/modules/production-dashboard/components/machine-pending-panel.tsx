// Machine Pending tab (legacy "Machine-wise Pending Work", L3670-3714 +
// L3780-3788). ADR-203 frozen header: the card-per-machine grid is now ONE
// table — a blue group heading per machine ("VMC-1 · Name · 3 ops · Running")
// over that machine's pending ops. The rows are the machine-loading `ops` list
// (already server-sorted priority → due → op_seq, kept within each machine),
// grouped in the machines' own order. Same six columns the mini-tables had.
// Machines with nothing pending (the old "Idle" cards) are named on one line
// above the table, so no machine drops out of sight.

import { TABLE_KEYS } from '@/ui/data/table-keys';
import type { MachineLoadOp } from '@innovic/shared';
import { Link } from '@tanstack/react-router';
import { useMemo } from 'react';
import { addDaysLocal, fmtDate, todayIst } from '@/lib/date';
import { itemCodeWithRev } from '@/lib/item-code';
import { DataTable, Panel } from '@/ui/data';
import type { DataTableColumn } from '@/ui/data';
import { OpStatusBadge } from './op-status-badge';

// IST today + 3 days (not the UTC date, which is a day behind before 05:30 IST).
const DUE_SOON_ISO = addDaysLocal(todayIst(), 3);

export interface PendingMachine {
  machineId: string;
  machineCode: string;
  name: string;
}

interface PendingRow {
  op: MachineLoadOp;
  machine: PendingMachine;
  /** Ops in this machine's group / how many of them are running — the
   *  card header's figures, now on the group heading. */
  groupCount: number;
  groupRunning: number;
}

/** Machines (in their own order) → their pending ops, flattened for the one
 *  table; plus the machines with nothing pending. */
export function groupPendingOps(
  machines: PendingMachine[],
  ops: MachineLoadOp[],
): { rows: PendingRow[]; idle: PendingMachine[] } {
  const byMachine = new Map<string, MachineLoadOp[]>();
  for (const op of ops) {
    if (!op.machineId) continue;
    const list = byMachine.get(op.machineId);
    if (list) list.push(op);
    else byMachine.set(op.machineId, [op]);
  }
  const rows: PendingRow[] = [];
  const idle: PendingMachine[] = [];
  for (const m of machines) {
    const list = byMachine.get(m.machineId) ?? [];
    if (list.length === 0) {
      idle.push(m);
      continue;
    }
    const running = list.filter((o) => o.computedStatus === 'running').length;
    for (const op of list) {
      rows.push({ op, machine: m, groupCount: list.length, groupRunning: running });
    }
  }
  return { rows, idle };
}

const COLUMNS: DataTableColumn<PendingRow>[] = [
  {
    id: 'jc_no',
    header: 'JC No.',
    kind: 'code',
    nowrap: true,
    render: ({ op }) => (
      <Link
        to="/job-cards/$id"
        params={{ id: op.jobCardId }}
        title="View job card status"
        className="mono cyan"
        style={{ textDecoration: 'none' }}
      >
        {op.jobCardCode}
      </Link>
    ),
  },
  {
    // The code carries the drawing revision; the name is only the fallback for
    // a card with no code.
    id: 'item_code',
    header: 'Item Code',
    kind: 'code',
    className: 'mono fw-700',
    nowrap: true,
    render: ({ op }) => (
      <span style={{ color: 'var(--text)' }}>
        {itemCodeWithRev(op.itemCode, op.itemRevision, op.itemName ?? '')}
      </span>
    ),
  },
  {
    id: 'operation',
    header: 'Operation',
    kind: 'text',
    align: 'left',
    ellipsis: true,
    render: ({ op }) => op.operation,
    title: ({ op }) => op.operation,
  },
  {
    id: 'op_status',
    header: 'Op Status',
    kind: 'badge',
    nowrap: true,
    render: ({ op }) => <OpStatusBadge status={op.computedStatus} />,
  },
  {
    id: 'available',
    header: 'Available',
    align: 'right',
    headColor: 'var(--amber2)',
    className: 'mono fw-700',
    nowrap: true,
    render: ({ op }) => <span style={{ color: 'var(--amber2)' }}>{op.available}</span>,
  },
  {
    id: 'due_date',
    header: 'Due Date',
    kind: 'date',
    nowrap: true,
    render: ({ op }) => {
      const dueSoon = op.dueDate != null && op.dueDate <= DUE_SOON_ISO;
      return (
        <span style={{ color: dueSoon ? 'var(--red)' : 'var(--text3)' }}>
          {fmtDate(op.dueDate)}
        </span>
      );
    },
  },
];

function MachineHeading({ row }: { row: PendingRow }): React.JSX.Element {
  const { machine: m, groupCount: n, groupRunning } = row;
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
      <span className="mono fw-700">{m.machineCode}</span>
      {m.name ? <span>· {m.name}</span> : null}
      <span>
        · {n} op{n !== 1 ? 's' : ''} ·
      </span>
      {groupRunning > 0 ? (
        <span className="badge b-green">Running</span>
      ) : (
        <span className="badge b-amber">Pending</span>
      )}
    </span>
  );
}

/** Machines that have at least one pending op — the tab's count. */
export function countBusyMachines(machines: PendingMachine[], ops: MachineLoadOp[]): number {
  return groupPendingOps(machines, ops).rows.reduce(
    (seen, r) => seen.add(r.machine.machineId),
    new Set<string>(),
  ).size;
}

export function MachinePendingPanel({
  machines,
  ops,
  isLoading,
}: {
  machines: PendingMachine[];
  ops: MachineLoadOp[];
  isLoading: boolean;
}): React.JSX.Element {
  const { rows, idle } = useMemo(() => groupPendingOps(machines, ops), [machines, ops]);
  return (
    <>
      {idle.length > 0 && rows.length > 0 ? (
        <div className="text3" style={{ fontSize: 'var(--fs-sm)', marginBottom: 'var(--sp-2)' }}>
          Idle (no pending work):{' '}
          <span className="mono">{idle.map((m) => m.machineCode).join(', ')}</span>
        </div>
      ) : null}
      <Panel
        fill
        bodyPadding="none"
        actions={
          <Link to="/job-queue" className="btn btn-ghost btn-sm">
            Full Queue →
          </Link>
        }
      >
        <DataTable<PendingRow>
          tableKey={TABLE_KEYS.prodDashboardMachinePending}
          columns={COLUMNS}
          rows={rows}
          rowKey={(r) => `${r.machine.machineId}:${r.op.jcOpId}`}
          loading={isLoading && machines.length === 0}
          emptyText={machines.length === 0 ? 'No Machines yet.' : 'No pending work on any machine.'}
          frozen
          groupRow={(r, _i, prev) =>
            prev && prev.machine.machineId === r.machine.machineId ? null : (
              <MachineHeading row={r} />
            )
          }
        />
      </Panel>
    </>
  );
}
