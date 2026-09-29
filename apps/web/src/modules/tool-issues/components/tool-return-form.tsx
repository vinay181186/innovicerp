// Record a tool return (ADR-193 phase 4b). Bulk: Good / Consumed / Damaged /
// Lost; serial: a Return Condition per instrument still out. Damaged / Lost
// need a reason and become write-offs for the Store In-charge.
import {
  type InstrumentReturnCondition,
  TOOL_REASON_MIN,
  type ToolIssueDetail,
} from '@innovic/shared';
import { useState } from 'react';
import { todayIst } from '@/lib/date';
import { useRecordToolReturn, useReturnInstruments } from '../api';

const r3 = (v: number): number => Math.round(v * 1000) / 1000;

export function ReturnForm({
  t,
  onDone,
  onError,
}: {
  t: ToolIssueDetail;
  onDone: (msg: string) => void;
  onError: (m: string | null) => void;
}): React.JSX.Element {
  const [date, setDate] = useState(todayIst());
  const [reason, setReason] = useState('');
  const [bulk, setBulk] = useState({ good: '', damaged: '', lost: '', consumed: '' });
  const out = t.instruments.filter((i) => !i.returnedOn);
  const [cond, setCond] = useState<Record<string, InstrumentReturnCondition | ''>>({});
  const bulkMut = useRecordToolReturn();
  const serialMut = useReturnInstruments();
  const busy = bulkMut.isPending || serialMut.isPending;
  const serial = t.instruments.length > 0;

  const needsReason = serial
    ? Object.values(cond).some((c) => c === 'damaged' || c === 'lost')
    : Number(bulk.damaged || 0) + Number(bulk.lost || 0) > 0;

  const save = (): void => {
    onError(null);
    if (needsReason && reason.trim().length < TOOL_REASON_MIN)
      return onError(`Damaged or Lost needs a reason (at least ${TOOL_REASON_MIN} characters).`);
    const done = (): void =>
      onDone(
        needsReason
          ? 'Return saved — Damaged / Lost wait for the Store In-charge to approve the write-off.'
          : 'Return saved — stock updated.',
      );
    const fail = (e: Error): void => onError(e.message || 'Could not save the return.');
    if (serial) {
      const instruments = out
        .filter((i) => cond[i.instrumentId])
        .map((i) => ({
          instrumentId: i.instrumentId,
          condition: cond[i.instrumentId] as InstrumentReturnCondition,
        }));
      if (instruments.length === 0) return onError('Set a condition on at least one instrument.');
      serialMut.mutate(
        {
          id: t.id,
          returnDate: date,
          instruments,
          ...(reason.trim() ? { reason: reason.trim() } : {}),
        },
        { onSuccess: done, onError: fail },
      );
      return;
    }
    const n = (s: string): number => (s.trim() ? Number(s) : 0);
    const v = {
      goodQty: n(bulk.good),
      damagedQty: n(bulk.damaged),
      lostQty: n(bulk.lost),
      consumedQty: n(bulk.consumed),
    };
    if (Object.values(v).some((x) => !Number.isFinite(x) || x < 0))
      return onError('Quantities must be 0 or more.');
    const total = r3(v.goodQty + v.damagedQty + v.lostQty + v.consumedQty);
    if (total <= 0) return onError('Enter at least one of Good / Damaged / Lost / Consumed.');
    if (total > r3(t.stillOutQty))
      return onError(`Only ${r3(t.stillOutQty)} is still out — the split adds up to ${total}.`);
    bulkMut.mutate(
      { id: t.id, returnDate: date, ...v, ...(reason.trim() ? { reason: reason.trim() } : {}) },
      { onSuccess: done, onError: fail },
    );
  };

  return (
    <div style={{ marginTop: 12 }}>
      <div className="form-grid">
        <div className="form-grp">
          <label className="form-label">Return Date ★</label>
          <input
            type="date"
            className="innovic-input"
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
        </div>
      </div>
      {serial ? (
        <table className="innovic-table tbl-grid" style={{ marginTop: 8 }}>
          <thead>
            <tr>
              <th>Instrument Serial No.</th>
              <th>Return Condition</th>
            </tr>
          </thead>
          <tbody>
            {out.map((i) => (
              <tr key={i.instrumentId}>
                <td className="mono fw-700" style={{ color: 'var(--text)' }}>
                  {i.serialNo}
                </td>
                <td>
                  <select
                    className="innovic-select"
                    value={cond[i.instrumentId] ?? ''}
                    onChange={(e) =>
                      setCond((s) => ({
                        ...s,
                        [i.instrumentId]: e.target.value as InstrumentReturnCondition | '',
                      }))
                    }
                  >
                    <option value="">— still out —</option>
                    <option value="good">Good</option>
                    <option value="damaged">Damaged</option>
                    <option value="lost">Lost</option>
                  </select>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <div className="form-grid" style={{ marginTop: 8 }}>
          {(
            [
              ['good', 'Good (back to stock)'],
              ['consumed', 'Consumed (worn out)'],
              ['damaged', 'Damaged'],
              ['lost', 'Lost'],
            ] as const
          ).map(([k, label]) => (
            <div className="form-grp" key={k}>
              <label className="form-label">{label}</label>
              <input
                type="number"
                min={0}
                step="any"
                className="innovic-input mono"
                value={bulk[k]}
                onChange={(e) => setBulk((b) => ({ ...b, [k]: e.target.value }))}
                onWheel={(e) => e.currentTarget.blur()}
              />
            </div>
          ))}
        </div>
      )}
      <div className="form-grp form-full" style={{ marginTop: 8 }}>
        <label className="form-label">Reason {needsReason ? '★' : ''}</label>
        <input
          type="text"
          className="innovic-input"
          placeholder="Needed for Damaged / Lost, e.g. dropped, anvil chipped"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        />
      </div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 8 }}>
        <button type="button" className="btn btn-primary" disabled={busy} onClick={save}>
          {busy ? 'Saving…' : 'Save Return'}
        </button>
      </div>
    </div>
  );
}
