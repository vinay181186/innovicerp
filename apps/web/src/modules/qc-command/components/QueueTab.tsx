// Assign Inspector tab (legacy _qccRenderQueue L18667). Pending QC ops with age,
// attempt counter, due date, assignment, and Pick-Up / Assign actions.
// Sortable by age / due date / customer — the sort runs on the SERVER over the
// whole queue and the table shows one 25-row page (ADR-201).
//
// ADR-199 table standard: the data table is the shared fit table
// (<DataTable tableKey={TABLE_KEYS.qcCommandQueue}>). First pinned column is
// JC No.; Item Name, SO No., Customer and Due Date ride in the ▸ detail row
// (defaultHidden). Overdue rows carry the shared late tint (ROW_TINT.late). The
// Sort-by bar, the Pick Up / Assign actions and the permission gates are kept.

import { type QcCommandQueueRow, type QcQueueSort, opSrNo } from '@innovic/shared';
import { fmtDate } from '@/lib/date';
import { itemCodeWithRev } from '@/lib/item-code';
import { soNoWithInternal } from '@/lib/so-number';
import { DataTable, Panel, ROW_TINT, type DataTableColumn } from '@/ui/data';
import { TABLE_KEYS } from '@/ui/data/table-keys';
import { type QcPager, TablePager } from './TablePager';

const SORTS: { id: QcQueueSort; label: string }[] = [
  { id: 'age', label: 'Oldest First' },
  { id: 'due', label: 'Due Date' },
  { id: 'customer', label: 'Customer' },
];

/** "1 day" / "3 days" — the one waiting-time format on every QC screen. */
function daysText(n: number): string {
  return `${n} ${n === 1 ? 'day' : 'days'}`;
}
function attemptColor(n: number): string {
  if (n === 1) return 'var(--green)';
  if (n === 2) return 'var(--amber)';
  return 'var(--red)';
}
function ageColor(n: number): string {
  if (n >= 3) return 'var(--red)';
  if (n >= 1) return 'var(--amber)';
  return 'var(--green)';
}

/** Item Name, SO No., Customer and Due Date ride in the ▸ detail row. */
const QUEUE_HIDDEN_COLUMNS = ['item_name', 'so_code', 'customer', 'due_date'] as const;

