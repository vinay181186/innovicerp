// S1 timer bar — "What are you starting now?" + Linked Task + ▶ Start, or,
// while a timer runs, the blue "Started HH:MM · elapsed" bar with ■ Stop.
//
// The server decides where the entry starts. When there is unlogged time
// before now it refuses the start; the bar then offers the two answers from
// the approved design: start back at nextFrom so the gap becomes this work
// (includeGap: true), or log the gap by hand first.

import type { DayLogDetail, DayLogWorkStatus } from '@innovic/shared';
import { fmtDuration, hhmmToMin } from '@innovic/shared';
import { useState } from 'react';
import { ApiError } from '@/lib/api';
import { useSaveKey } from '@/lib/use-save-key';
import { Banner } from '@/ui/feedback';
import { useStartDayLogTimer, useStopDayLogTimer, type DayQuery } from '../api';
import { errText, taskCode } from '../lib/format';
import { StatusPickDialog } from './day-dialogs';
import { TaskPicker } from './task-picker';

export interface TimerDraft {
  description: string;
  taskId: string | null;
  taskLabel: string | null;
}

export function TimerBar({
  day,
  q,
  nowMin,
  draft,
  onDraft,
  onLogByHand,
  onStopped,
}: {
  day: DayLogDetail;
  q: DayQuery;
  nowMin: number;
  draft: TimerDraft;
  onDraft: (d: TimerDraft) => void;
  /** "Log it by hand first": focus the hand form with To = now. */
  onLogByHand: () => void;
  /** After a stop: the status picked and the stopped entry's task. */
  onStopped: (status: DayLogWorkStatus, taskId: string | null, taskLabel: string | null) => void;
}): React.JSX.Element {
  const saveKey = useSaveKey();
  const start = useStartDayLogTimer(q, saveKey);
  const stop = useStopDayLogTimer(q);
  const [gapMsg, setGapMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [asking, setAsking] = useState(false);
  const running = day.entries.find((e) => e.kind === 'work' && !e.toTime) ?? null;

  async function doStart(includeGap: boolean): Promise<void> {
    setErr(null);
    try {
      await start.mutateAsync({
        description: draft.description.trim(),
        taskId: draft.taskId,
        includeGap,
      });
      setGapMsg(null);
    } catch (e) {
      const gapCode = e instanceof ApiError && /gap/i.test(e.code);
      const unlogged = hhmmToMin(day.summary.nextFrom) < nowMin;
      if (!includeGap && (gapCode || (e instanceof ApiError && e.status < 500 && unlogged))) {
        setGapMsg(errText(e));
      } else {
        setErr(errText(e));
      }
    }
  }

  async function doStop(status: DayLogWorkStatus): Promise<void> {
    setErr(null);
    try {
      await stop.mutateAsync({ status });
      setAsking(false);
      onStopped(status, running?.taskId ?? null, running?.taskLabel ?? null);
    } catch (e) {
      setErr(errText(e));
    }
  }

  if (running) {
    const elapsed = Math.max(0, nowMin - hhmmToMin(running.fromTime));
    return (
      <>
        <div
          className="panel"
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            alignItems: 'center',
            gap: 12,
            padding: '10px 14px',
            marginBottom: 10,
            border: '1px solid var(--blue)',
            boxShadow: '0 0 0 3px var(--blue3)',
          }}
        >
          <span style={{ flex: '1 1 260px', fontWeight: 600 }}>
            {running.description}{' '}
            {running.taskLabel ? (
              <span className="mono fw-700" title={running.taskLabel}>
                {taskCode(running.taskLabel)}
              </span>
            ) : null}
          </span>
          <span className="badge b-blue">Running</span>
          <span className="text3" style={{ fontSize: 'var(--fs-xs)' }}>
            Started <b className="mono">{running.fromTime}</b>
          </span>
          <span className="mono fw-700" style={{ fontSize: 20 }}>
            {fmtDuration(elapsed)}
          </span>
          <button
            type="button"
            className="btn btn-danger"
            disabled={stop.isPending}
            onClick={() => setAsking(true)}
          >
            ■ Stop
          </button>
        </div>
        {err ? (
          <Banner tone="error" role="alert">
            {err}
          </Banner>
        ) : null}
        {asking ? (
          <StatusPickDialog
            title="Stop the timer — what is the Work Status?"
            busy={stop.isPending}
            error={null}
            cancelLabel="Keep running"
            onPick={(s) => void doStop(s)}
            onClose={() => setAsking(false)}
          />
        ) : null}
      </>
    );
  }

  const canStart = draft.description.trim().length > 0 && !start.isPending;
  return (
    <>
      <div
        className="panel"
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          gap: 10,
          padding: '10px 14px',
          marginBottom: 10,
        }}
      >
        <input
          className="innovic-input"
          aria-label="What are you starting now?"
          placeholder="What are you starting now?"
          maxLength={500}
          value={draft.description}
          onChange={(e) => onDraft({ ...draft, description: e.target.value })}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && canStart) void doStart(false);
          }}
          style={{ flex: '1 1 320px' }}
        />
        <div style={{ width: 220 }}>
          <TaskPicker
            value={draft.taskId}
            valueLabel={draft.taskLabel}
            onChange={(taskId, taskLabel) => onDraft({ ...draft, taskId, taskLabel })}
          />
        </div>
        <button
          type="button"
          className="btn btn-primary"
          disabled={!canStart}
          onClick={() => void doStart(false)}
        >
          {start.isPending ? 'Starting…' : '▶ Start'}
        </button>
      </div>
      {gapMsg ? (
        <Banner tone="warn" role="alert" title={gapMsg} onDismiss={() => setGapMsg(null)}>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 6 }}>
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => {
                setGapMsg(null);
                onLogByHand();
              }}
            >
              Log it by hand first
            </button>
            <button
              type="button"
              className="btn btn-primary"
              disabled={start.isPending}
              onClick={() => void doStart(true)}
            >
              Start from {day.summary.nextFrom} (this work)
            </button>
          </div>
        </Banner>
      ) : null}
      {err ? (
        <Banner tone="error" role="alert">
          {err}
        </Banner>
      ) : null}
    </>
  );
}
