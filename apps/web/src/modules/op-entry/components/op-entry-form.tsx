// Op Entry form — legacy chrome (.panel / .btn / .innovic-input / .form-grp).
// Logic unchanged from the shadcn version: QC sub-form vs production-complete
// form, start/stop session, blocked-reason guard. T-040d QC path preserved.

import {
  type JcOpEnriched,
  SHIFTS,
  SHIFT_LABELS,
  type Shift,
  type StartOpInput,
  type SubmitOpLogInput,
  type SubmitQcLogInput,
} from '@innovic/shared';
import { Loader2, Play, PackagePlus, ShieldCheck, Square } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link } from '@tanstack/react-router';
import { QcReportAttach } from '@/components/shared/qc-report-attach';
import { useSession } from '@/lib/session';
import {
  useGenerateOspPr,
  useStartOp,
  useStopOp,
  useSubmitOpLog,
  useSubmitQcLog,
} from '../api';

interface Props {
  op: JcOpEnriched;
  // Active running session id for this op, if any (for the Stop button).
  activeRunningId: string | null;
  // Legacy _opEntryMode (renderOpEntry L5210): 'start' shows the Mark-as-Running
  // sub-form, 'complete' shows the Qty-Completed form. Only the production path
  // honours it (QC / outsource have their own dedicated flows). Defaulted so
  // callers that don't care keep the current combined behaviour.
  mode?: 'start' | 'complete';
  onModeChange?: (mode: 'start' | 'complete') => void;
}

function todayIso(): string {
  const d = new Date();
  return d.toISOString().slice(0, 10);
}

function nowHHMM(): string {
  const d = new Date();
  return d.toTimeString().slice(0, 5);
}

