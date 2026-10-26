// "Add time by hand" — for time the timer did not catch. From is fixed at the
// server's nextFrom (read-only); To, Work done, Linked Task and Work Status
// are the user's. The server checks the entry (order, breaks, future time)
// and its message is shown here as it comes.

import type { DayLogDetail, DayLogWorkStatus } from '@innovic/shared';
import { DAY_LOG_WORK_STATUSES, DAY_LOG_WORK_STATUS_LABELS } from '@innovic/shared';
import { forwardRef, useState } from 'react';
import { useSaveKey } from '@/lib/use-save-key';
import { useAddDayLogEntry, type DayQuery } from '../api';
import { errText } from '../lib/format';
import { TaskPicker } from './task-picker';

export const HandEntryForm = forwardRef<
  HTMLInputElement,
  {
    day: DayLogDetail;
    q: DayQuery;
    toTime: string;
    onToTime: (v: string) => void;
    onSaved: (status: DayLogWorkStatus, taskId: string | null, taskLabel: string | null) => void;
  }
>(function HandEntryForm({ day, q, toTime, onToTime, onSaved }, toRef) {
  const saveKey = useSaveKey();
  const add = useAddDayLogEntry(q, saveKey);
  const [description, setDescription] = useState('');
  const [taskId, setTaskId] = useState<string | null>(null);
  const [taskLabel, setTaskLabel] = useState<string | null>(null);
  const [status, setStatus] = useState<DayLogWorkStatus>('completed');
  const [err, setErr] = useState<string | null>(null);
  const ok = /^\d{2}:\d{2}$/.test(toTime) && description.trim().length > 0 && !add.isPending;

  async function save(): Promise<void> {
    setErr(null);
    try {
      await add.mutateAsync({
        date: day.date,
        toTime,
        description: description.trim(),
        taskId,
        status,
      });
      onSaved(status, taskId, taskLabel);
      setDescription('');
      setTaskId(null);
      setTaskLabel(null);
      setStatus('completed');
    } catch (e) {
      setErr(errText(e));
    }
  }

  return (
    <div
      style={{
        borderTop: '1px solid var(--border)',
        background: 'var(--bg3)',
        padding: '12px 14px',
      }}
    >
      <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 8 }}>
        Add time by hand{' '}
        <span className="text3" style={{ fontWeight: 400, fontSize: 'var(--fs-xs)' }}>
          From is fixed at <b className="mono">{day.summary.nextFrom}</b> — where your last entry or
          break ended.
        </span>
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-end', gap: 10 }}>
        <div>
          <label className="form-label" htmlFor="dl-from">
            From
          </label>
          <input
            id="dl-from"
            className="innovic-input mono"
            readOnly
            value={day.summary.nextFrom}
            style={{ width: '9ch', minWidth: 80 }}
          />
        </div>
        <div>
          <label className="form-label" htmlFor="dl-to">
            To <span className="req">*</span>
          </label>
          <input
            id="dl-to"
            ref={toRef}
            type="time"
            className="innovic-input mono"
            value={toTime}
            onChange={(e) => onToTime(e.target.value)}
            style={{ width: '12ch', minWidth: 110 }}
          />
        </div>
        <div style={{ flex: '1 1 260px' }}>
          <label className="form-label" htmlFor="dl-work">
            Work done <span className="req">*</span>
          </label>
          <input
            id="dl-work"
            className="innovic-input"
            maxLength={500}
            placeholder="What did you do in this time?"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </div>
        <div style={{ width: 220 }}>
          <label className="form-label" htmlFor="dl-task">
            Linked Task
          </label>
          <TaskPicker
            id="dl-task"
            value={taskId}
            valueLabel={taskLabel}
            onChange={(id, label) => {
              setTaskId(id);
              setTaskLabel(label);
            }}
          />
        </div>
        <div>
          <label className="form-label" htmlFor="dl-status">
            Work Status <span className="req">*</span>
          </label>
          <select
            id="dl-status"
            className="innovic-select"
            value={status}
            onChange={(e) => setStatus(e.target.value as DayLogWorkStatus)}
          >
            {DAY_LOG_WORK_STATUSES.map((s) => (
              <option key={s} value={s}>
                {DAY_LOG_WORK_STATUS_LABELS[s]}
              </option>
            ))}
          </select>
        </div>
        <button
          type="button"
          className="btn btn-primary"
          disabled={!ok}
          onClick={() => void save()}
        >
          {add.isPending ? 'Saving…' : 'Add entry'}
        </button>
      </div>
      {err ? (
        <p role="alert" style={{ color: 'var(--red2)', margin: '8px 0 0', fontSize: 13 }}>
          {err}
        </p>
      ) : null}
    </div>
  );
});
