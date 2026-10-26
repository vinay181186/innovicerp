// Company holidays (a holiday is not a working day — nothing is required).
// Shown only to whoever GET /day-logs/access says may manage them.

import { useState } from 'react';
import { fmtDate } from '@/lib/date';
import { Modal } from '@/ui/feedback';
import { useAddHoliday, useHolidays, useRemoveHoliday } from '../api';
import { errText } from '../lib/format';

export function HolidaysModal({ onClose }: { onClose: () => void }): React.JSX.Element {
  const q = useHolidays();
  const add = useAddHoliday();
  const remove = useRemoveHoliday();
  const [date, setDate] = useState('');
  const [name, setName] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const busy = add.isPending || remove.isPending;

  async function run(p: Promise<unknown>): Promise<boolean> {
    setErr(null);
    try {
      await p;
      return true;
    } catch (e) {
      setErr(errText(e));
      return false;
    }
  }

  return (
    <Modal
      title="Holidays"
      size="md"
      onClose={onClose}
      footer={
        <button type="button" className="btn btn-ghost" onClick={onClose}>
          Close
        </button>
      }
    >
      {q.isLoading ? <div className="empty-state">Loading…</div> : null}
      <div className="tbl-wrap" style={{ maxHeight: 320 }}>
        <table className="innovic-table">
          <thead>
            <tr>
              <th>Holiday Date</th>
              <th>Holiday</th>
              <th aria-label="Remove" />
            </tr>
          </thead>
          <tbody>
            {(q.data?.holidays ?? []).map((h) => (
              <tr key={h.id}>
                <td className="mono">{fmtDate(h.date)}</td>
                <td title={h.name}>{h.name}</td>
                <td>
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    disabled={busy}
                    onClick={() => void run(remove.mutateAsync(h.id))}
                  >
                    Remove
                  </button>
                </td>
              </tr>
            ))}
            {q.data && q.data.holidays.length === 0 ? (
              <tr>
                <td colSpan={3} className="empty-state">
                  No holidays set.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'flex-end',
          gap: 10,
          marginTop: 10,
        }}
      >
        <div>
          <label className="form-label" htmlFor="hol-date">
            Holiday Date <span className="req">*</span>
          </label>
          <input
            id="hol-date"
            type="date"
            className="innovic-input mono"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            style={{ width: '16ch', minWidth: 140 }}
          />
        </div>
        <div style={{ flex: '1 1 200px' }}>
          <label className="form-label" htmlFor="hol-name">
            Holiday <span className="req">*</span>
          </label>
          <input
            id="hol-name"
            className="innovic-input"
            maxLength={100}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </div>
        <button
          type="button"
          className="btn btn-primary"
          disabled={busy || !date || name.trim() === ''}
          onClick={() => {
            void run(add.mutateAsync({ date, name: name.trim() })).then((ok) => {
              if (ok) {
                setDate('');
                setName('');
              }
            });
          }}
        >
          {add.isPending ? 'Adding…' : '+ Add'}
        </button>
      </div>
      {err ? (
        <p role="alert" style={{ color: 'var(--red2)', margin: '8px 0 0', fontSize: 13 }}>
          {err}
        </p>
      ) : null}
    </Modal>
  );
}