export function OpEntryForm({
  op,
  activeRunningId,
  mode = 'complete',
  onModeChange,
}: Props): React.JSX.Element {
  const submit = useSubmitOpLog();
  const submitQc = useSubmitQcLog();
  const start = useStartOp();
  const stop = useStopOp();
  const genOsp = useGenerateOspPr();
  const session = useSession();
  const companyId = session.data?.companyId ?? null;
  const canWrite = session.data?.role === 'admin' || session.data?.role === 'manager';

  const [logDate, setLogDate] = useState(todayIso());
  const [shift, setShift] = useState<Shift>('day');
  const [qty, setQty] = useState<string>('');
  const [rejectQty, setRejectQty] = useState<string>('0');
  const [operatorName, setOperatorName] = useState<string>('');
  const [remarks, setRemarks] = useState<string>('');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  // QC report attachment (migration 0043) — only used on the QC sub-form.
  const [qcReportPath, setQcReportPath] = useState<string | null>(null);
  const [qcReportName, setQcReportName] = useState<string | null>(null);
  // OSP auto-PR result/error message (ADR-039) — only used on the outsource panel.
  const [ospMsg, setOspMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  // Reset when the selected op changes.
  useEffect(() => {
    setQty('');
    setRejectQty('0');
    setRemarks('');
    setErrorMessage(null);
    setQcReportPath(null);
    setQcReportName(null);
    setOspMsg(null);
  }, [op.id]);

  const isOutsource = op.opType === 'outsource';
  // T-040d: QC-bearing op = dedicated QC op OR process op with qc_required.
  const isQcOp = op.opType === 'qc';
  const isQcBearing = isQcOp || op.qcRequired;
  const noQcPending = isQcBearing && op.qcPending <= 0;
  const isQcPending = op.computedStatus === 'qc_pending';
  const noAvailable = op.available <= 0;
  const blockedReason = isOutsource
    ? 'This is an outsource operation; use the Procurement flow.'
    : isQcOp && noQcPending
      ? 'No QC pending on this operation — already inspected.'
      : !isQcOp && isQcPending
        ? 'Waiting on QC clearance — go to QC dashboard.'
        : !isQcOp && noAvailable
          ? 'No qty available — start the previous op first.'
          : null;

  async function handleSubmit(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    setErrorMessage(null);
    const qtyNum = Number(qty);
    if (!Number.isInteger(qtyNum) || qtyNum <= 0) {
      setErrorMessage('Qty must be a positive integer.');
      return;
    }
    const rejNum = Number(rejectQty || '0');
    const input: SubmitOpLogInput = {
      jcOpId: op.id,
      qty: qtyNum,
      rejectQty: Number.isFinite(rejNum) && rejNum >= 0 ? rejNum : 0,
      logDate,
      shift,
      ...(operatorName.trim() ? { operatorName: operatorName.trim() } : {}),
      ...(remarks.trim() ? { remarks: remarks.trim() } : {}),
    };
    try {
      await submit.mutateAsync(input);
      setQty('');
      setRejectQty('0');
      setRemarks('');
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Submit failed');
    }
  }

  // T-040d QC submit. qty can be 0, rejectQty can be 0, but at least one must
  // be > 0. Both are bounded by qcPending.
  async function handleSubmitQc(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    setErrorMessage(null);
    const qtyNum = Number(qty || '0');
    const rejNum = Number(rejectQty || '0');
    if (!Number.isInteger(qtyNum) || qtyNum < 0 || !Number.isInteger(rejNum) || rejNum < 0) {
      setErrorMessage('Accepted and reject qty must be non-negative integers.');
      return;
    }
    if (qtyNum + rejNum <= 0) {
      setErrorMessage('Enter accepted qty and/or reject qty.');
      return;
    }
    if (qtyNum + rejNum > op.qcPending) {
      setErrorMessage(`Total qty ${qtyNum + rejNum} exceeds QC pending ${op.qcPending}.`);
      return;
    }
    const input: SubmitQcLogInput = {
      jcOpId: op.id,
      qty: qtyNum,
      rejectQty: rejNum,
      logDate,
      shift,
      ...(operatorName.trim() ? { operatorName: operatorName.trim() } : {}),
      ...(remarks.trim() ? { remarks: remarks.trim() } : {}),
      ...(qcReportPath ? { qcReportPath, qcReportName } : {}),
    };
    try {
      await submitQc.mutateAsync(input);
      setQty('');
      setRejectQty('0');
      setRemarks('');
      setQcReportPath(null);
      setQcReportName(null);
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'QC submit failed');
    }
  }

  async function handleStart(): Promise<void> {
    setErrorMessage(null);
    const input: StartOpInput = {
      jcOpId: op.id,
      startDate: logDate,
      startTime: nowHHMM(),
      shift,
      ...(operatorName.trim() ? { operatorName: operatorName.trim() } : {}),
      ...(remarks.trim() ? { remarks: remarks.trim() } : {}),
    };
    try {
      await start.mutateAsync(input);
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Start failed');
    }
  }

  async function handleStop(): Promise<void> {
    if (!activeRunningId) return;
    setErrorMessage(null);
    try {
      await stop.mutateAsync(activeRunningId);
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Stop failed');
    }
  }

  // Production form submit dispatches by mode (legacy submitStartOp vs
  // submitOpEntry). In 'start' mode Enter/primary marks the op running; in
  // 'complete' mode it logs a completion.
  async function handleProductionSubmit(e: React.FormEvent): Promise<void> {
    if (mode === 'start') {
      e.preventDefault();
      if (!activeRunningId) await handleStart();
      return;
    }
    await handleSubmit(e);
  }

  // OSP auto-PR generation (ADR-039) — port of legacy _autoGenerateOspPR.
  async function handleGenerateOsp(): Promise<void> {
    setOspMsg(null);
    try {
      const res = await genOsp.mutateAsync({ jcOpId: op.id });
      setOspMsg({ kind: 'ok', text: res.message });
    } catch (err) {
      setOspMsg({ kind: 'err', text: err instanceof Error ? err.message : 'Failed to generate OSP PR' });
    }
  }

  // Shared common fields (Date, Shift) — used by both forms.
  const commonFields = (
    <>
      <div className="form-grp">
        <label className="form-label" htmlFor="opf-date">
          Date
        </label>
        <input
          id="opf-date"
          className="innovic-input"
          type="date"
          value={logDate}
          onChange={(e) => setLogDate(e.target.value)}
        />
      </div>
      <div className="form-grp">
        <label className="form-label" htmlFor="opf-shift">
          Shift
        </label>
        <select
          id="opf-shift"
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
    </>
  );

  const operatorAndRemarks = (
    <>
      <div className="form-grp form-full">
        <label className="form-label" htmlFor="opf-op">
          {isQcBearing ? 'Inspector' : 'Operator'}
        </label>
        <input
          id="opf-op"
          className="innovic-input"
          value={operatorName}
          onChange={(e) => setOperatorName(e.target.value)}
          placeholder={isQcBearing ? 'QC inspector name' : 'Operator name'}
        />
      </div>
      <div className="form-grp form-full">
        <label className="form-label" htmlFor="opf-rem">
          Remarks
        </label>
        <input
          id="opf-rem"
          className="innovic-input"
          value={remarks}
          onChange={(e) => setRemarks(e.target.value)}
          placeholder="Optional notes…"
        />
      </div>
    </>
  );

  const blockedBanner = blockedReason ? (
    <div
      style={{
        marginBottom: 12,
        padding: '8px 10px',
        borderRadius: 6,
        background: 'var(--amber3)',
        border: '1px solid var(--amber2)',
        color: 'var(--amber)',
        fontSize: 12,
        fontWeight: 600,
      }}
    >
      {blockedReason}
    </div>
  ) : null;

  const errorBanner = errorMessage ? (
    <div role="alert" style={{ color: 'var(--red)', fontSize: 12, marginTop: 8 }}>
      {errorMessage}
    </div>
  ) : null;

  // OSP outsource op (ADR-039): instead of a shop-floor log/start form, show
  // the auto-PR action. Once a PR/PO exists (outsource_status advanced past
  // pending) the op is managed from Purchase → Outsource Jobs.
  if (isOutsource) {
    const alreadyRaised =
      op.outsourceStatus != null && op.outsourceStatus !== 'pending';
    const statusLabel: Record<string, string> = {
      pending: 'Pending — no PR yet',
      pr_raised: 'PR raised — awaiting PO',
      po_created: 'Draft PO created — awaiting approval',
      sent: 'Sent to vendor (DC out)',
      received: 'Received back from vendor',
    };
    return (
      <div className="panel">
        <div className="panel-hdr">
          <span className="panel-title">Outside processing</span>
          <span className="text3" style={{ fontSize: 11 }}>
            Op {op.opSeq} · <span className="mono">{op.operation}</span>
          </span>
        </div>
        <div className="panel-body">
          <div
            style={{
              marginBottom: 12,
              padding: '8px 10px',
              borderRadius: 6,
              background: 'var(--bg4)',
              border: '1px solid var(--border)',
              fontSize: 12,
            }}
          >
            Status:{' '}
            <span className="fw-700">
              {op.outsourceStatus ? (statusLabel[op.outsourceStatus] ?? op.outsourceStatus) : 'Pending — no PR yet'}
            </span>
          </div>

          {alreadyRaised ? (
            <div className="text2" style={{ fontSize: 13, lineHeight: 1.6 }}>
              An OSP purchase request already exists for this operation. Manage it from{' '}
              <Link to="/purchase-orders" style={{ color: 'var(--cyan)', fontWeight: 600 }}>
                Purchase → Outsource Jobs
              </Link>
              .
            </div>
          ) : !canWrite ? (
            <div className="text3" style={{ fontSize: 12 }}>
              Generating an OSP purchase request needs Manager or Admin access.
            </div>
          ) : (
            <>
              <p className="text2" style={{ fontSize: 13, lineHeight: 1.6, marginBottom: 12 }}>
                If this operation matches a configured OSP process, generate a JW purchase
                request (and a draft PO when the process has a vendor with auto-PO enabled).
              </p>
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => void handleGenerateOsp()}
                disabled={genOsp.isPending}
              >
                {genOsp.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <PackagePlus size={14} />
                )}
                Generate OSP PR
              </button>
            </>
          )}

          {ospMsg ? (
            <div
              role="alert"
              style={{
                marginTop: 12,
                fontSize: 12,
                color: ospMsg.kind === 'ok' ? 'var(--green)' : 'var(--red)',
              }}
            >
              {ospMsg.text}
            </div>
          ) : null}
        </div>
      </div>
    );
  }

  // T-040d: render the QC sub-form when the selected op is qc-bearing.
  if (isQcBearing) {
    return (
      <form onSubmit={handleSubmitQc}>
        <div className="panel">
          <div className="panel-hdr">
            <span className="panel-title">QC inspection</span>
            <span className="text3" style={{ fontSize: 11 }}>
              Op {op.opSeq} · <span className="mono">{op.operation}</span> · QC pending:{' '}
              <span className="mono">{op.qcPending}</span>
            </span>
          </div>
          <div className="panel-body">
            {blockedBanner}
            <div className="form-grid">
              {commonFields}
              <div className="form-grp">
                <label className="form-label" htmlFor="opf-qty">
                  Accepted qty
                </label>
                <input
                  id="opf-qty"
                  className="innovic-input"
                  type="number"
                  inputMode="numeric"
                  min={0}
                  max={op.qcPending}
                  value={qty}
                  onChange={(e) => setQty(e.target.value)}
                  placeholder="0"
                  disabled={blockedReason !== null}
                />
              </div>
              <div className="form-grp">
                <label className="form-label" htmlFor="opf-rej">
                  Reject qty
                </label>
                <input
                  id="opf-rej"
                  className="innovic-input"
                  type="number"
                  inputMode="numeric"
                  min={0}
                  max={op.qcPending}
                  value={rejectQty}
                  onChange={(e) => setRejectQty(e.target.value)}
                  placeholder="0"
                  disabled={blockedReason !== null}
                />
              </div>
              {operatorAndRemarks}
            </div>
            <div style={{ marginTop: 10 }}>
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
            {errorBanner}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 12 }}>
              <button
                type="submit"
                className="btn btn-primary"
                disabled={blockedReason !== null || submitQc.isPending}
              >
                {submitQc.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <ShieldCheck size={14} />
                )}
                Submit QC inspection
              </button>
            </div>
          </div>
        </div>
      </form>
    );
  }

  // Production form for non-QC / non-outsource ops. Legacy renderOpEntry
  // (L5277-5331) switches between a Start and a Complete sub-form via
  // _opEntryMode; the header toggle mirrors legacy L5278-5283.
  const isStart = mode === 'start';
  const modeToggle = onModeChange ? (
    <div style={{ display: 'flex', gap: 4 }}>
      <button
        type="button"
        className="btn btn-sm"
        onClick={() => onModeChange('start')}
        style={{
          borderColor: isStart ? 'var(--amber)' : 'var(--border2)',
          background: isStart ? 'var(--amber3)' : 'transparent',
          color: isStart ? 'var(--amber)' : 'var(--text2)',
          fontWeight: 700,
        }}
      >
        ▶ Start
      </button>
      <button
        type="button"
        className="btn btn-sm"
        onClick={() => onModeChange('complete')}
        style={{
          borderColor: !isStart ? 'var(--green)' : 'var(--border2)',
          background: !isStart ? 'var(--green3)' : 'transparent',
          color: !isStart ? 'var(--green)' : 'var(--text2)',
          fontWeight: 700,
        }}
      >
        ✓ Complete
      </button>
    </div>
  ) : null;

  return (
    <form onSubmit={(e) => void handleProductionSubmit(e)}>
      <div className="panel">
        <div className="panel-hdr">
          <span className="panel-title">{isStart ? '▶ Start Operation' : '✓ Log entry'}</span>
          {modeToggle ?? (
            <span className="text3" style={{ fontSize: 11 }}>
              Op {op.opSeq} · <span className="mono">{op.operation}</span>
            </span>
          )}
        </div>
        <div className="panel-body">
          {blockedBanner}
          <div className="form-grid">
            {commonFields}
            {isStart ? (
              // Legacy "Mark Operation as Running" panel (L5303-5307).
              <div
                className="form-grp form-full"
                style={{
                  background: 'var(--amber3)',
                  border: '1px solid var(--amber2)',
                  borderRadius: 8,
                  padding: 10,
                }}
              >
                <div
                  style={{ fontSize: 13, fontWeight: 700, color: 'var(--amber)', marginBottom: 4 }}
                >
                  ▶ Mark Operation as Running
                </div>
                <div style={{ fontSize: 11, color: 'var(--text2)' }}>
                  This will mark{' '}
                  <b className="mono">
                    {op.jobCardCode} Op{op.opSeq}
                  </b>{' '}
                  as Running on <b>{op.machineCode ?? op.machineCodeText ?? '—'}</b>.
                </div>
                <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 4 }}>
                  Available qty to process:{' '}
                  <b style={{ color: 'var(--cyan)' }}>{op.available} pcs</b>
                </div>
              </div>
            ) : (
              <>
                <div className="form-grp">
                  <label className="form-label" htmlFor="opf-qty">
                    Qty done
                  </label>
                  <input
                    id="opf-qty"
                    className="innovic-input"
                    type="number"
                    inputMode="numeric"
                    min={1}
                    max={op.available}
                    value={qty}
                    onChange={(e) => setQty(e.target.value)}
                    placeholder="0"
                    disabled={blockedReason !== null}
                  />
                </div>
                <div className="form-grp">
                  <label className="form-label" htmlFor="opf-rej">
                    Reject qty
                  </label>
                  <input
                    id="opf-rej"
                    className="innovic-input"
                    type="number"
                    inputMode="numeric"
                    min={0}
                    value={rejectQty}
                    onChange={(e) => setRejectQty(e.target.value)}
                    placeholder="0"
                  />
                </div>
              </>
            )}
            {operatorAndRemarks}
          </div>
          {errorBanner}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 12 }}>
            {isStart ? (
              activeRunningId ? (
                <button
                  type="button"
                  className="btn btn-ghost"
                  onClick={() => void handleStop()}
                  disabled={stop.isPending}
                >
                  <Square size={14} />
                  Stop ({stop.isPending ? 'stopping…' : 'running'})
                </button>
              ) : (
                <button
                  type="submit"
                  className="btn btn-primary"
                  style={{ background: 'var(--amber)', borderColor: 'var(--amber)' }}
                  disabled={blockedReason !== null || start.isPending}
                >
                  {start.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play size={14} />}
                  ▶ Start Operation
                </button>
              )
            ) : (
              <>
                <button
                  type="submit"
                  className="btn btn-success"
                  disabled={blockedReason !== null || submit.isPending}
                >
                  {submit.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}✓ Submit
                  completion
                </button>
                {activeRunningId ? (
                  <button
                    type="button"
                    className="btn btn-ghost"
                    onClick={() => void handleStop()}
                    disabled={stop.isPending}
                  >
                    <Square size={14} />
                    Stop ({stop.isPending ? 'stopping…' : 'running'})
                  </button>
                ) : (
                  <button
                    type="button"
                    className="btn btn-ghost"
                    onClick={() => void handleStart()}
                    disabled={blockedReason !== null || start.isPending}
                  >
                    <Play size={14} />▶ Start session
                  </button>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    </form>
  );
}
