// TPI — Third Party Inspection (legacy renderTPI L21381). Pending TPI ops with
// an inline TPI entry form (accept/reject + Inspector/Organization/Cert No) +
// completed TPI records table. The submit reuses op-entry submitQcLog with
// isTpi + tpi metadata (op_log, migration 0037). Legacy chrome.

import {
  SHIFTS,
  SHIFT_LABELS,
  type Shift,
  type SubmitQcLogInput,
  type TpiCompletedRow,
  type TpiPendingRow,
} from '@innovic/shared';
import { createRoute } from '@tanstack/react-router';
import { Loader2 } from 'lucide-react';
import { useState } from 'react';
import { QcReportAttach, QcReportLink } from '@/components/shared/qc-report-attach';
import { useSession } from '@/lib/session';
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

// Excel export of completed TPI records (legacy _tpiExport L21572 / "⬇ Excel"
// button). Client-side from the loaded `completed` rows — columns mirror the
// legacy completed table. xlsx is dynamic-imported so the cost only lands when
// the user actually exports.
async function exportTpiRecords(rows: TpiCompletedRow[]): Promise<void> {
  const { utils: xlsxUtils, write: xlsxWrite } = await import('xlsx');
  const respLabel = (d: number | null): string =>
    d === null ? '' : d <= 0 ? 'Same day' : `${d}d`;
  const aoa: (string | number)[][] = [
    [
      'JC',
      'OP',
      'SO',
      'Item',
      'Operation',
      'Acc',
      'Rej',
      'Call Date',
      'Attended',
      'Response',
      'Inspector',
      'Organization',
      'Cert No.',
    ],
    ...rows.map((l) => [
      l.jcCode,
      `Op${l.opSeq}`,
      l.soCode ?? '',
      l.itemCode ?? '',
      l.operation,
      l.accepted,
      l.rejected,
      l.callDate ?? '',
      l.attendedDate,
      respLabel(l.respDays),
      l.inspector ?? '',
      l.organization ?? '',
      l.certNo ?? '',
    ]),
  ];
  const sheet = xlsxUtils.aoa_to_sheet(aoa);
  const wb = xlsxUtils.book_new();
  xlsxUtils.book_append_sheet(wb, sheet, 'TPI Records');
  const buf = xlsxWrite(wb, { type: 'array', bookType: 'xlsx' });
  const blob = new Blob([buf], { type: 'application/octet-stream' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `TPI_Records_${todayIso()}.xlsx`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
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
          marginBottom: 16,
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
            {/* Legacy L21472 hand-rolls this strip rather than using .panel-hdr /
                .panel-title (13px bold on --bg4, 10/14 padding) — mirrored. */}
            <div
              style={{
                padding: '10px 14px',
                background: 'var(--bg4)',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
              }}
            >
              <span style={{ fontWeight: 700, fontSize: 13 }}>
                <span style={{ color: 'var(--amber)' }}>⏳</span> Pending TPI ({pending.length})
              </span>
            </div>
            <div style={{ padding: 10 }}>
              {pending.length === 0 ? (
                <div className="empty-state" style={{ padding: 20, color: 'var(--green)' }}>
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
            {/* Legacy L21477 hand-rolls this strip too — same shape as Pending. */}
            <div
              style={{
                padding: '10px 14px',
                background: 'var(--bg4)',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
              }}
            >
              <span style={{ fontWeight: 700, fontSize: 13 }}>
                <span style={{ color: 'var(--green)' }}>✅</span> TPI Completed Records (
                {completed.length})
              </span>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                style={{ fontSize: 10 }}
                disabled={completed.length === 0}
                onClick={() => void exportTpiRecords(completed)}
              >
                ⬇ Excel
              </button>
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
                    <th>Report</th>
                  </tr>
                </thead>
                <tbody>
                  {completed.length === 0 ? (
                    <tr>
                      <td colSpan={14} className="empty-state">
                        No TPI records yet
                      </td>
                    </tr>
                  ) : (
                    completed.map((l, i) => (
                      // Legacy L21451 stripes rows inline: odd --bg, even --bg3.
                      // `.innovic-table tbody tr:nth-child(even) td` already paints
                      // the even ones (td beats tr), so this supplies the --bg the
                      // odd rows would otherwise miss.
                      <tr key={l.logId} style={{ background: i % 2 === 0 ? 'var(--bg)' : 'var(--bg3)' }}>
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
                        <td style={{ fontSize: 11 }}>
                          {l.qcReportPath ? (
                            <QcReportLink path={l.qcReportPath} name={l.qcReportName} label="View" />
                          ) : (
                            '—'
                          )}
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
  const companyId = useSession().data?.companyId ?? null;
  const [logDate, setLogDate] = useState(todayIso());
  const [shift, setShift] = useState<Shift>('day');
  const [accept, setAccept] = useState('');
  const [reject, setReject] = useState('0');
  const [inspector, setInspector] = useState('');
  const [organization, setOrganization] = useState('');
  const [certNo, setCertNo] = useState('');
  const [remarks, setRemarks] = useState('');
  const [qcReportPath, setQcReportPath] = useState<string | null>(null);
  const [qcReportName, setQcReportName] = useState<string | null>(null);
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
      ...(qcReportPath ? { qcReportPath, qcReportName } : {}),
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
        background: 'var(--bg2)',
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
          <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--green)', marginBottom: 12 }}>
            ✅ TPI Entry — {o.jcCode} Op{o.opSeq}
          </div>

          {/* Legacy L21413-21416: Date | Shift */}
          <div className="form-grid" style={{ gap: 10, marginBottom: 12 }}>
            <div className="form-grp">
              <label className="form-label" style={{ fontSize: 10 }}>
                Date
              </label>
              <input type="date" className="innovic-input" value={logDate} onChange={(e) => setLogDate(e.target.value)} />
            </div>
            <div className="form-grp">
              <label className="form-label" style={{ fontSize: 10 }}>
                Shift
              </label>
              <select className="innovic-select" value={shift} onChange={(e) => setShift(e.target.value as Shift)}>
                {SHIFTS.map((s) => (
                  <option key={s} value={s}>
                    {SHIFT_LABELS[s]}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Legacy L21417-21420: the big centred Accept / Reject qty inputs */}
          <div className="form-grid" style={{ gap: 10, marginBottom: 12 }}>
            <div className="form-grp">
              <label className="form-label" style={{ fontSize: 10, color: 'var(--green)' }}>
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
                style={{
                  fontSize: 20,
                  fontWeight: 800,
                  color: 'var(--green)',
                  textAlign: 'center',
                  padding: 8,
                  border: '2px solid var(--green)',
                  background: 'var(--bg)',
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
                max={o.qcPending}
                value={reject}
                onChange={(e) => setReject(e.target.value)}
                placeholder="0"
                style={{
                  fontSize: 20,
                  fontWeight: 800,
                  color: 'var(--red)',
                  textAlign: 'center',
                  padding: 8,
                  border: '2px solid var(--red)',
                  background: 'var(--bg)',
                }}
              />
            </div>
          </div>

          {/* Legacy L21421-21428: purple "TPI DETAILS (Required)" box. The purple
              belongs to the box + its heading — legacy's labels inside are plain. */}
          <div
            style={{
              border: '1px solid var(--purple)',
              borderRadius: 8,
              padding: 12,
              marginBottom: 12,
              background: 'rgba(139,92,246,0.04)',
            }}
          >
            <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--purple)', marginBottom: 8 }}>
              🔍 TPI DETAILS (Required)
            </div>
            <div className="form-grid" style={{ gap: 10 }}>
              <div className="form-grp">
                <label className="form-label" style={{ fontSize: 10 }}>
                  Inspector Name ★
                </label>
                <input className="innovic-input" style={{ fontWeight: 700 }} value={inspector} onChange={(e) => setInspector(e.target.value)} placeholder="e.g. Mr. Sharma" />
              </div>
              <div className="form-grp">
                <label className="form-label" style={{ fontSize: 10 }}>
                  Organization ★
                </label>
                <input className="innovic-input" value={organization} onChange={(e) => setOrganization(e.target.value)} placeholder="e.g. L&T QA Department" />
              </div>
              <div className="form-grp">
                <label className="form-label" style={{ fontSize: 10 }}>
                  TPI Certificate No.
                </label>
                <input className="innovic-input" style={{ fontWeight: 700, color: 'var(--purple)' }} value={certNo} onChange={(e) => setCertNo(e.target.value)} placeholder="e.g. TPI-2026-045" />
              </div>
              <div className="form-grp">
                <label className="form-label" style={{ fontSize: 10 }}>
                  Remarks
                </label>
                <input className="innovic-input" value={remarks} onChange={(e) => setRemarks(e.target.value)} placeholder="Observations…" />
              </div>
            </div>
          </div>

          {/* Legacy L21429-21433: attach row sits between the details box and the
              action buttons. QcReportAttach renders the same picker + × Remove. */}
          <div style={{ marginBottom: 12 }}>
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

          {err ? (
            <div role="alert" style={{ color: 'var(--red)', fontSize: 12, marginBottom: 8 }}>
              {err}
            </div>
          ) : null}
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <button type="button" className="btn btn-ghost btn-sm" onClick={onToggle}>
              Cancel
            </button>
            <button
              type="button"
              className="btn"
              style={{ background: 'var(--green)', color: '#fff', fontWeight: 700, fontSize: 13, padding: '8px 24px' }}
              disabled={submit.isPending}
              onClick={() => void send()}
            >
              {submit.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}✓ Submit TPI
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
