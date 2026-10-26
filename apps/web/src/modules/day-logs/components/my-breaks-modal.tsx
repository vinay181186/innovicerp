// "My Break Time" — the user's own breaks (name, From, To). They fill the
// day by themselves and never count as missing time. The list is edited here
// and saved whole (PUT /day-logs/my-breaks); the server checks the limit and
// the overlaps and its reason is shown as it comes.

import type { UserBreakTime } from '@innovic/shared';
import { fmtDuration, hhmmToMin } from '@innovic/shared';
import { useEffect, useState } from 'react';
import { Modal } from '@/ui/feedback';
import { useMyBreaks, useSaveMyBreaks } from '../api';
import { errText } from '../lib/format';

const MAX_BREAKS = 6;

export function MyBreaksModal({ onClose }: { onClose: () => void }): React.JSX.Element {
  const q = useMyBreaks();
  const save = useSaveMyBreaks();
  const [rows, setRows] = useState<UserBreakTime[] | null>(null);
  const [name, setName] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (q.data && rows === null) setRows(q.data.breaks);
  }, [q.data, rows]);

  const list = rows ?? [];
  const total = list.reduce(
    (n, b) => n + Math.max(0, hhmmToMin(b.toTime) - hhmmToMin(b.fromTime)),
    0,
  );
  const canAdd =
    name.trim() !== '' &&
    /^\d{2}:\d{2}$/.test(from) &&
    /^\d{2}:\d{2}$/.test(to) &&
    list.length < MAX_BREAKS;

  async function doSave(): Promise<void> {
    setErr(null);
    setSaved(false);
    try {
      const res = await save.mutateAsync({ breaks: list });
      setRows(res.breaks);
      setSaved(true);
    } catch (e) {
      setErr(errText(e));
    }
  }

  return (
    <Modal
      title="My Break Time"
      size="md"
      onClose={onClose}
      closeOnOverlayClick={false}
      footer={
        <>
          <button
            type="button"
            className="btn btn-ghost"
            onClick={onClose}
            disabled={save.isPending}
          >
            Close
          </button>
          <button
            type="button"
            className="btn btn-primary"
            disabled={save.isPending || rows === null}
            onClick={() => void doSave()}
          >
            {save.isPending ? 'Saving…' : 'Save'}
          </button>
        </>
      }
    >
      <p className="text3" style={{ margin: '0 0 8px', fontSize: 13 }}>
        Your own breaks. They fill your day by themselves and do not count as missing time.
        {q.data ? ` Up to ${fmtDuration(q.data.breakLimitMin)} in total.` : ''}
      </p>
      {q.isLoading ? <div className="empty-state">Loading…</div> : null}
      {q.isError ? (
        <p role="alert" style={{ color: 'var(--red2)' }}>
          {errText(q.error)}
        </p>
      ) : null}
      <div className="tbl-wrap">
        <table className="innovic-table">
          <thead>
            <tr>
              <th>Break</th>
              <th>From</th>
              <th>To</th>
              <th className="th-num">Time</th>
              <th aria-label="Remove" />
            </tr>
          </thead>
          <tbody>
            {list.map((b, i) => (
              <tr key={`${b.fromTime}-${i}`}>
                <td className="fw-700">{b.name}</td>
                <td className="mono">{b.fromTime}</td>
                <td className="mono">{b.toTime}</td>
                <td className="td-num mono">
                  {fmtDuration(hhmmToMin(b.toTime) - hhmmToMin(b.fromTime))}
                </td>
                <td>
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    onClick={() => setRows(list.filter((_, j) => j !== i))}
                  >
                    Remove
                  </button>
                </td>
              </tr>
            ))}
            {list.length > 0 ? (
              <tr>
                <td colSpan={3} className="fw-700">
                  Total
                </td>
                <td className="td-num mono fw-700">{fmtDuration(total)}</td>
                <td />
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
          <label className="form-label" htmlFor="br-name">
            Break name <span className="req">*</span>
          </label>
          <input
            id="br-name"
            className="innovic-input"
            maxLength={60}
            value={name}
            onChange={(e) => setName(e.target.value)}
            style={{ width: '20ch' }}
          />
        </div>
        <div>
          <label className="form-label" htmlFor="br-from">
            From <span className="req">*</span>
          </label>
          <input
            id="br-from"
            type="time"
            className="innovic-input mono"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            style={{ width: '12ch', minWidth: 110 }}
          />
        </div>
        <div>
          <label className="form-label" htmlFor="br-to">
            To <span className="req">*</span>
          </label>
          <input
            id="br-to"
            type="time"
            className="innovic-input mono"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            style={{ width: '12ch', minWidth: 110 }}
          />
        </div>
        <button
          type="button"
          className="btn btn-ghost"
          disabled={!canAdd}
          onClick={() => {
            setRows(
              [...list, { name: name.trim(), fromTime: from, toTime: to }].sort(
                (a, b) => hhmmToMin(a.fromTime) - hhmmToMin(b.fromTime),
              ),
            );
            setName('');
            setFrom('');
            setTo('');
            setSaved(false);
          }}
        >
          + Add break
        </button>
      </div>
      {err ? (
        <p role="alert" style={{ color: 'var(--red2)', margin: '8px 0 0', fontSize: 13 }}>
          {err}
        </p>
      ) : null}
      {saved ? (
        <p role="status" style={{ color: 'var(--green2)', margin: '8px 0 0', fontSize: 13 }}>
          Breaks saved.
        </p>
      ) : null}
    </Modal>
  );
}
