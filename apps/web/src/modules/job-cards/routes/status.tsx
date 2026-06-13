// JC Status view (parity: viewJCStatus L11020) — read-only status report:
// header + overall progress, the per-op routing table with live qty/QC/balance
// from v_jc_op_status, and a production/event timeline from op_log. Work actions
// (Start/Log/QC) live in Op Entry, linked from the header.
import type { JcOpEnriched, OpLog } from '@innovic/shared';
import { Link, createRoute } from '@tanstack/react-router';
import { ArrowLeft, Loader2 } from 'lucide-react';
import { useMemo } from 'react';
import { useJcOpsEnriched, useOpLog } from '@/modules/op-entry/api';
import { authenticatedRoute } from '@/routes/_authenticated';
import { useJobCard } from '../api';
import { JcStatusBadge } from '../components/jc-status-badge';

export const jobCardStatusRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: 'job-cards/$id',
  component: JobCardStatusPage,
});

const OP_STATUS: Record<string, { label: string; cls: string }> = {
  waiting: { label: 'Waiting', cls: 'b-grey' },
  available: { label: 'Available', cls: 'b-blue' },
  in_progress: { label: 'In Progress', cls: 'b-amber' },
  running: { label: 'Running', cls: 'b-amber' },
  qc_pending: { label: 'QC Pending', cls: 'b-amber' },
  complete: { label: 'Complete', cls: 'b-green' },
  pr_raised: { label: 'PR Raised', cls: 'b-blue' },
  po_created: { label: 'PO Created', cls: 'b-cyan' },
  at_vendor: { label: 'At Vendor', cls: 'b-amber' },
  received: { label: 'Received', cls: 'b-cyan' },
  ready_for_pr: { label: 'Ready for PR', cls: 'b-amber' },
  outsource: { label: 'Outsource', cls: 'b-grey' },
};

function machineLabel(o: JcOpEnriched): string {
  if (o.opType === 'qc') return '🔬 QC';
  if (o.opType === 'outsource') return '🏭 Outsource';
  return o.machineCode ?? o.machineCodeText ?? '—';
}

