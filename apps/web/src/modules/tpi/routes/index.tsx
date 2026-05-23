// TPI — Third Party Inspection (legacy renderTPI L21381). Pending TPI ops with
// an inline TPI entry form (accept/reject + Inspector/Organization/Cert No) +
// completed TPI records table. The submit reuses op-entry submitQcLog with
// isTpi + tpi metadata (op_log, migration 0037). Legacy chrome.

import { SHIFTS, type Shift, type SubmitQcLogInput, type TpiPendingRow } from '@innovic/shared';
import { createRoute } from '@tanstack/react-router';
import { Loader2 } from 'lucide-react';
import { useState } from 'react';
import { useSubmitQcLog } from '@/modules/op-entry/api';
import { authenticatedRoute } from '@/routes/_authenticated';
import { useTpi } from '../api';

export const tpiRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: 'tpi',
  component: TpiPage,
});

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function TpiPage(): React.JSX.Element {
  const { data, isLoading, isFetching, isError, error } = useTpi();
  const [openId, setOpenId] = useState<string | null>(null);

  const pending = data?.pending ?? [];
  const completed = data?.completed ?? [];

  return (
    <div>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: 14,
        }}
      >
        <div className="section-hdr" style={{ marginBottom: 0 }}>
          🔍 TPI (Third Party Inspection)
        </div>
        {isFetching && !isLoading ? (
          <span className="text3" style={{ fontSize: 11, fontFamily: 'var(--mono)' }}>
            <Loader2 className="inline h-3 w-3 animate-spin" />
          </span>
        ) : null}
      </div>

      {isLoading ? (
        <div className="panel">
          <div className="empty-state">
            <Loader2 className="mr-2 inline h-4 w-4 animate-spin" /> Loading TPI…
          </div>
        </div>
      ) : isError || !data ? (
        <div className="panel">
          <div className="empty-state" style={{ color: 'var(--red)' }}>
            {error instanceof Error ? error.message : 'Failed to load TPI'}
          </div>
        </div>
      ) : (
        <>
          <div className="panel" style={{ marginBottom: 16 }}>
            <div className="panel-hdr">
              <span className="panel-title">
                <span style={{ color: 'var(--amber)' }}>⏳</span> Pending TPI ({pending.length})
              </span>
            </div>
            <div className="panel-body">
              {pending.length === 0 ? (
                <div className="empty-state" style={{ color: 'var(--green)' }}>
                  ✅ No pending TPI calls
                </div>
              ) : (
                pending.map((o) => (
                  <PendingTpi
                    key={o.jcOpId}
                    o={o}
                    open={openId === o.jcOpId}
                    onToggle={() => setOpenId(openId === o.jcOpId ? null : o.jcOpId)}
                    onDone={() => setOpenId(null)}
                  />
                ))
              )}
            </div>
          </div>

          <div className="panel">
            <div className="panel-hdr">
              <span className="panel-title">
                <span style={{ color: 'var(--green)' }}>✅</span> TPI Completed Records (
                {completed.length})
              </span>
            </div>
            <div className="tbl-wrap">
              <table className="innovic-table">
                <thead>
                  <tr>
                    <th>JC</th>
                    <th>OP</th>
                    <th>SO</th>
                    <th>Item</th>
                    <th>Operation</th>
                    <th style={{ textAlign: 'right' }}>Acc</th>
                    <th style={{ textAlign: 'right' }}>Rej</th>
                    <th>Call Date</th>
                    <th>Attended</th>
                    <th>Response</th>
                    <th>Inspector</th>
                    <th>Organization</th>
                    <th>Cert No.</th>
                  </tr>
                </thead>
                <tbody>
                  {completed.length === 0 ? (
                    <tr>
                      <td colSpan={13} className="empty-state">
                        No TPI records yet
                      </td>
                    </tr>
                  ) : (
                    completed.map((l) => (
                      <tr key={l.logId}>
                        <td className="fw-700 cyan" style={{ fontSize: 12 }}>
                          {l.jcCode}
                        </td>
                        <td style={{ fontSize: 11 }}>Op{l.opSeq}</td>
                        <td style={{ fontSize: 11, color: 'var(--cyan)' }}>{l.soCode ?? '—'}</td>
                        <td style={{ fontSize: 11, color: 'var(--purple)' }}>{l.itemCode ?? '—'}</td>
                        <td style={{ fontSize: 11 }}>{l.operation}</td>
                        <td className="mono fw-700" style={{ textAlign: 'right', color: 'var(--green)' }}>
                          {l.accepted}
                        </td>
                        <td
                          className="mono fw-700"
                          style={{ textAlign: 'right', color: l.rejected > 0 ? 'var(--red)' : 'var(--text3)' }}
                        >
                          {l.rejected}
                        </td>
                        <td style={{ fontSize: 11, color: 'var(--amber)' }}>{l.callDate ?? '—'}</td>
                        <td style={{ fontSize: 11, color: 'var(--green)' }}>{l.attendedDate}</td>
                        <td style={{ fontSize: 11, fontWeight: 700, color: l.respDays !== null && l.respDays <= 0 ? 'var(--green)' : 'var(--amber)' }}>
                          {l.respDays === null ? '—' : l.respDays <= 0 ? 'Same day' : `${l.respDays}d`}
                        </td>
                        <td style={{ fontSize: 11, fontWeight: 700, color: 'var(--purple)' }}>
                          {l.inspector ?? '—'}
                        </td>
                        <td className="text2" style={{ fontSize: 10 }}>
                          {l.organization ?? '—'}
                        </td>
                        <td style={{ fontSize: 10, fontWeight: 700, color: 'var(--purple)' }}>
                          {l.certNo ?? '—'}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function PendingTpi(props: {
  o: TpiPendingRow;
  open: boolean;
  onToggle: () => void;
  onDone: () => void;
}): React.JSX.Element {
  const { o, open, onToggle, onDone } = props;
  const submit = useSubmitQcLog();
  const [logDate, setLogDate] = useState(todayIso());
  const [shift, setShift] = useState<Shift>('day');
  const [accept, setAccept] = useState('');
  const [reject, setReject] = useState('0');
  const [inspector, setInspector] = useState('');
  const [organization, setOrganization] = useState('');
  const [certNo, setCertNo] = useState('');
  const [remarks, setRemarks] = useState('');
  const [err, setErr] = useState<string | null>(null);

  async function send(): Promise<void> {
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
    if (!inspector.trim() || !organization.trim()) {
      setErr('Inspector and Organization are required.');
      return;
    }
    const input: SubmitQcLogInput = {
      jcOpId: o.jcOpId,
      qty: acc,
      rejectQty: rej,
      logDate,
      shift,
      operatorName: inspector.trim(),
      isTpi: true,
      tpiInspector: inspector.trim(),
      tpiOrganization: organization.trim(),
      ...(certNo.trim() ? { tpiCertNo: certNo.trim() } : {}),
      ...(remarks.trim() ? { remarks: remarks.trim() } : {}),
    };
    try {
      await submit.mutateAsync(input);
      onDone();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'TPI submit failed');
    }
  }

  return (
    <div
      style={{
        border: `1px solid ${open ? 'var(--green)' : 'var(--border)'}`,
        borderRadius: 8,
        marginBottom: 8,
        background: 'var(--bg3)',
        overflow: 'hidden',
      }}
    >
      <div
        style={{
          padding: '10px 14px',
          cursor: 'pointer',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
        }}
        onClick={onToggle}
      >
        <div>
          <b className="cyan" style={{ fontSize: 13 }}>
            {o.jcCode}
          </b>{' '}
          <span className="text3" style={{ fontSize: 11 }}>
            Op{o.opSeq} — {o.operation}
          </span>
          {o.waitDays > 1 ? (
            <span style={{ fontSize: 10, color: 'var(--red)', fontWeight: 700, marginLeft: 8 }}>
              ⚠ WAITING {o.waitDays} DAYS
            </span>
          ) : null}
          <div className="text2" style={{ fontSize: 11 }}>
            {o.soCode ?? '—'} • {o.itemCode ?? '—'} • Order: {o.orderQty} pcs
          </div>
          {o.callDate ? (
            <div style={{ fontSize: 10, color: 'var(--amber)' }}>Called: {o.callDate}</div>
          ) : null}
        </div>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: 22, fontWeight: 800, color: 'var(--amber)' }}>{o.qcPending}</div>
          <div className="text3" style={{ fontSize: 9 }}>
            PENDING
          </div>
        </div>
      </div>

      {open ? (
        <div style={{ padding: 14, background: 'rgba(34,197,94,0.04)', borderTop: '2px solid var(--green)' }}>
          <div className="form-grid">
            <div className="form-grp">
              <label className="form-label">Date</label>
              <input type="date" className="innovic-input" value={logDate} onChange={(e) => setLogDate(e.target.value)} />
            </div>
            <div className="form-grp">
              <label className="form-label">Shift</label>
              <select className="innovic-select" value={shift} onChange={(e) => setShift(e.target.value as Shift)}>
                {SHIFTS.map((s) => (
                  <option key={s} value={s}>
                    {s === 'day' ? 'Day' : 'Night'}
                  </option>
                ))}
              </select>
            </div>
            <div className="form-grp">
              <label className="form-label" style={{ color: 'var(--green)' }}>
                ✅ Accept Qty (max {o.qcPending})
              </label>
              <input type="number" className="innovic-input" min={0} max={o.qcPending} value={accept} onChange={(e) => setAccept(e.target.value)} placeholder="0" style={{ fontWeight: 700, color: 'var(--green)' }} />
            </div>
            <div className="form-grp">
              <label className="form-label" style={{ color: 'var(--red)' }}>
                ❌ Reject Qty
              </label>
              <input type="number" className="innovic-input" min={0} max={o.qcPending} value={reject} onChange={(e) => setReject(e.target.value)} placeholder="0" style={{ fontWeight: 700, color: 'var(--red)' }} />
            </div>
            <div className="form-grp">
              <label className="form-label" style={{ color: 'var(--purple)' }}>
                Inspector Name ★
              </label>
              <input className="innovic-input" value={inspector} onChange={(e) => setInspector(e.target.value)} placeholder="e.g. Mr. Sharma" />
            </div>
            <div className="form-grp">
              <label className="form-label" style={{ color: 'var(--purple)' }}>
                Organization ★
              </label>
              <input className="innovic-input" value={organization} onChange={(e) => setOrganization(e.target.value)} placeholder="e.g. L&T QA Department" />
            </div>
            <div className="form-grp">
              <label className="form-label" style={{ color: 'var(--purple)' }}>
                TPI Certificate No.
              </label>
              <input className="innovic-input" value={certNo} onChange={(e) => setCertNo(e.target.value)} placeholder="e.g. TPI-2026-045" />
            </div>
            <div className="form-grp">
              <label className="form-label">Remarks</label>
              <input className="innovic-input" value={remarks} onChange={(e) => setRemarks(e.target.value)} placeholder="Observations…" />
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
            <button type="button" className="btn btn-success" disabled={submit.isPending} onClick={() => void send()}>
              {submit.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}✓ Submit TPI
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
