// JC Status content (legacy viewJCStatus L11020 body): drawing + Print, 6 stat
// cards, OPERATION FLOW stepper, OPERATIONS DETAIL (per-op recent logs + Start/
// Log/QC actions), and the completion-log timeline. Rendered by the JC Status
// page (routes/status).
import type {
  JcOpEnriched,
  JobCardCompletionEvent,
  JobCardEditModel,
  JobCardListItem,
  JobCardStatusExtras,
  JobCardStatusOpExtra,
  OpLog,
} from '@innovic/shared';
import { Link, useNavigate } from '@tanstack/react-router';
import { Download, Loader2, Printer } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { signedUrl } from '@/lib/storage';
import { useItemsList } from '@/modules/items/api';
import { useMachinesList } from '@/modules/machines/api';
import { useVendorsList } from '@/modules/vendors/api';
import { opEntryKeys, useJcOpsEnriched, useOpLog } from '@/modules/op-entry/api';
import { useMyCompany } from '@/modules/settings/api';
import {
  jobCardsKeys,
  useJobCard,
  useJobCardEditModel,
  useJobCardStatusExtras,
  useUpdateJobCard,
} from '../api';
import { JcStatTiles } from './jc-stat-tiles';
import { JcOpCard } from './jc-op-card';
import { JcOpEditCard, type JcOpEditValues } from './jc-op-edit-card';
import { OutsourceBalanceModal } from './outsource-balance-modal';
import { buildJcWriteInput } from '../lib/build-jc-write-input';
import { OUTSOURCE_STATUS_LABEL } from '../lib/jc-op-labels';
import { exportJobCardExcel } from '../lib/export-job-card-excel';
import { printJobCard } from '../lib/print-job-card';

// Legacy disposition icon/colour ladder (viewJCStatus L11115-11116). Legacy
// keyed Title-Case strings ('Rework', 'Scrap', …); our nc_disposition enum is
// snake_case, so the keys are remapped.
const DISPOSITION_ICON: Record<string, { icon: string; color: string }> = {
  rework: { icon: '♻', color: 'var(--cyan)' },
  scrap: { icon: '🗑', color: 'var(--red)' },
  use_as_is: { icon: '✅', color: 'var(--green)' },
  return_to_vendor: { icon: '📦', color: 'var(--purple)' },
  make_fresh: { icon: '📦', color: 'var(--purple)' },
};

// One rendered feed row. Kept presentation-only: the server owns the merge,
// order and total; this maps a structured event → legacy's icon/colour/title.
interface FeedRow {
  id: string;
  date: string;
  time: string | null;
  icon: string;
  color: string;
  title: string;
  detail: string;
  remarks: string;
  qtyKind: 'none' | 'complete' | 'qc' | 'nc';
  qty: number | null;
}

