// JC Operations board — columns + the ⋯ row menu (ADR-199 fit table: one line
// per row, always fits the screen). Moved out of routes/list.tsx, where they
// were a hand-built <Row>. What used to stack inside one cell is now a column
// of its own:
//   Item Code | Item Name                (the name sat under the code)
//   Completed | QC Pending               (the "⏳N QC" line under Completed)
//   Operation | Outsource Status | Vendor (the OSP tag, status and vendor)
//   Actual Machine | Qty per Machine     (the per-machine lines, ADR-164;
//                                         hidden by default — it shows in ▸)
// An outsource op keeps its amber row tint through rowClassName (jc-ops.css).

import { opSrNo, type JcOpsBoardRow } from '@innovic/shared';
import { Link } from '@tanstack/react-router';
import {
  formatMachineQty,
  machineSplitTitle,
  resolveActualMachine,
} from '@/components/shared/machine-split';
import { itemCodeWithRev } from '@/lib/item-code';
import type { DataTableColumn } from '@/ui/data';
import { OP_STATUS } from '../../job-cards/lib/jc-op-labels';

export const JC_OPS_DEFAULT_PINNED = ['item_code'];
export const JC_OPS_DEFAULT_HIDDEN = ['qty_per_machine'];

// Sort & Filter (server mode, ADR-200/201) — the board is paged, so every ▾
// runs on the server over ALL ops. `sortFilterField` names the field in the
// API's JC_OPS_SF_COLUMNS map. Actual Machine / Qty per Machine are worked
// out per row after the query, so they have no ▾.
const OP_STATUS_OPTIONS = Object.entries(OP_STATUS).map(([value, s]) => ({
  value,
  label: s.label,
}));
const QC_OPTIONS = [
  { value: 'true', label: 'Yes' },
  { value: 'false', label: 'No' },
];

// Our snake_case enum values, shown in Title Case (legacy L11359-L11368).
const OUTSOURCE_STATUS_LABELS: Record<string, string> = {
  pending: 'Pending',
  pr_raised: 'PR Raised',
  po_created: 'PO Created',
  sent: 'At Vendor',
  received: 'Received',
};

const OUTSOURCE_STATUS_COLOR: Record<string, string> = {
  pending: 'var(--text3)',
  pr_raised: 'var(--amber)',
  po_created: 'var(--blue)',
  sent: 'var(--amber)',
  received: 'var(--cyan)',
};

const isOutsource = (o: JcOpsBoardRow): boolean => o.opType === 'outsource';
const outsourceStatusOf = (o: JcOpsBoardRow): string => o.outsourceStatus || 'pending';
const dash = <span className="text3">—</span>;

function OpStatusBadge({ status }: { status: string }): React.JSX.Element {
  // One shared op-status map (job-cards/lib/jc-op-labels) — same words and
  // colours as the Job Card page.
  const s = OP_STATUS[status.toLowerCase()];
  return (
    <span className={`badge ${s?.cls ?? ''}`.trim()}>{s?.label ?? status.replace(/_/g, ' ')}</span>
  );
}

/** The PR / PO / at-vendor detail beside the outsource status — what the old
 *  action cell showed as text ("⏳ PR: …", "PO: …" link, "📦 At Vendor"). */
function OutsourceRef({ o, st }: { o: JcOpsBoardRow; st: string }): React.JSX.Element | null {
  if (st === 'pr_raised' && o.outsourcePrCode) {
    return <span className="mono"> · {o.outsourcePrCode}</span>;
  }
  if (st === 'po_created' && o.outsourcePoCode) {
    return (
      <>
        {' · '}
        {o.outsourcePoId ? (
          <Link
            to="/purchase-orders/$id"
            params={{ id: o.outsourcePoId }}
            className="mono"
            style={{ color: 'var(--blue)', textDecoration: 'underline dotted' }}
            onClick={(e) => e.stopPropagation()}
          >
            {o.outsourcePoCode}
          </Link>
        ) : (
          <span className="mono">{o.outsourcePoCode}</span>
        )}
      </>
    );
  }
  if (st === 'sent') return <span> ({o.sentQty} pcs)</span>;
  return null;
}

