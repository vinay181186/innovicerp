// The four actions on one instrument (ADR-193 phase 4a): Send for Calibration,
// Record Calibration, Scrap (→ a pending write-off) and Edit. Each is a small
// form shown inside the detail modal; Save calls the hook and hands back.
import { INSTRUMENT_REASON_MIN, type InstrumentDetail } from '@innovic/shared';
import { Loader2 } from 'lucide-react';
import { useState } from 'react';
import { todayIst } from '@/lib/date';
import {
  useRecordCalibration,
  useMarkMissingInstrument,
  useScrapInstrument,
  useSendForCalibration,
  useUpdateInstrument,
} from '../api';
import { errText } from '../lib/instrument-ui';

export type InstrumentAction = 'send' | 'record' | 'scrap' | 'missing' | 'edit';

interface Props {
  ins: InstrumentDetail;
  mode: InstrumentAction;
  onBack: () => void;
  onDone: (msg: string) => void;
}

function Field(props: {
  label: string;
  id: string;
  full?: boolean;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <div className={props.full ? 'form-grp form-full' : 'form-grp'}>
      <label className="form-label" htmlFor={props.id}>
        {props.label}
      </label>
      {props.children}
    </div>
  );
}

export function InstrumentActionForm({ ins, mode, onBack, onDone }: Props): React.JSX.Element {
  const today = todayIst();
  const [date, setDate] = useState(today);
  const [agency, setAgency] = useState('');
  const [result, setResult] = useState<'pass' | 'fail'>('pass');
  const [certificateNo, setCertificateNo] = useState('');
  const [nextDueOn, setNextDueOn] = useState('');
  const [reason, setReason] = useState('');
  const [intervalDays, setIntervalDays] = useState(
    ins.calibrationIntervalDays !== null ? String(ins.calibrationIntervalDays) : '',
  );
  const [location, setLocation] = useState(ins.location ?? '');
  const [serialNo, setSerialNo] = useState(ins.serialNo);
  const [remarks, setRemarks] = useState(ins.remarks ?? '');
  const [err, setErr] = useState<string | null>(null);

  const send = useSendForCalibration();
  const record = useRecordCalibration();
  const scrap = useScrapInstrument();
  const missing = useMarkMissingInstrument();
  const update = useUpdateInstrument();
  const busy =
    send.isPending || record.isPending || scrap.isPending || missing.isPending || update.isPending;
  const fail = (e: unknown): void => setErr(errText(e, 'Could not save. Try again.'));

  const save = (): void => {
    setErr(null);
    if (mode === 'send') {
      if (!date) return setErr('Enter the date it was sent.');
      if (!agency.trim()) return setErr('Enter the calibration agency.');
      send.mutate(
        { id: ins.id, sentOn: date, agency: agency.trim() },
        { onSuccess: () => onDone('Sent for calibration.'), onError: fail },
      );
    } else if (mode === 'record') {
      if (!date) return setErr('Enter the calibration date.');
      record.mutate(
        {
          id: ins.id,
          calibratedOn: date,
          result,
          ...(certificateNo.trim() ? { certificateNo: certificateNo.trim() } : {}),
          ...(agency.trim() ? { agency: agency.trim() } : {}),
          ...(nextDueOn && result === 'pass' ? { nextDueOn } : {}),
          ...(remarks.trim() && remarks.trim() !== (ins.remarks ?? '')
            ? { remarks: remarks.trim() }
            : {}),
        },
        { onSuccess: () => onDone('Calibration recorded.'), onError: fail },
      );
    } else if (mode === 'scrap' || mode === 'missing') {
      if (reason.trim().length < INSTRUMENT_REASON_MIN)
        return setErr(`Give a reason (at least ${INSTRUMENT_REASON_MIN} characters).`);
      (mode === 'missing' ? missing : scrap).mutate(
        { id: ins.id, reason: reason.trim() },
        {
          onSuccess: () =>
            onDone(
              mode === 'missing'
                ? 'Marked missing — Lost write-off sent for approval.'
                : 'Scrap sent for approval — Write-off pending.',
            ),
          onError: fail,
        },
      );
    } else {
      let days: number | null = null;
      if (intervalDays.trim()) {
        days = Number(intervalDays);
        if (!Number.isInteger(days) || days <= 0 || days > 3650)
          return setErr('Calibration Interval (days) must be a whole number from 1 to 3650.');
      }
      update.mutate(
        {
          id: ins.id,
          calibrationIntervalDays: days,
          ...(serialNo.trim() && serialNo.trim() !== ins.serialNo
            ? { serialNo: serialNo.trim() }
            : {}),
          location: location.trim() || null,
          remarks: remarks.trim() || null,
        },
        { onSuccess: () => onDone('Saved.'), onError: fail },
      );
    }
  };

  const title =
    mode === 'send'
      ? 'Send for Calibration'
      : mode === 'record'
        ? 'Record Calibration'
        : mode === 'scrap'
          ? 'Scrap'
          : mode === 'missing'
            ? 'Mark Missing'
            : 'Edit';

  return (
    <div className="panel" style={{ marginTop: 12 }}>
      <div className="panel-body">
        <div className="fw-700" style={{ fontSize: 12, marginBottom: 8 }}>
          {title}
        </div>
        <div className="form-grid">
          {mode === 'send' || mode === 'record' ? (
            <Field label={mode === 'send' ? 'Sent On ★' : 'Calibrated On ★'} id="ia-date">
              <input
                id="ia-date"
                type="date"
                className="innovic-input"
                max={today}
                value={date}
                onChange={(e) => setDate(e.target.value)}
              />
            </Field>
          ) : null}
          {mode === 'send' || mode === 'record' ? (
            <Field label={mode === 'send' ? 'Agency ★' : 'Agency'} id="ia-agency">
              <input
                id="ia-agency"
                className="innovic-input"
                maxLength={120}
                placeholder="Calibration agency / lab"
                value={agency}
                onChange={(e) => setAgency(e.target.value)}
              />
            </Field>
          ) : null}
          {mode === 'record' ? (
            <>
              <Field label="Result ★" id="ia-result">
                <select
                  id="ia-result"
                  className="innovic-select"
                  value={result}
                  onChange={(e) => setResult(e.target.value as 'pass' | 'fail')}
                >
                  <option value="pass">Pass</option>
                  <option value="fail">Fail</option>
                </select>
              </Field>
              <Field label="Certificate No." id="ia-cert">
                <input
                  id="ia-cert"
                  className="innovic-input mono"
                  maxLength={80}
                  value={certificateNo}
                  onChange={(e) => setCertificateNo(e.target.value)}
                />
              </Field>
              {result === 'pass' ? (
                <Field label="Next Due" id="ia-next">
                  <input
                    id="ia-next"
                    type="date"
                    className="innovic-input"
                    value={nextDueOn}
                    onChange={(e) => setNextDueOn(e.target.value)}
                  />
                </Field>
              ) : null}
              <div className="form-grp form-full text3" style={{ fontSize: 11 }}>
                {result === 'pass'
                  ? 'Next Due blank = Calibrated On + Calibration Interval (days).'
                  : 'Fail keeps it blocked from issue until a Pass or Scrap.'}
              </div>
            </>
          ) : null}
          {mode === 'scrap' || mode === 'missing' ? (
            <Field label="Reason ★" id="ia-reason" full>
              <input
                id="ia-reason"
                className="innovic-input"
                maxLength={500}
                placeholder={
                  mode === 'missing'
                    ? 'e.g. not found on the rack at the stock count'
                    : 'e.g. anvil face damaged, cannot be recalibrated'
                }
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              />
              <div className="text3" style={{ fontSize: 11, marginTop: 4 }}>
                This does not {mode === 'missing' ? 'mark it Lost' : 'scrap it'} yet: it goes for
                approval to the Store In-charge (not the person who recorded it). Until then it
                shows Write-off pending and cannot be issued or sent for calibration. On approval it
                leaves stock.
              </div>
            </Field>
          ) : null}
          {mode === 'edit' ? (
            <>
              <Field label="Instrument Serial No." id="ia-serial">
                <input
                  id="ia-serial"
                  className="innovic-input mono"
                  maxLength={80}
                  value={serialNo}
                  onChange={(e) => setSerialNo(e.target.value)}
                  title="Correct a mistyped serial — only while it was never issued"
                />
              </Field>
              <Field label="Calibration Interval (days)" id="ia-int">
                <input
                  id="ia-int"
                  type="number"
                  min={1}
                  max={3650}
                  step={1}
                  className="innovic-input mono"
                  placeholder="blank = not calibrated"
                  value={intervalDays}
                  onWheel={(e) => e.currentTarget.blur()}
                  onChange={(e) => setIntervalDays(e.target.value)}
                />
              </Field>
              <Field label="Location" id="ia-loc">
                <input
                  id="ia-loc"
                  className="innovic-input"
                  maxLength={100}
                  value={location}
                  onChange={(e) => setLocation(e.target.value)}
                />
              </Field>
            </>
          ) : null}
          {mode === 'edit' || mode === 'record' ? (
            <Field label="Remarks" id="ia-rem" full>
              <input
                id="ia-rem"
                className="innovic-input"
                maxLength={500}
                value={remarks}
                onChange={(e) => setRemarks(e.target.value)}
              />
            </Field>
          ) : null}
        </div>
        {err ? (
          <div role="alert" style={{ color: 'var(--red2)', fontSize: 12, marginTop: 8 }}>
            {err}
          </div>
        ) : null}
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 10 }}>
          <button type="button" className="btn btn-ghost" onClick={onBack}>
            Back
          </button>
          <button type="button" className="btn btn-primary" disabled={busy} onClick={save}>
            {busy ? (
              <>
                <Loader2 size={14} className="inline animate-spin" /> Saving…
              </>
            ) : mode === 'scrap' || mode === 'missing' ? (
              'Send for Approval'
            ) : (
              'Save'
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
