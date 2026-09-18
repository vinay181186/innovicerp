// Job Card VIEW page — the bottom tab bar (2026-09-18 mockup):
//   Documents & Quality | Remarks | Related Records | History
//
//   Documents & Quality  cards for what this card actually has: the drawing
//                        (opens the shared preview), each QC document (opens
//                        the file), open QC calls (→ QC Call Register on this
//                        card), NCs (→ NC register on this card). No card for
//                        a thing that does not exist; no "Manage Documents".
//   Remarks              the card's own remarks text.
//   Related Records      the shared Related Documents panel, as before.
//   History              the completion-log feed (op_log ∪ NC ∪ dispositions ∪
//                        OSP), as before — server-merged, real total.
//
// Presentation only. Every figure is one the page already loaded.
import type {
  JcOpEnriched,
  JobCardCompletionEvent,
  JobCardListItem,
  JobCardStatusExtras,
} from '@innovic/shared';
import { fmtOpSrNo } from '@innovic/shared';
import { Link } from '@tanstack/react-router';
import { useMemo, useState } from 'react';
import { RelatedDocsPanel } from '@/components/shared/related-docs-panel';
import { effectiveFormPerms, useMyAccess } from '@/lib/access-control';
import { drawingViewUrl } from '@/lib/drawing-url';
import type { JcDrawingRef } from './jc-view-summary';