function JobCardStatusPage(): React.JSX.Element {
  const { id } = jobCardStatusRoute.useParams();
  const { data: jc, isLoading, isError, error } = useJobCard(id);
  const { data: ops = [] } = useJcOpsEnriched({ jobCardId: id }, { enabled: Boolean(id) });
  const { data: logs = [] } = useOpLog({ jobCardId: id, limit: 200 }, { enabled: Boolean(id) });

  const sortedOps = useMemo(() => [...ops].sort((a, b) => a.opSeq - b.opSeq), [ops]);
  const opById = useMemo(() => new Map(ops.map((o) => [o.id, o])), [ops]);
  const sortedLogs = useMemo(
    () =>
      [...logs].sort((a, b) => (b.logDate + (b.startTime ?? '')).localeCompare(a.logDate + (a.startTime ?? ''))),
    [logs],
  );

  if (isLoading) {
    return (
      <div>
        <Loader2 className="inline h-4 w-4 animate-spin" /> Loading job card…
      </div>
    );
  }
  if (isError || !jc) {
    return (
      <div className="panel">
        <div className="panel-body empty-state" style={{ color: 'var(--red)' }}>
          {error instanceof Error ? error.message : 'Job card not found'}
        </div>
      </div>
    );
  }

  const totalOps = sortedOps.length;
  const doneOps = sortedOps.filter((o) => o.computedStatus === 'complete').length;
  const pct = totalOps > 0 ? Math.round((doneOps / totalOps) * 100) : 0;

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
        <Link to="/job-cards" className="btn btn-ghost btn-sm">
          <ArrowLeft size={14} /> Back to Job Cards
        </Link>
        <Link to="/op-entry" search={{ jc: jc.code }} className="btn btn-primary btn-sm">
          ▶ Open in Op Entry
        </Link>
      </div>

      <div className="panel" style={{ marginBottom: 12 }}>
        <div className="panel-hdr">
          <div className="panel-title">
            🛠 {jc.code} — {jc.itemCode} {jc.itemName ? `· ${jc.itemName}` : ''}
          </div>
          <JcStatusBadge status={jc.computedStatus} />
        </div>
        <div className="panel-body">
          <div className="form-grid form-grid-4" style={{ marginBottom: 10 }}>
            <Info label="SO / WO" value={jc.sourceLink?.code ?? '—'} />
            <Info label="Client PO Line" value={jc.clientPoLineNo ?? '—'} />
            <Info label="Date" value={jc.jcDate} />
            <Info label="Due Date" value={jc.dueDate ?? '—'} />
            <Info label="Order Qty" value={String(jc.orderQty)} />
            <Info label="Completed" value={String(jc.lastOpCompletedQty)} />
            <Info label="Pending" value={String(Math.max(0, jc.orderQty - jc.lastOpCompletedQty))} />
            <Info label="Priority" value={jc.priority === 'high' ? 'High' : 'Normal'} />
          </div>
          <div style={{ fontSize: 11, color: 'var(--text3)', marginBottom: 4 }}>
            Operations complete: {doneOps}/{totalOps} ({pct}%)
          </div>
          <div style={{ height: 6, background: 'var(--bg5)', borderRadius: 3 }}>
            <div style={{ width: `${pct}%`, height: '100%', background: 'var(--green)', borderRadius: 3 }} />
          </div>
        </div>
      </div>

      <div className="panel" style={{ marginBottom: 12 }}>
        <div className="panel-hdr">
          <div className="panel-title">Operations</div>
        </div>
        <div className="tbl-wrap">
          <table className="innovic-table">
            <thead>
              <tr>
                <th>#</th>
                <th>Machine</th>
                <th>Operation</th>
                <th>Cycle</th>
                <th>Program / Tool</th>
                <th>Order</th>
                <th>Input</th>
                <th style={{ color: 'var(--green)' }}>Done</th>
                <th style={{ color: 'var(--amber)' }}>Balance</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {sortedOps.length === 0 ? (
                <tr>
                  <td colSpan={10} className="empty-state">
                    No operations on this job card.
                  </td>
                </tr>
              ) : (
                sortedOps.map((o) => {
                  const st = OP_STATUS[o.computedStatus] ?? { label: o.computedStatus, cls: 'b-grey' };
                  const bal = o.opType === 'qc' ? o.qcPending : o.available;
                  return (
                    <tr
                      key={o.id}
                      style={
                        o.opType === 'qc'
                          ? { background: 'rgba(34,197,94,0.04)' }
                          : o.opType === 'outsource'
                            ? { background: 'rgba(255,176,32,0.04)' }
                            : undefined
                      }
                    >
                      <td className="td-ctr mono fw-700">{o.opSeq}</td>
                      <td style={{ fontSize: 11 }}>{machineLabel(o)}</td>
                      <td>{o.operation}</td>
                      <td className="td-ctr mono">{Number(o.cycleTimeMin) || '—'}</td>
                      <td style={{ fontSize: 10 }}>
                        {o.program ? <span style={{ color: 'var(--blue)' }}>{o.program}</span> : null}
                        {o.toolNo ? <span style={{ color: 'var(--cyan)' }}> · {o.toolNo}</span> : null}
                        {!o.program && !o.toolNo ? '—' : null}
                      </td>
                      <td className="td-ctr">{o.inputAvail}</td>
                      <td className="td-ctr text2">{o.inputAvail}</td>
                      <td className="td-ctr mono fw-700" style={{ color: 'var(--green)' }}>
                        {o.opType === 'qc' ? o.qcAcceptedQty : o.completedQty}
                      </td>
                      <td
                        className="td-ctr mono fw-700"
                        style={{ color: bal > 0 ? 'var(--amber)' : 'var(--text3)' }}
                      >
                        {bal}
                      </td>
                      <td>
                        <span className={`badge ${st.cls}`}>{st.label}</span>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="panel">
        <div className="panel-hdr">
          <div className="panel-title">Production Log</div>
          <div className="panel-meta">{sortedLogs.length} entries</div>
        </div>
        <div className="tbl-wrap">
          <table className="innovic-table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Shift</th>
                <th>Operation</th>
                <th>Type</th>
                <th style={{ textAlign: 'center' }}>Qty</th>
                <th>Operator</th>
                <th>Remarks</th>
              </tr>
            </thead>
            <tbody>
              {sortedLogs.length === 0 ? (
                <tr>
                  <td colSpan={7} className="empty-state">
                    No production log entries yet.
                  </td>
                </tr>
              ) : (
                sortedLogs.map((l: OpLog) => {
                  const op = opById.get(l.jcOpId);
                  return (
                    <tr key={l.id}>
                      <td className="text2" style={{ fontSize: 11 }}>
                        {l.logDate}
                      </td>
                      <td className="text2" style={{ fontSize: 11 }}>
                        {l.shift}
                      </td>
                      <td style={{ fontSize: 11 }}>
                        {op ? `Op${op.opSeq}: ${op.operation}` : '—'}
                      </td>
                      <td>
                        <span
                          className={`badge ${l.logType === 'qc' ? 'b-green' : l.logType === 'start' ? 'b-amber' : 'b-cyan'}`}
                        >
                          {l.logType}
                        </span>
                      </td>
                      <td className="td-ctr mono fw-700" style={{ color: 'var(--green)' }}>
                        +{l.qty}
                        {l.rejectQty > 0 ? (
                          <span style={{ color: 'var(--red)' }}> / -{l.rejectQty}</span>
                        ) : null}
                      </td>
                      <td style={{ fontSize: 11 }}>{l.operatorName ?? '—'}</td>
                      <td className="text3" style={{ fontSize: 11 }}>
                        {l.remarks ?? ''}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function Info({ label, value }: { label: string; value: string }): React.JSX.Element {
  return (
    <div className="form-grp">
      <div className="form-label" style={{ marginBottom: 2 }}>
        {label}
      </div>
      <div className="fw-700" style={{ fontSize: 13 }}>
        {value}
      </div>
    </div>
  );
}
