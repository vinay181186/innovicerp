// Job Queue — the shared fit-table columns, row tint and Action cell (ADR-199
// table standard 2026-10-01). Split out of routes/list.tsx so that file stays
// under the line ceiling and every machine panel builds ITS columns from one
// place, guaranteeing one shared layout (one tableKey) across every machine.
//
// One row per pending op. The eight on-sheet columns below (first pinned =
// JC No.) carry the facts the shop floor reads at a glance; the rest ride in
// the row's ▸ detail via JOB_QUEUE_HIDDEN_IDS. Labels per docs/NAMING.md
// (JC No., Sr No, Op, Operation, Item Code, Available, Op Status, Due Date,
// POL, Item Name, SO No., Customer, Priority, Order Qty, Completed, Actual
// Machine).

import type { JobQueueMachine, JobQueueRow } from '@innovic/shared';
import { opSrNo } from '@innovic/shared';
import { Link } from '@tanstack/react-router';
import { ActualMachineLine } from '@/components/shared/machine-split';
import { fmtDate } from '@/lib/date';
import { itemCodeWithRev } from '@/lib/item-code';
import { OP_STATUS } from '@/modules/job-cards/lib/jc-op-labels';
import { renderJcOpsLink } from '@/modules/jc-ops/components/jc-ops-columns';
import { ROW_TINT, RowMenu } from '@/ui/data';
import type { DataTableColumn } from '@/ui/data';

/** Legacy L10406/L10407 — the ▲/▼ queue-move buttons are inline-styled. */
const queueBtnStyle: React.CSSProperties = {
  background: 'none',
  border: '1px solid var(--border2)',
  borderRadius: 3,
  padding: '0 4px',
  cursor: 'pointer',
  fontSize: 11,
  color: 'var(--text2)',
  lineHeight: 1.6,
};

/** The next op to process on this machine: some qty is free and nothing of it is
 *  running yet (the same rule the queue has always used to tint the amber row
 *  and to enable Start / Complete). */
export function isNextRow(r: JobQueueRow): boolean {
  return r.available > 0 && !r.isRunning;
}

/** Whole-row wash: overdue (past its Due Date, not finished) reads red; the
 *  next-to-process op reads amber. Overdue wins — it is the more urgent signal.
 *  `today` is the IST yyyy-mm-dd the route computes once. */
export function jobQueueRowTint(r: JobQueueRow, today: string): string | undefined {
  const overdue = r.dueDate != null && r.dueDate < today && r.status !== 'complete';
  if (overdue) return ROW_TINT.late;
  if (isNextRow(r)) return ROW_TINT.pending;
  return undefined;
}

/** Op status words + colours: the ONE shared map (job-cards/lib/jc-op-labels). */
function StatusBadge({ status }: { status: string }): React.JSX.Element {
  const hit = OP_STATUS[status.toLowerCase()];
  const cls = hit ? hit.cls : 'b-grey';
  return (
    <span className={cls ? `badge ${cls}` : 'badge'}>
      {hit ? hit.label : status.replace(/_/g, ' ')}
    </span>
  );
}

/** Legacy badge() (L1959): 'High' → b-amber, 'Normal' → b-grey. */
function PriorityBadge({ priority }: { priority: string }): React.JSX.Element {
  const high = priority.toLowerCase() === 'high';
  return <span className={`badge ${high ? 'b-amber' : 'b-grey'}`}>{high ? 'High' : 'Normal'}</span>;
}

/** Columns moved off the sheet into the row's ▸ detail (defaultHidden). */
export const JOB_QUEUE_HIDDEN_IDS: string[] = [
  'pol',
  'item_name',
  'so_no',
  'customer',
  'priority',
  'order_qty',
  'completed',
  'actual_machine',
];

/**
 * The columns for one machine's queue. The ids are identical for every machine,
 * so passing the SAME tableKey to every panel's DataTable gives one shared,
 * remembered layout. `machine` is only read for the Actual Machine line and the
 * queue position; the column identities never depend on it.
 */
