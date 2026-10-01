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
import type { DataTableColumn, RowMenuItem } from '@/ui/data';
import type { RenderLink } from '@/ui/layout';
import { OP_STATUS } from '../../job-cards/lib/jc-op-labels';

export const JC_OPS_DEFAULT_PINNED = ['item_code'];
export const JC_OPS_DEFAULT_HIDDEN = ['qty_per_machine'];

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
      kind: 'code',
      header: 'POL',
      headColor: 'var(--purple)',
      className: 'mono fw-700',
      render: (o) => <span style={{ color: 'var(--purple)' }}>{o.clientPoLineNo ?? '—'}</span>,
    },
    {
      id: 'item_code',
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
      kind: 'code',
      header: 'Op',
      className: 'mono fw-700',
      render: (o) => opSrNo(o.opSeq),
    },
    {
      // ADR-164 — PLANNED (where the remaining qty runs) and ACTUAL (who made
      // the Done qty, else the plan). An outsource op has neither.
      id: 'planned_machine',
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
      kind: 'text',
      header: 'Operation',
      ellipsis: true,
      render: (o) => o.operation,
      title: (o) => o.operation,
    },
    {
      id: 'cycle_time',
      kind: 'num',
      header: 'Cycle Time (h)',
      align: 'right',
      className: 'mono',
      render: (o) => (o.cycleTime ? o.cycleTime.toFixed(3) : '—'),
    },
    {
      id: 'qc_required',
      kind: 'badge',
      header: 'QC',
      headColor: 'var(--green2)',
      render: (o) => (o.qcRequired ? <span className="badge b-green">Yes</span> : dash),
    },
    {
      id: 'jc_qty',
      kind: 'num',
      header: 'JC Qty',
      align: 'right',
      render: (o) => o.jcOrderQty,
    },
    {
      id: 'completed',
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
      kind: 'num',
      header: 'Available',
      align: 'right',
      headColor: 'var(--amber2)',
      className: 'mono fw-700',
      render: (o) => <span style={{ color: 'var(--amber2)' }}>{o.available}</span>,
    },
    {
      id: 'pending_hrs',
      kind: 'num',
      header: 'Pending Hrs',
      align: 'right',
      headColor: 'var(--red2)',
      className: 'mono fw-700',
      render: (o) => <span style={{ color: 'var(--red2)' }}>{o.pendingHrs.toFixed(1)}h</span>,
    },
    {
      id: 'op_status',
      kind: 'badge',
      header: 'Op Status',
      render: (o) => <OpStatusBadge status={o.status} />,
    },
    {
      // Legacy L11379 [OSP] tag + the outsource sub-status, in one column.
      id: 'outsource_status',
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

export interface JcOpsActionProps {
  canWrite: boolean;
  canCreatePr: boolean;
  canOpEntry: boolean;
  onEdit: (o: JcOpsBoardRow) => void;
  onCreatePr: (o: JcOpsBoardRow) => void;
  onOutsource: (o: JcOpsBoardRow) => void;
}

/** The ⋯ menu's link renderer: Start / Log Op deep-link to `/op-entry?…`,
 *  and the router's <Link> wants that query as `search`, so it is split off. */
export const renderJcOpsLink: RenderLink = ({ to, ...rest }) => {
  const q = to.indexOf('?');
  if (q < 0) return <Link {...rest} to={to} />;
  const search = Object.fromEntries(new URLSearchParams(to.slice(q + 1)));
  return <Link {...rest} to={to.slice(0, q)} search={search} />;
};

/**
 * The row's ⋯ menu items — only the ones valid for that op (owner-approved
 * spec 2026-10-01). An item the user has no right to is left out; one the
 * server would refuse for this op's state is greyed with the reason. The
 * outsource state that used to sit in the action cell as text ("PR: …",
 * "PO: …", "At Vendor (n pcs)") now shows in the Outsource Status column, and
 * "✓ Locked / 🔒 Running" is Change Machine's greyed reason.
 */
export function jcOpsRowMenu(o: JcOpsBoardRow, p: JcOpsActionProps): RowMenuItem[] {
  if (isOutsource(o)) {
    // Legacy L11369 — raise a PR from a pending outsource op. The server-side
    // cascade stamps this op as pr_raised + links the new PR.
    return [
      {
        key: 'raise-pr',
        label: 'Raise PR',
        icon: 'plus',
        group: 'workflow',
        hidden: !p.canCreatePr,
        disabledReason: outsourceStatusOf(o) === 'pending' ? undefined : 'PR already raised',
        onSelect: () => p.onCreatePr(o),
      },
    ];
  }

  const running = o.status === 'running';
  const complete = o.status === 'complete';
  // Running / complete op: why the server refuses a machine change or an
  // outsource send for it.
  const stateReason = complete ? 'Completed' : running ? 'Running — stop it first' : undefined;
  // ▶ Start / ✚ Log — the Job Queue's rule: an in-house op with pieces waiting
  // and no session running is the next thing to do. Pieces already made →
  // Log Op (the Complete half); none yet → Start Operation.
  const logging = o.completed > 0;
  const startReason = running
    ? 'Already running'
    : complete
      ? 'Completed'
      : o.available > 0
        ? undefined
        : 'Nothing Pending';
  const opEntryTo = `/op-entry?${new URLSearchParams({
    jc: o.jcCode,
    op: o.jcOpId,
    mode: logging ? 'complete' : 'start',
  }).toString()}`;

  return [
    {
      key: 'start',
      label: logging ? 'Log Op' : 'Start Operation',
      icon: logging ? 'plus' : 'play',
      group: 'workflow',
      hidden: !p.canOpEntry,
      disabledReason: startReason,
      ...(startReason ? {} : { to: opEntryTo }),
    },
    {
      // ADR-125 — a half-done op CAN change machine (each op_log row carries
      // the machine that made its qty). Blocked only when 'complete' or a
      // session is running, matching changeJcOpMachine exactly.
      key: 'change-machine',
      label: 'Change Machine',
      icon: 'settings',
      group: 'workflow',
      hidden: !p.canWrite,
      disabledReason: stateReason,
      onSelect: () => p.onEdit(o),
    },
    {
      // ADR-081 — send the remaining qty out. Qty already covered by open PRs
      // is not on the row; the server refuses it and the dialog shows why.
      key: 'outsource',
      label: 'Outsource Available',
      icon: 'truck',
      group: 'workflow',
      hidden: !p.canWrite || o.opType !== 'process',
      disabledReason: stateReason ?? (o.available > 0 ? undefined : 'Nothing Pending'),
      onSelect: () => p.onOutsource(o),
    },
  ];
}