// Mirrors legacy _allEvents shaping (L11091-11131) per event kind.
function mapEvent(e: JobCardCompletionEvent): FeedRow {
  if (e.kind === 'op') {
    const label =
      e.logType === 'start' ? 'Started' : e.logType === 'qc' ? 'QC Entry' : 'Completed';
    const machine = e.machineCode ?? '?';
    const operator = e.operatorName ?? '';
    const detail =
      e.logType === 'start'
        ? `on ${machine} by ${operator}`
        : e.logType === 'qc'
          ? `+${e.qty ?? 0} accepted${(e.rejectQty ?? 0) > 0 ? `, ${e.rejectQty} rejected` : ''} — ${operator}`
          : `+${e.qty ?? 0} pcs — ${operator}`;
    return {
      id: e.id,
      date: e.date,
      time: e.time,
      icon: e.logType === 'start' ? '▶' : e.logType === 'qc' ? '🔬' : '✔',
      color: e.logType === 'start' ? 'var(--amber)' : 'var(--green)',
      title: `Op${e.opSeq ?? '?'}: ${e.operation ?? '?'} — ${label}`,
      detail: `${detail}${e.shift ? ` • ${e.shift}` : ''}`,
      remarks: e.remarks ?? '',
      qtyKind: e.logType === 'start' ? 'none' : e.logType === 'qc' ? 'qc' : 'complete',
      qty: e.qty ?? 0,
    };
  }
  if (e.kind === 'nc') {
    const detail =
      `${e.rejectedQty ?? 0} pcs rejected — ${e.reason ?? ''}` +
      (e.disposition ? ` • Disposition: ${e.disposition}` : '') +
      (e.operatorText ? ` • Operator: ${e.operatorText}` : '');
    return {
      id: e.id,
      date: e.date,
      time: e.time,
      icon: '❌',
      color: 'var(--red)',
      title: `${e.ncNo ?? 'NC'}: ${e.reasonCategory ?? 'NC'} at Op${e.opSeq ?? '?'}`,
      detail,
      remarks: '',
      qtyKind: 'nc',
      qty: e.rejectedQty ?? 0,
    };
  }
  if (e.kind === 'nc-disposition') {
    const d = DISPOSITION_ICON[e.disposition ?? ''] ?? { icon: '📦', color: 'var(--purple)' };
    const detail =
      `${e.rejectedQty ?? 0} pcs` +
      (e.disposition === 'rework' ? ` → back to Op${e.reworkOpSeq ?? '?'}` : '') +
      (e.dispositionBy ? ` • By: ${e.dispositionBy}` : '');
    return {
      id: e.id,
      date: e.date,
      time: e.time,
      icon: d.icon,
      color: d.color,
      title: `${e.ncNo ?? 'NC'} Disposed: ${e.disposition ?? ''}`,
      detail,
      remarks: '',
      qtyKind: 'none',
      qty: null,
    };
  }
  // osp (legacy L11128-11130)
  return {
    id: e.id,
    date: e.date,
    time: e.time,
    icon: '📋',
    color: 'var(--blue)',
    title: `${e.ospCategory ?? ''}: ${e.detail ?? ''}`,
    detail: 'Auto-generated for OSP process',
    remarks: '',
    qtyKind: 'none',
    qty: null,
  };
}

// QC document card (legacy L11253-54). storagePath resolves to a signed URL on
// click (legacy embedded base64 fileData directly; we stream from Storage).
function QcDocCard({
  docType,
  fileName,
  storagePath,
  uploadDate,
}: {
  docType: string;
  fileName: string;
  storagePath: string;
  uploadDate: string | null;
}): React.JSX.Element {
  const open = (): void => {
    void signedUrl(storagePath).then((url) => window.open(url, '_blank', 'noopener'));
  };
  return (
    <div style={{ padding: '8px 12px', background: 'var(--bg3)', borderRadius: 8, border: '1px solid var(--border)', minWidth: 190 }}>
      <div style={{ fontSize: 10, color: 'var(--cyan)', fontWeight: 700 }}>{docType}</div>
      <div style={{ fontSize: 12, fontWeight: 600, margin: '3px 0' }}>{fileName || '—'}</div>
      {storagePath ? (
        <button
          type="button"
          onClick={open}
          style={{ fontSize: 11, color: 'var(--blue)', background: 'none', border: 'none', padding: 0, cursor: 'pointer' }}
        >
          📎 {fileName || 'Download'}
        </button>
      ) : (
        <span style={{ fontSize: 10, color: 'var(--text3)' }}>No file</span>
      )}
      <div style={{ fontSize: 10, color: 'var(--text3)', marginTop: 3 }}>Added: {uploadDate ?? '—'}</div>
    </div>
  );
}

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

// Operation Flow stepper (legacy L11210-11240). Extracted from the view body so
// the JC edit branch (mode='edit') renders the identical read-only strip — same
// markup for both, per the JcStatTiles precedent. Presentation-only.
function OperationFlowStrip({
  jc,
  sortedOps,
  opExtraById,
}: {
  jc: JobCardListItem;
  sortedOps: JcOpEnriched[];
  opExtraById: Map<string, JobCardStatusOpExtra>;
}): React.JSX.Element {
  return (
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
                    <>
                      <div style={{ fontSize: 11, fontWeight: 600, margin: '2px 0', color: 'var(--cyan)' }}>
                        {o.machineCode ?? o.machineCodeText ?? '—'}
                      </div>
                      {/* Resolved machine name (legacy L11230 sub-line). */}
                      {opExtraById.get(o.id)?.machineName ? (
                        <div style={{ fontSize: 9, color: 'var(--text3)' }}>
                          {opExtraById.get(o.id)?.machineName}
                        </div>
                      ) : null}
                    </>
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
  );
}

