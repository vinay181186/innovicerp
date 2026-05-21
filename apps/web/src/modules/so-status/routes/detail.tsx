// SO Status Review (PL-1). Mirrors legacy renderSOStatus L4255 — per-line
// progress chips + per-JC op-level drill-down + outsource alerts.

import type {
  SoStatusJc,
  SoStatusLine,
  SoStatusOp,
  SoStatusOpStatus,
} from '@innovic/shared';
import { Link, createRoute } from '@tanstack/react-router';
import { ArrowLeft, Loader2 } from 'lucide-react';
import { authenticatedRoute } from '@/routes/_authenticated';
import { useSoStatus } from '../api';

export const soStatusDetailRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: 'sales-orders/$id/status',
  component: SoStatusPage,
});

function SoStatusPage(): React.JSX.Element {
  const { id } = soStatusDetailRoute.useParams();
  const { data, isLoading, isError, error } = useSoStatus(id);

  if (isLoading) {
    return (
      <div>
        <Loader2 className="inline h-4 w-4 animate-spin" /> Loading SO status…
      </div>
    );
  }
  if (isError || !data) {
    return (
      <div className="panel">
        <div className="panel-body">
          <div style={{ marginBottom: 8 }}>
            <Link to="/sales-orders" className="btn btn-ghost btn-sm">
              <ArrowLeft size={14} /> Back
            </Link>
          </div>
          <div className="empty-state" style={{ color: 'var(--red)' }}>
            {error instanceof Error ? error.message : 'Unable to load SO status'}
          </div>
        </div>
      </div>
    );
  }

  const { header, lines } = data;

  return (
    <div>
      <Link
        to="/sales-orders/$id"
        params={{ id }}
        className="btn btn-ghost btn-sm"
        style={{ marginBottom: 10 }}
      >
        <ArrowLeft size={14} /> Back to SO detail
      </Link>

      <div className="panel">
        <div className="panel-hdr">
          <div>
            <div className="td-code" style={{ color: 'var(--cyan)', fontSize: 16, fontWeight: 700 }}>
              {header.code}
            </div>
            <div
              className="panel-title"
              style={{ marginTop: 2, display: 'flex', alignItems: 'center', gap: 10 }}
            >
              {header.customerName ?? 'Untitled customer'}
              <SoHeaderStatusBadge status={header.status} />
            </div>
          </div>
          <div
            className="text3"
            style={{ fontSize: 11, fontFamily: 'var(--mono)', textAlign: 'right' }}
          >
            <div>
              total qty <b style={{ color: 'var(--text)' }}>{header.totalQty}</b>
              {' · done '}
              <b style={{ color: 'var(--green2)' }}>{header.totalDoneQty}</b>
              {' · '}
              <b style={{ color: 'var(--text)' }}>{header.overallCompletionPct}%</b>
            </div>
            <div style={{ marginTop: 2 }}>
              SO date {header.soDate}
              {header.clientPoNo ? ` · PO ${header.clientPoNo}` : ''}
            </div>
          </div>
        </div>
        <div className="panel-body">
          <ProgBar pct={header.overallCompletionPct} />
        </div>
      </div>

      {lines.length === 0 ? (
        <div className="panel">
          <div className="panel-body">
            <div className="empty-state">No lines on this SO yet.</div>
          </div>
        </div>
      ) : (
        lines.map((line) => <LinePanel key={line.id} line={line} />)
      )}
    </div>
  );
}

