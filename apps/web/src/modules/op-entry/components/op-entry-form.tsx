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
import { effectiveFormPerms, useMyAccess } from '@/lib/access-control';
import { useSession } from '@/lib/session';
import { useOperatorsList } from '@/modules/operators/api';
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
  // OSP-PR generation stays a manager/admin action (server: requireWriteRole).
  const canWrite = session.data?.role === 'admin' || session.data?.role === 'manager';
  // Tier-driven, per department. Shop-floor Start/Log/Stop = op_entry entry
  // (Production). The QC inspection sub-form is a QC action, so its submit uses
  // the SAME key the server enforces on it (qc_submit entry).
  const { data: eff } = useMyAccess();
  const canOpEntry = effectiveFormPerms(eff, 'op_entry').entry;
  const canQcSubmit = effectiveFormPerms(eff, 'qc_submit').entry;

  // EVERY field starts BLANK — no seeded date, no seeded time, no pre-selected
  // shift, no "0" already sitting in the reject box. A seeded value is a value
  // nobody typed: an operator booking last night's second shift this morning
  // would submit today's date and the day shift simply by not noticing them,
  // and the record would be wrong with nothing on screen ever having looked
  // wrong. The data-entry operator states the facts of THIS entry, from the
  // date picker and the dropdowns, on his own accord. Mandatory fields carry a
  // ★ on their label and are checked before any request goes out.
  const [logDate, setLogDate] = useState<string>('');
  // Clock time of the entry, editable on BOTH tabs. Start already accepted a
  // client time (startOpInputSchema) but the form hard-coded "now";
  // completion and QC logs had no time field at all and the service wrote
  // start_time: null, so an operator logging a shift late could never record
  // when the work actually happened.
  const [entryTime, setEntryTime] = useState<string>('');
  // '' is the un-answered state, which is why this is Shift | '' and the
  // dropdown opens on a "Select shift" placeholder rather than on 'day'.
  const [shift, setShift] = useState<Shift | ''>('');
  const [qty, setQty] = useState<string>('');
  const [rejectQty, setRejectQty] = useState<string>('');
  const [operatorName, setOperatorName] = useState<string>('');
  // Master operators FK — resolved only when the typed operator/inspector name
  // (or code) exactly matches a master operator. Left undefined for free text so
  // logging is never blocked by an operator missing from the master.
  const [operatorId, setOperatorId] = useState<string | undefined>(undefined);
  const [remarks, setRemarks] = useState<string>('');
  // Remarks starts compact (inline next to Operator); "show more" expands it.
  const [remarksExpanded, setRemarksExpanded] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  // QC report attachment (migration 0043) — only used on the QC sub-form.
  const [qcReportPath, setQcReportPath] = useState<string | null>(null);
  const [qcReportName, setQcReportName] = useState<string | null>(null);
  // OSP auto-PR result/error message (ADR-039) — only used on the outsource panel.
  const [ospMsg, setOspMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  // Reset when the selected op changes. Quantities and notes belong to the op
  // that was on screen, never to the next one.
  useEffect(() => {
    setQty('');
    setRejectQty('');
    setRemarks('');
    setRemarksExpanded(false);
    setErrorMessage(null);
    setQcReportPath(null);
    setQcReportName(null);
    setOspMsg(null);
  }, [op.id]);

  // Operators master for the datalist-backed operator/inspector picker. Active
  // operators only; free text still works when there's no match.
  const operatorsQuery = useOperatorsList({ isActive: true, limit: 200, offset: 0 });
  const operators = operatorsQuery.data?.operators ?? [];

  // On operator/inspector input change, keep the free-text name and resolve the
  // master FK only on an exact name-or-code match (else leave it undefined).
  function handleOperatorNameChange(value: string): void {
    setOperatorName(value);
    const needle = value.trim().toLowerCase();
    const match = needle
      ? operators.find(
          (o) => o.name.trim().toLowerCase() === needle || o.code.trim().toLowerCase() === needle,
        )
      : undefined;
    setOperatorId(match ? match.id : undefined);
  }

  /** The one mandatory-field gate for every action on this form.
   *
   *  Because nothing is pre-filled any more, no handler may assume a date, a
   *  time or a shift is present — so each one calls this first. It names what
   *  is missing in a single inline message instead of letting the request go
   *  out and come back as a server validation error the operator has to guess
   *  at.
   *
   *  It returns the chosen shift rather than a boolean so the caller also gets
   *  it narrowed from `Shift | ''` down to `Shift` for the request body; null
   *  means "something is missing, the message is already on screen, stop". */
  function requireMandatory(opts: { qtyRequired: boolean; personLabel: string }): Shift | null {
    const missing: string[] = [];
    if (!logDate) missing.push('Date');
    if (!entryTime) missing.push('Time');
    if (!shift) missing.push('Shift');
    if (!operatorId && !operatorName.trim()) missing.push(opts.personLabel);
    // An EMPTY quantity box is the blocker, never the number in it: 0 is a
    // perfectly good answer on a stop ("this session made nothing") and must
    // still be typed out loud rather than assumed.
    if (opts.qtyRequired && qty.trim() === '') missing.push('Qty');
    if (missing.length > 0 || !shift) {
      setErrorMessage(`Fill in the mandatory ★ fields before continuing — missing: ${missing.join(', ')}.`);
      return null;
    }
    return shift;
  }

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
    // Date, time, shift, operator AND quantity are all mandatory on a
    // completion — a booked piece with no shift or no name against it is not
    // an audit trail.
    const chosenShift = requireMandatory({ qtyRequired: true, personLabel: 'Operator' });
    if (!chosenShift) return;
    const qtyNum = Number(qty);
    if (!Number.isInteger(qtyNum) || qtyNum <= 0) {
      setErrorMessage('Qty must be a positive whole number.');
      return;
    }
    // Blank reject box means none were scrapped; it is the one number here
    // that is allowed to go unanswered.
    const rejNum = Number(rejectQty || '0');
    const input: SubmitOpLogInput = {
      jcOpId: op.id,
      qty: qtyNum,
      rejectQty: Number.isFinite(rejNum) && rejNum >= 0 ? rejNum : 0,
      logDate,
      logTime: entryTime,
      shift: chosenShift,
      ...(operatorId ? { operatorId } : {}),
      ...(operatorName.trim() ? { operatorName: operatorName.trim() } : {}),
      ...(remarks.trim() ? { remarks: remarks.trim() } : {}),
    };
    try {
      await submit.mutateAsync(input);
      setQty('');
      setRejectQty('');
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
    // The inspection's own date, time, shift and inspector are mandatory. The
    // accepted/reject pair is NOT covered by the gate: QC's rule is "at least
    // one of the two is above zero", checked just below.
    const chosenShift = requireMandatory({ qtyRequired: false, personLabel: 'Inspector' });
    if (!chosenShift) return;
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
      logTime: entryTime,
      shift: chosenShift,
      ...(operatorId ? { operatorId } : {}),
      ...(operatorName.trim() ? { operatorName: operatorName.trim() } : {}),
      ...(remarks.trim() ? { remarks: remarks.trim() } : {}),
      ...(qcReportPath ? { qcReportPath, qcReportName } : {}),
    };
    try {
      await submitQc.mutateAsync(input);
      setQty('');
      setRejectQty('');
      setRemarks('');
      setQcReportPath(null);
      setQcReportName(null);
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'QC submit failed');
    }
  }

  async function handleStart(): Promise<void> {
    setErrorMessage(null);
    // Starting asks for when the work began and who is running it — date,
    // time, shift and operator. No quantity: nothing has been made yet.
    const chosenShift = requireMandatory({ qtyRequired: false, personLabel: 'Operator' });
    if (!chosenShift) return;
    const input: StartOpInput = {
      jcOpId: op.id,
      startDate: logDate,
      startTime: entryTime,
      shift: chosenShift,
      ...(operatorId ? { operatorId } : {}),
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
    // Stop is a PRODUCTION ENTRY that also frees the machine. It writes the
    // very same completion row Log writes — same qty, same rejects, same
    // date/time/shift/operator, same downstream cascades — and then releases
    // the machine for the next job; Log books the pieces but keeps the machine
    // held. Nothing is inherited from the running session (a night-shift
    // session can be stopped next morning by somebody else), so the operator
    // states the facts of THIS entry in the fields above and they are sent
    // here: the server's stopOpInputSchema now refuses a bare { id }.
    const chosenShift = requireMandatory({ qtyRequired: true, personLabel: 'Operator' });
    if (!chosenShift) return;
    // 0 is a valid stop quantity — the session made nothing — so the only
    // number this refuses is a negative or non-whole one. The empty box was
    // already caught by the gate above.
    const qtyNum = Number(qty);
    if (!Number.isInteger(qtyNum) || qtyNum < 0) {
      setErrorMessage('Qty must be 0 or a positive whole number.');
      return;
    }
    const rejNum = Number(rejectQty || '0');
    if (!Number.isInteger(rejNum) || rejNum < 0) {
      setErrorMessage('Reject qty must be 0 or a positive whole number.');
      return;
    }
    try {
      await stop.mutateAsync({
        id: activeRunningId,
        qty: qtyNum,
        rejectQty: rejNum,
        logDate,
        logTime: entryTime,
        shift: chosenShift,
        ...(operatorId ? { operatorId } : {}),
        ...(operatorName.trim() ? { operatorName: operatorName.trim() } : {}),
        ...(remarks.trim() ? { remarks: remarks.trim() } : {}),
      });
      setQty('');
      setRejectQty('');
      setRemarks('');
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
            {/* Compact single-row field strip (matches the production Log Entry
                form): Date · Time · Shift · Accepted · Reject · Inspector on one
                wrapping row, Remarks beside it with show more/less. */}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'flex-end' }}>
              <div className="form-grp" style={{ width: 140 }}>
                <label className="form-label" htmlFor="opf-date">
                  Date<span className="req">★</span>
                </label>
                <input
                  id="opf-date"
                  className="innovic-input"
                  type="date"
                  required
                  value={logDate}
                  onChange={(e) => setLogDate(e.target.value)}
                />
              </div>
              <div className="form-grp" style={{ width: 110 }}>
                <label className="form-label" htmlFor="opf-time">
                  Time<span className="req">★</span>
                </label>
                <input
                  id="opf-time"
                  className="innovic-input"
                  type="time"
                  required
                  value={entryTime}
                  onChange={(e) => setEntryTime(e.target.value)}
                />
              </div>
              <div className="form-grp" style={{ width: 120 }}>
                <label className="form-label" htmlFor="opf-shift">
                  Shift<span className="req">★</span>
                </label>
                {/* The empty first option IS the starting state — no shift is
                    pre-selected, so the inspector has to choose one. */}
                <select
                  id="opf-shift"
                  className="innovic-select"
                  required
                  value={shift}
                  onChange={(e) => setShift(e.target.value as Shift | '')}
                >
                  <option value="">Select shift</option>
                  {SHIFTS.map((s) => (
                    <option key={s} value={s}>
                      {SHIFT_LABELS[s]}
                    </option>
                  ))}
                </select>
              </div>
              <div className="form-grp" style={{ width: 100 }}>
                <label className="form-label" htmlFor="opf-qty">
                  Accepted
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
              <div className="form-grp" style={{ width: 100 }}>
                <label className="form-label" htmlFor="opf-rej">
                  Reject
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
              <div className="form-grp" style={{ flex: '1 1 180px', minWidth: 160 }}>
                <label className="form-label" htmlFor="opf-op">
                  Inspector<span className="req">★</span>
                </label>
                <input
                  id="opf-op"
                  className="innovic-input"
                  list="opf-op-list"
                  required
                  value={operatorName}
                  onChange={(e) => handleOperatorNameChange(e.target.value)}
                  placeholder="QC inspector name"
                  autoComplete="off"
                />
                <datalist id="opf-op-list">
                  {operators.map((o) => (
                    <option key={o.id} value={o.name}>
                      {o.code}
                      {o.department ? ` · ${o.department}` : ''}
                    </option>
                  ))}
                </datalist>
              </div>
              <div
                className="form-grp"
                style={remarksExpanded ? { flexBasis: '100%' } : { flex: '1 1 180px', minWidth: 160 }}
              >
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: 8,
                  }}
                >
                  <label className="form-label" htmlFor="opf-rem">
                    Remarks
                  </label>
                  <button
                    type="button"
                    onClick={() => setRemarksExpanded((v) => !v)}
                    style={{
                      background: 'none',
                      border: 'none',
                      padding: 0,
                      color: 'var(--cyan)',
                      fontSize: 11,
                      fontWeight: 600,
                      cursor: 'pointer',
                    }}
                  >
                    {remarksExpanded ? 'show less' : 'show more'}
                  </button>
                </div>
                {remarksExpanded ? (
                  <textarea
                    id="opf-rem"
                    className="innovic-textarea"
                    rows={3}
                    value={remarks}
                    onChange={(e) => setRemarks(e.target.value)}
                    placeholder="Optional notes…"
                    style={{ resize: 'vertical' }}
                  />
                ) : (
                  <input
                    id="opf-rem"
                    className="innovic-input"
                    value={remarks}
                    onChange={(e) => setRemarks(e.target.value)}
                    placeholder="Optional notes…"
                    title={remarks || undefined}
                  />
                )}
              </div>
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
              {canQcSubmit ? (
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
              ) : null}
            </div>
          </div>
        </div>
      </form>
    );
  }

  // Production form for non-QC / non-outsource ops. Legacy renderOpEntry
  // (L5277-5331) switches between a Start and a Complete sub-form via
  // _opEntryMode; the header toggle mirrors legacy L5278-5283.
  // No open session means there is nothing to complete, so Complete is not
  // offered at all -- neither as a button nor as a form. `mode` is forced back
  // to 'start' rather than trusted, because it can also arrive from ?mode= in
  // the URL (a bookmark, a shared link) and would otherwise reach the Complete
  // form with no button having been pressed.
  const canComplete = Boolean(activeRunningId);
  const isStart = !canComplete || mode === 'start';
  // The quantity boxes follow the buttons, not the tab. Stopping a session is
  // now a production entry in its own right, and the Stop button also appears
  // on the Start tab while a session is open — so wherever Stop can be pressed
  // the operator must have somewhere to type what the session made. Without
  // this, Start-tab Stop would demand a Qty the form never showed him.
  const showQtyFields = !isStart || Boolean(activeRunningId);
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
      {canComplete ? (
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
      ) : null}
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
          {/* Minimized single-row field strip (see reference UI): Date · Time ·
              Shift · [Qty · Reject] · Operator all on ONE wrapping row, with
              Remarks full-width below. Each field's form-grp carries an explicit
              width because .innovic-input is width:100% and would otherwise
              collapse in a flex row. */}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'flex-end' }}>
            <div className="form-grp" style={{ width: 140 }}>
              <label className="form-label" htmlFor="opf-date">
                Date<span className="req">★</span>
              </label>
              <input
                id="opf-date"
                className="innovic-input"
                type="date"
                required
                value={logDate}
                onChange={(e) => setLogDate(e.target.value)}
              />
            </div>
            <div className="form-grp" style={{ width: 110 }}>
              <label className="form-label" htmlFor="opf-time">
                Time<span className="req">★</span>
              </label>
              <input
                id="opf-time"
                className="innovic-input"
                type="time"
                required
                value={entryTime}
                onChange={(e) => setEntryTime(e.target.value)}
              />
            </div>
            <div className="form-grp" style={{ width: 120 }}>
              <label className="form-label" htmlFor="opf-shift">
                Shift<span className="req">★</span>
              </label>
              {/* The empty first option IS the starting state — no shift is
                  pre-selected, so the operator has to choose one. */}
              <select
                id="opf-shift"
                className="innovic-select"
                required
                value={shift}
                onChange={(e) => setShift(e.target.value as Shift | '')}
              >
                <option value="">Select shift</option>
                {SHIFTS.map((s) => (
                  <option key={s} value={s}>
                    {SHIFT_LABELS[s]}
                  </option>
                ))}
              </select>
            </div>
            <div className="form-grp" style={{ width: 130 }}>
              <label className="form-label" htmlFor="opf-machine">
                Machine
              </label>
              <input
                id="opf-machine"
                className="innovic-input"
                readOnly
                value={op.machineCode ?? op.machineCodeText ?? '—'}
              />
            </div>
            {showQtyFields ? (
              <>
                <div className="form-grp" style={{ width: 100 }}>
                  <label className="form-label" htmlFor="opf-qty">
                    Qty done<span className="req">★</span>
                  </label>
                  {/* min is 0, not 1: a Stop that made nothing is a real and
                      required answer. The completion path still refuses 0 in
                      handleSubmit, where that rule belongs.
                      `required` is native only on the Complete tab, whose
                      submit button IS this form's submit. On the Start tab the
                      box is here for Stop (a plain button), and marking it
                      required would block an ordinary ▶ Start on Enter — the
                      JS gate in handleStop enforces it there instead. */}
                  <input
                    id="opf-qty"
                    className="innovic-input"
                    type="number"
                    inputMode="numeric"
                    min={0}
                    max={op.available}
                    required={!isStart}
                    value={qty}
                    onChange={(e) => setQty(e.target.value)}
                    disabled={blockedReason !== null}
                  />
                </div>
                <div className="form-grp" style={{ width: 100 }}>
                  <label className="form-label" htmlFor="opf-rej">
                    Reject
                  </label>
                  {/* Optional — left blank it counts as none scrapped. */}
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
            ) : null}
            <div className="form-grp" style={{ flex: '1 1 200px', minWidth: 180 }}>
              <label className="form-label" htmlFor="opf-op">
                Operator<span className="req">★</span>
              </label>
              <input
                id="opf-op"
                className="innovic-input"
                list="opf-op-list"
                required
                value={operatorName}
                onChange={(e) => handleOperatorNameChange(e.target.value)}
                placeholder="Operator name"
                autoComplete="off"
              />
              <datalist id="opf-op-list">
                {operators.map((o) => (
                  <option key={o.id} value={o.name}>
                    {o.code}
                    {o.department ? ` · ${o.department}` : ''}
                  </option>
                ))}
              </datalist>
            </div>
            {/* Remarks sits next to Operator. Collapsed it is a compact single
                line (full text on hover); "show more" expands it to a full-width
                textarea for long notes, "show less" collapses it back. */}
            <div
              className="form-grp"
              style={remarksExpanded ? { flexBasis: '100%' } : { flex: '1 1 200px', minWidth: 180 }}
            >
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 8,
                }}
              >
                <label className="form-label" htmlFor="opf-rem">
                  Remarks
                </label>
                <button
                  type="button"
                  onClick={() => setRemarksExpanded((v) => !v)}
                  style={{
                    background: 'none',
                    border: 'none',
                    padding: 0,
                    color: 'var(--cyan)',
                    fontSize: 11,
                    fontWeight: 600,
                    cursor: 'pointer',
                  }}
                >
                  {remarksExpanded ? 'show less' : 'show more'}
                </button>
              </div>
              {remarksExpanded ? (
                <textarea
                  id="opf-rem"
                  className="innovic-textarea"
                  rows={3}
                  value={remarks}
                  onChange={(e) => setRemarks(e.target.value)}
                  placeholder="Optional notes…"
                  style={{ resize: 'vertical' }}
                />
              ) : (
                <input
                  id="opf-rem"
                  className="innovic-input"
                  value={remarks}
                  onChange={(e) => setRemarks(e.target.value)}
                  placeholder="Optional notes…"
                  title={remarks || undefined}
                />
              )}
            </div>
          </div>

          {isStart ? (
            // "Mark Operation as Running" info panel — full width below the strip.
            <div
              style={{
                background: 'var(--amber3)',
                border: '1px solid var(--amber2)',
                borderRadius: 8,
                padding: 10,
                marginTop: 12,
              }}
            >
              <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--amber)', marginBottom: 4 }}>
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
                Available qty to process: <b style={{ color: 'var(--cyan)' }}>{op.available} pcs</b>
              </div>
            </div>
          ) : null}

          {errorBanner}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 12 }}>
            {canOpEntry ? (
              isStart ? (
                activeRunningId ? (
                  <button
                    type="button"
                    className="btn btn-ghost"
                    onClick={() => void handleStop()}
                    disabled={stop.isPending}
                    title="Books the quantity above AND frees the machine for the next job"
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
                      title="Books the quantity above AND frees the machine for the next job"
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
              )
            ) : null}
            <span
              style={{
                marginLeft: 'auto',
                alignSelf: 'center',
                fontSize: 12,
                color: 'var(--text2)',
              }}
            >
              Pending on this op:{' '}
              <b style={{ color: 'var(--amber)' }}>{op.pendingQty}</b>
            </span>
          </div>
        </div>
      </div>
    </form>
  );
}
