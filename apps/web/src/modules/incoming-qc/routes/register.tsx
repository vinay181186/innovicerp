// Incoming QC Call Register — a two-pane register modeled on the process QC Call
// Register (qc-call-register/routes/index.tsx), but for GRN-based incoming QC.
// LEFT: GRN lines pending inspection with an inline accept/reject form that
// records QC and credits accepted qty to stock. RIGHT: completed-inspection log.
// Data from GET /incoming-qc; the inline submit hits POST /incoming-qc/:id/inspect.

import type { IncomingQcCompletedRow, IncomingQcPendingRow } from '@innovic/shared';
import { createRoute } from '@tanstack/react-router';
import { Loader2 } from 'lucide-react';
import { useState } from 'react';
import { QcReportAttach, QcReportLink } from '@/components/shared/qc-report-attach';
import { fmtDate } from '@/lib/print/doc-print';
import { useSession } from '@/lib/session';
import { authenticatedRoute } from '@/routes/_authenticated';
import { useIncomingQc, useSubmitIncomingQc } from '../api';

export const incomingQcRegisterRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: 'incoming-qc-register',
  validateSearch: (search: Record<string, unknown>): { line?: string } =>
    typeof search.line === 'string' ? { line: search.line } : {},
  component: IncomingQcRegisterPage,
});

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

// Legacy wait colour: red ≥3, amber ≥2, else green.
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

function IncomingQcRegisterPage(): React.JSX.Element {
  const { data, isLoading, isError, error } = useIncomingQc();
  const { line: lineParam } = incomingQcRegisterRoute.useSearch();
  const [openId, setOpenId] = useState<string | null>(lineParam ?? null);
  const [pendSearch, setPendSearch] = useState('');
  const [compSearch, setCompSearch] = useState('');

  const allPending = data?.pending ?? [];
  const allCompleted = data?.completed ?? [];

  const pt = pendSearch.trim().toLowerCase();
  const ct = compSearch.trim().toLowerCase();
  const matchP = (o: IncomingQcPendingRow): boolean =>
    pt === '' ||
    [o.grnNo, o.itemCode, o.itemName, o.vendorName, o.poCode].some((v) =>
      (v ?? '').toLowerCase().includes(pt),
    );
  const matchC = (l: IncomingQcCompletedRow): boolean =>
    ct === '' ||
    [l.grnNo, l.itemCode, l.itemName, l.vendorName].some((v) => (v ?? '').toLowerCase().includes(ct));

  const pending = allPending.filter(matchP);
  const completed = allCompleted.filter(matchC);

  if (isLoading) {
    return (
      <div className="panel">
        <div className="empty-state">
          <Loader2 className="mr-2 inline h-4 w-4 animate-spin" /> Loading incoming QC…
        </div>
      </div>
    );
  }
  if (isError || !data) {
    return (
      <div className="panel">
        <div className="empty-state" style={{ color: 'var(--red)' }}>
          {error instanceof Error ? error.message : 'Failed to load incoming QC register'}
        </div>
      </div>
    );
  }

  return (
    <div
      style={{ display: 'flex', height: 'calc(100vh - 112px)', gap: 0, margin: -16, overflow: 'hidden' }}
    >
      {/* LEFT: Pending Incoming QC */}
      <div
        style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          borderRight: '1px solid var(--border)',
          minWidth: 0,
        }}
      >
        <div
          style={{
            padding: '12px 14px',
            background: 'var(--bg3)',
            borderBottom: '1px solid var(--border)',
            display: 'flex',
            alignItems: 'center',
            gap: 10,
          }}
        >
          <div
            style={{
              background: 'rgba(251,191,36,0.12)',
              border: '1px solid rgba(251,191,36,0.3)',
              borderRadius: 6,
              padding: '4px 12px',
              textAlign: 'center',
            }}
          >
            <div style={{ fontSize: 20, fontWeight: 800, color: 'var(--amber)' }}>
              {data.metrics.grnsWaiting}
            </div>
            <div className="text3" style={{ fontSize: 9 }}>
              PENDING
            </div>
          </div>
          <div style={{ fontSize: 14, fontWeight: 700 }}>⏳ Pending Incoming QC</div>
          <div style={{ flex: 1 }} />
          <input
            className="innovic-input"
            style={{ fontSize: 12, width: 180 }}
            placeholder="🔍 Search..."
            value={pendSearch}
            onChange={(e) => setPendSearch(e.target.value)}
          />
        </div>
        <div style={{ flex: 1, overflowY: 'auto' }}>
          {pending.length === 0 ? (
            <div className="empty-state">
              <div style={{ fontSize: 28, marginBottom: 8 }}>✅</div>
              No material pending incoming QC
            </div>
          ) : (
            pending.map((o) => (
              <PendingRow
                key={o.grnLineId}
                o={o}
                open={openId === o.grnLineId}
                onToggle={() => setOpenId(openId === o.grnLineId ? null : o.grnLineId)}
                onDone={() => setOpenId(null)}
              />
            ))
          )}
        </div>
      </div>

      {/* RIGHT: Completed Incoming QC */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        <div
          style={{
            padding: '12px 14px',
            background: 'var(--bg3)',
            borderBottom: '1px solid var(--border)',
            display: 'flex',
            alignItems: 'center',
            gap: 10,
          }}
        >
          <div
            style={{
              background: 'rgba(34,197,94,0.08)',
              border: '1px solid rgba(34,197,94,0.25)',
              borderRadius: 6,
              padding: '4px 12px',
              textAlign: 'center',
            }}
          >
            <div style={{ fontSize: 20, fontWeight: 800, color: 'var(--green)' }}>
              {data.metrics.todayAcceptedQty}
            </div>
            <div className="text3" style={{ fontSize: 9 }}>
              ACCEPTED TODAY
            </div>
          </div>
          <div style={{ fontSize: 14, fontWeight: 700 }}>✅ Completed Incoming QC</div>
          <div style={{ flex: 1 }} />
          <input
            className="innovic-input"
            style={{ fontSize: 12, width: 180 }}
            placeholder="🔍 Search..."
            value={compSearch}
            onChange={(e) => setCompSearch(e.target.value)}
          />
        </div>
        <div style={{ flex: 1, overflowY: 'auto' }}>
          {completed.length === 0 ? (
            <div className="empty-state">No inspections yet</div>
          ) : (
            completed.map((l) => <CompletedRow key={l.grnLineId} l={l} />)
          )}
        </div>
      </div>
    </div>
  );
}

