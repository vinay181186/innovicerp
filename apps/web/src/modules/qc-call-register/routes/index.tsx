// QC Call Register (legacy renderQCDashboard L4126, page `qcdashboard`).
// 2-panel: LEFT pending QC calls with an inline accept/reject submit; RIGHT
// completed QC log. Frontend-only — data from the qc-history endpoint, the QC
// write reuses op-entry's submitQcLog mutation. Legacy chrome.

import { SHIFTS, SHIFT_LABELS, type Shift, type SubmitQcLogInput } from '@innovic/shared';
import type { QcHistoryLogRow, QcHistoryPendingRow } from '@innovic/shared';
import { createRoute } from '@tanstack/react-router';
import { Loader2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { QcReportAttach, QcReportLink } from '@/components/shared/qc-report-attach';
import { fmtDate } from '@/lib/print/doc-print';
import { useSession } from '@/lib/session';
import { useOperatorsList } from '@/modules/operators/api';
import { useSubmitQcLog } from '@/modules/op-entry/api';
import { authenticatedRoute } from '@/routes/_authenticated';
import { useQcHistory } from '@/modules/qc-history/api';

export const qcCallRegisterRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: 'qc-call-register',
  component: QcCallRegisterPage,
});

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

// Whole-day diff between two YYYY-MM-DD dates (legacy /864e5 round). Parsed at
// UTC midnight so the result is timezone-independent.
function dayDiff(fromIso: string, toIso: string): number {
  const a = Date.parse(`${fromIso.slice(0, 10)}T00:00:00Z`);
  const b = Date.parse(`${toIso.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(a) || Number.isNaN(b)) return 0;
  return Math.round((b - a) / 864e5);
}

// Legacy L4150: red ≥3, amber ≥2, else green.
function waitColor(days: number): string {
  return days >= 3 ? 'var(--red)' : days >= 2 ? 'var(--amber)' : 'var(--green)';
}

function waitBg(days: number): string {
  return days >= 3
    ? 'rgba(239,68,68,0.1)'
    : days >= 2
      ? 'rgba(245,158,11,0.1)'
      : 'rgba(34,197,94,0.1)';
}

function QcCallRegisterPage(): React.JSX.Element {
  const { data, isLoading, isError, error } = useQcHistory();
  const [openId, setOpenId] = useState<string | null>(null);
  const [pendSearch, setPendSearch] = useState('');
  const [compSearch, setCompSearch] = useState('');

  // Active operator names for the inline QC entry Inspector datalist
  // (legacy L4164: db.operators filtered status==='Active').
  const operatorsQuery = useOperatorsList({ isActive: true, limit: 200, offset: 0 });
  const operatorNames = useMemo(
    () => (operatorsQuery.data?.operators ?? []).map((op) => op.name),
    [operatorsQuery.data?.operators],
  );

  const allPending = data?.pending ?? [];
  const allLogs = (data?.logs ?? []).slice(0, 30);
  const completeCount = (data?.logs ?? []).length;

  const pt = pendSearch.trim().toLowerCase();
  const ct = compSearch.trim().toLowerCase();
  const matchP = (o: QcHistoryPendingRow): boolean =>
    pt === '' ||
    [o.jcCode, o.soCode, o.itemCode, o.operation].some((v) =>
      (v ?? '').toLowerCase().includes(pt),
    );
  const matchC = (l: QcHistoryLogRow): boolean =>
    ct === '' ||
    [l.jcCode, l.soCode, l.itemCode, l.operation].some((v) =>
      (v ?? '').toLowerCase().includes(ct),
    );

  const pending = allPending.filter(matchP);
  const logs = allLogs.filter(matchC);

  return (
    <div>
      <div className="section-hdr" style={{ marginBottom: 14 }}>
        🔬 QC Call Register
      </div>

      {isLoading ? (
        <div className="panel">
          <div className="empty-state">
            <Loader2 className="mr-2 inline h-4 w-4 animate-spin" /> Loading QC calls…
          </div>
        </div>
      ) : isError || !data ? (
        <div className="panel">
          <div className="empty-state" style={{ color: 'var(--red)' }}>
            {error instanceof Error ? error.message : 'Failed to load QC call register'}
          </div>
        </div>
      ) : (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)',
            gap: 14,
            alignItems: 'start',
          }}
        >
          {/* LEFT: pending QC calls */}
          <div className="panel">
            <div className="panel-hdr">
              <span className="panel-title" style={{ color: 'var(--amber)' }}>
                ⏳ QC Pending Calls
              </span>
              <span className="mono fw-700" style={{ color: 'var(--amber)', fontSize: 16 }}>
                {allPending.length}
              </span>
            </div>
            <div style={{ padding: '8px 12px', borderBottom: '1px solid var(--border)' }}>
              <input
                className="innovic-input"
                style={{ width: '100%', fontSize: 12 }}
                placeholder="🔍 Search…"
                value={pendSearch}
                onChange={(e) => setPendSearch(e.target.value)}
              />
            </div>
            <div style={{ maxHeight: 'calc(100vh - 260px)', overflowY: 'auto' }}>
              {pending.length === 0 ? (
                <div className="empty-state">✅ No pending QC calls</div>
              ) : (
                pending.map((o) => (
                  <PendingCall
                    key={o.jcOpId}
                    o={o}
                    open={openId === o.jcOpId}
                    operatorNames={operatorNames}
                    onToggle={() => setOpenId(openId === o.jcOpId ? null : o.jcOpId)}
                    onDone={() => setOpenId(null)}
                  />
                ))
              )}
            </div>
          </div>

          {/* RIGHT: completed QC log */}
          <div className="panel">
            <div className="panel-hdr">
              <span className="panel-title" style={{ color: 'var(--green)' }}>
                ✅ QC Completed Log
              </span>
              <span style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                <span
                  className="mono fw-700"
                  style={{
                    color: 'var(--green)',
                    fontSize: 12,
                    padding: '2px 8px',
                    background: 'rgba(34,197,94,0.08)',
                    border: '1px solid rgba(34,197,94,0.25)',
                    borderRadius: 6,
                  }}
                >
                  {completeCount} COMPLETE
                </span>
                <span className="text3" style={{ fontSize: 11 }}>
                  today {data.stats.today}
                </span>
              </span>
            </div>
            <div style={{ padding: '8px 12px', borderBottom: '1px solid var(--border)' }}>
              <input
                className="innovic-input"
                style={{ width: '100%', fontSize: 12 }}
                placeholder="🔍 Search…"
                value={compSearch}
                onChange={(e) => setCompSearch(e.target.value)}
              />
            </div>
            <div style={{ maxHeight: 'calc(100vh - 260px)', overflowY: 'auto' }}>
              {logs.length === 0 ? (
                <div className="empty-state">No QC entries yet</div>
              ) : (
                logs.map((l) => <CompletedLog key={l.logId} l={l} />)
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function PendingCall(props: {
  o: QcHistoryPendingRow;
  open: boolean;
  operatorNames: string[];
  onToggle: () => void;
  onDone: () => void;
}): React.JSX.Element {
  const { o, open, operatorNames, onToggle, onDone } = props;
  const submitQc = useSubmitQcLog();
  const companyId = useSession().data?.companyId ?? null;
  const inspectorListId = `qc-inspectors-${o.jcOpId}`;
  const waitingDays = o.qcCallDate ? dayDiff(o.qcCallDate, todayIso()) : 0;
  const [logDate, setLogDate] = useState(todayIso());
  const [shift, setShift] = useState<Shift>('day');
  const [accept, setAccept] = useState('');
  const [reject, setReject] = useState('0');
  const [inspector, setInspector] = useState('');
  const [remarks, setRemarks] = useState('');
  const [qcReportPath, setQcReportPath] = useState<string | null>(null);
  const [qcReportName, setQcReportName] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function submit(): Promise<void> {
    setErr(null);
    const acc = Number(accept || '0');
    const rej = Number(reject || '0');
    if (!Number.isInteger(acc) || acc < 0 || !Number.isInteger(rej) || rej < 0) {
      setErr('Accept/Reject must be non-negative integers.');
      return;
    }
    if (acc + rej <= 0) {
      setErr('Enter accept and/or reject qty.');
      return;
    }
    if (acc + rej > o.qcPending) {
      setErr(`Total ${acc + rej} exceeds pending ${o.qcPending}.`);
      return;
    }
    const input: SubmitQcLogInput = {
      jcOpId: o.jcOpId,
      qty: acc,
      rejectQty: rej,
      logDate,
      shift,
      ...(inspector.trim() ? { operatorName: inspector.trim() } : {}),
      ...(remarks.trim() ? { remarks: remarks.trim() } : {}),
      ...(qcReportPath ? { qcReportPath, qcReportName } : {}),
    };
    try {
      await submitQc.mutateAsync(input);
      onDone();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'QC submit failed');
    }
  }

  return (
    <div
      className={o.overdue ? 'qc-alert-blink' : undefined}
      style={{
        borderBottom: '1px solid var(--border)',
        background: open ? 'rgba(34,197,94,0.06)' : undefined,
      }}
    >
      <div
        style={{
          padding: '10px 12px',
          cursor: 'pointer',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
        }}
        onClick={onToggle}
      >
        <div style={{ minWidth: 0 }}>
          <div>
            <b className="cyan" style={{ fontSize: 13 }}>
              {o.jcCode}
            </b>{' '}
            <span className="text3" style={{ fontSize: 11 }}>
              Op{o.opSeq}
            </span>
            {o.clientPoLineNo ? (
              <span
                style={{ fontSize: 10, color: 'var(--purple)', fontWeight: 700, marginLeft: 6 }}
              >
                [CPO:{o.clientPoLineNo}]
              </span>
            ) : null}
          </div>
          <div className="text2" style={{ fontSize: 11 }}>
            {o.itemCode ?? '—'} — {o.operation}
          </div>
          <div className="text3" style={{ fontSize: 10 }}>
            {o.soCode ?? '—'} | Produced: {o.completed} | Order: {o.orderQty}
          </div>
          {o.qcCallDate ? (
            <div style={{ display: 'flex', gap: 8, marginTop: 4, fontSize: 10 }}>
              <span className="text3">
                📅 Called: <b style={{ color: 'var(--amber)' }}>{fmtDate(o.qcCallDate)}</b>
              </span>
              <span
                style={{
                  fontWeight: 800,
                  color: waitColor(waitingDays),
                  padding: '1px 6px',
                  background: waitBg(waitingDays),
                  borderRadius: 3,
                  border: `1px solid ${waitColor(waitingDays)}`,
                }}
              >
                ⏳ {waitingDays} day{waitingDays !== 1 ? 's' : ''} waiting
              </span>
            </div>
          ) : o.pendSince ? (
            <div style={{ fontSize: 10, marginTop: 2 }}>
              <span className="text3">📅 Since: </span>
              <span style={{ fontWeight: 700, color: o.overdue ? 'var(--red)' : 'var(--amber)' }}>
                {fmtDate(o.pendSince)}
                {o.overdue ? ' ⚠' : ''}
              </span>
            </div>
          ) : null}
        </div>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: 20, fontWeight: 800, color: 'var(--amber)' }}>{o.qcPending}</div>
          <div className="text3" style={{ fontSize: 9 }}>
            PENDING
          </div>
        </div>
      </div>

      {open ? (
        <div
          style={{
            padding: '14px 12px',
            background: 'rgba(34,197,94,0.04)',
            borderTop: '2px solid var(--green)',
          }}
        >
          <div className="form-grid">
            <div className="form-grp">
              <label className="form-label">Date</label>
              <input
                type="date"
                className="innovic-input"
                value={logDate}
                onChange={(e) => setLogDate(e.target.value)}
              />
            </div>
            <div className="form-grp">
              <label className="form-label">Shift</label>
              <select
                className="innovic-select"
                value={shift}
                onChange={(e) => setShift(e.target.value as Shift)}
              >
                {SHIFTS.map((s) => (
                  <option key={s} value={s}>
                    {SHIFT_LABELS[s]}
                  </option>
                ))}
              </select>
            </div>
            <div className="form-grp">
              <label className="form-label" style={{ color: 'var(--green)' }}>
                ✅ Accept Qty (max {o.qcPending})
              </label>
              <input
                type="number"
                className="innovic-input"
                min={0}
                max={o.qcPending}
                value={accept}
                onChange={(e) => setAccept(e.target.value)}
                placeholder="0"
                style={{ fontWeight: 700, color: 'var(--green)' }}
              />
            </div>
            <div className="form-grp">
              <label className="form-label" style={{ color: 'var(--red)' }}>
                ❌ Reject Qty
              </label>
              <input
                type="number"
                className="innovic-input"
                min={0}
                max={o.qcPending}
                value={reject}
                onChange={(e) => setReject(e.target.value)}
                placeholder="0"
                style={{ fontWeight: 700, color: 'var(--red)' }}
              />
            </div>
            <div className="form-grp form-full">
              <label className="form-label">Inspector / Operator</label>
              <datalist id={inspectorListId}>
                {operatorNames.map((name) => (
                  <option key={name} value={name} />
                ))}
              </datalist>
              <input
                className="innovic-input"
                list={inspectorListId}
                value={inspector}
                onChange={(e) => setInspector(e.target.value)}
                placeholder="🔍 Search operator…"
              />
            </div>
            <div className="form-grp form-full">
              <label className="form-label">Remarks</label>
              <input
                className="innovic-input"
                value={remarks}
                onChange={(e) => setRemarks(e.target.value)}
                placeholder="NC reason, observations…"
              />
            </div>
            <div className="form-grp form-full">
              <QcReportAttach
                companyId={companyId}
                fileName={qcReportName}
                onUploaded={(path, name) => {
                  setQcReportPath(path);
                  setQcReportName(name);
                }}
                onClear={() => {
                  setQcReportPath(null);
                  setQcReportName(null);
                }}
              />
            </div>
          </div>
          {err ? (
            <div role="alert" style={{ color: 'var(--red)', fontSize: 12, marginTop: 8 }}>
              {err}
            </div>
          ) : null}
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 10 }}>
            <button type="button" className="btn btn-ghost btn-sm" onClick={onToggle}>
              Cancel
            </button>
            <button
              type="button"
              className="btn btn-success"
              disabled={submitQc.isPending}
              onClick={() => void submit()}
            >
              {submitQc.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}✓ Submit QC
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function CompletedLog({ l }: { l: QcHistoryLogRow }): React.JSX.Element {
  // Legacy L4201: response = attended − called, "Same day" if ≤0.
  let response: string | null = null;
  if (l.qcCallDate) {
    const d = dayDiff(l.qcCallDate, l.logDate);
    response = d <= 0 ? 'Same day' : `${d} day${d > 1 ? 's' : ''}`;
  }
  const sameDay = response === 'Same day';

  return (
    <div style={{ padding: '8px 12px', borderBottom: '1px solid var(--border)', fontSize: 12 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ minWidth: 0 }}>
          <b className="cyan">{l.jcCode}</b>{' '}
          <span className="text3" style={{ fontSize: 10 }}>
            Op{l.opSeq} — {l.operation}
          </span>
          <div className="text2" style={{ fontSize: 11 }}>
            {l.itemCode ?? '—'} · {l.soCode ?? '—'}
          </div>
          {l.qcCallDate ? (
            <div style={{ fontSize: 10, marginTop: 2 }}>
              <span className="text3">
                Called: <b style={{ color: 'var(--amber)' }}>{fmtDate(l.qcCallDate)}</b>
              </span>{' '}
              →{' '}
              <span>
                Attended: <b style={{ color: 'var(--green)' }}>{fmtDate(l.logDate)}</b>
              </span>
              {response ? (
                <>
                  {' — '}
                  <span
                    style={{
                      fontWeight: 700,
                      color: sameDay ? 'var(--green)' : 'var(--amber)',
                    }}
                  >
                    Response: {response}
                  </span>
                </>
              ) : null}
            </div>
          ) : (
            <div className="text3" style={{ fontSize: 10 }}>
              Attended: <b>{fmtDate(l.logDate)}</b>
            </div>
          )}
        </div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <span style={{ color: 'var(--green)', fontWeight: 700 }}>{l.accepted} ✓</span>
          {l.rejected > 0 ? (
            <span style={{ color: 'var(--red)', fontWeight: 700 }}>{l.rejected} ✗</span>
          ) : null}
        </div>
      </div>
      <div
        className="text3"
        style={{ display: 'flex', gap: 10, fontSize: 10, marginTop: 3, flexWrap: 'wrap' }}
      >
        <span>{l.shift ?? '—'}</span>
        <span>{l.inspector ?? '—'}</span>
        <span className="mono">{l.logNo}</span>
        {l.qcReportPath ? (
          <QcReportLink path={l.qcReportPath} name={l.qcReportName} label={l.qcReportName ?? '⬇'} />
        ) : null}
        {l.remarks ? <span className="text2">{l.remarks}</span> : null}
      </div>
    </div>
  );
}
