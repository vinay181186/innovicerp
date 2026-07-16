// JC Status content (legacy viewJCStatus L11020 body): drawing + Print, 6 stat
// cards, OPERATION FLOW stepper, OPERATIONS DETAIL (per-op recent logs + Start/
// Log/QC actions), and the completion-log timeline. Rendered by the JC Status
// page (routes/status).
import type { JcOpsBoardRow, OpLog, OutsourceStatus } from '@innovic/shared';
import { useNavigate } from '@tanstack/react-router';
import { Download, Loader2, Printer } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { signedUrl } from '@/lib/storage';
import { useJcOpsBoard } from '@/modules/jc-ops/api';
import { useJcOpsEnriched, useOpLog } from '@/modules/op-entry/api';
import { useMyCompany } from '@/modules/settings/api';
import { useJobCard } from '../api';
import { JcStatusBadge } from './jc-status-badge';
import { exportJobCardExcel } from '../lib/export-job-card-excel';
import { printJobCard } from '../lib/print-job-card';

// Mirrors legacy badge() (L1959-1970) for the op status strings it maps.
// Two legacy entries are inert: badge('In Progress') → `b-yellow` and
// badge('Running') → `b-running`, neither of which legacy's <style> defines —
// so they render unstyled in legacy too. We keep our `b-amber` for both rather
// than port a no-op class (same call the SO Status port made for `b-blue`).
const OP_STATUS: Record<string, { label: string; cls: string }> = {
  waiting: { label: 'Waiting', cls: 'b-red' },
  available: { label: 'Available', cls: 'b-blue' },
  in_progress: { label: 'In Progress', cls: 'b-amber' },
  running: { label: 'Running', cls: 'b-amber' },
  qc_pending: { label: 'QC Pending', cls: 'b-amber' },
  complete: { label: 'Complete', cls: 'b-green' },
  pr_raised: { label: 'PR Raised', cls: 'b-amber' },
  po_created: { label: 'PO Created', cls: 'b-blue' },
  at_vendor: { label: 'At Vendor', cls: 'b-amber' },
  received: { label: 'Received', cls: 'b-cyan' },
  ready_for_pr: { label: 'Ready for PR', cls: 'b-amber' },
  outsource: { label: 'Outsource', cls: 'b-amber' },
};

// Legacy stores outsourceStatus as Title Case strings ('Pending', 'PR Raised',
// 'PO Created', …) and renders them raw (L11043, L11075). Ours is the pg enum
// `outsource_status`, so rendering it raw shows `pr_raised` where legacy shows
// `PR Raised`. This maps our enum back to legacy's exact wording.
//
// Kept separate from OP_STATUS above: that map is keyed for a different field
// (jc_ops computed status, read only at the Status column) and has no entry for
// `pending` or `sent` — two of the five outsource values — so reusing it would
// leave those rendering raw. `Record<OutsourceStatus, string>` makes the
// compiler enforce all five.
const OUTSOURCE_STATUS_LABEL: Record<OutsourceStatus, string> = {
  pending: 'Pending',
  pr_raised: 'PR Raised',
  po_created: 'PO Created',
  sent: 'Sent',
  received: 'Received',
};

// Legacy op-status → progress-bar colour (L11033). Legacy tests only
// 'In Progress' here, so 'Running' falls through to blue — mirrored verbatim.
const barColor = (status: string): string =>
  status === 'complete' ? 'var(--green)' : status === 'in_progress' ? 'var(--amber)' : 'var(--blue)';

// Legacy renders bare 'HH:MM' (its op_log startTime is a time input); our
// `op_log.start_time` is a `time` column serialised 'HH:MM:SS'. Bare clock
// time — no timezone involved, so no ISSUE-065 exposure.
const fmtTime = (t: string | null): string => (t ? t.slice(0, 5) : '');

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