function LinePanel({ line }: { line: SoStatusLine }): React.JSX.Element {
  return (
    <div className="panel">
      <div className="panel-hdr">
        <div>
          <div className="td-code" style={{ color: 'var(--purple)', fontSize: 14, fontWeight: 700 }}>
            #{line.lineNo} · {line.itemCode ?? line.itemCodeText ?? '—'}
          </div>
          <div
            className="text3"
            style={{ fontSize: 12, marginTop: 2 }}
          >
            {line.partName ?? '—'}
            {line.clientPoLineNo ? ` · client PO L#${line.clientPoLineNo}` : ''}
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <LineStatusBadge status={line.status} />
          <span
            className="text3"
            style={{ fontSize: 11, fontFamily: 'var(--mono)', minWidth: 110, textAlign: 'right' }}
          >
            {line.doneQty}/{line.orderQty}
            {' · '}
            <b style={{ color: 'var(--text)' }}>{line.completionPct}%</b>
          </span>
        </div>
      </div>
      <div className="panel-body">
        <ProgBar pct={line.completionPct} />
        <div
          style={{
            marginTop: 14,
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
            gap: 10,
          }}
        >
          <Chip label="JC Issued" qty={line.chips.jcIssued.qty} total={line.chips.jcIssued.total} />
          <Chip label="PO Raised" qty={line.chips.poRaised.qty} total={line.chips.poRaised.total} />
          <Chip
            label="GRN Recd"
            qty={line.chips.grnReceived.qty}
            total={line.chips.grnReceived.total}
          />
          <Chip
            label="QC Accepted"
            qty={line.chips.qcAccepted.qty}
            total={line.chips.qcAccepted.total}
          />
          <Chip label="Produced" qty={line.chips.produced.qty} total={line.chips.produced.total} />
          <Chip
            label="Dispatched"
            qty={line.chips.dispatched.qty}
            total={line.chips.dispatched.total}
          />
        </div>
        {line.outsourceAlert.atVendorQty > 0 ||
        line.outsourceAlert.pendingPrCount > 0 ||
        line.outsourceAlert.prRaisedCount > 0 ? (
          <div style={{ marginTop: 12, display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {line.outsourceAlert.atVendorQty > 0 ? (
              <span className="badge b-blue">
                🏭 At vendor: {line.outsourceAlert.atVendorQty} pcs
              </span>
            ) : null}
            {line.outsourceAlert.pendingPrCount > 0 ? (
              <span className="badge b-amber">
                📋 {line.outsourceAlert.pendingPrCount} op(s) awaiting PR
              </span>
            ) : null}
            {line.outsourceAlert.prRaisedCount > 0 ? (
              <span className="badge b-amber">
                🛒 {line.outsourceAlert.prRaisedCount} PR(s) awaiting PO
              </span>
            ) : null}
          </div>
        ) : null}

        <div style={{ marginTop: 16 }}>
          <div className="section-hdr" style={{ marginBottom: 6 }}>
            Linked Job Cards ({line.jobCards.length})
          </div>
          {line.jobCards.length === 0 ? (
            <div className="text3" style={{ fontSize: 12, padding: 8 }}>
              No Job Cards yet for this line.
            </div>
          ) : (
            <div className="tbl-wrap">
              <table className="innovic-table">
                <thead>
                  <tr>
                    <th>JC</th>
                    <th>Item</th>
                    <th className="td-right">Qty</th>
                    <th>Progress</th>
                    <th className="td-right">Remaining</th>
                    <th>Priority</th>
                    <th>Due</th>
                    <th>Status</th>
                    <th>Ops</th>
                  </tr>
                </thead>
                <tbody>
                  {line.jobCards.map((jc) => (
                    <JcRow key={jc.id} jc={jc} />
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function JcRow({ jc }: { jc: SoStatusJc }): React.JSX.Element {
  return (
    <tr>
      <td>
        <Link
          to="/op-entry"
          search={{ jc: jc.code }}
          className="td-code"
          style={{ color: 'var(--cyan)' }}
        >
          {jc.code}
        </Link>
      </td>
      <td>
        <span className="text3" style={{ fontSize: 12 }}>
          {jc.itemCode ?? '—'}
        </span>
      </td>
      <td className="td-right">{jc.orderQty}</td>
      <td style={{ minWidth: 140 }}>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            fontFamily: 'var(--mono)',
            fontSize: 11,
          }}
        >
          <span>{jc.doneQty}</span>
          <ProgBar pct={jc.completionPct} small />
          <span style={{ color: 'var(--text3)' }}>{jc.completionPct}%</span>
        </div>
      </td>
      <td
        className="td-right"
        style={{ color: jc.remainingQty > 0 ? 'var(--red2)' : 'var(--text3)' }}
      >
        {jc.remainingQty}
      </td>
      <td>
        <span className="text3" style={{ fontSize: 12, textTransform: 'capitalize' }}>
          {jc.priority}
        </span>
      </td>
      <td>
        <span className="text3" style={{ fontSize: 12 }}>
          {jc.dueDate ?? '—'}
        </span>
      </td>
      <td>
        <JcStatusBadge status={jc.status} />
      </td>
      <td>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
          {jc.ops.map((op) => (
            <OpChip key={op.id} op={op} />
          ))}
          {jc.ops.length === 0 ? (
            <span className="text3" style={{ fontSize: 11 }}>
              no ops
            </span>
          ) : null}
        </div>
      </td>
    </tr>
  );
}

function OpChip({ op }: { op: SoStatusOp }): React.JSX.Element {
  const cls = opStatusBadgeClass(op.status);
  const icon = op.opType === 'outsource' ? '🏭' : op.opType === 'qc' || op.qcRequired ? '🔧' : null;
  const title =
    `Op ${op.opSeq} — ${op.operation} (${op.opType})\n` +
    `input ${op.inputAvail} · completed ${op.completed}` +
    (op.qcRequired || op.opType === 'qc'
      ? ` · qc-acc ${op.qcAccepted}/${op.qcRejected}-rej/${op.qcPending}-pend`
      : '') +
    `\nstatus: ${op.status}`;
  return (
    <span
      className={`badge ${cls}`}
      style={{ padding: '1px 5px', fontSize: 10, textTransform: 'none' }}
      title={title}
    >
      {icon ? `${icon} ` : ''}Op{op.opSeq}
      {op.status === 'complete' ? ' ✓' : ''}
    </span>
  );
}

function ProgBar({ pct, small = false }: { pct: number; small?: boolean }): React.JSX.Element {
  const color =
    pct >= 100 ? 'var(--green)' : pct >= 70 ? 'var(--blue)' : pct > 0 ? 'var(--amber)' : 'var(--bg4)';
  return (
    <div className="prog-wrap" style={small ? { height: 4, width: 60 } : undefined}>
      <div className="prog-bar" style={{ width: `${Math.max(2, pct)}%`, background: color }} />
    </div>
  );
}

function Chip({ label, qty, total }: { label: string; qty: number; total: number }): React.JSX.Element {
  const pct = total > 0 ? Math.min(100, Math.round((qty / total) * 100)) : 0;
  return (
    <div
      style={{
        border: '1px solid var(--border)',
        borderRadius: 6,
        padding: '6px 8px',
        background: 'var(--bg2)',
      }}
    >
      <div
        className="text3"
        style={{
          fontSize: 10,
          textTransform: 'uppercase',
          letterSpacing: '0.05em',
          marginBottom: 2,
        }}
      >
        {label}
      </div>
      <div style={{ fontFamily: 'var(--mono)', fontSize: 12, fontWeight: 600 }}>
        {qty}
        <span className="text3" style={{ fontWeight: 400 }}>
          {' '}
          / {total}
        </span>
        <span className="text3" style={{ fontWeight: 400, float: 'right', fontSize: 11 }}>
          {pct}%
        </span>
      </div>
      <ProgBar pct={pct} small />
    </div>
  );
}

function SoHeaderStatusBadge({
  status,
}: {
  status: 'open' | 'closed' | 'dispatched' | 'cancelled';
}): React.JSX.Element {
  const cls =
    status === 'open'
      ? 'b-blue'
      : status === 'closed'
        ? 'b-green'
        : status === 'dispatched'
          ? 'b-cyan'
          : 'b-grey';
  return <span className={`badge ${cls}`}>{status}</span>;
}

function LineStatusBadge({
  status,
}: {
  status: 'no_jc' | 'complete' | 'qc_pending' | 'in_progress';
}): React.JSX.Element {
  const map: Record<typeof status, { cls: string; label: string }> = {
    no_jc: { cls: 'b-grey', label: 'No JC' },
    complete: { cls: 'b-green', label: 'Complete' },
    qc_pending: { cls: 'b-amber', label: 'QC Pending' },
    in_progress: { cls: 'b-blue', label: 'In Progress' },
  };
  const m = map[status];
  return <span className={`badge ${m.cls}`}>{m.label}</span>;
}

function JcStatusBadge({
  status,
}: {
  status: 'complete' | 'qc_pending' | 'in_progress' | 'no_ops';
}): React.JSX.Element {
  const map: Record<typeof status, { cls: string; label: string }> = {
    complete: { cls: 'b-green', label: 'Complete' },
    qc_pending: { cls: 'b-amber', label: 'QC Pending' },
    in_progress: { cls: 'b-blue', label: 'In Progress' },
    no_ops: { cls: 'b-grey', label: 'No Ops' },
  };
  const m = map[status];
  return <span className={`badge ${m.cls}`}>{m.label}</span>;
}

function opStatusBadgeClass(status: SoStatusOpStatus): string {
  switch (status) {
    case 'complete':
      return 'b-green';
    case 'qc_pending':
      return 'b-amber';
    case 'running':
    case 'in_progress':
      return 'b-blue';
    case 'available':
      return 'b-cyan';
    case 'waiting':
      return 'b-grey';
    case 'outsource_pending':
    case 'outsource_pr_raised':
      return 'b-amber';
    case 'outsource_po_created':
    case 'outsource_at_vendor':
      return 'b-blue';
    case 'outsource_received':
      return 'b-green';
    default:
      return 'b-grey';
  }
}