export function jobQueueColumns(opts: {
  machine: JobQueueMachine;
  /** jc_op id → its position in this machine's FULL queue (not the filtered
   *  rows), so Sr No stays true while a search narrows what is shown. */
  posById: Map<string, number>;
  today: string;
}): DataTableColumn<JobQueueRow>[] {
  const { machine, posById, today } = opts;
  return [
    {
      id: 'jc_no',
      header: 'JC No.',
      nowrap: true,
      render: (r) => (
        <Link
          to="/job-cards/$id"
          params={{ id: r.jcId }}
          className="td-code cyan"
          style={{ color: 'inherit', textDecoration: 'underline dotted' }}
          onClick={(e) => e.stopPropagation()}
        >
          {r.jcCode}
        </Link>
      ),
    },
    {
      id: 'sr_no',
      header: 'Sr No',
      kind: 'code',
      className: 'mono fw-700',
      nowrap: true,
      render: (r) => {
        const pos = (posById.get(r.jcOpId) ?? 0) + 1;
        return <span style={{ color: isNextRow(r) ? 'var(--amber)' : 'var(--text3)' }}>{pos}</span>;
      },
    },
    {
      id: 'op',
      header: 'Op',
      kind: 'code',
      className: 'mono',
      nowrap: true,
      render: (r) => opSrNo(r.opSeq),
    },
    {
      id: 'operation',
      header: 'Operation',
      kind: 'text',
      align: 'left',
      ellipsis: true,
      render: (r) => r.operation,
      title: (r) => r.operation,
    },
    {
      id: 'item_code',
      header: 'Item Code',
      kind: 'code',
      className: 'mono fw-700',
      nowrap: true,
      render: (r) => (
        <span style={{ color: 'var(--text)' }}>
          {itemCodeWithRev(r.itemCode, r.itemRevision, '—')}
        </span>
      ),
    },
    {
      id: 'available',
      header: 'Available',
      align: 'right',
      headColor: 'var(--amber2)',
      className: 'mono fw-700',
      nowrap: true,
      render: (r) => (
        <span style={{ fontSize: 15, color: isNextRow(r) ? 'var(--amber)' : 'var(--text3)' }}>
          {r.available}
        </span>
      ),
    },
    {
      id: 'op_status',
      header: 'Op Status',
      kind: 'badge',
      nowrap: true,
      render: (r) => <StatusBadge status={r.isRunning ? 'running' : r.status} />,
    },
    {
      id: 'due_date',
      header: 'Due Date',
      kind: 'date',
      className: 'mono',
      nowrap: true,
      render: (r) => {
        const overdue = r.dueDate != null && r.dueDate < today && r.status !== 'complete';
        if (!r.dueDate) return <span className="text2">—</span>;
        return (
          <span
            style={{
              color: overdue ? 'var(--red)' : 'var(--text2)',
              fontWeight: overdue ? 700 : undefined,
            }}
          >
            {fmtDate(r.dueDate)}
            {overdue ? ' ⚠' : ''}
          </span>
        );
      },
    },
    // ── ▸ detail (defaultHidden) ─────────────────────────────────────────────
    {
      id: 'pol',
      header: 'POL',
      headColor: 'var(--purple)',
      nowrap: true,
      render: (r) => (
        <span className="mono fw-700" style={{ color: 'var(--purple)' }}>
          {r.clientPoLineNo ?? '—'}
        </span>
      ),
    },
    {
      id: 'item_name',
      header: 'Item Name',
      kind: 'text',
      align: 'left',
      ellipsis: true,
      render: (r) => r.itemName ?? '—',
      title: (r) => r.itemName ?? '',
    },
    {
      id: 'so_no',
      header: 'SO No.',
      kind: 'code',
      className: 'mono',
      nowrap: true,
      render: (r) => r.soCode ?? '—',
    },
    {
      id: 'customer',
      header: 'Customer',
      kind: 'text',
      align: 'left',
      ellipsis: true,
      render: (r) => r.soCustomer ?? '—',
      title: (r) => r.soCustomer ?? '',
    },
    {
      id: 'priority',
      header: 'Priority',
      kind: 'badge',
      nowrap: true,
      render: (r) => <PriorityBadge priority={r.priority} />,
    },
    {
      id: 'order_qty',
      header: 'Order Qty',
      align: 'right',
      className: 'mono',
      nowrap: true,
      render: (r) => r.orderQty,
    },
    {
      id: 'completed',
      header: 'Completed',
      align: 'right',
      headColor: 'var(--green2)',
      className: 'mono fw-700 green',
      nowrap: true,
      render: (r) => r.completed,
    },
    {
      id: 'actual_machine',
      header: 'Actual Machine',
      kind: 'text',
      align: 'left',
      // ADR-164 / ADR-126 — which machine ACTUALLY made the Completed figure:
      // the same name when nothing changed, amber when it differs, with the
      // per-machine breakdown for a 2+ machine split.
      render: (r) => <ActualMachineLine planned={machine.machineCode} machines={r.machines} />,
    },
  ];
}

