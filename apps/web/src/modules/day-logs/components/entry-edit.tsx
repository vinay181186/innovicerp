// The two edits of a SAVED My Day Log entry, drawn inside its ▸ area (ADR-255):
//   EditWorkForm  — ⋯ "Edit Working on": the Working On box + Save / Cancel.
//                   A DIRECT save (PATCH /day-logs/entries/:id/work), no
//                   approval and no mark of any kind on the row. Save is off
//                   while the box is empty or unchanged.
//   EditTimesForm — ⋯ "Edit times / SO": Start, Stop, SO / JWSO with Save /
//                   Cancel. A DIRECT save too (ADR-256, PATCH
//                   /day-logs/entries/:id) — no approval; a Super Admin sees
//                   every change on Team Day Logs. Working On is shown
//                   read-only; the current text is sent (the server ignores it
//                   there).
// Both carry the updatedAt the entry had when the edit opened (§20.4).

import type { DayLogEntry, DayLogOrder, UpdateDayLogEntryInput } from '@innovic/shared';
import { fmt12, fmtDuration, parseTime, updateDayLogEntryInputSchema } from '@innovic/shared';
import { useState } from 'react';
import { useSaveKey } from '@/lib/use-save-key';
import { useUpdateDayLogEntry, useUpdateDayLogWork, type DayQuery } from '../api';
import { errText } from '../lib/format';
import { spanMinutes } from '../lib/sheet';
import { OrderSelect } from './order-select';
import { TimeField } from './time-field';
import { RowError, WorkBox } from './work-line';

function Buttons({
  label,
  busyLabel,
  busy,
  off,
  onSave,
  onCancel,
}: {
  label: string;
  busyLabel: string;
  busy: boolean;
  off: boolean;
  onSave: () => void;
  onCancel: () => void;
}): React.JSX.Element {
  return (
    <div className="dl-btns">
      <button
        type="button"
        className="btn btn-primary btn-sm"
        disabled={busy || off}
        onClick={onSave}
      >
        {busy ? busyLabel : label}
      </button>
      <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={onCancel}>
        Cancel
      </button>
    </div>
  );
}

export function EditWorkForm({
  e,
  q,
  onDone,
}: {
  e: DayLogEntry;
  q: DayQuery;
  onDone: () => void;
}): React.JSX.Element {
  const saveKey = useSaveKey();
  const save = useUpdateDayLogWork(q, saveKey);
  const [desc, setDesc] = useState(e.description);
  const [loadedAt] = useState(e.updatedAt);
  const [err, setErr] = useState<string | null>(null);
  const text = desc.trim();
  const off = !text || text === e.description.trim();

  async function send(): Promise<void> {
    if (save.isPending || off) return;
    setErr(null);
    try {
      await save.mutateAsync({ id: e.id, description: text, updatedAt: loadedAt });
      onDone();
    } catch (x) {
      setErr(errText(x));
    }
  }

  return (
    <div>
      <span className="dl-xl">Working On</span>
      <WorkBox value={desc} onChange={setDesc} disabled={save.isPending}>
        <Buttons
          label="Save"
          busyLabel="Saving…"
          busy={save.isPending}
          off={off}
          onSave={() => void send()}
          onCancel={onDone}
        />
      </WorkBox>
      {err ? <RowError text={err} /> : null}
    </div>
  );
}

export function EditTimesForm({
  e,
  q,
  nowMin,
  onSent,
  onCancel,
}: {
  e: DayLogEntry;
  q: DayQuery;
  nowMin: number | null;
  onSent: () => void;
  onCancel: () => void;
}): React.JSX.Element {
  const update = useUpdateDayLogEntry(q);
  const [start, setStart] = useState(fmt12(e.fromTime));
  const [stop, setStop] = useState(e.toTime ? fmt12(e.toTime) : '');
  const [order, setOrder] = useState<DayLogOrder | null>(e.order);
  const [loadedAt] = useState(e.updatedAt);
  const [err, setErr] = useState<string | null>(null);
  const busy = update.isPending;
  const mins = spanMinutes(start, stop);

  async function send(): Promise<void> {
    if (busy) return;
    setErr(null);
    const startTime = parseTime(start);
    const stopTime = parseTime(stop);
    if (!startTime) return setErr('Start time is compulsory — type 930 or pick it.');
    if (!stopTime) return setErr('Stop time is compulsory — type 1030 or pick it.');
    const body: UpdateDayLogEntryInput = {
      kind: 'work',
      // ADR-255: ignored by the server here — Working On is never edited in this flow.
      description: e.description,
      startTime,
      stopTime,
      orderType: order?.type ?? null,
      orderId: order?.id ?? null,
      updatedAt: loadedAt,
    };
    const check = updateDayLogEntryInputSchema.safeParse(body);
    if (!check.success) return setErr(check.error.issues[0]?.message ?? 'Check the row.');
    try {
      await update.mutateAsync({ id: e.id, ...body });
      onSent();
    } catch (x) {
      setErr(errText(x));
    }
  }

  return (
    <div>
      <div className="dl-times">
        <label className="dl-fl">
          <span className="dl-xl">Start Time</span>
          <TimeField
            ariaLabel="Start Time"
            value={start}
            onChange={setStart}
            nowMin={nowMin}
            disabled={busy}
            placeholder="Start *"
          />
        </label>
        <label className="dl-fl">
          <span className="dl-xl">Stop Time</span>
          <TimeField
            ariaLabel="Stop Time"
            value={stop}
            onChange={setStop}
            nowMin={nowMin}
            disabled={busy}
            placeholder="Stop *"
          />
        </label>
        <span className="dl-fl">
          <span className="dl-xl">Working Hours</span>
          <span className="mono dl-hrs">{mins !== null ? fmtDuration(mins) : '—'}</span>
        </span>
        <div className="dl-fl">
          <span className="dl-xl">SO / JWSO</span>
          <OrderSelect value={order} disabled={busy} onChange={setOrder} />
        </div>
      </div>
      <span className="dl-xl">Working On</span>
      <div className="dl-full text3">{e.description}</div>
      <Buttons
        label="Save"
        busyLabel="Saving…"
        busy={busy}
        off={false}
        onSave={() => void send()}
        onCancel={onCancel}
      />
      {err ? <RowError text={err} /> : null}
    </div>
  );
}
