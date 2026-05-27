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
import { Loader2, Play, ShieldCheck, Square } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useStartOp, useStopOp, useSubmitOpLog, useSubmitQcLog } from '../api';

interface Props {
  op: JcOpEnriched;
  // Active running session id for this op, if any (for the Stop button).
  activeRunningId: string | null;
}

function todayIso(): string {
  const d = new Date();
  return d.toISOString().slice(0, 10);
}

function nowHHMM(): string {
  const d = new Date();
  return d.toTimeString().slice(0, 5);
}

export function OpEntryForm({ op, activeRunningId }: Props): React.JSX.Element {
  const submit = useSubmitOpLog();
  const submitQc = useSubmitQcLog();
  const start = useStartOp();
  const stop = useStopOp();

  const [logDate, setLogDate] = useState(todayIso());
  const [shift, setShift] = useState<Shift>('day');
  const [qty, setQty] = useState<string>('');
  const [rejectQty, setRejectQty] = useState<string>('0');
  const [operatorName, setOperatorName] = useState<string>('');
  const [remarks, setRemarks] = useState<string>('');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Reset when the selected op changes.
  useEffect(() => {
    setQty('');
    setRejectQty('0');
    setRemarks('');
    setErrorMessage(null);
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
    };
    try {
      await submitQc.mutateAsync(input);
      setQty('');
      setRejectQty('0');
      setRemarks('');
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

  // Production-complete form for non-QC ops (process / outsource).
  return (
    <form onSubmit={handleSubmit}>
      <div className="panel">
        <div className="panel-hdr">
          <span className="panel-title">Log entry</span>
          <span className="text3" style={{ fontSize: 11 }}>
            Op {op.opSeq} · <span className="mono">{op.operation}</span>
          </span>
        </div>
        <div className="panel-body">
          {blockedBanner}
          <div className="form-grid">
            {commonFields}
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
            {operatorAndRemarks}
          </div>
          {errorBanner}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 12 }}>
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
          </div>
        </div>
      </div>
    </form>
  );
}
