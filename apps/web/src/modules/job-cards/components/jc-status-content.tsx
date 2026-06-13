// JC Status content (legacy viewJCStatus L11020 body): drawing + Print, 6 stat
// cards, OPERATION FLOW stepper, OPERATIONS DETAIL (per-op recent logs + Start/
// Log/QC actions), and the completion-log timeline. Rendered by the JC Status
// page (routes/status).
import type { OpLog } from '@innovic/shared';
import { useNavigate } from '@tanstack/react-router';
import { Download, Loader2, Printer } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { signedUrl } from '@/lib/storage';
import { useJcOpsEnriched, useOpLog } from '@/modules/op-entry/api';
import { useMyCompany } from '@/modules/settings/api';
import { useJobCard } from '../api';
import { JcStatusBadge } from './jc-status-badge';
import { exportJobCardExcel } from '../lib/export-job-card-excel';
import { printJobCard } from '../lib/print-job-card';

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

const fmtLog = (l: OpLog): string =>
  `${l.logDate} · ${l.shift} · +${l.qty}${l.operatorName ? ' · ' + l.operatorName : ''}`;

const cardStyle = (bg: string, brd: string): React.CSSProperties => ({
  background: bg,
  border: `1px solid ${brd}`,
  borderRadius: 8,
  padding: 12,
});
const lblStyle: React.CSSProperties = {
  fontSize: 10,
  color: 'var(--text3)',
  textTransform: 'uppercase',
  letterSpacing: '.08em',
  marginBottom: 4,
};