/**
 * The row's Action cell: the ▲/▼ queue-reorder controls (reused verbatim from
 * the legacy handler via `onMove`) and the ⋯ op-entry menu. The reorder arrows
 * are hidden while a search term is typed — a move swaps a row with its
 * neighbour in the FULL queue, which a filtered view no longer shows — and when
 * the user cannot reorder. Spacers keep the two-row arrow stack aligned.
 */
export function jobQueueRowActions(opts: {
  row: JobQueueRow;
  machine: JobQueueMachine;
  posById: Map<string, number>;
  canReorder: boolean;
  canOpEntry: boolean;
  /** True while a search term narrows the rows — hides the arrows. */
  searching: boolean;
  onMove: (machineId: string, opId: string, dir: 'up' | 'down') => void;
}): React.JSX.Element {
  const { row: r, machine: m, posById, canReorder, canOpEntry, searching, onMove } = opts;
  const idx = posById.get(r.jcOpId) ?? 0;
  const isNext = isNextRow(r);
  // ADR-126 — "started" has to mean started ON THIS MACHINE. When the split is
  // empty nothing is attributed to any machine, so fall back to the op total.
  const startedHere =
    r.machines.length > 0
      ? r.machines.some((s) => s.machineCode === m.machineCode && s.qty > 0)
      : r.completed > 0;
  const showUp = canReorder && !searching && idx > 0;
  const showDown = canReorder && !searching && idx < m.rows.length - 1;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, justifyContent: 'center' }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2, alignItems: 'center' }}>
        {showUp ? (
          <button
            type="button"
            style={queueBtnStyle}
            onClick={() => onMove(m.machineId, r.jcOpId, 'up')}
            title="Move up"
          >
            ▲
          </button>
        ) : (
          <span style={{ width: 18, display: 'inline-block' }} />
        )}
        {showDown ? (
          <button
            type="button"
            style={queueBtnStyle}
            onClick={() => onMove(m.machineId, r.jcOpId, 'down')}
            title="Move down"
          >
            ▼
          </button>
        ) : (
          <span style={{ width: 18, display: 'inline-block' }} />
        )}
      </div>
      {/* T33: only offer "Complete" once the op is started on this machine;
          otherwise "Start Operation". Not the next job → greyed. */}
      <RowMenu
        renderLink={renderJcOpsLink}
        items={[
          {
            key: 'op-entry',
            label: startedHere ? 'Complete' : 'Start Operation',
            icon: startedHere ? 'check' : 'play',
            group: 'workflow',
            // A running job is completed from its own row, so the item is hidden
            // (not greyed) while it runs.
            hidden: !canOpEntry || (r.isRunning && !isNext),
            disabledReason: isNext ? undefined : 'Nothing Pending',
            ...(isNext
              ? {
                  to: `/op-entry?${new URLSearchParams({
                    jc: r.jcCode,
                    op: r.jcOpId,
                    mode: startedHere ? 'complete' : 'start',
                  }).toString()}`,
                }
              : {}),
          },
        ]}
      />
    </div>
  );
}
