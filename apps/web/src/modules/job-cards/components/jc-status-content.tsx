// JC Status content (legacy viewJCStatus L11020 body): drawing + Print, 6 stat
// cards, OPERATION FLOW stepper, OPERATIONS DETAIL (per-op recent logs + Start/
// Log/QC actions), and the completion-log timeline. Rendered by the JC Status
// page (routes/status).
import type {
  JcOpEnriched,
  JcOpsBoardRow,
  JobCardCompletionEvent,
  JobCardEditModel,
  JobCardListItem,
  JobCardStatusExtras,
  JobCardStatusOpExtra,
  OpLog,
  OutsourceStatus,
} from '@innovic/shared';
import { Link, useNavigate } from '@tanstack/react-router';
import { Download, Loader2, Printer } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { signedUrl } from '@/lib/storage';
import { useItemsList } from '@/modules/items/api';
import { useJcOpsBoard } from '@/modules/jc-ops/api';
import { SearchableSelect } from '@/components/shared/searchable-select';
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
import { OutsourceBalanceModal } from './outsource-balance-modal';
import { buildJcWriteInput } from '../lib/build-jc-write-input';
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
  at_vendor: { label: 'Processing', cls: 'b-amber' },
  received: { label: 'Incoming QC', cls: 'b-cyan' },
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
                  <th>Order Qty</th>
                  <th style={{ color: 'var(--green)' }}>Completed Qty</th>
                  <th style={{ color: 'var(--amber)' }}>Pending Qty</th>
                  <th style={{ color: 'var(--blue)' }}>At Vendor</th>
                  <th style={{ color: 'var(--cyan)' }}>In QC</th>
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
                    // Canonical per-op quantities: Completed = this op's done qty
                    // (QC → accepted; process/outsource → completedQty, which for
                    // outsource is accepted-back per 0068), Pending = Order − Completed.
                    const doneQty = isQc ? o.qcAcceptedQty : o.completedQty;
                    const pendingQty = Math.max(0, jc.orderQty - doneQty);
                    const opLogs = (logsByOp.get(o.id) ?? []).slice(0, 3);
                    const isOut = o.opType === 'outsource';
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
                              {/* Resolved machine name (legacy machTag L1982). */}
                              {opExtraById.get(o.id)?.machineName ? (
                                <span style={{ fontSize: 9, color: 'var(--text3)', fontWeight: 400, display: 'block' }}>
                                  {opExtraById.get(o.id)?.machineName}
                                </span>
                              ) : null}
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
                          {/* tool_details (legacy L11049) — server-resolved (opExtras). */}
                          {opExtraById.get(o.id)?.toolDetails ? (
                            <>
                              {o.program || o.toolNo ? <br /> : null}
                              <span style={{ color: 'var(--text3)', fontSize: 10 }}>
                                {opExtraById.get(o.id)?.toolDetails}
                              </span>
                            </>
                          ) : null}
                          {!o.program && !o.toolNo ? <span className="text3">—</span> : null}
                        </td>
                        <td className="td-ctr">{jc.orderQty}</td>
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
                          <span className="mono fw-700" style={{ fontSize: 15, color: pendingQty > 0 ? 'var(--amber)' : 'var(--text3)' }}>
                            {pendingQty}
                          </span>
                        </td>
                        <td className="td-ctr">
                          {isOut ? (
                            <span className="mono fw-700" style={{ fontSize: 14, color: o.atVendorQty > 0 ? 'var(--blue)' : 'var(--text3)' }}>
                              {o.atVendorQty}
                            </span>
                          ) : (
                            <span className="text3">—</span>
                          )}
                        </td>
                        <td className="td-ctr">
                          {isOut ? (
                            <span className="mono fw-700" style={{ fontSize: 14, color: o.inQcQty > 0 ? 'var(--cyan)' : 'var(--text3)' }}>
                              {o.inQcQty}
                            </span>
                          ) : (
                            <span className="text3">—</span>
                          )}
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
                          ) : o.computedStatus === 'complete' ? (
                            <span style={{ color: 'var(--green)', fontSize: 12 }}>✓ Done</span>
                          ) : o.computedStatus === 'in_progress' ||
                            o.computedStatus === 'running' ||
                            o.completedQty > 0 ? (
                            /* T33: Log only once the op is started; otherwise the
                               Start button below is the only action shown. */
                            <button
                              type="button"
                              className="btn btn-sm btn-primary"
                              onClick={() => void navigate({ to: '/op-entry', search: { jc: jc.code, op: o.id, mode: 'complete' } })}
                            >
                              ✚ Log
                            </button>
                          ) : null}
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

