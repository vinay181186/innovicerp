// Op Entry form — legacy chrome (.panel / .btn / .innovic-input / .form-grp).
// Logic unchanged from the shadcn version: QC sub-form vs production-complete
// form, start/stop session, blocked-reason guard. T-040d QC path preserved.

import {
  type JcOpEnriched,
  type OpLog,
  SHIFTS,
  SHIFT_LABELS,
  type Shift,
  type StartOpInput,
  type SubmitOpLogInput,
  type SubmitQcLogInput,
} from '@innovic/shared';
import { fmtOpSrNo, opSrNo } from '@innovic/shared';
import { AlertTriangle, Loader2, Play, PackagePlus, ShieldCheck, Square } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from '@tanstack/react-router';
import { QcReportAttach } from '@/components/shared/qc-report-attach';
import { SearchableSelect } from '@/components/shared/searchable-select';
import { effectiveFormPerms, useMyAccess } from '@/lib/access-control';
import { todayIst } from '@/lib/date';
import { itemCodeWithRev } from '@/lib/item-code';
import { useSession } from '@/lib/session';
import { useMachineGroupsList, useMachinesList } from '@/modules/machines/api';
import { MachineGroupPicker } from '@/modules/machines/components/machine-group-picker';
import { useOperatorsList } from '@/modules/operators/api';
import {
  useGenerateOspPr,
  useRunningOps,
  useStartOp,
  useStopOp,
  useSubmitOpLog,
  useSubmitQcLog,
} from '../api';

interface Props {
  op: JcOpEnriched;
  // Active running session id for this op, if any (for the Stop button).
  activeRunningId: string | null;
  /** Kept for the callers that still pass it; the production path no longer
   *  reads it. Which half of the form shows is decided by `activeRunningId`
   *  alone -- see the note beside `isStart`. */
  mode?: 'start' | 'complete';
  onModeChange?: (mode: 'start' | 'complete') => void;
  /** Called after a write of ANY kind lands -- start, completion, QC, stop.
   *  The form itself has no opinion about what should happen next; when it is
   *  hosted in a popup (op-entry-modal.tsx) the host closes on this, so the
   *  operator is returned to the list they picked the operation from rather
   *  than left staring at a box they have already submitted. Absent when the
   *  form is rendered inline, where nothing should close. */
  onSubmitted?: () => void;
  /** The machine to offer as the ACTUAL machine before the operator touches
   *  the picker, when the host knows better than the plan — the By Machine tab
   *  opens Start from a machine tile, and that tile is the machine the
   *  operator is standing at. Falls back to the op's planned machine. */
  defaultMachineId?: string | null;
  /** Closes the host popup without a write. Used by the machine-busy notice's
   *  "Open Current Operation", which navigates away from this box. */
  onClose?: () => void;
  /** Reports the Actual Machine the operator currently has picked on the
   *  Start tab (code, or null while none), so the host's heading strip can
   *  show it live beside the planned machine. */
  onActualMachineChange?: (code: string | null) => void;
  /** Open the Start form with the Actual Machine BLANK (group still seeded
   *  from the plan). The host sets it when the planned machine is busy and
   *  the operator chose "Start on another machine" — the plan must not be the
   *  pre-filled answer then. */
  startWithoutMachine?: boolean;
}

/** The one wording used wherever this form refuses a future date, so the QC
 *  sub-form, the production form, Start and Stop all say exactly the same
 *  thing. An hour after the date boxes were changed to open blank, a real
 *  entry was booked dated a day into the future because "11" was typed instead
 *  of "10"; work cannot have happened on a day that has not happened yet. */
const FUTURE_DATE_MESSAGE =
  'Log Date cannot be in the future — an operation cannot be worked on a day that has not happened yet.';