function PendingRow(props: {
  o: IncomingQcPendingRow;
  open: boolean;
  onToggle: () => void;
  onDone: () => void;
}): React.JSX.Element {
  const { o, open, onToggle, onDone } = props;
  const submit = useSubmitIncomingQc();
  const companyId = useSession().data?.companyId ?? null;
  const [qcDate, setQcDate] = useState(todayIso());
  const [accept, setAccept] = useState('');
  const [reject, setReject] = useState('0');
  const [remarks, setRemarks] = useState('');
  const [qcReportPath, setQcReportPath] = useState<string | null>(null);
  const [qcReportName, setQcReportName] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function doSubmit(): Promise<void> {
    setErr(null);
    const acc = Number(accept || '0');
    const rej = Number(reject || '0');
    if (!Number.isInteger(acc) || acc < 0 || !Number.isInteger(rej) || rej < 0) {
      setErr('Accept/Reject must be non-negative integers.');
      return;
    }
    if (acc + rej <= 0) {
      setErr('Enter an accept and/or reject qty.');
      return;
    }
    if (acc + rej > o.pendingQty) {
      setErr(`Total ${acc + rej} exceeds pending ${o.pendingQty}.`);
      return;
    }
    try {
      await submit.mutateAsync({
        grnLineId: o.grnLineId,
        input: {
          acceptedQty: acc,
          rejectedQty: rej,
          qcDate,
          ...(remarks.trim() ? { qcRemarks: remarks.trim() } : {}),
          ...(qcReportPath ? { qcReportPath, ...(qcReportName ? { qcReportName } : {}) } : {}),
        },
      });
      onDone();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'QC submit failed');
    }
  }

  return (
    <div
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
              {o.itemCode ?? '—'}
            </b>{' '}
            <span className="text2" style={{ fontSize: 12 }}>
              {o.itemName ?? ''}
            </span>
          </div>
          <div className="text3" style={{ fontSize: 10 }}>
            GRN <b className="mono">{o.grnNo}</b> · {o.vendorName ?? '—'}
            {o.poCode ? ` · PO ${o.poCode}` : ''}
          </div>
          <div style={{ display: 'flex', gap: 8, marginTop: 4, fontSize: 10 }}>
            <span className="text3">
              📅 Received: <b style={{ color: 'var(--amber)' }}>{fmtDate(o.grnDate)}</b>
            </span>
            <span
              style={{
                fontWeight: 800,
                color: waitColor(o.waitDays),
                padding: '1px 6px',
                background: waitBg(o.waitDays),
                borderRadius: 3,
                border: `1px solid ${waitColor(o.waitDays)}`,
              }}
            >
              ⏳ {o.waitDays} day{o.waitDays !== 1 ? 's' : ''} waiting
            </span>
          </div>
        </div>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: 20, fontWeight: 800, color: 'var(--amber)' }}>{o.pendingQty}</div>
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
          <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--green)', marginBottom: 10 }}>
            ✅ Inspect — {o.itemCode ?? o.itemName ?? 'Item'} ·{' '}
            <span style={{ background: 'rgba(34,197,94,0.15)', padding: '2px 8px', borderRadius: 4 }}>
              GRN {o.grnNo}
            </span>
          </div>
          <div className="form-grid">
            <div className="form-grp">
              <label className="form-label" style={{ fontSize: 10 }}>
                QC date
              </label>
              <input
                type="date"
                className="innovic-input"
                value={qcDate}
                onChange={(e) => setQcDate(e.target.value)}
              />
            </div>
            <div className="form-grp">
              <label className="form-label" style={{ fontSize: 10, color: 'var(--green)' }}>
                ✅ Accept Qty (max {o.pendingQty})
              </label>
              <input
                type="number"
                className="innovic-input"
                min={0}
                max={o.pendingQty}
                value={accept}
                onChange={(e) => setAccept(e.target.value)}
                placeholder="0"
                style={{
                  fontSize: 18,
                  fontWeight: 800,
                  color: 'var(--green)',
                  border: '2px solid var(--green)',
                  textAlign: 'center',
                }}
              />
            </div>
            <div className="form-grp">
              <label className="form-label" style={{ fontSize: 10, color: 'var(--red)' }}>
                ❌ Reject Qty
              </label>
              <input
                type="number"
                className="innovic-input"
                min={0}
                max={o.pendingQty}
                value={reject}
                onChange={(e) => setReject(e.target.value)}
                placeholder="0"
                style={{
                  fontSize: 18,
                  fontWeight: 800,
                  color: 'var(--red)',
                  border: '2px solid var(--red)',
                  textAlign: 'center',
                }}
              />
            </div>
            <div className="form-grp form-full">
              <label className="form-label" style={{ fontSize: 10 }}>
                Remarks
              </label>
              <input
                className="innovic-input"
                value={remarks}
                onChange={(e) => setRemarks(e.target.value)}
                placeholder="NC reason, observations..."
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
              disabled={submit.isPending}
              onClick={() => void doSubmit()}
            >
              {submit.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}✓ Submit QC
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function CompletedRow({ l }: { l: IncomingQcCompletedRow }): React.JSX.Element {
  const dispColor =
    l.disposition === 'Rejected'
      ? 'var(--red)'
      : l.disposition === 'Partial Accept'
        ? 'var(--amber)'
        : 'var(--green)';
  return (
    <div style={{ padding: '8px 12px', borderBottom: '1px solid var(--border)', fontSize: 12 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ minWidth: 0 }}>
          <b className="cyan">{l.itemCode ?? '—'}</b>{' '}
          <span className="text3" style={{ fontSize: 10 }}>
            {l.itemName ?? ''}
          </span>
          <div className="text2" style={{ fontSize: 11 }}>
            GRN <span className="mono">{l.grnNo}</span> · {l.vendorName ?? '—'}
          </div>
          <div style={{ fontSize: 10, marginTop: 2 }}>
            <span className="text3">Received: {fmtDate(l.grnDate)}</span>
            {l.qcDate ? (
              <>
                {' → '}
                <span>
                  Inspected: <b style={{ color: 'var(--green)' }}>{fmtDate(l.qcDate)}</b>
                </span>
                {l.respDays != null ? (
                  <span
                    style={{
                      fontWeight: 700,
                      marginLeft: 6,
                      color: l.respDays <= 0 ? 'var(--green)' : 'var(--amber)',
                    }}
                  >
                    ({l.respDays <= 0 ? 'Same day' : `${l.respDays} day${l.respDays > 1 ? 's' : ''}`})
                  </span>
                ) : null}
              </>
            ) : null}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <span style={{ color: 'var(--green)', fontWeight: 700 }}>{l.acceptedQty} ✓</span>
          {l.rejectedQty > 0 ? (
            <span style={{ color: 'var(--red)', fontWeight: 700 }}>{l.rejectedQty} ✗</span>
          ) : null}
          <span
            style={{
              fontSize: 10,
              fontWeight: 700,
              color: dispColor,
              border: `1px solid ${dispColor}`,
              borderRadius: 3,
              padding: '1px 6px',
            }}
          >
            {l.disposition}
          </span>
        </div>
      </div>
      <div
        className="text3"
        style={{ display: 'flex', gap: 10, fontSize: 10, marginTop: 3, flexWrap: 'wrap' }}
      >
        {l.qcReportPath ? (
          <QcReportLink path={l.qcReportPath} name={l.qcReportName} label={l.qcReportName ?? '⬇'} />
        ) : null}
        {l.qcRemarks ? <span className="text2">{l.qcRemarks}</span> : null}
      </div>
    </div>
  );
}