export function JcStatusContent({ id }: { id: string }): React.JSX.Element {
  const navigate = useNavigate();
  const { data: jc, isLoading, isError, error } = useJobCard(id);
  const { data: ops = [] } = useJcOpsEnriched({ jobCardId: id }, { enabled: Boolean(id) });
  const { data: logs = [] } = useOpLog({ jobCardId: id, limit: 300 }, { enabled: Boolean(id) });
  const { data: company } = useMyCompany();
  const [detailOpen, setDetailOpen] = useState(true);
  const drawingPath = jc?.drawingFilePath ?? null;
  const { data: drawingUrl } = useQuery({
    queryKey: ['jc-drawing', drawingPath],
    queryFn: () => signedUrl(drawingPath as string),
    enabled: Boolean(drawingPath),
    staleTime: 60_000,
  });

  const sortedOps = useMemo(() => [...ops].sort((a, b) => a.opSeq - b.opSeq), [ops]);
  const logsByOp = useMemo(() => {
    const m = new Map<string, OpLog[]>();
    for (const l of logs) {
      const arr = m.get(l.jcOpId) ?? [];
      arr.push(l);
      m.set(l.jcOpId, arr);
    }
    for (const arr of m.values()) arr.sort((a, b) => b.logDate.localeCompare(a.logDate));
    return m;
  }, [logs]);
  const opById = useMemo(() => new Map(ops.map((o) => [o.id, o])), [ops]);
  const timeline = useMemo(
    () =>
      [...logs]
        .filter((l) => l.logType !== 'start')
        .sort((a, b) => (b.logDate + (b.startTime ?? '')).localeCompare(a.logDate + (a.startTime ?? ''))),
    [logs],
  );

  if (isLoading) {
    return (
      <div className="empty-state">
        <Loader2 className="inline h-4 w-4 animate-spin" /> Loading job card…
      </div>
    );
  }
  if (isError || !jc) {
    return (
      <div className="empty-state" style={{ color: 'var(--red)' }}>
        {error instanceof Error ? error.message : 'Job card not found'}
      </div>
    );
  }

  const totalOps = sortedOps.length;
  const doneOps = sortedOps.filter((o) => o.computedStatus === 'complete').length;
  const pct = totalOps > 0 ? Math.round((doneOps / totalOps) * 100) : 0;
  const completed = jc.lastOpCompletedQty;
  const pending = Math.max(0, jc.orderQty - completed);
  const openOpEntry = (): void => void navigate({ to: '/op-entry', search: { jc: jc.code } });

  return (
    <div>
      <div style={{ display: 'flex', gap: 6, marginBottom: 12 }}>
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => printJobCard({ jc, ops, company })}>
          <Printer size={13} /> Print Job Card
        </button>
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          onClick={() => exportJobCardExcel({ jc, ops, logs })}
          title="Download Excel (with production log)"
        >
          <Download size={13} /> Excel
        </button>
        <button type="button" className="btn btn-primary btn-sm" onClick={openOpEntry}>
          ▶ Open in Op Entry
        </button>
      </div>

      {drawingUrl ? (
        <div style={{ ...cardStyle('var(--bg3)', 'var(--border)'), marginBottom: 14 }}>
          <div style={{ ...lblStyle, marginBottom: 6 }}>Drawing</div>
          <img
            src={drawingUrl}
            alt="JC drawing"
            style={{ maxHeight: 160, maxWidth: '100%', borderRadius: 4, border: '1px solid var(--border2)', display: 'block' }}
          />
        </div>
      ) : null}

      {/* 6 stat cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: 10, marginBottom: 16 }}>
        <div style={cardStyle('var(--bg3)', 'var(--border)')}>
          <div style={lblStyle}>Item</div>
          <div className="fw-700">{jc.itemName || jc.itemCode}</div>
          <div style={{ fontSize: 11, color: 'var(--text2)' }}>{jc.itemCode}</div>
        </div>
        <div style={cardStyle('var(--bg3)', 'var(--border)')}>
          <div style={lblStyle}>SO / WO</div>
          <div className="fw-700 mono">{jc.sourceLink?.code ?? '—'}</div>
          <div style={{ fontSize: 11, color: 'var(--text2)' }}>
            Line: <b>{jc.sourceLink?.lineNo ?? '1'}</b>
            {jc.clientPoLineNo ? (
              <span style={{ color: 'var(--purple)', fontWeight: 700 }}> · CPO Ln: {jc.clientPoLineNo}</span>
            ) : null}
          </div>
          <div style={{ fontSize: 11, color: 'var(--text2)' }}>Due: {jc.dueDate ?? '—'}</div>
        </div>
        <div style={cardStyle('var(--bg3)', 'var(--border)')}>
          <div style={lblStyle}>Order Qty</div>
          <div className="mono" style={{ fontSize: 22, fontWeight: 800 }}>{jc.orderQty}</div>
          <span className={`badge ${jc.priority === 'high' ? 'b-amber' : 'b-grey'}`}>
            {jc.priority === 'high' ? 'High' : 'Normal'}
          </span>
        </div>
        <div style={cardStyle('var(--bg3)', 'var(--border)')}>
          <div style={lblStyle}>Overall Status</div>
          <div style={{ marginBottom: 6 }}>
            <JcStatusBadge status={jc.computedStatus} />
          </div>
          <div style={{ height: 6, background: 'var(--bg5)', borderRadius: 3 }}>
            <div style={{ width: `${pct}%`, height: '100%', background: '#3b82f6', borderRadius: 3 }} />
          </div>
          <div style={{ fontSize: 10, color: 'var(--text3)', marginTop: 3 }}>
            {doneOps}/{totalOps} ops · {pct}%
          </div>
        </div>
        <div style={cardStyle('var(--green3, #dcfce7)', 'var(--green2, #86efac)')}>
          <div style={{ ...lblStyle, color: 'var(--green)' }}>Completed Qty</div>
          <div className="mono" style={{ fontSize: 22, fontWeight: 800, color: 'var(--green)' }}>{completed}</div>
          <div style={{ fontSize: 11, color: 'var(--green)' }}>of {jc.orderQty} ordered</div>
        </div>
        <div
          style={cardStyle(
            pending > 0 ? 'var(--red3, #fee2e2)' : 'var(--green3, #dcfce7)',
            pending > 0 ? '#fca5a5' : 'var(--green2, #86efac)',
          )}
        >
          <div style={{ ...lblStyle, color: pending > 0 ? 'var(--red)' : 'var(--green)' }}>Pending Qty</div>
          <div className="mono" style={{ fontSize: 22, fontWeight: 800, color: pending > 0 ? 'var(--red)' : 'var(--green)' }}>
            {pending}
          </div>
          <div style={{ fontSize: 11, color: 'var(--text2)' }}>{pending === 0 ? '✓ All complete' : 'pcs remaining'}</div>
        </div>
      </div>

      {/* OPERATION FLOW */}
      <div style={{ ...cardStyle('var(--bg3)', 'var(--border)'), marginBottom: 16 }}>
        <div style={{ ...lblStyle, marginBottom: 8 }}>Operation Flow</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap' }}>
          {sortedOps.length === 0 ? (
            <span className="text3" style={{ fontSize: 12 }}>No operations</span>
          ) : (
            sortedOps.map((o, i) => {
              const isQc = o.opType === 'qc';
              const isOut = o.opType === 'outsource';
              const flowQty = isQc ? o.qcAcceptedQty : o.completedQty;
              const flowTotal = isQc ? o.inputAvail || jc.orderQty : jc.orderQty;
              const accent =
                o.computedStatus === 'complete' ? 'var(--green)' : isQc ? 'var(--green)' : isOut ? 'var(--amber)' : 'var(--cyan)';
              return (
                <div key={o.id} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  <div
                    style={{
                      background: o.computedStatus === 'complete' ? 'var(--green3, #dcfce7)' : 'var(--bg4)',
                      border: `1px solid ${o.computedStatus === 'complete' ? 'var(--green2, #86efac)' : 'var(--border2)'}`,
                      borderRadius: 6,
                      padding: '6px 10px',
                      textAlign: 'center',
                      minWidth: 80,
                    }}
                  >
                    <div className="mono" style={{ fontSize: 10, fontWeight: 700, color: accent }}>
                      Op{o.opSeq}
                      {isQc ? ' 🔬' : isOut ? ' 🏭' : ''}
                    </div>
                    <div style={{ fontSize: 11, fontWeight: 600, margin: '2px 0', color: accent }}>
                      {isQc ? 'QC' : isOut ? 'OUTSOURCE' : (o.machineCode ?? o.machineCodeText ?? '—')}
                    </div>
                    <div style={{ fontSize: 9, color: 'var(--text3)' }}>{o.operation.split(' ').slice(0, 2).join(' ')}</div>
                    <div style={{ fontSize: 10, marginTop: 3, fontWeight: 700, color: flowQty > 0 ? 'var(--green)' : 'var(--text3)' }}>
                      {flowQty}/{flowTotal}
                    </div>
                  </div>
                  {i < sortedOps.length - 1 ? <span style={{ color: 'var(--text3)', fontSize: 18 }}>›</span> : null}
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* OPERATIONS DETAIL */}
      <button
        type="button"
        onClick={() => setDetailOpen((v) => !v)}
        className="mono"
        style={{
          background: 'none',
          border: 'none',
          cursor: 'pointer',
          fontSize: 11,
          color: 'var(--cyan)',
          fontWeight: 700,
          letterSpacing: '.08em',
          textTransform: 'uppercase',
          marginBottom: 8,
          padding: 0,
        }}
      >
        {detailOpen ? '▾' : '▸'} Operations Detail
      </button>
      {detailOpen ? (
        <div className="panel" style={{ marginBottom: 16 }}>
          <div className="tbl-wrap">
            <table className="innovic-table">
              <thead>
                <tr>
                  <th>Op</th>
                  <th>Machine</th>
                  <th>Operation</th>
                  <th>Cycle(h)</th>
                  <th>Prog/Tool</th>
                  <th>Order</th>
                  <th>Input</th>
                  <th>Done</th>
                  <th style={{ color: 'var(--amber)' }}>Avail</th>
                  <th>Status</th>
                  <th>Recent Logs</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {sortedOps.length === 0 ? (
                  <tr>
                    <td colSpan={12} className="empty-state">No operations on this job card.</td>
                  </tr>
                ) : (
                  sortedOps.map((o) => {
                    const st = OP_STATUS[o.computedStatus] ?? { label: o.computedStatus, cls: 'b-grey' };
                    const isQc = o.opType === 'qc';
                    const bal = isQc ? o.qcPending : o.available;
                    const opLogs = (logsByOp.get(o.id) ?? []).slice(0, 3);
                    const done = isQc ? o.qcAcceptedQty : o.completedQty;
                    return (
                      <tr
                        key={o.id}
                        style={
                          isQc
                            ? { background: 'rgba(34,197,94,0.04)' }
                            : o.opType === 'outsource'
                              ? { background: 'rgba(255,176,32,0.04)' }
                              : undefined
                        }
                      >
                        <td className="td-ctr mono fw-700">{o.opSeq}</td>
                        <td style={{ fontSize: 11 }}>
                          {isQc ? '🔬 QC' : o.opType === 'outsource' ? '🏭 Out' : (o.machineCode ?? o.machineCodeText ?? '—')}
                        </td>
                        <td>{o.operation}</td>
                        <td className="td-ctr mono">{Number(o.cycleTimeMin) || '—'}</td>
                        <td style={{ fontSize: 10 }}>
                          {o.program ? <span style={{ color: 'var(--blue)' }}>{o.program}</span> : null}
                          {o.toolNo ? <span style={{ color: 'var(--cyan)' }}> · {o.toolNo}</span> : null}
                          {!o.program && !o.toolNo ? '—' : null}
                        </td>
                        <td className="td-ctr">{jc.orderQty}</td>
                        <td className="td-ctr text2">{o.inputAvail}</td>
                        <td className="td-ctr mono fw-700" style={{ color: 'var(--green)' }}>
                          {done}
                          {isQc && o.qcRejectedQty > 0 ? <div style={{ fontSize: 9, color: 'var(--red)' }}>✗{o.qcRejectedQty} rej</div> : null}
                          {isQc && o.qcPending > 0 ? <div style={{ fontSize: 9, color: 'var(--amber)' }}>⏳{o.qcPending} pend</div> : null}
                        </td>
                        <td className="td-ctr mono fw-700" style={{ color: bal > 0 ? 'var(--amber)' : 'var(--text3)' }}>{bal}</td>
                        <td>
                          <span className={`badge ${st.cls}`}>{st.label}</span>
                        </td>
                        <td style={{ fontSize: 10, lineHeight: 1.6 }}>
                          {opLogs.length === 0 ? (
                            <span className="text3">No entries</span>
                          ) : (
                            opLogs.map((l) => <div key={l.id}>{fmtLog(l)}</div>)
                          )}
                        </td>
                        <td>
                          {o.computedStatus === 'complete' ? (
                            <span style={{ color: 'var(--green)', fontSize: 11 }}>✓ Done</span>
                          ) : isQc ? (
                            <button type="button" className="btn btn-sm" style={{ color: 'var(--green)' }} onClick={openOpEntry}>
                              🔬 QC{o.qcPending > 0 ? ` (${o.qcPending})` : ''}
                            </button>
                          ) : (
                            <button type="button" className="btn btn-sm btn-primary" onClick={openOpEntry}>
                              {o.computedStatus === 'available' || o.computedStatus === 'waiting' ? '▶ Start' : '✚ Log'}
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}

      {/* Completion Log */}
      <div className="mono" style={{ fontSize: 11, color: 'var(--cyan)', fontWeight: 700, letterSpacing: '.08em', textTransform: 'uppercase', marginBottom: 8 }}>
        ▸ Completion Log ({timeline.length} entries)
      </div>
      <div className="panel">
        <div className="tbl-wrap" style={{ maxHeight: 260, overflowY: 'auto' }}>
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
              {timeline.length === 0 ? (
                <tr>
                  <td colSpan={7} className="empty-state">No log entries yet.</td>
                </tr>
              ) : (
                timeline.map((l) => {
                  const op = opById.get(l.jcOpId);
                  return (
                    <tr key={l.id}>
                      <td className="text2" style={{ fontSize: 11 }}>{l.logDate}</td>
                      <td className="text2" style={{ fontSize: 11 }}>{l.shift}</td>
                      <td style={{ fontSize: 11 }}>{op ? `Op${op.opSeq}: ${op.operation}` : '—'}</td>
                      <td>
                        <span className={`badge ${l.logType === 'qc' ? 'b-green' : 'b-cyan'}`}>{l.logType}</span>
                      </td>
                      <td className="td-ctr mono fw-700" style={{ color: 'var(--green)' }}>
                        +{l.qty}
                        {l.rejectQty > 0 ? <span style={{ color: 'var(--red)' }}> / -{l.rejectQty}</span> : null}
                      </td>
                      <td style={{ fontSize: 11 }}>{l.operatorName ?? '—'}</td>
                      <td className="text3" style={{ fontSize: 11 }}>{l.remarks ?? ''}</td>
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