// Outsource vendor/PR/PO details for a JC op. Wired from the existing jc-ops
// board endpoint (useJcOpsBoard, jc-ops/api.ts:31), whose row already carries
// outsourceVendorName / outsourcePrCode / outsourcePoCode (jc-ops.ts:39-41,
// populated in jc-ops/service.ts:70-72) — fields the op-entry enriched op shape
// (sortedOps) omits. Legacy renders these at L11043 (vendor name in the Machine
// cell) and L11070-74 (PR/PO refs in the Action cell).
//
// Rendered ONLY inside outsource rows, so the board is fetched only when a JC
// actually has outsource ops, and always with a resolved jcCode (these mount
// after the JC has loaded) — no unfiltered fetch-all. Multiple outsource rows on
// one JC share a single request (identical query key → TanStack Query dedupes).
function useOutsourceRow(jcCode: string, jcOpId: string): JcOpsBoardRow | undefined {
  const { data } = useJcOpsBoard({ jcCode, limit: 500, offset: 0 });
  return data?.items.find((r) => r.jcOpId === jcOpId);
}

// Machine-column cell for an outsource op (legacy L11043): label + resolved
// vendor name + status.
function OutsourceMachineCell({
  jcCode,
  jcOpId,
  status,
}: {
  jcCode: string;
  jcOpId: string;
  status: OutsourceStatus;
}): React.JSX.Element {
  const row = useOutsourceRow(jcCode, jcOpId);
  return (
    <>
      <div style={{ fontSize: 10, color: 'var(--amber)', fontWeight: 600 }}>🏭 Outsource</div>
      {row?.outsourceVendorName ? (
        <div style={{ fontSize: 9, color: 'var(--text3)' }}>{row.outsourceVendorName}</div>
      ) : null}
      <div style={{ fontSize: 9, color: 'var(--text3)' }}>{OUTSOURCE_STATUS_LABEL[status]}</div>
    </>
  );
}