/** Editable op row shape (mirrors job-card-form's FormOp). `hasStarted` locks
 *  removal/retype; `available` drives the outsource-balance action. */
interface EditOp {
  id?: string;
  machineCode: string;
  operation: string;
  opType: 'process' | 'qc' | 'outsource';
  cycleTimeMin: number;
  program: string;
  toolNo: string;
  toolDetails: string;
  qcRequired: boolean;
  outsourceVendorCode: string;
  outsourceCost: number;
  hasStarted: boolean;
  available: number;
}

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
            {opCount} op{ops.length !== 1 ? 's' : ''}
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
                  <th>QC</th>
                  <th>Order Qty</th>
                  <th style={{ color: 'var(--green)' }}>Completed Qty</th>
                  <th style={{ color: 'var(--amber)' }}>Pending Qty</th>
                  <th style={{ color: 'var(--blue)' }}>At Vendor</th>
                  <th style={{ color: 'var(--cyan)' }}>In QC</th>
                  <th>Status</th>
                  <th>Recent Logs</th>
                  <th style={{ color: 'var(--amber)' }}>Outsource</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {ops.length === 0 ? (
                  <tr>
                    <td colSpan={15} className="empty-state">
                      No operations — click “+ Add Op” or “+ Add QC Op”.
                    </td>
                  </tr>
                ) : (
                  ops.map((o, i) => {
                    const isQc = o.opType === 'qc';
                    const isOut = o.opType === 'outsource';
                    const en = o.id ? enrichedById.get(o.id) : undefined;
                    const machineName = machines.find((m) => m.code === o.machineCode)?.name ?? '';
                    const st = en
                      ? (OP_STATUS[en.computedStatus] ?? { label: en.computedStatus, cls: 'b-grey' })
                      : null;
                    const doneQty = en ? (isQc ? en.qcAcceptedQty : en.completedQty) : 0;
                    const pendingQty = en ? Math.max(0, jc.orderQty - doneQty) : 0;
                    const opLogs = o.id ? (logsByOp.get(o.id) ?? []).slice(0, 3) : [];
                    return (
                      <tr
                        key={o.id ?? `new-${i}`}
                        style={
                          isQc
                            ? { background: 'rgba(34,197,94,0.04)' }
                            : isOut
                              ? { background: 'rgba(255,176,32,0.04)' }
                              : undefined
                        }
                      >
                        <td className="td-ctr mono fw-700" style={{ fontSize: 15 }}>
                          {en ? en.opSeq : i + 1}
                          {isQc ? (
                            <div style={{ fontSize: 8, fontWeight: 700, color: 'var(--green)' }}>🔬 QC</div>
                          ) : null}
                          {isOut ? (
                            <div style={{ fontSize: 8, fontWeight: 700, color: 'var(--amber)' }}>🏭 OUT</div>
                          ) : null}
                        </td>
                        {/* Machine — editable input for process ops. */}
                        <td>
                          {isQc ? (
                            <span className="badge b-green">🔬 QC</span>
                          ) : isOut ? (
                            /* T32b: an OSP op has no machine — show an inactive
                               badge like QC, not a greyed empty machine input. */
                            <span
                              className="badge"
                              style={{
                                background: 'rgba(245,158,11,0.12)',
                                color: 'var(--amber)',
                                border: '1px solid rgba(245,158,11,0.35)',
                              }}
                            >
                              🏭 OSP
                            </span>
                          ) : (
                            <>
                              <SearchableSelect
                                id={`jc-edit-mach-${o.id ?? i}`}
                                value={machines.find((m) => m.code === o.machineCode)?.id ?? null}
                                onChange={(id) =>
                                  setOp(i, {
                                    machineCode: id
                                      ? (machines.find((m) => m.id === id)?.code ?? '')
                                      : '',
                                  })
                                }
                                onSearch={setMachineSearch}
                                options={machineOptions}
                                placeholder="🔍 Machine ★"
                                valueLabel={o.machineCode || undefined}
                                selectedLabel={(m) => m.code ?? m.name ?? ''}
                              />
                              <div className="cyan" style={{ fontSize: 10, marginTop: 2, minHeight: 13 }}>
                                {machineName}
                              </div>
                            </>
                          )}
                        </td>
                        {/* Operation — editable. */}
                        <td>
                          <input
                            className="innovic-input"
                            value={o.operation}
                            placeholder={isQc ? 'QC process name ★' : 'Operation name ★'}
                            onChange={(e) => setOp(i, { operation: e.target.value })}
                            style={{ fontSize: 12 }}
                          />
                        </td>
                        {/* Cycle — editable. */}
                        <td>
                          <input
                            type="number"
                            min={0}
                            step="0.01"
                            className="innovic-input"
                            value={o.cycleTimeMin || ''}
                            onChange={(e) => setOp(i, { cycleTimeMin: Number(e.target.value) })}
                            style={{ fontSize: 12, width: 70 }}
                          />
                        </td>
                        {/* Prog/Tool — editable (program + tool details). */}
                        <td>
                          {isQc ? (
                            <span className="text3" style={{ fontSize: 10 }}>—</span>
                          ) : (
                            <>
                              <input
                                className="innovic-input"
                                value={o.program}
                                placeholder="CNC program"
                                onChange={(e) => setOp(i, { program: e.target.value })}
                                style={{ fontSize: 11, marginBottom: 3 }}
                              />
                              <input
                                className="innovic-input"
                                value={o.toolDetails}
                                placeholder="Tool details"
                                onChange={(e) => setOp(i, { toolDetails: e.target.value })}
                                style={{ fontSize: 11 }}
                              />
                            </>
                          )}
                        </td>
                        {/* QC required — editable checkbox. */}
                        <td className="td-ctr">
                          {isQc ? (
                            <span className="badge b-green">YES</span>
                          ) : (
                            <label
                              style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 3 }}
                              title="QC Required after this operation"
                            >
                              <input
                                type="checkbox"
                                checked={o.qcRequired}
                                onChange={(e) => setOp(i, { qcRequired: e.target.checked })}
                              />
                              <span className={o.qcRequired ? 'green' : 'text3'} style={{ fontSize: 9, fontWeight: 700 }}>
                                {o.qcRequired ? 'YES' : 'NO'}
                              </span>
                            </label>
                          )}
                        </td>
                        {/* Order Qty — read-only (JC order qty). */}
                        <td className="td-ctr">{jc.orderQty}</td>
                        {/* Completed — read-only from enriched. */}
                        <td className="td-ctr mono fw-700">
                          {!en ? (
                            <span className="text3">—</span>
                          ) : isQc ? (
                            <>
                              <div style={{ fontSize: 13, color: 'var(--green)' }}>{en.qcAcceptedQty}</div>
                              <div style={{ fontSize: 9, color: 'var(--green)' }}>✓ accepted</div>
                              {en.qcRejectedQty > 0 ? (
                                <div style={{ fontSize: 9, color: 'var(--red)' }}>✗{en.qcRejectedQty} rej</div>
                              ) : null}
                            </>
                          ) : (
                            <>
                              <span style={{ color: 'var(--green)' }}>{en.completedQty}</span>
                              {en.qcRequired && en.qcAcceptedQty > 0 ? (
                                <div style={{ fontSize: 9, color: 'var(--green)' }}>✓{en.qcAcceptedQty} acc</div>
                              ) : null}
                            </>
                          )}
                        </td>
                        {/* Pending — read-only. */}
                        <td className="td-ctr">
                          {!en ? (
                            <span className="text3">—</span>
                          ) : (
                            <span className="mono fw-700" style={{ fontSize: 15, color: pendingQty > 0 ? 'var(--amber)' : 'var(--text3)' }}>
                              {pendingQty}
                            </span>
                          )}
                        </td>
                        {/* At Vendor — read-only. */}
                        <td className="td-ctr">
                          {en && isOut ? (
                            <span className="mono fw-700" style={{ fontSize: 14, color: en.atVendorQty > 0 ? 'var(--blue)' : 'var(--text3)' }}>
                              {en.atVendorQty}
                            </span>
                          ) : (
                            <span className="text3">—</span>
                          )}
                        </td>
                        {/* In QC — read-only. */}
                        <td className="td-ctr">
                          {en && isOut ? (
                            <span className="mono fw-700" style={{ fontSize: 14, color: en.inQcQty > 0 ? 'var(--cyan)' : 'var(--text3)' }}>
                              {en.inQcQty}
                            </span>
                          ) : (
                            <span className="text3">—</span>
                          )}
                        </td>
                        {/* Status — read-only badge. */}
                        <td>
                          {st ? (
                            <span className={`badge ${st.cls}`}>{st.label}</span>
                          ) : (
                            <span className="text3" style={{ fontSize: 10 }}>—</span>
                          )}
                        </td>
                        {/* Recent Logs — read-only. */}
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
                        {/* Outsource — editable. Started process op with a
                            remaining balance → the 🏭 Outsource balance modal;
                            un-started process op → the OUTSOURCE checkbox +
                            vendor/cost inputs (mirrors job-card-form). */}
                        <td>
                          {isQc ? (
                            <span className="text3" style={{ fontSize: 10 }}>—</span>
                          ) : (
                            <div>
                              {o.hasStarted && !isOut && o.available > 0 && o.id ? (
                                <button
                                  type="button"
                                  className="btn btn-sm"
                                  style={{
                                    fontSize: 9,
                                    fontWeight: 700,
                                    color: 'var(--amber)',
                                    border: '1px solid rgba(245,158,11,0.4)',
                                    padding: '2px 6px',
                                  }}
                                  title={`Outsource the remaining ${o.available} pc(s) of this started operation`}
                                  onClick={() => {
                                    setBalanceNote(null);
                                    setBalanceOpIdx(i);
                                  }}
                                >
                                  🏭 Outsource balance
                                </button>
                              ) : (
                                <label
                                  style={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: 3,
                                    cursor: o.hasStarted ? 'not-allowed' : 'pointer',
                                  }}
                                  title={o.hasStarted ? 'Operation already started — locked' : 'Outsource this op'}
                                >
                                  <input
                                    type="checkbox"
                                    checked={isOut}
                                    disabled={o.hasStarted}
                                    onChange={(e) =>
                                      setOp(i, { opType: e.target.checked ? 'outsource' : 'process' })
                                    }
                                  />
                                  <span style={{ fontSize: 9, fontWeight: 700, color: isOut ? 'var(--amber)' : 'var(--text3)' }}>
                                    {o.hasStarted ? 'OUTSRC 🔒' : 'OUTSOURCE'}
                                  </span>
                                </label>
                              )}
                              {isOut ? (
                                <div style={{ marginTop: 3 }}>
                                  <input
                                    className="innovic-input"
                                    list="dlJcEditVendor"
                                    value={o.outsourceVendorCode}
                                    placeholder="🔍 Vendor"
                                    onChange={(e) => setOp(i, { outsourceVendorCode: e.target.value })}
                                    style={{ fontSize: 10, marginBottom: 3 }}
                                  />
                                  <input
                                    type="number"
                                    min={0}
                                    step="0.01"
                                    className="innovic-input"
                                    value={o.outsourceCost || ''}
                                    placeholder="₹ Cost/pc"
                                    onChange={(e) => setOp(i, { outsourceCost: Number(e.target.value) })}
                                    style={{ fontSize: 10 }}
                                  />
                                </div>
                              ) : null}
                            </div>
                          )}
                        </td>
                        {/* Move / remove — started ops locked from re-sequence
                            and removal (server also blocks OSP-committed ops). */}
                        <td style={{ whiteSpace: 'nowrap' }}>
                          <button
                            type="button"
                            className="btn btn-ghost btn-sm btn-icon"
                            disabled={i === 0 || o.hasStarted}
                            onClick={() => moveOp(i, -1)}
                            title={o.hasStarted ? 'Started op — cannot re-sequence' : 'Move up'}
                          >
                            ▲
                          </button>
                          <button
                            type="button"
                            className="btn btn-ghost btn-sm btn-icon"
                            disabled={i === ops.length - 1 || o.hasStarted}
                            onClick={() => moveOp(i, 1)}
                            title={o.hasStarted ? 'Started op — cannot re-sequence' : 'Move down'}
                          >
                            ▼
                          </button>
                          <button
                            type="button"
                            className="btn btn-danger btn-sm btn-icon"
                            disabled={o.hasStarted}
                            onClick={() => setOps((prev) => prev.filter((_, idx) => idx !== i))}
                            title={o.hasStarted ? 'Started op — cannot remove' : 'Remove'}
                          >
                            ✕
                          </button>
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