export function QueueTab({
  rows,
  sort,
  onSort,
  pager,
  canPickUp,
  canAssign,
  busyId,
  onPickUp,
  onAssign,
}: {
  /** This page of the queue, already in `sort` order (server-side). */
  rows: QcCommandQueueRow[];
  sort: QcQueueSort;
  onSort: (s: QcQueueSort) => void;
  pager: QcPager;
  // Both come from the caller's qc_submit tier now, not their global role:
  // pick-up is `entry`, assign-to-another is `edit`.
  canPickUp: boolean;
  canAssign: boolean;
  busyId: string | null;
  onPickUp: (jcOpId: string) => void;
  onAssign: (row: QcCommandQueueRow) => void;
}): React.JSX.Element {
  const showActions = canPickUp || canAssign;

  const columns: DataTableColumn<QcCommandQueueRow>[] = [
    {
      id: 'jc_code',
      header: 'JC No.',
      nowrap: true,
      render: (it) => (
        <span className="td-code" style={{ color: 'var(--cyan)' }}>
          {it.jcCode}
        </span>
      ),
    },
    {
      id: 'op',
      header: 'Op',
      nowrap: true,
      render: (it) => (
        <span className="mono fw-700" style={{ color: 'var(--red2)' }}>
          {opSrNo(it.opSeq)}
        </span>
      ),
    },
    {
      id: 'operation',
      header: 'Operation',
      align: 'left',
      ellipsis: true,
      render: (it) => <span style={{ fontWeight: 600, color: 'var(--red2)' }}>{it.operation}</span>,
      title: (it) => it.operation,
    },
    {
      id: 'item_code',
      header: 'Item Code',
      nowrap: true,
      // An inspector reads the code to find the drawing, so it carries weight
      // rather than sitting in the faintest token on the page (item-code rule).
      render: (it) => (
        <span className="mono fw-700" style={{ color: 'var(--text)' }}>
          {itemCodeWithRev(it.itemCode, it.itemRevision)}
        </span>
      ),
    },
    {
      id: 'days_waiting',
      header: 'Days Waiting',
      align: 'right',
      nowrap: true,
      render: (it) => (
        <span className="mono fw-700" style={{ color: ageColor(it.ageDays) }}>
          {daysText(it.ageDays)}
        </span>
      ),
      filterValue: (it) => it.ageDays,
    },
    {
      id: 'qc_pending',
      header: 'QC Pending',
      align: 'right',
      nowrap: true,
      render: (it) => (
        <span className="mono fw-700" style={{ color: 'var(--amber2)' }}>
          {it.pendingQty}
        </span>
      ),
    },
    {
      id: 'attempts',
      kind: 'badge',
      header: 'Attempts',
      nowrap: true,
      render: (it) => (
        <span
          style={{
            fontSize: 11,
            fontWeight: 700,
            padding: '2px 10px',
            borderRadius: 10,
            background: 'var(--bg3)',
            color: attemptColor(it.attemptNo),
          }}
        >
          {it.attemptNo}
        </span>
      ),
      filterValue: (it) => it.attemptNo,
    },
    {
      id: 'assigned_to',
      header: 'Assigned To',
      nowrap: true,
      render: (it) =>
        it.assignedTo ? (
          <span style={{ color: 'var(--blue)', fontWeight: 600 }}>{it.assignedTo}</span>
        ) : (
          <span className="text3">—</span>
        ),
    },
    // ── ▸ detail row (defaultHidden) — reachable from the Columns menu. ──
    {
      id: 'item_name',
      header: 'Item Name',
      align: 'left',
      ellipsis: true,
      className: 'fw-700',
      render: (it) => it.itemName?.trim() || '—',
      title: (it) => it.itemName ?? '',
    },
    {
      id: 'so_code',
      header: 'SO No.',
      nowrap: true,
      render: (it) => (
        <span style={{ color: 'var(--cyan)' }}>
          {it.soCode ? soNoWithInternal(it.soCode, it.soInternalNo) : '—'}
        </span>
      ),
    },
    {
      id: 'customer',
      header: 'Customer',
      align: 'left',
      ellipsis: true,
      render: (it) => it.customer?.trim() || '—',
      title: (it) => it.customer ?? '',
    },
    {
      id: 'due_date',
      kind: 'date',
      header: 'Due Date',
      nowrap: true,
      render: (it) => (
        <span style={{ color: it.isOverdue ? 'var(--red)' : 'var(--text3)' }}>
          {fmtDate(it.dueDate)}
        </span>
      ),
      filterValue: (it) => it.dueDate ?? '',
    },
  ];

  return (
    <>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: 12,
          flexWrap: 'wrap',
          gap: 8,
        }}
      >
        {/* No title here — the tab above already names this list. */}
        <div />
        <div style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 11 }}>
          <span className="text3">Sort by:</span>
          {SORTS.map((s) => (
            <button
              key={s.id}
              type="button"
              className="btn btn-ghost btn-sm"
              style={
                sort === s.id
                  ? {
                      fontSize: 11,
                      background: 'var(--red3)',
                      color: 'var(--red2)',
                      border: '1px solid var(--red)',
                    }
                  : { fontSize: 11 }
              }
              onClick={() => onSort(s.id)}
            >
              {s.label}
            </button>
          ))}
        </div>
      </div>

      {/* Legacy L18691 returns early on an empty queue: no panel, no table, no
          tip — just the sort bar and this line. */}
      {pager.total === 0 ? (
        <div className="empty-state" style={{ color: 'var(--green2)' }}>
          No QC Pending items.
        </div>
      ) : (
        <Panel bodyPadding="none">
          <DataTable
            tableKey={TABLE_KEYS.qcCommandQueue}
            columns={columns}
            defaultHidden={[...QUEUE_HIDDEN_COLUMNS]}
            rows={rows}
            rowKey={(it) => it.jcOpId}
            rowClassName={(it) => (it.isOverdue ? ROW_TINT.late : undefined)}
            rowActionsWidth="1%"
            {...(showActions
              ? {
                  rowMenu: (it: QcCommandQueueRow) => [
                    {
                      key: 'pick-up',
                      label: 'Pick Up',
                      icon: 'check' as const,
                      group: 'workflow' as const,
                      hidden: !canPickUp,
                      // The pick-up for this op is already on its way.
                      disabledReason: busyId === it.jcOpId ? 'Working…' : undefined,
                      onSelect: () => onPickUp(it.jcOpId),
                    },
                    {
                      key: 'assign',
                      label: 'Assign',
                      icon: 'user-round' as const,
                      group: 'workflow' as const,
                      hidden: !canAssign,
                      onSelect: () => onAssign(it),
                    },
                  ],
                }
              : {})}
          />
          <TablePager pager={pager} noun="call" />
        </Panel>
      )}
    </>
  );
}
