// Ready-to-process ("Available Now") board — columns, the ▸ detail set, the ⋯
// row menu and the row tint for the ADR-199 fit table (DataTable + tableKey).
// One line per op, always fits the screen; the detail columns drop into the ▸
// expander. Converted from the hand-built <ReadyRow> that used to live in
// routes/index.tsx. Op-status wording/colour come from the shared OpStatusBadge
// so the Ready board and the machine-load widget never disagree.

import type { ProductionDashboardReadyOp } from '@innovic/shared';
import { opSrNo } from '@innovic/shared';
import { Link } from '@tanstack/react-router';
import { ActualMachineCell, PlannedMachineCell } from '@/components/shared/machine-split';
import { itemCodeWithRev } from '@/lib/item-code';
import { ROW_TINT } from '@/ui/data';
import type { DataTableColumn, RowMenuItem } from '@/ui/data';
import { OP_STATUS_BADGES, OpStatusBadge } from './op-status-badge';

/** Op Status tick list for server Sort & Filter: stored value + label shown. */
const OP_STATUS_OPTIONS = Object.entries(OP_STATUS_BADGES).map(([value, b]) => ({
  value,
  label: b.label,
}));

// JC No. is column 0 (always pinned). The six visible columns match the brief:
// JC No. · Op · Operation · Actual Machine · Available · Op Status. The rest of
// the op detail is hidden by default and shows in the ▸ expander.
export const PROD_READY_DEFAULT_PINNED = ['jc_no'];
export const PROD_READY_DEFAULT_HIDDEN = [
  'item_code',
  'item_name',
  'planned_machine',
  'order_qty',
  'completed',
  'pending_hrs',
];

const dash = <span className="text3">—</span>;
const hasMachine = (op: ProductionDashboardReadyOp): boolean =>
  Boolean(op.machineCode || op.machines.length);

/** Soft row wash where a real status maps (ADR-199). An Available-Now op is
 *  normally just "available" (no tint); a finished one reads done, a QC-waiting
 *  one pending. Hover/selection always win. */
export function prodReadyRowTint(op: ProductionDashboardReadyOp): string | undefined {
  if (op.computedStatus === 'complete') return ROW_TINT.done;
  if (op.computedStatus === 'qc_pending') return ROW_TINT.pending;
  return undefined;
}

export function prodReadyColumns(): DataTableColumn<ProductionDashboardReadyOp>[] {
  return [
    {
      // DESTINATION (user request, 2026-09-11): a JC number goes to the job card
      // itself, everywhere in the app. Op Entry is reachable from the ⋯ menu.
      id: 'jc_no',
      sortFilterField: 'jobCardCode',
      kind: 'code',
      header: 'JC No.',
      className: 'td-code',
      render: (op) => (
        <Link
          to="/job-cards/$id"
          params={{ id: op.jobCardId }}
          style={{ color: 'var(--cyan)', textDecoration: 'none' }}
          title="View job card status"
        >
          {op.jobCardCode}
        </Link>
      ),
    },
    {
      id: 'op_seq',
      sortFilterField: 'opSeq',
      filterType: 'num',
      kind: 'code',
      header: 'Op',
      className: 'mono',
      render: (op) => opSrNo(op.opSeq),
    },
    {
      id: 'operation',
      sortFilterField: 'operation',
      kind: 'text',
      header: 'Operation',
      ellipsis: true,
      render: (op) => op.operation,
      title: (op) => op.operation,
    },
    {
      // ADR-164 — who actually made the Completed qty (else the plan). An op with
      // no machine at all (OSP) keeps its dash.
      id: 'actual_machine',
      kind: 'code',
      header: 'Actual Machine',
      render: (op) =>
        hasMachine(op) ? (
          <ActualMachineCell planned={op.machineCode} machines={op.machines} />
        ) : (
          dash
        ),
    },
    {
      id: 'available',
      sortFilterField: 'available',
      kind: 'num',
      header: 'Available',
      align: 'right',
      headColor: 'var(--amber2)',
      className: 'mono fw-700',
      render: (op) => <span style={{ color: 'var(--amber2)' }}>{op.available}</span>,
    },
    {
      id: 'op_status',
      sortFilterField: 'computedStatus',
      filterOptions: OP_STATUS_OPTIONS,
      kind: 'badge',
      header: 'Op Status',
      render: (op) => <OpStatusBadge status={op.computedStatus} />,
    },
    // ── ▸ detail (hidden by default) ──────────────────────────────────────────
    {
      // The item the card is for. The code leads because it carries the drawing
      // revision (CODE/REV) the operator works to.
      id: 'item_code',
      sortFilterField: 'itemCode',
      kind: 'code',
      header: 'Item Code',
      className: 'td-code',
      render: (op) => (
        <span style={{ color: 'var(--text)' }}>
          {itemCodeWithRev(op.itemCode, op.itemRevision, '')}
        </span>
      ),
    },
    {
      id: 'item_name',
      sortFilterField: 'itemName',
      kind: 'text',
      header: 'Item Name',
      align: 'left',
      ellipsis: true,
      className: 'text3',
      render: (op) => op.itemName ?? '',
      title: (op) => op.itemName ?? '',
    },
    {
      // ADR-164 — where the REMAINING qty runs.
      id: 'planned_machine',
      sortFilterField: 'machineCode',
      kind: 'code',
      header: 'Planned Machine',
      render: (op) => (hasMachine(op) ? <PlannedMachineCell planned={op.machineCode} /> : dash),
    },
    {
      id: 'order_qty',
      sortFilterField: 'orderQty',
      kind: 'num',
      header: 'Order Qty',
      align: 'right',
      className: 'mono',
      render: (op) => op.orderQty,
    },
    {
      id: 'completed',
      sortFilterField: 'completedQty',
      kind: 'num',
      header: 'Completed',
      align: 'right',
      headColor: 'var(--green2)',
      className: 'mono fw-700',
      render: (op) => <span style={{ color: 'var(--green)' }}>{op.completedQty}</span>,
    },
    {
      id: 'pending_hrs',
      sortFilterField: 'pendingHrs',
      kind: 'num',
      header: 'Pending Hrs',
      align: 'right',
      className: 'mono',
      render: (op) => <span style={{ color: 'var(--orange)' }}>{op.pendingHrs}</span>,
    },
  ];
}

/** The ⋯ menu's one item: ▶ Start / ✚ Log, deep-linking into Op Entry — the same
 *  rule the Job Queue uses. Pieces already made → Log Op (Complete half); none
 *  yet → Start Operation. Only for a machine op with no session running; an OSP
 *  op (no machine) is booked from its DC, not Op Entry. Running / nothing waiting
 *  → the server refuses, so the item is greyed. */
export function prodReadyRowMenu(
  op: ProductionDashboardReadyOp,
  canOpEntry: boolean,
): RowMenuItem[] {
  const logging = op.completedQty > 0;
  const running = op.computedStatus === 'running';
  const startReason = running || op.available > 0 ? undefined : 'Nothing Pending';
  return [
    {
      key: 'op-entry',
      label: logging ? 'Log Op' : 'Start Operation',
      icon: logging ? 'plus' : 'play',
      group: 'workflow',
      hidden: !canOpEntry || !hasMachine(op) || running,
      disabledReason: startReason,
      ...(startReason
        ? {}
        : {
            to: `/op-entry?${new URLSearchParams({
              jc: op.jobCardCode,
              op: op.jcOpId,
              mode: logging ? 'complete' : 'start',
            }).toString()}`,
          }),
    },
  ];
}