export function jcOpsColumns(): DataTableColumn<JcOpsBoardRow>[] {
  return [
    {
      // The JC number opens that card — only when `jcId` resolves; otherwise
      // it renders exactly as it always has (no dead link).
      id: 'jc_no',
      sortFilterField: 'jcCode',
      kind: 'code',
      header: 'JC No.',
      className: 'mono fw-700',
      render: (o) =>
        o.jcId ? (
          <Link
            to="/job-cards/$id"
            params={{ id: o.jcId }}
            title="View job card status"
            style={{ color: 'var(--cyan)', textDecoration: 'none' }}
          >
            {o.jcCode}
          </Link>
        ) : (
          <span style={{ color: 'var(--cyan)' }}>{o.jcCode}</span>
        ),
    },
    {
      // POL — the customer's own PO line number, before the item code.
      id: 'client_po_line_no',
      sortFilterField: 'clientPoLineNo',
      kind: 'code',
      header: 'POL',
      headColor: 'var(--purple)',
      className: 'mono fw-700',
      render: (o) => <span style={{ color: 'var(--purple)' }}>{o.clientPoLineNo ?? '—'}</span>,
    },
    {
      id: 'item_code',
      sortFilterField: 'itemCode',
      kind: 'code',
      header: 'Item Code',
      className: 'mono fw-700',
      render: (o) => (
        <span style={{ color: 'var(--text)' }}>
          {itemCodeWithRev(o.jcItemCode, o.itemRevision, '')}
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
      render: (o) => o.jcItemName ?? '',
      title: (o) => o.jcItemName ?? '',
    },
    {
      id: 'op_seq',
      sortFilterField: 'opSeq',
      filterType: 'num',
      kind: 'code',
      header: 'Op',
      className: 'mono fw-700',
      render: (o) => opSrNo(o.opSeq),
    },
    {
      // ADR-164 — PLANNED (where the remaining qty runs) and ACTUAL (who made
      // the Done qty, else the plan). An outsource op has neither.
      id: 'planned_machine',
      sortFilterField: 'plannedMachine',
      kind: 'code',
      header: 'Planned Machine',
      className: 'mono fw-700',
      render: (o) => (isOutsource(o) ? dash : o.machineCode?.trim() || '—'),
    },
    {
      id: 'actual_machine',
      kind: 'code',
      header: 'Actual Machine',
      className: 'mono fw-700',
      render: (o) => {
        if (isOutsource(o)) return dash;
        const a = resolveActualMachine({ planned: o.machineCode, machines: o.machines });
        return (
          <span
            style={{ color: a.differs ? 'var(--amber)' : undefined }}
            title={a.split.length ? machineSplitTitle(a.split) : undefined}
          >
            {a.label}
          </span>
        );
      },
    },
    {
      id: 'operation',
      sortFilterField: 'operation',
      kind: 'text',
      header: 'Operation',
      ellipsis: true,
      render: (o) => o.operation,
      title: (o) => o.operation,
    },
    {
      id: 'cycle_time',
      sortFilterField: 'cycleTime',
      kind: 'num',
      header: 'Cycle Time (h)',
      align: 'right',
      className: 'mono',
      render: (o) => (o.cycleTime ? o.cycleTime.toFixed(3) : '—'),
    },
    {
      id: 'qc_required',
      sortFilterField: 'qcRequired',
      filterOptions: QC_OPTIONS,
      kind: 'badge',
      header: 'QC',
      headColor: 'var(--green2)',
      render: (o) => (o.qcRequired ? <span className="badge b-green">Yes</span> : dash),
    },
    {
      id: 'jc_qty',
      sortFilterField: 'jcQty',
      kind: 'num',
      header: 'JC Qty',
      align: 'right',
      render: (o) => o.jcOrderQty,
    },
    {
      id: 'completed',
      sortFilterField: 'completed',
      kind: 'num',
      header: 'Completed',
      align: 'right',
      headColor: 'var(--green2)',
      className: 'mono fw-700',
      render: (o) => <span style={{ color: 'var(--green2)' }}>{o.completed}</span>,
    },
    {
      // Pieces made and still waiting for this op's QC — the "⏳N QC" line
      // that used to sit under Completed.
      id: 'qc_pending',
      sortFilterField: 'qcPending',
      kind: 'num',
      header: 'QC Pending',
      align: 'right',
      headColor: 'var(--amber2)',
      className: 'mono fw-700',
      render: (o) =>
        o.qcRequired && o.qcPending > 0 ? (
          <span style={{ color: 'var(--amber2)' }}>⏳{o.qcPending}</span>
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
      render: (o) => <span style={{ color: 'var(--amber2)' }}>{o.available}</span>,
    },
    {
      id: 'pending_hrs',
      sortFilterField: 'pendingHrs',
      kind: 'num',
      header: 'Pending Hrs',
      align: 'right',
      headColor: 'var(--red2)',
      className: 'mono fw-700',
      render: (o) => <span style={{ color: 'var(--red2)' }}>{o.pendingHrs.toFixed(1)}h</span>,
    },
    {
      id: 'op_status',
      sortFilterField: 'status',
      filterOptions: OP_STATUS_OPTIONS,
      kind: 'badge',
      header: 'Op Status',
      render: (o) => <OpStatusBadge status={o.status} />,
    },
    {
      // Legacy L11379 [OSP] tag + the outsource sub-status, in one column.
      id: 'outsource_status',
      sortFilterField: 'outsourceStatus',
      filterOptions: Object.entries(OUTSOURCE_STATUS_LABELS).map(([value, label]) => ({
        value,
        label,
      })),
      kind: 'badge',
      header: 'Outsource Status',
      render: (o) => {
        if (!isOutsource(o)) return dash;
        const st = outsourceStatusOf(o);
        return (
          <>
            <span className="badge b-purple">OSP</span>{' '}
            <span
              className="fw-700"
              style={{ color: OUTSOURCE_STATUS_COLOR[st] ?? 'var(--green)' }}
            >
              {OUTSOURCE_STATUS_LABELS[st] ?? st.replace(/_/g, ' ')}
            </span>
            <OutsourceRef o={o} st={st} />
          </>
        );
      },
    },
    {
      id: 'vendor',
      sortFilterField: 'vendor',
      kind: 'text',
      header: 'Vendor',
      ellipsis: true,
      className: 'text3',
      render: (o) => (isOutsource(o) ? (o.outsourceVendorName ?? '—') : '—'),
      title: (o) => (isOutsource(o) ? (o.outsourceVendorName ?? '') : ''),
    },
    {
      id: 'qty_per_machine',
      kind: 'text',
      header: 'Qty per Machine',
      ellipsis: true,
      className: 'text3',
      render: (o) => {
        if (isOutsource(o)) return '—'; // an outsourced op has no machine split
        const a = resolveActualMachine({ planned: o.machineCode, machines: o.machines });
        return a.split.length
          ? a.split.map((m) => formatMachineQty(m.machineCode, m.qty)).join(' · ')
          : '—';
      },
    },
  ];
}

export { type JcOpsActionProps, jcOpsRowMenu, renderJcOpsLink } from './jc-ops-row-menu';
