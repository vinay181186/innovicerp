// The ONE box of My Day Log (owner 2026-10-26): one input, one way — the
// timer. Nothing is typed by hand any more and nothing is linked to a task.
//
//   Idle    → "What are you working on? [text] [▶ Start]" (Enter = Start),
//             with "Starts at HH:MM — where your last entry ended" under it.
//   Running → a strong bar "● <work> since HH:MM 1h 05m [■ Stop]", and the
//             same text box beside it as "Switch to:" — starting new work
//             closes the running one at now (the server does it).
//   Stop    → an inline panel: Finished at [HH:MM] Status [Completed ▾]
//             [Save] [Cancel]. Finished at defaults to now; left as it is,
//             no end time is sent and the server uses its own now.
//
// The server always starts at nextFrom (no gap is possible) and its message
// is shown under the box as it comes.

import type { DayLogDetail, DayLogWorkStatus } from '@innovic/shared';
import {
  DAY_LOG_WORK_STATUSES,
  DAY_LOG_WORK_STATUS_LABELS,
  fmtDuration,
  hhmmToMin,
} from '@innovic/shared';
import { useState } from 'react';
import { useSaveKey } from '@/lib/use-save-key';
import { useStartDayLogTimer, useStopDayLogTimer, type DayQuery } from '../api';
import { errText, parseHhmm } from '../lib/format';
import { TimeField } from './time-field';

interface StopDraft {
  /** The "now" the panel opened with — unchanged means "send no endTime". */
  openedAt: string;
  at: string;
  status: DayLogWorkStatus;
}

export function WorkBox({
  day,
  q,
  nowMin,
  nowHhmm,
  text,
  onText,
  inputRef,
}: {
  day: DayLogDetail;
  q: DayQuery;
  /** Live server clock (minutes) — the running elapsed figure. */
  nowMin: number;
  /** Same clock as "HH:MM" — the Finished at default. */
  nowHhmm: string;
  text: string;
  onText: (v: string) => void;
  inputRef?: React.Ref<HTMLInputElement> | undefined;
}): React.JSX.Element {
  const saveKey = useSaveKey();
  const start = useStartDayLogTimer(q, saveKey);
  const stop = useStopDayLogTimer(q);
  const [err, setErr] = useState<string | null>(null);
  const [stopping, setStopping] = useState<StopDraft | null>(null);
  const running = day.entries.find((e) => e.kind === 'work' && !e.toTime) ?? null;
  const busy = start.isPending || stop.isPending;
  const canStart = text.trim().length > 0 && !busy;
  const stopAt = stopping ? parseHhmm(stopping.at) : null;

  async function doStart(): Promise<void> {
    if (!canStart) return;
    setErr(null);
    try {
      await start.mutateAsync({ description: text.trim() });
      onText('');
      setStopping(null);
    } catch (e) {
      setErr(errText(e));
    }
  }

  async function doStop(): Promise<void> {
    if (!stopping || !stopAt || busy) return;
    setErr(null);
    try {
      await stop.mutateAsync({
        status: stopping.status,
        ...(stopAt !== stopping.openedAt ? { endTime: stopAt } : {}),
      });
      setStopping(null);
    } catch (e) {
      setErr(errText(e));
    }
  }

  const input = (
    <input
      ref={inputRef}
      className="innovic-input"
      aria-label={running ? 'Switch to' : 'What are you working on?'}
      placeholder={running ? 'Next work…' : 'What are you working on?'}
      maxLength={500}
      value={text}
      disabled={busy}
      onChange={(e) => onText(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') void doStart();
      }}
      style={{ flex: '1 1 320px' }}
    />
  );
  const startBtn = (
    <button
      type="button"
      className="btn btn-primary"
      disabled={!canStart}
      onClick={() => void doStart()}
    >
      {start.isPending ? 'Starting…' : '▶ Start'}
    </button>
  );
  const rowStyle: React.CSSProperties = {
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 10,
  };

  return (
    <div className="panel" style={{ padding: '10px 14px', marginBottom: 10 }}>
      {running ? (
        <div
          style={{
            ...rowStyle,
            gap: 12,
            padding: '8px 12px',
            marginBottom: 10,
            borderRadius: 'var(--radius-sm)',
            border: '1px solid var(--blue)',
            background: 'var(--blue3)',
          }}
        >
          <span style={{ color: 'var(--blue)', fontSize: 16 }} aria-hidden>
            ●
          </span>
          <span
            className="fw-700"
            title={running.description}
            style={{
              flex: '1 1 240px',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {running.description}
          </span>
          <span className="text3" style={{ fontSize: 'var(--fs-xs)' }}>
            since <b className="mono">{running.fromTime}</b>
          </span>
          <span className="mono fw-700" style={{ fontSize: 20 }}>
            {fmtDuration(Math.max(0, nowMin - hhmmToMin(running.fromTime)))}
          </span>
          <button
            type="button"
            className="btn btn-danger"
            disabled={busy || stopping !== null}
            onClick={() => {
              setErr(null);
              setStopping({ openedAt: nowHhmm, at: nowHhmm, status: 'completed' });
            }}
          >
            ■ Stop
          </button>
        </div>
      ) : null}

      {running && stopping ? (
        <div style={{ ...rowStyle, marginBottom: 10 }} aria-label="Stop the timer">
          <label className="form-label" htmlFor="dl-stop-at" style={{ margin: 0 }}>
            Finished at
          </label>
          <TimeField
            id="dl-stop-at"
            value={stopping.at}
            disabled={busy}
            onChange={(v) => setStopping({ ...stopping, at: v })}
            onEnter={() => void doStop()}
          />
          <label className="form-label" htmlFor="dl-stop-status" style={{ margin: 0 }}>
            Status
          </label>
          <select
            id="dl-stop-status"
            className="innovic-select"
            value={stopping.status}
            disabled={busy}
            onChange={(e) =>
              setStopping({ ...stopping, status: e.target.value as DayLogWorkStatus })
            }
          >
            {DAY_LOG_WORK_STATUSES.map((s) => (
              <option key={s} value={s}>
                {DAY_LOG_WORK_STATUS_LABELS[s]}
              </option>
            ))}
          </select>
          <button
            type="button"
            className="btn btn-primary"
            disabled={!stopAt || busy}
            onClick={() => void doStop()}
          >
            {stop.isPending ? 'Saving…' : 'Save'}
          </button>
          <button
            type="button"
            className="btn btn-ghost"
            disabled={busy}
            onClick={() => setStopping(null)}
          >
            Cancel
          </button>
        </div>
      ) : null}

      <div style={rowStyle}>
        {running ? (
          <span className="form-label" style={{ margin: 0 }}>
            Switch to:
          </span>
        ) : null}
        {input}
        {startBtn}
      </div>
      <div className="text3" style={{ fontSize: 'var(--fs-xs)', marginTop: 6 }}>
        {running
          ? 'Starting new work stops the running one now (Completed).'
          : `Starts at ${day.summary.nextFrom} — where your last entry ended`}
      </div>
      {err ? (
        <p role="alert" style={{ color: 'var(--red2)', margin: '6px 0 0', fontSize: 13 }}>
          {err}
        </p>
      ) : null}
    </div>
  );
}