// ─── Completion-log feed (History tab) ──────────────────────────────────────

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
    const label = e.logType === 'start' ? 'Started' : e.logType === 'qc' ? 'QC Entry' : 'Completed';
    // ADR-164 — machineCode is the machine ACTUALLY used; plannedMachineCode is
    // the op's plan. Name the plan only when the two differ.
    const machine = e.machineCode ?? '?';
    const planned = e.plannedMachineCode?.trim() ?? '';
    const machineLabel =
      planned && e.machineCode && planned.toLowerCase() !== e.machineCode.trim().toLowerCase()
        ? `${machine} (planned ${planned})`
        : machine;
    const operator = e.operatorName ?? '';
    const detail =
      e.logType === 'start'
        ? `on ${machineLabel} by ${operator}`
        : e.logType === 'qc'
          ? `+${e.qty ?? 0} accepted${(e.rejectQty ?? 0) > 0 ? `, ${e.rejectQty} rejected` : ''} — ${operator}`
          : `+${e.qty ?? 0} pcs — ${operator}`;
    return {
      id: e.id,
      date: e.date,
      time: e.time,
      icon: e.logType === 'start' ? '▶' : e.logType === 'qc' ? '🔬' : '✔',
      color: e.logType === 'start' ? 'var(--amber)' : 'var(--green)',
      title: `Op${e.opSeq != null ? fmtOpSrNo(e.opSeq) : '?'}: ${e.operation ?? '?'} — ${label}`,
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
      title: `${e.ncNo ?? 'NC'}: ${e.reasonCategory ?? 'NC'} at Op${e.opSeq != null ? fmtOpSrNo(e.opSeq) : '?'}`,
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
      (e.disposition === 'rework'
        ? ` → back to Op${e.reworkOpSeq != null ? fmtOpSrNo(e.reworkOpSeq) : '?'}`
        : '') +
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

/** The History tab body — legacy L11144-11161, L11259-11260. A per-date
 *  grouped icon feed, not a table. The header shows the REAL server total;
 *  when op_log was capped, it notes how many of the total are shown
 *  (ISSUE-174 — no fabricated count). */
function HistoryFeed({
  completionLog,
}: {
  completionLog: JobCardStatusExtras['completionLog'] | undefined;
}): React.JSX.Element {
  // The server owns the MERGE (op_log ∪ NC ∪ NC-disposition ∪ OSP activity),
  // the ORDER (latest-first) and the TOTAL; here we group the already-sorted
  // events by date and map each to its icon/colour/title.
  const eventDays = useMemo(() => {
    const rows = (completionLog?.events ?? []).map(mapEvent);
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
      total: completionLog?.total ?? rows.length,
      truncated: completionLog?.truncated ?? false,
    };
  }, [completionLog]);

  return (
    <div>
      <div style={{ fontSize: 11, color: 'var(--text3)', marginBottom: 8 }}>
        {eventDays.truncated
          ? `showing latest ${eventDays.shown} of ${eventDays.total} entries`
          : `${eventDays.total} entries`}
      </div>
      <div
        style={{
          maxHeight: 320,
          overflowY: 'auto',
          border: '1px solid var(--border)',
          borderRadius: 8,
          padding: '0 12px',
        }}
      >
        {eventDays.total === 0 ? (
          <div className="empty-state" style={{ padding: 16 }}>
            No log entries yet
          </div>
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
                  style={{
                    display: 'flex',
                    gap: 10,
                    padding: '5px 0',
                    borderBottom: '1px solid var(--border)',
                    alignItems: 'flex-start',
                  }}
                >
                  <div style={{ fontSize: 14, width: 20, textAlign: 'center', flexShrink: 0 }}>
                    {e.icon}
                  </div>
                  <div style={{ flex: 1 }}>
                    <div
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                      }}
                    >
                      <span style={{ fontSize: 12, fontWeight: 700, color: e.color }}>
                        {e.title}
                      </span>
                      {e.time ? (
                        <span className="mono" style={{ fontSize: 10, color: 'var(--text3)' }}>
                          {e.time}
                        </span>
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

// ─── Documents & Quality cards ───────────────────────────────────────────────

/** One document card: icon · title · sub-line. A button when it opens a file
 *  or a modal, a Link when it navigates to a register, plain when it only
 *  informs (the register links are permission-gated by the caller — the card
 *  then still shows the figure, as information is never gated here). */
function DocCard({
  icon,
  iconBg,
  title,
  sub,
  onClick,
  link,
  hint,
}: {
  icon: string;
  iconBg: string;
  title: string;
  sub: React.ReactNode;
  onClick?: (() => void) | undefined;
  link?: { to: 'qc-call-register' | 'nc-register'; search: string } | null;
  hint?: string;
}): React.JSX.Element {
  const body = (
    <>
      <span
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: 32,
          height: 32,
          borderRadius: 8,
          background: iconBg,
          fontSize: 16,
          flexShrink: 0,
        }}
      >
        {icon}
      </span>
      <span style={{ minWidth: 0 }}>
        <span
          className="fw-700"
          style={{ display: 'block', fontSize: 12, color: 'var(--text)', whiteSpace: 'nowrap' }}
        >
          {title}
        </span>
        <span
          className="mono"
          style={{
            display: 'block',
            fontSize: 11,
            color: 'var(--text2)',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            maxWidth: 220,
          }}
        >
          {sub}
        </span>
      </span>
    </>
  );
  const style: React.CSSProperties = {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 10,
    padding: '8px 12px',
    background: 'var(--bg2)',
    border: '1px solid var(--border)',
    borderRadius: 8,
    minWidth: 160,
    textAlign: 'left',
    textDecoration: 'none',
    color: 'inherit',
    cursor: onClick || link ? 'pointer' : 'default',
    font: 'inherit',
  };
  if (link?.to === 'qc-call-register') {
    return (
      <Link to="/qc-call-register" search={{ search: link.search }} title={hint} style={style}>
        {body}
      </Link>
    );
  }
  if (link?.to === 'nc-register') {
    return (
      <Link to="/nc-register" search={{ search: link.search }} title={hint} style={style}>
        {body}
      </Link>
    );
  }
  if (onClick) {
    return (
      <button type="button" onClick={onClick} title={hint} style={style}>
        {body}
      </button>
    );
  }
  return (
    <div title={hint} style={style}>
      {body}
    </div>
  );
}

function DocumentsTab({
  jc,
  ops,
  extras,
  drawing,
  onOpenDrawing,
}: {
  jc: JobCardListItem;
  ops: JcOpEnriched[];
  extras: JobCardStatusExtras | undefined;
  drawing: JcDrawingRef | null;
  onOpenDrawing: () => void;
}): React.JSX.Element {
  const { data: eff } = useMyAccess();
  // The two register links carry the same gates as the op-card buttons that
  // open the same screens (jc-op-actions.tsx): QC Call Register → qc_submit
  // .view, NC register → nc_dispose.view. Without the right the card stays
  // (it is information) but does not link; hidden as a link until the access
  // matrix has loaded, like every other action button.
  const canQc = effectiveFormPerms(eff, 'qc_submit').view;
  const canNc = effectiveFormPerms(eff, 'nc_dispose').view;

  // QC Calls = the QC operations with pieces waiting to be inspected right now
  // (qcPending > 0) — the same condition that shows 🔬 QC Call (n) on the op
  // card. The enriched op carries no qc_call_date, so this is calls OPEN, not
  // calls ever raised. Pieces waiting go on the sub-line.
  const qcOps = ops.filter((o) => o.opType === 'qc');
  const openQcCalls = qcOps.filter((o) => o.qcPending > 0);
  const qcPendingPcs = openQcCalls.reduce((s, o) => s + o.qcPending, 0);
  // NC Report = the NC entries in the server-merged completion log (every NC
  // is included in full; only op_log is ever capped — see jobCardStatusExtras).
  const ncEvents = (extras?.completionLog.events ?? []).filter((e) => e.kind === 'nc');
  const ncPcs = ncEvents.reduce((s, e) => s + (e.rejectedQty ?? 0), 0);

  const qcDocs = extras?.qcDocs ?? [];
  const openQcDoc = (storagePath: string): void => {
    // The link is minted by the SERVER in view mode (since 2026-09-11), so the
    // open is logged and no attachment disposition is handed out by the
    // browser's own session.
    void drawingViewUrl({ path: storagePath, source: 'qc_document', refCode: jc.code }).then(
      (url) => window.open(url, '_blank', 'noopener'),
    );
  };

  const nothing = !drawing && qcDocs.length === 0 && qcOps.length === 0 && ncEvents.length === 0;

  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
      {drawing ? (
        <DocCard
          icon="📐"
          iconBg="var(--green3)"
          title="Drawing"
          sub={`${drawing.code}${drawing.rev ? ` (Rev. ${drawing.rev})` : ''}`}
          onClick={onOpenDrawing}
          hint={`Open this drawing — ${drawing.label}`}
        />
      ) : null}
      {qcDocs.map((d) => (
        <DocCard
          key={d.id}
          icon="📄"
          iconBg="var(--blue3)"
          title={d.docType}
          sub={d.fileName || '—'}
          onClick={d.storagePath ? () => openQcDoc(d.storagePath) : undefined}
          hint={`${d.fileName || 'No file'}${d.uploadDate ? ` · added ${d.uploadDate}` : ''}`}
        />
      ))}
      {qcOps.length > 0 ? (
        <DocCard
          icon="🔬"
          iconBg="var(--amber3)"
          title="QC Calls"
          sub={
            openQcCalls.length > 0
              ? `${openQcCalls.length} open · ${qcPendingPcs} pcs waiting`
              : 'none open'
          }
          hint={
            canQc
              ? 'Open the QC Call Register on this job card'
              : 'QC operations with pieces waiting to be inspected'
          }
          link={canQc ? { to: 'qc-call-register', search: jc.code } : null}
        />
      ) : null}
      {ncEvents.length > 0 ? (
        <DocCard
          icon="⚠"
          iconBg="var(--red3)"
          title="NC Report"
          sub={`${ncEvents.length} NC · ${ncPcs} pcs`}
          hint={
            canNc
              ? 'Open the NC register filtered to this job card'
              : 'Non-conformances raised on this job card'
          }
          link={canNc ? { to: 'nc-register', search: jc.code } : null}
        />
      ) : null}
      {nothing ? (
        <div className="empty-state" style={{ padding: 16, width: '100%' }}>
          No drawing, QC document, QC call or NC on this job card yet
        </div>
      ) : null}
    </div>
  );
}

// ─── The tab bar ─────────────────────────────────────────────────────────────

type Tab = 'docs' | 'remarks' | 'related' | 'history';

const TABS: ReadonlyArray<{ key: Tab; label: string }> = [
  { key: 'docs', label: 'Documents & Quality' },
  { key: 'remarks', label: 'Remarks' },
  { key: 'related', label: 'Related Records' },
  { key: 'history', label: 'History' },
];

export function JcViewTabs({
  jc,
  ops,
  extras,
  drawing,
  onOpenDrawing,
}: {
  jc: JobCardListItem;
  ops: JcOpEnriched[];
  extras: JobCardStatusExtras | undefined;
  drawing: JcDrawingRef | null;
  onOpenDrawing: () => void;
}): React.JSX.Element {
  const [tab, setTab] = useState<Tab>('docs');
  return (
    <div className="panel">
      <div
        role="tablist"
        style={{
          display: 'flex',
          gap: 2,
          padding: '0 8px',
          borderBottom: '1px solid var(--border)',
          background: 'var(--bg3)',
        }}
      >
        {TABS.map((t) => {
          const active = t.key === tab;
          return (
            <button
              key={t.key}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => setTab(t.key)}
              style={{
                background: 'none',
                border: 'none',
                borderBottom: `2px solid ${active ? 'var(--blue)' : 'transparent'}`,
                padding: '9px 12px',
                cursor: 'pointer',
                fontSize: 12,
                fontWeight: 700,
                color: active ? 'var(--blue2)' : 'var(--text2)',
                font: 'inherit',
              }}
            >
              {t.label}
            </button>
          );
        })}
      </div>
      <div className="panel-body">
        {tab === 'docs' ? (
          <DocumentsTab
            jc={jc}
            ops={ops}
            extras={extras}
            drawing={drawing}
            onOpenDrawing={onOpenDrawing}
          />
        ) : tab === 'remarks' ? (
          jc.remarks ? (
            <div style={{ fontSize: 13, color: 'var(--text)', whiteSpace: 'pre-wrap' }}>
              {jc.remarks}
            </div>
          ) : (
            <div className="empty-state" style={{ padding: 16 }}>
              No remarks on this job card
            </div>
          )
        ) : tab === 'related' ? (
          <RelatedDocsPanel module="job-cards" id={jc.id} />
        ) : (
          <HistoryFeed completionLog={extras?.completionLog} />
        )}
      </div>
    </div>
  );
}