export function OpEntryForm({
  op,
  activeRunningId,
  onModeChange,
  onSubmitted,
  defaultMachineId,
  onClose,
  onActualMachineChange,
  startWithoutMachine = false,
}: Props): React.JSX.Element {
  const navigate = useNavigate();
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

  // `CODE/REV` for the part this operation is on, or '' when the join brought no
  // item back. '' rather than a dash, because a dash would assert that the card
  // has no item; and it is tested rather than printed blind, so a missing code
  // shows nothing at all instead of an empty "Item:" label.
  const itemCodeLabel = itemCodeWithRev(op.itemCode, op.itemRevision, '');

  // EVERY field starts BLANK — no seeded date, no seeded time, no pre-selected
  // shift, no "0" already sitting in the reject box. A seeded value is a value
  // nobody typed: an operator booking last night's second shift this morning
  // would submit today's date and the day shift simply by not noticing them,
  // and the record would be wrong with nothing on screen ever having looked
  // wrong. The data-entry operator states the facts of THIS entry, from the
  // date picker and the dropdowns, on his own accord. Mandatory fields carry a
  // ★ on their label and are checked before any request goes out.
  const [logDate, setLogDate] = useState<string>('');
  // Upper bound for every date box on this form. It is NOT a default: the box
  // still opens blank, `max` only greys out the days after today in the native
  // picker. todayIst() is the same "today" the rest of the app uses, so a
  // shop-floor PC (which runs on IST, as the server records) greys out
  // tomorrow onwards. Read on each render so a form left open past midnight
  // moves with the clock rather than freezing on yesterday.
  const maxLogDate = todayIst();
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
  // NC(s) the last completion raised from its rejects (ADR-183), shown as the
  // success notice. Null when the last save raised none.
  const [ncNotice, setNcNotice] = useState<{ ncs: OpLog['ncs']; rejected: number } | null>(null);

  // PLANNED vs ACTUAL machine. The plan is jc_ops.machine_id, set at JC
  // creation and shown read-only here — Start never rewrites it. The session
  // opens on the ACTUAL machine, which defaults to the plan (or to the tile the
  // By Machine tab was opened from) and can be changed through Group → Machine,
  // the same two controls the JC edit card and SO Planning use. Only a process
  // op has one; QC ops carry no machine.
  const isProcessOp = op.opType === 'process';
  const [actualMachineId, setActualMachineId] = useState<string | null>(null);
  const [actualGroupId, setActualGroupId] = useState<string | null>(null);
  const [machineSearch, setMachineSearch] = useState('');
  // The busy banner's ✕. Dismissing hides the banner for THAT machine only —
  // pick a different busy one and it comes straight back — and never enables
  // Start: a busy machine stays un-startable whether or not the notice is up.
  const [busyDismissedFor, setBusyDismissedFor] = useState<string | null>(null);
  // ≤ 200: the machines list route caps `limit` there and 400s above it.
  const { data: machinesData } = useMachinesList({ limit: 200, offset: 0 });
  const { data: machineGroupsData } = useMachineGroupsList({ limit: 200, offset: 0 });
  const machinesList = useMemo(() => machinesData?.machines ?? [], [machinesData]);
  const machineGroupCodeById = useMemo(
    () => new Map((machineGroupsData?.groups ?? []).map((g) => [g.id, g.code])),
    [machineGroupsData],
  );
  const actualMachine = actualMachineId
    ? (machinesList.find((m) => m.id === actualMachineId) ?? null)
    : null;
  const plannedLabel = op.machineCode ?? op.machineCodeText ?? '—';
  // The code to PRINT for the actual machine. The master lookup above is the
  // truth once the list is in; until then the op row already knows its own
  // planned machine's code, so a picker still seeded on the plan is labelled
  // from that rather than left blank while the list loads.
  const actualLabel =
    actualMachine?.code ??
    (actualMachineId && actualMachineId === op.machineId ? op.machineCode : null);
  useEffect(() => {
    onActualMachineChange?.(actualLabel ?? null);
    // The host only wants the CODE; the callback identity is not a trigger.
  }, [actualLabel]);
  // Seed on every op change: the picker must open on THIS op's plan, not on
  // whatever the previous row was started on.
  useEffect(() => {
    const seedId = startWithoutMachine ? null : (defaultMachineId ?? op.machineId ?? null);
    setActualMachineId(seedId);
    setActualGroupId(
      seedId && seedId !== op.machineId
        ? null // resolved from the master below once the list is in
        : (op.machineGroupId ?? null),
    );
    setMachineSearch('');
    setBusyDismissedFor(null);
  }, [op.id, op.machineId, op.machineGroupId, defaultMachineId, startWithoutMachine]);
  // A seeded machine whose group the op row could not tell us (the By Machine
  // tile, or a plan with no group) reads its group off the master.
  useEffect(() => {
    if (!actualMachineId || actualGroupId) return;
    const m = machinesList.find((x) => x.id === actualMachineId);
    if (m?.machineGroupId) setActualGroupId(m.machineGroupId);
  }, [machinesList, actualMachineId, actualGroupId]);
  const machineOptions = useMemo(
    () =>
      machinesList
        .filter(
          (m) =>
            (!actualGroupId || m.machineGroupId === actualGroupId) &&
            (!machineSearch.trim() ||
              `${m.code} ${m.name}`.toLowerCase().includes(machineSearch.trim().toLowerCase())),
        )
        .map((m) => ({ id: m.id, code: m.code, name: m.name })),
    [machinesList, actualGroupId, machineSearch],
  );
  // Picking a group narrows the list; a machine outside the new group is
  // cleared so the row cannot read "VMC group, running a lathe".
  function handleGroupChange(groupId: string | null): void {
    setActualGroupId(groupId);
    if (groupId && actualMachine && actualMachine.machineGroupId !== groupId) {
      setActualMachineId(null);
    }
  }
  function handleMachineChange(id: string | null): void {
    setActualMachineId(id);
    const m = id ? machinesList.find((x) => x.id === id) : undefined;
    if (m?.machineGroupId && !actualGroupId) setActualGroupId(m.machineGroupId);
  }

  // MACHINE-BUSY GATE. Starting inserts a running_ops row, and a partial
  // unique index refuses a second running session on the same machine. That
  // refusal used to arrive only after the form was filled and submitted; here
  // it is caught the moment the ACTUAL machine is chosen, and — because the
  // operator can now pick another machine — it is a notice beside the picker,
  // not a wall in front of the form. Keyed on the chosen machine's id, which
  // is what the index sees.
  const runningOps = useRunningOps({ status: 'running' });
  const busy =
    !activeRunningId && actualMachineId
      ? (runningOps.data?.find(
          (r) => r.machineId === actualMachineId && !r.isOsp && r.jcOpId !== op.id,
        ) ?? null)
      : null;
  // Until the sessions list has answered, the machine is UNKNOWN — not free.
  // Start stays disabled and the banner slot says so; otherwise the seconds
  // the list takes to arrive are seconds in which a busy machine looks free.
  const busyUnknown =
    !activeRunningId && isProcessOp && Boolean(actualMachineId) && runningOps.data === undefined;

  // OPERATOR AUTO-FILL ON LOG / STOP (user decision 2026-09-21). The Start
  // entry already recorded who is running the machine on the session row, so
  // when this form opens in its Log / Stop half the person who STARTED is the
  // likeliest answer to "Operator" — pre-filled, never locked: a night-shift
  // session stopped next morning by somebody else is still typed over. Seeded
  // ONCE per session id, and only while the box is untouched (blank, or still
  // exactly the previous seed), so the 30-second re-poll of the sessions list
  // can never overwrite a name the operator has typed. A session with no
  // operator recorded leaves the box blank, as before. Production half only:
  // the QC sub-form's Inspector box is a different question and stays blank.
  const runningSession =
    activeRunningId && !(op.opType === 'qc' || op.qcRequired)
      ? (runningOps.data?.find((r) => r.id === activeRunningId) ?? null)
      : null;
  const seededForRunId = useRef<string | null>(null);
  // What the seed put in the box, '' when nothing was seeded. The "auto-filled"
  // note below the input shows only while the box still reads exactly this.
  const [seedValue, setSeedValue] = useState<string>('');
  useEffect(() => {
    if (!activeRunningId) {
      seededForRunId.current = null;
      setSeedValue('');
      return;
    }
    if (seededForRunId.current === activeRunningId) return;
    if (!runningSession) return; // list not in yet (or the session is gone)
    seededForRunId.current = activeRunningId;
    const untouched = operatorName.trim() === '' || operatorName === seedValue;
    if (!untouched) {
      setSeedValue('');
      return;
    }
    const name = runningSession.operatorName?.trim() ?? '';
    setSeedValue(name);
    setOperatorName(name);
    // The master id rides only with a VISIBLE name. A session carrying an id
    // but no name must not leave a hidden operator behind a blank box, or the
    // mandatory check would pass on somebody the operator cannot see.
    setOperatorId(name ? (runningSession.operatorId ?? undefined) : undefined);
  }, [activeRunningId, runningSession, operatorName, seedValue]);
  const operatorIsSeeded =
    Boolean(activeRunningId) && seedValue !== '' && operatorName === seedValue;

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
    setNcNotice(null);
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
    if (!logDate) missing.push('Log Date');
    if (!entryTime) missing.push('Time');
    if (!shift) missing.push('Shift');
    if (!operatorId && !operatorName.trim()) missing.push(opts.personLabel);
    // An EMPTY quantity box is the blocker, never the number in it: 0 is a
    // perfectly good answer on a stop ("this session made nothing") and must
    // still be typed out loud rather than assumed.
    if (opts.qtyRequired && qty.trim() === '') missing.push('Completed');
    if (missing.length > 0 || !shift) {
      setErrorMessage(
        `Fill in the mandatory ★ fields before continuing — missing: ${missing.join(', ')}.`,
      );
      return null;
    }
    // The picker's `max` greys future days out, but several browsers still let
    // a date be TYPED straight into the box, which is exactly how a future
    // entry got booked in the first place. So the same rule is enforced again
    // here, before any request goes out. Both sides are `YYYY-MM-DD`, which
    // compares correctly as plain text. The server refuses it too — this only
    // stops the operator before they submit rather than after.
    if (logDate > maxLogDate) {
      setErrorMessage(FUTURE_DATE_MESSAGE);
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
        ? 'Waiting for QC — open QC Call Register.'
        : !isQcOp && noAvailable
          ? 'No qty available — complete the previous Op first.'
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
    // Blank reject box means none were scrapped; it is the one number here
    // that is allowed to go unanswered.
    const rejNum = Number(rejectQty || '0');
    if (!Number.isInteger(qtyNum) || qtyNum < 0 || !Number.isInteger(rejNum) || rejNum < 0) {
      setErrorMessage('Completed and Rejected must be 0 or a whole number.');
      return;
    }
    // ADR-183: "0 good, 9 rejected" is a real entry (a scrapped batch) and
    // raises an NC on the server. Only an entry with nothing in it is refused.
    if (qtyNum + rejNum <= 0) {
      setErrorMessage('Enter a quantity — Completed, Rejected, or both.');
      return;
    }
    // Rejected pieces consume the op's available qty too, so the cap is on
    // the two together. The server re-checks under a row lock.
    if (qtyNum + rejNum > op.available) {
      setErrorMessage(
        `Completed + Rejected (${qtyNum + rejNum}) cannot be more than Available (${op.available}).`,
      );
      return;
    }
    const input: SubmitOpLogInput = {
      jcOpId: op.id,
      qty: qtyNum,
      rejectQty: rejNum,
      logDate,
      logTime: entryTime,
      shift: chosenShift,
      ...(operatorId ? { operatorId } : {}),
      ...(operatorName.trim() ? { operatorName: operatorName.trim() } : {}),
      ...(remarks.trim() ? { remarks: remarks.trim() } : {}),
    };
    setNcNotice(null);
    try {
      const saved = await submit.mutateAsync(input);
      setQty('');
      // ADR-183: a reject raised an NC. Say so and hold the box open on the
      // notice (its Close button hands off to onSubmitted) — closing at once
      // would hide the NC number the operator needs to hear about.
      if (saved.ncs && saved.ncs.length > 0) {
        setNcNotice({ ncs: saved.ncs, rejected: rejNum });
      } else {
        onSubmitted?.();
      }
      setRejectQty('');
      setRemarks('');
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Could not save the entry. Try again.');
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
    const chosenShift = requireMandatory({ qtyRequired: false, personLabel: 'Inspected By' });
    if (!chosenShift) return;
    const qtyNum = Number(qty || '0');
    const rejNum = Number(rejectQty || '0');
    if (!Number.isInteger(qtyNum) || qtyNum < 0 || !Number.isInteger(rejNum) || rejNum < 0) {
      setErrorMessage('Accepted and Rejected must be 0 or a whole number.');
      return;
    }
    if (qtyNum + rejNum <= 0) {
      setErrorMessage('Enter a quantity — Accepted, Rejected, or both.');
      return;
    }
    if (qtyNum + rejNum > op.qcPending) {
      setErrorMessage(
        `Accepted + Rejected (${qtyNum + rejNum}) cannot be more than QC Pending (${op.qcPending}).`,
      );
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
      onSubmitted?.();
      setRejectQty('');
      setRemarks('');
      setQcReportPath(null);
      setQcReportName(null);
    } catch (err) {
      setErrorMessage(
        err instanceof Error ? err.message : 'Could not save the inspection. Try again.',
      );
    }
  }

  async function handleStart(): Promise<void> {
    setErrorMessage(null);
    // Starting asks for when the work began and who is running it — date,
    // time, shift and operator. No quantity: nothing has been made yet.
    const chosenShift = requireMandatory({ qtyRequired: false, personLabel: 'Operator' });
    if (!chosenShift) return;
    if (isProcessOp && !actualMachineId) {
      setErrorMessage('Select the machine this operation will actually run on.');
      return;
    }
    if (busyUnknown) {
      setErrorMessage('Still checking whether the machine is free — one moment.');
      return;
    }
    if (busy) {
      setErrorMessage(
        `${actualMachine?.code ?? 'That machine'} is running ${busy.jobCardCode} Op ${fmtOpSrNo(busy.opSeq)} — pick another machine or stop that operation first.`,
      );
      return;
    }
    const input: StartOpInput = {
      jcOpId: op.id,
      ...(isProcessOp && actualMachineId ? { machineId: actualMachineId } : {}),
      startDate: logDate,
      startTime: entryTime,
      shift: chosenShift,
      ...(operatorId ? { operatorId } : {}),
      ...(operatorName.trim() ? { operatorName: operatorName.trim() } : {}),
      ...(remarks.trim() ? { remarks: remarks.trim() } : {}),
    };
    try {
      await start.mutateAsync(input);
      onSubmitted?.();
    } catch (err) {
      setErrorMessage(
        err instanceof Error ? err.message : 'Could not start the operation. Try again.',
      );
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
      setErrorMessage('Completed must be 0 or a whole number.');
      return;
    }
    const rejNum = Number(rejectQty || '0');
    if (!Number.isInteger(rejNum) || rejNum < 0) {
      setErrorMessage('Rejected must be 0 or a whole number.');
      return;
    }
    // Same cap as Log: rejected pieces consume available too (ADR-183).
    if (qtyNum + rejNum > op.available) {
      setErrorMessage(
        `Completed + Rejected (${qtyNum + rejNum}) cannot be more than Available (${op.available}).`,
      );
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
      onSubmitted?.();
    } catch (err) {
      setErrorMessage(
        err instanceof Error ? err.message : 'Could not stop the operation. Try again.',
      );
    }
  }

  // Production form submit dispatches on the same fact the form is showing
  // (legacy submitStartOp vs submitOpEntry): no session -> Enter starts the op,
  // a live session -> Enter logs a completion against it. Reading `mode` here
  // instead let a stale ?mode=start send a running op down the start path.
  async function handleProductionSubmit(e: React.FormEvent): Promise<void> {
    if (isStart) {
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
      setOspMsg({
        kind: 'err',
        text: err instanceof Error ? err.message : 'Failed to generate OSP PR',
      });
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

  // Success notice for a completion whose rejects raised an NC (ADR-183) —
  // same inline green as the OSP-PR result, with the NC code linked.
  const ncBanner = ncNotice ? (
    <div
      role="status"
      style={{
        display: 'flex',
        gap: 10,
        alignItems: 'center',
        marginTop: 12,
        padding: '8px 10px',
        borderRadius: 6,
        background: 'var(--green3)',
        border: '1px solid var(--green2)',
        color: 'var(--green)',
        fontSize: 12,
        fontWeight: 600,
      }}
    >
      <div style={{ flex: 1 }}>
        ✓ Saved —{' '}
        {ncNotice.ncs.map((nc, i) => (
          <span key={nc.id}>
            {i > 0 ? ', ' : ''}
            <Link
              to="/nc-register/$id"
              params={{ id: nc.id }}
              className="mono fw-700"
              onClick={() => onSubmitted?.()}
            >
              {nc.code}
            </Link>
          </span>
        ))}{' '}
        raised for <b className="mono">{ncNotice.rejected}</b> rejected pcs.
      </div>
      {onSubmitted ? (
        <button type="button" className="btn btn-sm" onClick={() => onSubmitted()}>
          Close
        </button>
      ) : null}
    </div>
  ) : null;

  // OSP outsource op (ADR-039): instead of a shop-floor log/start form, show
  // the auto-PR action. Once a PR/PO exists (outsource_status advanced past
  // pending) the op is managed from Purchase → Outsource Jobs.
  if (isOutsource) {
    const alreadyRaised = op.outsourceStatus != null && op.outsourceStatus !== 'pending';
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
            Op {opSrNo(op.opSeq)} · <span className="mono">{op.operation}</span>
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
              {op.outsourceStatus
                ? (statusLabel[op.outsourceStatus] ?? op.outsourceStatus)
                : 'Pending — no PR yet'}
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
                If this operation matches a configured OSP process, generate a JW purchase request
                (and a draft PO when the process has a vendor with auto-PO enabled).
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
              Op {opSrNo(op.opSeq)} · <span className="mono">{op.operation}</span> · QC pending:{' '}
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
                  Log Date<span className="req">★</span>
                </label>
                <input
                  id="opf-date"
                  className="innovic-input"
                  type="date"
                  max={maxLogDate}
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
                  Rejected
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
                  Inspected By<span className="req">★</span>
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
                style={
                  remarksExpanded ? { flexBasis: '100%' } : { flex: '1 1 180px', minWidth: 160 }
                }
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
                  Submit Inspection
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
  // WHICH HALF SHOWS IS A FACT ABOUT THE MACHINE, NOT A CHOICE.
  //
  // A live session means there is nothing to start; no session means there is
  // nothing to complete. The two are mutually exclusive, so the form reads the
  // session and neither the caller nor the URL can put it in the other state.
  //
  // It used to be `!canComplete || mode === 'start'`, and IN-JC-26-00017 Op 1
  // showed what that costs. The op was genuinely running -- 90 of 100 done, 10
  // left, session open since 11:43 -- and pressing the Start tab put the panel
  // into Start: the heading read "Start Operation", an amber box promised to
  // "mark this operation as Running on CNC-1" when it already was, and the only
  // button underneath was Stop. The screen contradicted itself. `?mode=start`
  // from a bookmark or the back button reached the same state without a click.
  const canComplete = Boolean(activeRunningId);
  const isStart = !canComplete;
  // The quantity boxes follow the buttons, not the tab. Stopping a session is
  // now a production entry in its own right, and the Stop button also appears
  // on the Start tab while a session is open — so wherever Stop can be pressed
  // the operator must have somewhere to type what the session made. Without
  // this, Start-tab Stop would demand a Qty the form never showed him.
  const showQtyFields = !isStart || Boolean(activeRunningId);
  const modeToggle = onModeChange ? (
    <div style={{ display: 'flex', gap: 4 }}>
      {/* Gated exactly the way ✓ Complete below always was. That asymmetry was
          the whole bug: Complete asked whether it was possible and Start never
          did, so a running operation was offered a Start it could not do. */}
      {canComplete ? null : (
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
      )}
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
              Op {opSrNo(op.opSeq)} · <span className="mono">{op.operation}</span>
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
                Log Date<span className="req">★</span>
              </label>
              <input
                id="opf-date"
                className="innovic-input"
                type="date"
                max={maxLogDate}
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
            {isStart && isProcessOp ? (
              <>
                {/* PLANNED — from JC creation, read-only. Start never rewrites
                    it; the machine the session actually runs on is chosen in
                    the two boxes beside it. */}
                <div className="form-grp" style={{ width: 110 }}>
                  <label className="form-label" htmlFor="opf-machine">
                    Planned Machine
                  </label>
                  <input
                    id="opf-machine"
                    className="innovic-input mono fw-700"
                    readOnly
                    value={plannedLabel}
                    title="Set at Job Card creation. Not changed by starting."
                  />
                </div>
                <div className="form-grp" style={{ width: 160 }}>
                  <label className="form-label" htmlFor="opf-mgrp">
                    Machine Group
                  </label>
                  <MachineGroupPicker
                    id="opf-mgrp"
                    valueId={actualGroupId}
                    valueText={
                      actualGroupId ? (machineGroupCodeById.get(actualGroupId) ?? null) : null
                    }
                    onChange={handleGroupChange}
                  />
                </div>
                <div className="form-grp" style={{ width: 170 }}>
                  <label className="form-label" htmlFor="opf-actual-machine">
                    Actual Machine<span className="req">★</span>
                  </label>
                  <SearchableSelect
                    id="opf-actual-machine"
                    value={actualMachineId}
                    onChange={handleMachineChange}
                    onSearch={setMachineSearch}
                    options={machineOptions}
                    placeholder={actualGroupId ? '🔍 Machine in group ★' : '🔍 Machine ★'}
                    valueLabel={actualLabel ?? undefined}
                    selectedLabel={(m) => m.code ?? m.name}
                  />
                </div>
              </>
            ) : (
              <>
                {/* Log / Stop: both machines, always, as two plain read-only
                    boxes the same height as their neighbours — no sub-line
                    under either, so the row stays level. Actual is the open
                    session's machine (the one the pieces get stamped with);
                    when the operator never changed it the two read the same. */}
                <div className="form-grp" style={{ width: 110 }}>
                  <label className="form-label" htmlFor="opf-machine">
                    Planned Machine
                  </label>
                  <input id="opf-machine" className="innovic-input" readOnly value={plannedLabel} />
                </div>
                <div className="form-grp" style={{ width: 110 }}>
                  <label className="form-label" htmlFor="opf-actual-machine-ro">
                    Actual Machine
                  </label>
                  <input
                    id="opf-actual-machine-ro"
                    className="innovic-input"
                    readOnly
                    value={op.activeRunningMachineCode ?? plannedLabel}
                  />
                </div>
              </>
            )}
            {showQtyFields ? (
              <>
                <div className="form-grp" style={{ width: 100 }}>
                  <label className="form-label" htmlFor="opf-qty">
                    Completed<span className="req">★</span>
                  </label>
                  {/* min is 0, not 1: a Stop that made nothing is a real and
                      required answer, and so is 0 completed with rejects
                      (ADR-183). handleSubmit refuses only 0 + 0.
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
                    Rejected
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
              {/* Shown only while the box still holds the name the seed put
                  there; the first keystroke hides it. */}
              {operatorIsSeeded ? (
                <div className="form-help">
                  ✓ auto-filled from Start — change if another operator finished
                </div>
              ) : null}
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

          {busy && busyDismissedFor !== actualMachineId ? (
            /* MACHINE BUSY (picked by hand) — the moment the operator chooses
               an Actual Machine that is running another job, this says so,
               right under the machine boxes, before the amber Start box. ✕
               closes it so they can get on with picking another machine; it
               does NOT free the machine — Start stays disabled while a busy
               machine is the chosen one. */
            <div
              role="alert"
              style={{
                display: 'flex',
                gap: 10,
                alignItems: 'flex-start',
                padding: '10px 12px',
                marginTop: 12,
                background: 'var(--bg3)',
                border: '1px solid var(--amber)',
                borderRadius: 8,
                fontSize: 12,
                lineHeight: 1.5,
              }}
            >
              <AlertTriangle size={18} className="amber" style={{ flex: 'none', marginTop: 2 }} />
              <div style={{ flex: 1 }}>
                <b className="mono">{actualLabel ?? 'This machine'}</b> is currently running{' '}
                <span className="mono fw-700 cyan">
                  {busy.jobCardCode} / Op {opSrNo(busy.opSeq)}
                </span>
                . Pick another machine, or complete / stop that operation first.
              </div>
              <button
                type="button"
                className="btn btn-sm"
                title="Open the running operation to Complete or Stop it"
                onClick={() => {
                  void navigate({
                    to: '/op-entry',
                    search: (prev) => ({
                      ...prev,
                      jc: busy.jobCardCode,
                      op: busy.jcOpId,
                      mode: 'complete',
                      view: undefined,
                    }),
                  });
                  onClose?.();
                }}
              >
                ✚ Open Current Operation
              </button>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                aria-label="Dismiss"
                title="Close this notice and pick another machine"
                onClick={() => setBusyDismissedFor(actualMachineId)}
                style={{ padding: '2px 6px' }}
              >
                ✕
              </button>
            </div>
          ) : null}

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
              <div
                style={{ fontSize: 13, fontWeight: 700, color: 'var(--amber)', marginBottom: 4 }}
              >
                ▶ Mark Operation as Running
              </div>
              <div style={{ fontSize: 11, color: 'var(--text2)' }}>
                This will mark{' '}
                <b className="mono">
                  {op.jobCardCode} Op{opSrNo(op.opSeq)}
                </b>{' '}
                as Running on <b>{isProcessOp ? (actualLabel ?? '—') : plannedLabel}</b>
                {isProcessOp && actualLabel && actualLabel !== plannedLabel ? (
                  <>
                    {' '}
                    <span className="amber">(planned {plannedLabel})</span>
                  </>
                ) : null}
                .
              </div>
              {/* The part. The sentence above names the job, the operation and
                  the machine, which is everything except WHAT is being made —
                  and a job card number does not carry the part in it, so an
                  operator could read that line back word for word and still be
                  about to run the wrong component. This panel is full width
                  inside the popup, so there is room for the name as well as the
                  code; it is still held to one line, with the whole of it on
                  hover, because a wrapped line here pushes the Start button
                  down and this is a screen people press quickly. */}
              {itemCodeLabel ? (
                <div
                  style={{
                    fontSize: 11,
                    color: 'var(--text2)',
                    marginTop: 4,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                  title={
                    (op.clientPoLineNo ? `POL ${op.clientPoLineNo} · ` : '') +
                    (op.itemName ? `${itemCodeLabel} — ${op.itemName}` : itemCodeLabel)
                  }
                >
                  {/* POL — the line number printed on the CUSTOMER's own
                      purchase order, ahead of the item code. Dropped when no
                      sales order sits behind the card. */}
                  {op.clientPoLineNo ? (
                    <>
                      POL{' '}
                      <b className="mono" style={{ color: 'var(--purple)' }}>
                        {op.clientPoLineNo}
                      </b>{' '}
                      ·{' '}
                    </>
                  ) : null}
                  Item:{' '}
                  <b className="mono" style={{ color: 'var(--purple)' }}>
                    {itemCodeLabel}
                  </b>
                  {op.itemName ? ` — ${op.itemName}` : ''}
                </div>
              ) : null}
              <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 4 }}>
                Available qty to process: <b style={{ color: 'var(--cyan)' }}>{op.available} pcs</b>
              </div>
            </div>
          ) : null}

          {busyUnknown ? (
            <div
              className="text3"
              style={{
                display: 'flex',
                gap: 8,
                alignItems: 'center',
                padding: 10,
                marginTop: 12,
                background: 'var(--bg3)',
                border: '1px solid var(--border)',
                borderRadius: 8,
                fontSize: 12,
              }}
            >
              <Loader2 className="h-4 w-4 animate-spin" />
              Checking whether <b className="mono">{actualLabel ?? 'this machine'}</b> is free…
            </div>
          ) : null}
          {ncBanner}
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
                    {stop.isPending ? 'Stopping…' : 'Stop Operation'}
                  </button>
                ) : (
                  <button
                    type="submit"
                    className="btn btn-primary"
                    style={{ background: 'var(--amber)', borderColor: 'var(--amber)' }}
                    disabled={
                      blockedReason !== null || start.isPending || Boolean(busy) || busyUnknown
                    }
                    title={
                      busy
                        ? `${actualLabel ?? 'The chosen machine'} is busy with ${busy.jobCardCode} Op ${fmtOpSrNo(busy.opSeq)} — pick another machine`
                        : undefined
                    }
                  >
                    {start.isPending ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Play size={14} />
                    )}
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
                    {submit.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}✓
                    Complete
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
                      {stop.isPending ? 'Stopping…' : 'Stop Operation'}
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="btn btn-ghost"
                      onClick={() => void handleStart()}
                      disabled={blockedReason !== null || start.isPending}
                    >
                      <Play size={14} />▶ Start Operation
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
              Pending on this op: <b style={{ color: 'var(--amber)' }}>{op.pendingQty}</b>
            </span>
          </div>
        </div>
      </div>
    </form>
  );
}