// Mode dispatcher. VIEW mode renders the canonical read-only status body
// (byte-identical to before). EDIT mode renders the same sections (tiles +
// operation flow + operations table) with the editable fields, reusing the JC
// create/edit save logic. No hooks here → the branch is safe for rules-of-hooks.
export function JcStatusContent({
  id,
  mode = 'view',
}: {
  id: string;
  mode?: 'view' | 'edit';
}): React.JSX.Element {
  if (mode === 'edit') return <JcStatusEditContent id={id} />;
  return <JcStatusViewContent id={id} />;
}

function JcStatusViewContent({ id }: { id: string }): React.JSX.Element {
  const navigate = useNavigate();
  const { data: jc, isLoading, isError, error } = useJobCard(id);
  const { data: ops = [] } = useJcOpsEnriched({ jobCardId: id }, { enabled: Boolean(id) });
  const { data: logs = [] } = useOpLog({ jobCardId: id, limit: 300 }, { enabled: Boolean(id) });
  // Server-computed extras: QC docs, per-op machine name + tool details, and the
  // merged completion feed (op_log ∪ NC ∪ OSP) with a real total (ISSUE-174).
  const { data: extras } = useJobCardStatusExtras(id);
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
  // Per-op machine name (flow stepper, L11230) + tool details (Prog/Tool cell,
  // L11049) — both server-resolved (opExtras); the op-entry enriched op omits
  // them. Keyed by op id.
  const opExtraById = useMemo(
    () => new Map((extras?.opExtras ?? []).map((e) => [e.jcOpId, e])),
    [extras?.opExtras],
  );

  // Completion feed (legacy _allEvents L11091-11134). The server owns the MERGE
  // (op_log ∪ NC ∪ NC-disposition ∪ OSP activity), the ORDER (latest-first) and
  // the TOTAL; here we group the already-sorted events by date and map each to
  // its icon/colour/title. `truncated` → op_log was capped, so the header shows
  // "showing latest N of total" (ISSUE-174 — no fabricated count).
  const eventDays = useMemo(() => {
    const rows = (extras?.completionLog.events ?? []).map(mapEvent);
    const days: { date: string; events: FeedRow[] }[] = [];
    for (const r of rows) {
      const key = r.date || 'Unknown';
      const last = days.find((d) => d.date === key);
      if (last) last.events.push(r);
      else days.push({ date: key, events: [r] });
    }
    return {
      days,
      shown: rows.length,
      total: extras?.completionLog.total ?? rows.length,
      truncated: extras?.completionLog.truncated ?? false,
    };
  }, [extras?.completionLog]);

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

      {/* 6 stat cards — shared with the JC edit page via JcStatTiles so both
          screens carry the same summary header (same format, only mode differs). */}
      <JcStatTiles jc={jc} ops={ops} />

      {/* OPERATION FLOW — extracted so the JC edit branch renders the SAME
          read-only stepper (shared component, identical markup). */}
      <OperationFlowStrip jc={jc} sortedOps={sortedOps} opExtraById={opExtraById} />

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
        <div style={{ marginBottom: 16 }}>
          {sortedOps.length === 0 ? (
            <div className="panel">
              <div className="empty-state">No operations</div>
            </div>
          ) : (
            sortedOps.map((o) => (
              <JcOpCard
                key={o.id}
                jc={jc}
                op={o}
                machineName={opExtraById.get(o.id)?.machineName ?? null}
                toolDetails={opExtraById.get(o.id)?.toolDetails ?? null}
                logs={(logsByOp.get(o.id) ?? []).slice(0, 3)}
                onStart={(opId) =>
                  void navigate({ to: '/op-entry', search: { jc: jc.code, op: opId, mode: 'start' } })
                }
                onLog={(opId) =>
                  void navigate({ to: '/op-entry', search: { jc: jc.code, op: opId, mode: 'complete' } })
                }
                onQc={() => void navigate({ to: '/qc-call-register' })}
              />
            ))
          )}
        </div>
      ) : null}

      {/* QC DOCUMENTS — legacy L11250-11257. Rendered only when the JC has docs
          attached (file_registry qc-docs), between the ops table and the feed. */}
      {extras && extras.qcDocs.length > 0 ? (
        <>
          <div style={{ marginTop: 16, marginBottom: 8 }}>
            <span className="mono" style={{ fontSize: 11, color: 'var(--cyan)', fontWeight: 700, textTransform: 'uppercase' }}>
              ▸ QC Documents ({extras.qcDocs.length})
            </span>
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 16 }}>
            {extras.qcDocs.map((d) => (
              <QcDocCard
                key={d.id}
                docType={d.docType}
                fileName={d.fileName}
                storagePath={d.storagePath}
                uploadDate={d.uploadDate}
              />
            ))}
          </div>
        </>
      ) : null}

      {/* Log history — legacy L11144-11161, L11259-11260. A per-date grouped
          icon feed, not a table. Header shows the REAL server total; when op_log
          was capped, it notes how many of the total are shown (ISSUE-174). */}
      <div className="mono" style={{ fontSize: 11, color: 'var(--cyan)', fontWeight: 700, letterSpacing: '.08em', textTransform: 'uppercase', marginBottom: 8 }}>
        ▸ Completion Log{' '}
        {eventDays.truncated
          ? `(showing latest ${eventDays.shown} of ${eventDays.total} entries)`
          : `(${eventDays.total} entries)`}
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
                  {e.qtyKind !== 'none' ? (
                    <div className="mono fw-700" style={{ fontSize: 13, flexShrink: 0 }}>
                      {e.qtyKind === 'qc' ? (
                        `+${e.qty}`
                      ) : e.qtyKind === 'nc' ? (
                        <span style={{ color: 'var(--red)' }}>-{e.qty}</span>
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

// ─── EDIT MODE ──────────────────────────────────────────────────────────────
// Same sections as the view (tiles + operation flow + operations table) with
// editable header + op cells. Reuses the JC create/edit save logic
// (buildJcWriteInput + useUpdateJobCard), the shared OutsourceBalanceModal +
// useOutsourceOpBalance, and the OP_STATUS map — no reinvented logic.

/** Editable op row shape — now shared with the editable op card
 *  (`JcOpEditValues`, jc-op-edit-card.tsx). Same fields as before; only the
 *  declaration moved so the card and this screen cannot drift. */
type EditOp = JcOpEditValues;

// Loader: fetches the editable model + the read-only enriched ops/logs/extras,
// then renders the form once everything resolves (so the form seeds its state
// from props, exactly like job-card-form seeds from its `model` prop).
function JcStatusEditContent({ id }: { id: string }): React.JSX.Element {
  const { data: jc, isLoading, isError, error } = useJobCard(id);
  const { data: model, isLoading: modelLoading, isError: modelError } = useJobCardEditModel(id);
  const { data: enrichedOps = [] } = useJcOpsEnriched({ jobCardId: id }, { enabled: Boolean(id) });
  const { data: logs = [] } = useOpLog({ jobCardId: id, limit: 300 }, { enabled: Boolean(id) });
  const { data: extras } = useJobCardStatusExtras(id);

  if (isLoading || modelLoading) {
    return (
      <div className="empty-state">
        <Loader2 className="inline h-4 w-4 animate-spin" /> Loading job card…
      </div>
    );
  }
  if (isError || modelError || !jc || !model) {
    return (
      <div className="empty-state" style={{ color: 'var(--red)' }}>
        {error instanceof Error ? error.message : 'Job card not found'}
      </div>
    );
  }
  return (
    <JcStatusEditForm
      id={id}
      jc={jc}
      model={model}
      enrichedOps={enrichedOps}
      logs={logs}
      extras={extras}
    />
  );
}

function JcStatusEditForm({
  id,
  jc,
  model,
  enrichedOps,
  logs,
  extras,
}: {
  id: string;
  jc: JobCardListItem;
  model: JobCardEditModel;
  enrichedOps: JcOpEnriched[];
  logs: OpLog[];
  extras: JobCardStatusExtras | undefined;
}): React.JSX.Element {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const update = useUpdateJobCard(id);

  const { data: itemsData } = useItemsList({ limit: 500, offset: 0 });
  const { data: machinesData } = useMachinesList({ limit: 500, offset: 0 });
  const { data: vendorsData } = useVendorsList({ limit: 500, offset: 0 });
  const items = itemsData?.items ?? [];
  const machines = machinesData?.machines ?? [];
  const vendors = (vendorsData?.vendors ?? []).filter((v) => v.isActive);
  // T32a: the edit machine picker now uses the shared SearchableSelect (like
  // create/plan) instead of a datalist, which collapsed on a pre-filled value.
  // Only one row's dropdown is open at a time, so a shared search term is fine.
  const [machineSearch, setMachineSearch] = useState('');
  const machineOptions = machines
    .filter(
      (m) =>
        !machineSearch.trim() ||
        `${m.code} ${m.name}`.toLowerCase().includes(machineSearch.trim().toLowerCase()),
    )
    .map((m) => ({ id: m.id, code: m.code, name: m.name }));

  // ── Editable header (item code, order qty, due date, priority, remarks).
  //    Source, date, drawing and existing QC docs are preserved unchanged from
  //    the model on save (not editable on this screen). ──
  const [itemCode, setItemCode] = useState(model.itemCode);
  const [orderQty, setOrderQty] = useState<string>(String(model.orderQty));
  const [dueDate, setDueDate] = useState(model.dueDate ?? '');
  const [priority, setPriority] = useState<'normal' | 'high'>(model.priority);
  const [remarks, setRemarks] = useState(model.remarks ?? '');

  const [ops, setOps] = useState<EditOp[]>(
    model.ops.map((o) => ({
      id: o.id,
      machineCode: o.machineCode ?? '',
      operation: o.operation,
      opType: o.opType,
      cycleTimeMin: o.cycleTimeMin,
      program: o.program ?? '',
      toolNo: o.toolNo ?? '',
      toolDetails: o.toolDetails ?? '',
      qcRequired: o.qcRequired,
      outsourceVendorCode: o.outsourceVendorCode ?? '',
      outsourceCost: o.outsourceCost,
      hasStarted: o.hasStarted,
      available: o.available ?? 0,
    })),
  );
  const [error, setError] = useState<string | null>(null);
  const [detailOpen, setDetailOpen] = useState(true);
  const [balanceOpIdx, setBalanceOpIdx] = useState<number | null>(null);
  const [balanceNote, setBalanceNote] = useState<string | null>(null);

  // Read-only enriched columns + recent logs (from the JC Status view) keyed by
  // op id, so each editable row shows the SAME live progress the view shows.
  const enrichedById = useMemo(
    () => new Map(enrichedOps.map((o) => [o.id, o])),
    [enrichedOps],
  );
  const sortedEnriched = useMemo(
    () => [...enrichedOps].sort((a, b) => a.opSeq - b.opSeq),
    [enrichedOps],
  );
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
  const opExtraById = useMemo(
    () => new Map((extras?.opExtras ?? []).map((e) => [e.jcOpId, e])),
    [extras?.opExtras],
  );

  const setOp = (i: number, patch: Partial<EditOp>): void => {
    setOps((prev) => prev.map((o, idx) => (idx === i ? { ...o, ...patch } : o)));
  };
  const moveOp = (i: number, dir: -1 | 1): void => {
    setOps((prev) => {
      const next = [...prev];
      const j = i + dir;
      if (j < 0 || j >= next.length) return prev;
      [next[i], next[j]] = [next[j]!, next[i]!];
      return next;
    });
  };
  const addOp = (qc = false): void => {
    setOps((prev) => [
      ...prev,
      {
        machineCode: '',
        operation: '',
        opType: qc ? 'qc' : 'process',
        cycleTimeMin: 0,
        program: '',
        toolNo: '',
        toolDetails: '',
        qcRequired: qc,
        outsourceVendorCode: '',
        outsourceCost: 0,
        hasStarted: false,
        available: 0,
      },
    ]);
  };

  const submitting = update.isPending;

  const onSave = async (): Promise<void> => {
    setError(null);
    // Shared validation + payload build. Source/date/drawing/docs are carried
    // through from the model unchanged (edit here only touches header + ops).
    const result = buildJcWriteInput({
      isEdit: true,
      jcDate: model.jcDate,
      sourceType: model.sourceSoLineId ? 'so' : model.sourceJwLineId ? 'jw' : null,
      sourceLineId: model.sourceSoLineId ?? model.sourceJwLineId ?? null,
      itemCode,
      orderQty,
      priority,
      dueDate,
      drawingFilePath: model.drawingFilePath,
      remarks,
      ops,
      // Existing QC docs already carry ids → filtered out of the write payload
      // (unchanged server-side); no new-doc upload on this screen.
      docs: model.qcDocs.map((d) => ({
        id: d.id,
        docType: d.docType,
        fileName: d.fileName,
        storagePath: d.storagePath,
        fileSize: d.fileSize,
      })),
    });
    if (!result.ok) {
      setError(result.error);
      return;
    }
    try {
      await update.mutateAsync(result.payload);
      void queryClient.invalidateQueries({ queryKey: jobCardsKeys.detail(id) });
      void queryClient.invalidateQueries({ queryKey: opEntryKeys.all });
      void navigate({ to: '/job-cards/$id', params: { id } });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed');
    }
  };

  const opCount = ops.filter((o) => o.opType !== 'qc').length;
  const qcCount = ops.filter((o) => o.opType === 'qc').length;

  return (
    <div>
      <datalist id="dlJcEditItem">
        {items.map((i) => (
          <option key={i.id} value={i.code}>
            {i.code} — {i.name}
          </option>
        ))}
      </datalist>
      <datalist id="dlJcEditVendor">
        {vendors.map((v) => (
          <option key={v.id} value={v.code}>
            {v.code} — {v.name}
          </option>
        ))}
      </datalist>

      {/* Same summary tiles as the view — shared JcStatTiles. */}
      <JcStatTiles jc={jc} ops={enrichedOps} />

      {/* Editable header fields */}
      <div className="panel" style={{ marginBottom: 12 }}>
        <div className="panel-hdr">
          <div className="panel-title">▸ Job Card Details</div>
        </div>
        <div className="panel-body">
          <div className="form-grid">
            <div className="form-grp">
              <label className="form-label">JC No.</label>
              <input className="innovic-input" value={model.code} readOnly />
            </div>
            <div className="form-grp">
              <label className="form-label">Priority</label>
              <select
                className="innovic-select"
                value={priority}
                onChange={(e) => setPriority(e.target.value as 'normal' | 'high')}
              >
                <option value="normal">Normal</option>
                <option value="high">High</option>
              </select>
            </div>
            <div className="form-grp form-full">
              <label className="form-label">
                Item Code <span className="req">★</span>
              </label>
              <input
                className="innovic-input"
                list="dlJcEditItem"
                value={itemCode}
                placeholder="🔍 Search item code or name…"
                onChange={(e) => setItemCode(e.target.value)}
              />
            </div>
            <div className="form-grp">
              <label className="form-label">
                Order Qty <span className="req">★</span>
              </label>
              <input
                type="number"
                min={1}
                className="innovic-input"
                value={orderQty}
                onChange={(e) => setOrderQty(e.target.value)}
              />
            </div>
            <div className="form-grp">
              <label className="form-label">Due Date</label>
              <input
                type="date"
                className="innovic-input"
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
              />
            </div>
            <div className="form-grp form-full">
              <label className="form-label">Remarks</label>
              <textarea
                className="innovic-textarea"
                rows={2}
                value={remarks}
                onChange={(e) => setRemarks(e.target.value)}
                placeholder="Optional notes for this job card"
              />
            </div>
          </div>
        </div>
      </div>

      {/* Operation Flow — SAME read-only stepper as the view. */}
      <OperationFlowStrip jc={jc} sortedOps={sortedEnriched} opExtraById={opExtraById} />

      {/* OPERATIONS DETAIL — same table as the view, with editable cells for
          Machine/Operation/Cycle/Prog-Tool/QC/Outsource. The qty/status/logs
          columns stay READ-ONLY from the enriched ops. */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
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
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <span className="text3" style={{ fontSize: 11 }}>
            {opCount} op{opCount !== 1 ? 's' : ''}
            {qcCount > 0 ? ` + ${qcCount} QC` : ''}
          </span>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => addOp(false)}>
            + Add Op
          </button>
          <button
            type="button"
            className="btn btn-sm"
            style={{ color: 'var(--green)', border: '1px solid rgba(34,197,94,0.3)' }}
            onClick={() => addOp(true)}
          >
            + Add QC Op
          </button>
        </div>
      </div>
      {detailOpen ? (
        <div style={{ marginBottom: 16 }}>
          {ops.length === 0 ? (
            <div className="panel">
              <div className="empty-state">
                No operations — click “+ Add Op” or “+ Add QC Op”.
              </div>
            </div>
          ) : (
            ops.map((o, i) => {
              const en = o.id ? enrichedById.get(o.id) : undefined;
              return (
                <JcOpEditCard
                  key={o.id ?? `new-${i}`}
                  jc={jc}
                  op={o}
                  index={i}
                  seqLabel={en ? en.opSeq : i + 1}
                  enriched={en}
                  machineName={machines.find((m) => m.code === o.machineCode)?.name ?? ''}
                  machines={machines}
                  machineOptions={machineOptions}
                  onMachineSearch={setMachineSearch}
                  vendorListId="dlJcEditVendor"
                  logs={o.id ? (logsByOp.get(o.id) ?? []).slice(0, 3) : []}
                  isFirst={i === 0}
                  isLast={i === ops.length - 1}
                  onChange={(patch) => setOp(i, patch)}
                  onMove={(dir) => moveOp(i, dir)}
                  onRemove={() => setOps((prev) => prev.filter((_, idx) => idx !== i))}
                  onOutsourceBalance={() => {
                    setBalanceNote(null);
                    setBalanceOpIdx(i);
                  }}
                />
              );
            })
          )}
        </div>
      ) : null}

      {error ? (
        <div
          style={{
            color: 'var(--red)',
            background: 'var(--red3)',
            border: '1px solid #fca5a5',
            borderRadius: 6,
            padding: '6px 10px',
            fontSize: 12,
            marginBottom: 10,
          }}
        >
          {error}
        </div>
      ) : null}

      {balanceNote ? (
        <div
          style={{
            color: 'var(--green)',
            background: 'rgba(34,197,94,0.08)',
            border: '1px solid rgba(34,197,94,0.3)',
            borderRadius: 6,
            padding: '6px 10px',
            fontSize: 12,
            marginBottom: 10,
          }}
        >
          {balanceNote}
        </div>
      ) : null}

      {balanceOpIdx !== null && ops[balanceOpIdx]?.id ? (
        <OutsourceBalanceModal
          jcId={id}
          jcCode={model.code}
          opId={ops[balanceOpIdx]!.id!}
          opSeq={enrichedById.get(ops[balanceOpIdx]!.id!)?.opSeq ?? balanceOpIdx + 1}
          operation={ops[balanceOpIdx]!.operation}
          itemCode={itemCode}
          available={ops[balanceOpIdx]!.available}
          defaultVendorCode={ops[balanceOpIdx]!.outsourceVendorCode}
          vendors={vendors}
          onClose={() => setBalanceOpIdx(null)}
          onDone={(qtyDone) => {
            const idx = balanceOpIdx;
            const op = ops[idx];
            if (op) setOp(idx, { available: Math.max(0, op.available - qtyDone) });
            setBalanceNote(`Outsourced ${qtyDone} pc(s) from Op${idx + 1} — JW OSP purchase request raised.`);
            setBalanceOpIdx(null);
          }}
        />
      ) : null}

      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 6 }}>
        <Link to="/job-cards/$id" params={{ id }} className="btn btn-ghost">
          Cancel
        </Link>
        <button
          type="button"
          className="btn btn-success"
          disabled={submitting}
          onClick={() => void onSave()}
        >
          {submitting ? <Loader2 size={13} className="animate-spin" /> : null} ✓ Save Job Card
        </button>
      </div>
    </div>
  );
}