// Action-column cell for an outsource op (legacy L11070-74): PR ref when a PR is
// raised, PO ref when a PO is created, otherwise the raw status. Legacy's
// "Create PR" branch (L11070) is an OSP action that lives in Op Entry
// (useGenerateOspPr), not on this read-oriented status page — so only the
// resulting references are surfaced here.
function OutsourceActionRefs({
  jcCode,
  jcOpId,
  status,
}: {
  jcCode: string;
  jcOpId: string;
  status: OutsourceStatus;
}): React.JSX.Element {
  const row = useOutsourceRow(jcCode, jcOpId);
  if (status === 'pr_raised' && row?.outsourcePrCode) {
    return <span style={{ fontSize: 10, color: 'var(--blue)' }}>PR: {row.outsourcePrCode}</span>;
  }
  if (status === 'po_created' && row?.outsourcePoCode) {
    return <span style={{ fontSize: 10, color: 'var(--cyan)' }}>PO: {row.outsourcePoCode}</span>;
  }
  return <span style={{ fontSize: 10, color: 'var(--purple)' }}>{OUTSOURCE_STATUS_LABEL[status]}</span>;
}

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

  // Legacy _allEvents (L11091-11142): every op_log row for this JC — including
  // 'start' entries, which our previous port dropped — shaped into an icon feed
  // and grouped by date, latest first.
  //
  // Legacy also folds in NC register events, NC dispositions, and OSP PR/PO
  // events from the activity log (L11106-11131). None of those have a
  // server-side source on this page's endpoints, so they are reported as a gap
  // rather than derived in the browser.
  const eventDays = useMemo(() => {
    const events = logs.map((l) => {
      const op = opById.get(l.jcOpId);
      const machine = op ? (op.machineCode ?? op.machineCodeText ?? '?') : '?';
      const operator = l.operatorName ?? '';
      const label = l.logType === 'start' ? 'Started' : l.logType === 'qc' ? 'QC Entry' : 'Completed';
      const detail =
        l.logType === 'start'
          ? `on ${machine} by ${operator}`
          : l.logType === 'qc'
            ? `+${l.qty} accepted${l.rejectQty > 0 ? `, ${l.rejectQty} rejected` : ''} — ${operator}`
            : `+${l.qty} pcs — ${operator}`;
      return {
        id: l.id,
        date: l.logDate,
        time: fmtTime(l.startTime),
        sort: `${l.logDate}T${fmtTime(l.startTime) || '99:99'}`,
        icon: l.logType === 'start' ? '▶' : l.logType === 'qc' ? '🔬' : '✔',
        color: l.logType === 'start' ? 'var(--amber)' : 'var(--green)',
        title: `Op${op?.opSeq ?? '?'}: ${op?.operation ?? '?'} — ${label}`,
        detail: `${detail}${l.shift ? ` • ${l.shift}` : ''}`,
        remarks: l.remarks ?? '',
        logType: l.logType,
        qty: l.qty,
      };
    });
    events.sort((a, b) => b.sort.localeCompare(a.sort));
    const days: { date: string; events: typeof events }[] = [];
    for (const e of events) {
      const key = e.date || 'Unknown';
      const last = days.find((d) => d.date === key);
      if (last) last.events.push(e);
      else days.push({ date: key, events: [e] });
    }
    return { days, total: events.length };
  }, [logs, opById]);

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

      {/* Legacy _jcDrwSec (L11263). Legacy pairs the header with a
          `🖨 Drawing` button (printDrawingFile(id,'jc')); we have no drawing-only
          print path on this page, so the header carries the label alone. */}
      {drawingUrl ? (
        <div style={{ marginBottom: 14, padding: 10, background: 'var(--bg3)', border: '1px solid var(--border)', borderRadius: 8 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
            <span className="mono" style={{ fontSize: 11, color: 'var(--cyan)', fontWeight: 700 }}>▸ DRAWING</span>
          </div>
          <img
            src={drawingUrl}
            alt="JC drawing"
            style={{ maxHeight: 140, maxWidth: '100%', borderRadius: 4, border: '1px solid var(--border2)', display: 'block' }}
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
          {jc.remarks ? (
            <div style={{ fontSize: 11, color: 'var(--text2)', marginTop: 2 }}>
              Remarks: <span style={{ color: 'var(--text)' }}>{jc.remarks}</span>
            </div>
          ) : null}
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
          <div className="prog-wrap">
            <div className="prog-bar" style={{ width: `${pct}%`, background: 'var(--blue)' }} />
          </div>
          <div style={{ fontSize: 10, color: 'var(--text3)', marginTop: 3 }}>
            {doneOps}/{totalOps} ops · {pct}%
          </div>
        </div>
        <div style={cardStyle('var(--green3)', 'var(--green2)')}>
          <div style={{ ...lblStyle, color: 'var(--green2)', marginBottom: 6 }}>Completed Qty</div>
          <div className="mono" style={{ fontSize: 22, fontWeight: 800, color: 'var(--green)' }}>{completed}</div>
          <div style={{ fontSize: 11, color: 'var(--green2)' }}>of {jc.orderQty} ordered</div>
        </div>
        <div
          style={cardStyle(
            pending > 0 ? 'var(--red3)' : 'var(--green3)',
            pending > 0 ? 'var(--red2)' : 'var(--green2)',
          )}
        >
          <div style={{ ...lblStyle, color: pending > 0 ? 'var(--red2)' : 'var(--green2)', marginBottom: 6 }}>Pending Qty</div>
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
              const st = o.computedStatus;
              // Legacy L11213-11216 bg / bdr / opColor / doneColor ladders.
              // (Legacy's OSP branch is skipped: jc_ops.op_type has no 'osp'
              // value in this system — OSP is handled at op-entry start.)
              const bg =
                st === 'complete'
                  ? 'var(--green3)'
                  : st === 'qc_pending'
                    ? 'rgba(34,197,94,0.12)'
                    : isOut
                      ? 'rgba(255,176,32,0.12)'
                      : isQc
                        ? 'rgba(34,197,94,0.08)'
                        : st === 'in_progress' || st === 'running'
                          ? 'var(--amber3)'
                          : st === 'available'
                            ? 'var(--blue3)'
                            : 'var(--bg4)';
              const bdr =
                st === 'complete'
                  ? 'var(--green2)'
                  : st === 'qc_pending'
                    ? 'rgba(34,197,94,0.5)'
                    : isOut
                      ? 'rgba(255,176,32,0.4)'
                      : isQc
                        ? 'rgba(34,197,94,0.3)'
                        : st === 'in_progress' || st === 'running'
                          ? 'var(--amber2)'
                          : st === 'available'
                            ? 'var(--blue2)'
                            : 'var(--border2)';
              const opColor =
                st === 'complete'
                  ? 'var(--green)'
                  : isQc
                    ? 'var(--green)'
                    : isOut
                      ? 'var(--amber)'
                      : st === 'in_progress' || st === 'running'
                        ? 'var(--amber)'
                        : st === 'available'
                          ? 'var(--blue)'
                          : 'var(--text3)';
              const doneColor =
                st === 'complete' || st === 'qc_pending'
                  ? 'var(--green)'
                  : st === 'in_progress' || st === 'running'
                    ? 'var(--amber)'
                    : 'var(--text3)';
              const flowQty = isQc ? o.qcAcceptedQty : o.completedQty;
              const flowLabel = isQc
                ? `${flowQty}/${o.inputAvail || jc.orderQty}`
                : `${flowQty}/${jc.orderQty}`;
              return (
                <div key={o.id} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  <div
                    style={{
                      background: bg,
                      border: `1px solid ${bdr}`,
                      borderRadius: 6,
                      padding: '6px 10px',
                      textAlign: 'center',
                      minWidth: 80,
                    }}
                  >
                    <div className="mono" style={{ fontSize: 10, fontWeight: 700, color: opColor }}>
                      Op{o.opSeq}
                      {isOut ? ' 🏭' : ''}
                      {isQc ? ' 🔬' : ''}
                    </div>
                    {isQc ? (
                      <>
                        <div style={{ fontSize: 11, fontWeight: 600, margin: '2px 0', color: 'var(--green)' }}>QC</div>
                        <div style={{ fontSize: 9, color: 'var(--text3)' }}>{o.operation}</div>
                      </>
                    ) : isOut ? (
                      <div style={{ fontSize: 11, fontWeight: 600, margin: '2px 0', color: 'var(--amber)' }}>OUTSOURCE</div>
                    ) : (
                      <div style={{ fontSize: 11, fontWeight: 600, margin: '2px 0', color: 'var(--cyan)' }}>
                        {o.machineCode ?? o.machineCodeText ?? '—'}
                      </div>
                    )}
                    <div style={{ fontSize: 9, color: 'var(--text3)' }}>
                      {isQc ? '' : o.operation.split(' ').slice(0, 2).join(' ')}
                    </div>
                    {isOut ? (
                      <div style={{ fontSize: 9, marginTop: 3, fontWeight: 700, color: 'var(--amber)' }}>
                        {OUTSOURCE_STATUS_LABEL[o.outsourceStatus ?? 'pending']}
                      </div>
                    ) : (
                      <div style={{ fontSize: 10, marginTop: 3, fontWeight: 700, color: doneColor }}>{flowLabel}</div>
                    )}
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
                  <th>Progress</th>
                  <th>Status</th>
                  <th>Recent Logs</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {sortedOps.length === 0 ? (
                  <tr>
                    <td colSpan={13} className="empty-state">No operations</td>
                  </tr>
                ) : (
                  sortedOps.map((o) => {
                    const st = OP_STATUS[o.computedStatus] ?? { label: o.computedStatus, cls: 'b-grey' };
                    const isQc = o.opType === 'qc';
                    const bal = isQc ? o.qcPending : o.available;
                    const opLogs = (logsByOp.get(o.id) ?? []).slice(0, 3);
                    const isOut = o.opType === 'outsource';
                    const pctOp = jc.orderQty > 0 ? Math.min(100, Math.round((o.completedQty / jc.orderQty) * 100)) : 0;
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
                        <td className="td-ctr mono fw-700" style={{ fontSize: 15 }}>
                          {o.opSeq}
                          {isQc ? (
                            <div style={{ fontSize: 8, fontWeight: 700, color: 'var(--green)' }}>🔬 QC</div>
                          ) : o.qcRequired ? (
                            <div style={{ fontSize: 8, fontWeight: 700, color: 'var(--green)' }}>QC</div>
                          ) : null}
                          {isOut ? <div style={{ fontSize: 8, fontWeight: 700, color: 'var(--amber)' }}>🏭 OUT</div> : null}
                        </td>
                        <td>
                          {isQc ? (
                            <div
                              style={{
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: 4,
                                padding: '4px 8px',
                                background: 'rgba(34,197,94,0.12)',
                                border: '1px solid rgba(34,197,94,0.3)',
                                borderRadius: 4,
                              }}
                            >
                              <span style={{ fontSize: 11 }}>🔬</span>
                              <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--green)' }}>QC</span>
                            </div>
                          ) : isOut ? (
                            <OutsourceMachineCell
                              jcCode={jc.code}
                              jcOpId={o.id}
                              status={o.outsourceStatus ?? 'pending'}
                            />
                          ) : (
                            <span className="tag" style={{ background: 'var(--bg4)', color: 'var(--cyan)', display: 'inline-block', lineHeight: 1.25, verticalAlign: 'top' }}>
                              <span style={{ fontWeight: 700, display: 'block' }}>{o.machineCode ?? o.machineCodeText ?? '—'}</span>
                            </span>
                          )}
                        </td>
                        <td>{o.operation}</td>
                        <td className="td-ctr mono">{Number(o.cycleTimeMin) || '—'}</td>
                        <td style={{ fontSize: 11 }}>
                          {o.program ? (
                            <span className="mono" style={{ color: 'var(--blue)' }}>{o.program}</span>
                          ) : null}
                          {o.toolNo ? (
                            <>
                              {o.program ? <br /> : null}
                              <span style={{ color: 'var(--cyan)', fontSize: 10 }}>{o.toolNo}</span>
                            </>
                          ) : null}
                          {!o.program && !o.toolNo ? <span className="text3">—</span> : null}
                        </td>
                        <td className="td-ctr">{jc.orderQty}</td>
                        <td className="td-ctr text2">{o.inputAvail}</td>
                        <td className="td-ctr mono fw-700">
                          {isQc ? (
                            <>
                              <div style={{ fontSize: 13, color: 'var(--green)' }}>{o.qcAcceptedQty}</div>
                              <div style={{ fontSize: 9, color: 'var(--green)' }}>✓ accepted</div>
                              {o.qcRejectedQty > 0 ? (
                                <div style={{ fontSize: 9, color: 'var(--red)' }}>✗{o.qcRejectedQty} rej</div>
                              ) : null}
                              {o.qcPending > 0 ? (
                                <div style={{ fontSize: 9, color: 'var(--amber)' }}>⏳{o.qcPending} pending</div>
                              ) : null}
                            </>
                          ) : (
                            <>
                              <span style={{ color: 'var(--green)' }}>{o.completedQty}</span>
                              {o.qcRequired ? (
                                <>
                                  <div style={{ fontSize: 9, color: 'var(--green)' }}>✓{o.qcAcceptedQty} acc</div>
                                  {o.qcRejectedQty > 0 ? (
                                    <div style={{ fontSize: 9, color: 'var(--red)' }}>✗{o.qcRejectedQty} rej</div>
                                  ) : null}
                                  {o.qcPending > 0 ? (
                                    <div style={{ fontSize: 9, color: 'var(--amber)' }}>⏳{o.qcPending} pend</div>
                                  ) : null}
                                </>
                              ) : null}
                            </>
                          )}
                        </td>
                        <td className="td-ctr">
                          <span className="mono fw-700" style={{ fontSize: 15, color: bal > 0 ? 'var(--amber)' : 'var(--text3)' }}>
                            {bal}
                          </span>
                        </td>
                        <td style={{ minWidth: 90 }}>
                          <div className="prog-wrap" style={{ marginBottom: 3 }}>
                            <div className="prog-bar" style={{ width: `${pctOp}%`, background: barColor(o.computedStatus) }} />
                          </div>
                          <div style={{ textAlign: 'center', fontSize: 10, color: 'var(--text3)' }}>{pctOp}%</div>
                        </td>
                        <td>
                          <span className={`badge ${st.cls}`}>{st.label}</span>
                        </td>
                        <td style={{ fontSize: 11, lineHeight: 1.7 }}>
                          {opLogs.length === 0 ? (
                            <span style={{ color: 'var(--text3)', fontSize: 11 }}>No entries</span>
                          ) : (
                            opLogs.map((l, li) => (
                              <span key={l.id} style={{ fontSize: 11, color: 'var(--text2)' }}>
                                {li > 0 ? <br /> : null}
                                {l.logDate} · {l.shift} · <b style={{ color: 'var(--green)' }}>+{l.qty}</b> ·{' '}
                                {l.operatorName ?? ''}
                              </span>
                            ))
                          )}
                        </td>
                        {/* Legacy L11067-11085. Legacy branches on outsource FIRST
                            (L11068), then QC, then normal ops. The outsource PR-No
                            (L11072) / PO-No (L11074) refs are wired from the jc-ops
                            board via OutsourceActionRefs; legacy's Create PR button
                            (L11070) is an Op Entry action, not surfaced here. */}
                        <td>
                          {isOut ? (
                            <OutsourceActionRefs
                              jcCode={jc.code}
                              jcOpId={o.id}
                              status={o.outsourceStatus ?? 'pending'}
                            />
                          ) : isQc ? (
                            o.qcPending > 0 ? (
                              <button
                                type="button"
                                className="btn btn-sm"
                                style={{ color: 'var(--green)' }}
                                onClick={() => void navigate({ to: '/qc-call-register' })}
                              >
                                🔬 QC ({o.qcPending})
                              </button>
                            ) : o.computedStatus === 'complete' ? (
                              <span style={{ color: 'var(--green)', fontSize: 12 }}>✓ QC Done</span>
                            ) : (
                              <span style={{ fontSize: 10, color: 'var(--text3)' }}>Waiting</span>
                            )
                          ) : o.computedStatus !== 'complete' ? (
                            <button
                              type="button"
                              className="btn btn-sm btn-primary"
                              onClick={() => void navigate({ to: '/op-entry', search: { jc: jc.code, op: o.id, mode: 'complete' } })}
                            >
                              ✚ Log
                            </button>
                          ) : (
                            <span style={{ color: 'var(--green)', fontSize: 12 }}>✓ Done</span>
                          )}
                          {!isQc && !isOut && (o.computedStatus === 'available' || o.computedStatus === 'waiting') ? (
                            <button
                              type="button"
                              className="btn btn-sm"
                              style={{ marginTop: 3 }}
                              onClick={() => void navigate({ to: '/op-entry', search: { jc: jc.code, op: o.id, mode: 'start' } })}
                            >
                              ▶ Start
                            </button>
                          ) : null}
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

      {/* Log history — legacy L11144-11161, L11259-11260. A per-date grouped
          icon feed, not a table. */}
      <div className="mono" style={{ fontSize: 11, color: 'var(--cyan)', fontWeight: 700, letterSpacing: '.08em', textTransform: 'uppercase', marginBottom: 8 }}>
        ▸ Completion Log ({eventDays.total} entries)
      </div>
      <div style={{ maxHeight: 220, overflowY: 'auto', border: '1px solid var(--border)', borderRadius: 8, padding: '0 12px' }}>
        {eventDays.total === 0 ? (
          <div className="empty-state" style={{ padding: 16 }}>No log entries yet</div>
        ) : (
          eventDays.days.map((day) => (
            <div key={day.date} style={{ marginBottom: 12 }}>
              <div
                className="mono"
                style={{
                  fontSize: 11,
                  fontWeight: 700,
                  color: 'var(--cyan)',
                  padding: '4px 0',
                  borderBottom: '1px solid var(--border)',
                  marginBottom: 6,
                }}
              >
                📅 {day.date}
              </div>
              {day.events.map((e) => (
                <div
                  key={e.id}
                  style={{ display: 'flex', gap: 10, padding: '5px 0', borderBottom: '1px solid var(--border)', alignItems: 'flex-start' }}
                >
                  <div style={{ fontSize: 14, width: 20, textAlign: 'center', flexShrink: 0 }}>{e.icon}</div>
                  <div style={{ flex: 1 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span style={{ fontSize: 12, fontWeight: 700, color: e.color }}>{e.title}</span>
                      {e.time ? (
                        <span className="mono" style={{ fontSize: 10, color: 'var(--text3)' }}>{e.time}</span>
                      ) : null}
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--text2)', marginTop: 1 }}>
                      {e.detail}
                      {e.remarks ? (
                        <>
                          {' • '}
                          <i>{e.remarks}</i>
                        </>
                      ) : null}
                    </div>
                  </div>
                  {e.logType !== 'start' ? (
                    <div className="mono fw-700" style={{ fontSize: 13, flexShrink: 0 }}>
                      {e.logType === 'qc' ? (
                        `+${e.qty}`
                      ) : (
                        <b style={{ color: 'var(--green)' }}>+{e.qty}</b>
                      )}
                    </div>
                  ) : null}
                </div>
              ))}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
