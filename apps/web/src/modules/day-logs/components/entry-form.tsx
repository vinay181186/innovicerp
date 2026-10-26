// My Day Log's ONE entry form (design approved 2026-10-26): Type Work /
// Break · Working on (Break name for a break) · Against SO / JWSO (work
// only, type-to-search) · Start time · Stop time (empty = the entry stays
// Open) · Remark · Save. While editing: "Update entry" + "Cancel edit".
// The input is checked with the shared schema (the same rules the server
// applies); overlap, break limit and "not after now" are the server's.
//
// STRICT ORDER (owner 2026-10-26): Start is never typed — a new entry starts
// at the server's `summary.nextStart` (09:00 AM on a new day), shown locked;
// while an entry is Open there is no next start, so the form says "Stop …
// first" and Save is off. Only the LAST entry (latest start) may change its
// Stop time or Type; an earlier entry shows its times locked and may change
// Working on / SO / Remark only. Times show as "09:00 AM" (fmt12) and go to
// the API as 24-hour "HH:MM" (parseTime).

import type { DayLogDetail, DayLogEntry, DayLogEntryKind, DayLogOrder } from '@innovic/shared';
import {
  addDayLogEntryInputSchema,
  fmt12,
  parseTime,
  updateDayLogEntryInputSchema,
} from '@innovic/shared';
import { useState } from 'react';
import { SearchableSelect } from '@/components/shared/searchable-select';
import { useSaveKey } from '@/lib/use-save-key';
import {
  useAddDayLogEntry,
  useDayLogOrderOptions,
  useUpdateDayLogEntry,
  type DayQuery,
} from '../api';
import { errText } from '../lib/format';
import { LockedTime, TimeField } from './time-field';

const KINDS: { kind: DayLogEntryKind; label: string }[] = [
  { kind: 'work', label: 'Work' },
  { kind: 'break', label: 'Break' },
];

export function EntryForm({
  day,
  q,
  nowMin,
  editing,
  isLast,
  onDone,
}: {
  day: DayLogDetail;
  q: DayQuery;
  /** Today: the live server minute; null on another day. */
  nowMin: number | null;
  /** The entry being edited, or null for a new one. */
  editing: DayLogEntry | null;
  /** The entry being edited is the day's last (latest start) — its times may change. */
  isLast: boolean;
  /** Edit saved or cancelled. */
  onDone: () => void;
}): React.JSX.Element {
  const saveKey = useSaveKey();
  const add = useAddDayLogEntry(q, saveKey);
  const update = useUpdateDayLogEntry(q);
  const [kind, setKind] = useState<DayLogEntryKind>(editing?.kind ?? 'work');
  const [desc, setDesc] = useState(editing?.description ?? '');
  const [order, setOrder] = useState<DayLogOrder | null>(editing?.order ?? null);
  const [stop, setStop] = useState(editing?.toTime ? fmt12(editing.toTime) : '');
  const [remarks, setRemarks] = useState(editing?.remarks ?? '');
  // §20.4: the edit carries the updatedAt the entry had when editing began.
  const [loadedAt] = useState(editing?.updatedAt ?? '');
  const [orderSearch, setOrderSearch] = useState('');
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const orders = useDayLogOrderOptions(orderSearch, kind === 'work');
  const busy = add.isPending || update.isPending;
  const isBreak = kind === 'break';
  // Start: the edited entry's own, else where the server says the next one starts.
  const start = editing ? editing.fromTime : day.summary.nextStart;
  /** An earlier entry: times and Type locked. */
  const timesLocked = editing !== null && !isLast;
  const openEntry = editing ? null : day.entries.find((e) => !e.toTime);
  const blocked = start === null;

  const options = (orders.data ?? []).map((o) => ({
    id: o.id,
    code: o.code,
    name: [o.ref, o.party].filter(Boolean).join(' · ') || (o.type === 'so' ? 'SO' : 'JWSO'),
  }));

  async function save(): Promise<void> {
    if (busy) return;
    setMsg(null);
    const startT = start;
    if (!startT) return;
    const stopT = timesLocked
      ? (editing?.toTime ?? null)
      : stop.trim() === ''
        ? null
        : parseTime(stop);
    if (!timesLocked && stop.trim() !== '' && !stopT)
      return setMsg({
        ok: false,
        text: 'Stop time: type it as 1130, 3pm or 3:15 pm, or leave it empty.',
      });
    const body = {
      kind,
      description: desc.trim(),
      startTime: startT,
      stopTime: stopT,
      orderType: isBreak ? null : (order?.type ?? null),
      orderId: isBreak ? null : (order?.id ?? null),
      remarks: remarks.trim() || null,
    };
    const check = editing
      ? updateDayLogEntryInputSchema.safeParse({ ...body, updatedAt: loadedAt })
      : addDayLogEntryInputSchema.safeParse({ ...body, date: day.date });
    if (!check.success) {
      return setMsg({ ok: false, text: check.error.issues[0]?.message ?? 'Check the entry.' });
    }
    try {
      if (editing) {
        await update.mutateAsync({ id: editing.id, ...body, updatedAt: loadedAt });
        onDone();
        return;
      }
      await add.mutateAsync({ ...body, date: day.date });
      setKind('work');
      setDesc('');
      setOrder(null);
      setStop('');
      setRemarks('');
      setMsg({
        ok: true,
        text: stopT
          ? `Saved ${fmt12(startT)} – ${fmt12(stopT)}.`
          : `Saved — open since ${fmt12(startT)}.`,
      });
    } catch (e) {
      setMsg({ ok: false, text: errText(e) });
    }
  }

  // overflow visible: the time picker drops below its field — no clipping.
  return (
    <div
      className="panel"
      aria-label="Entry"
      style={{ padding: '10px 14px', marginBottom: 10, overflow: 'visible' }}
    >
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-end', gap: 10 }}>
        <div style={{ display: 'grid', gap: 3 }}>
          <span className="form-label">Type</span>
          <div role="group" aria-label="Type" style={{ display: 'inline-flex' }}>
            {KINDS.map((k, i) => {
              const on = kind === k.kind;
              return (
                <button
                  key={k.kind}
                  type="button"
                  className={`btn${on ? ' btn-primary' : ' btn-ghost'}`}
                  aria-pressed={on}
                  disabled={busy || timesLocked}
                  title={timesLocked ? 'Only the last entry may change its Type' : undefined}
                  onClick={() => {
                    setKind(k.kind);
                    if (k.kind === 'break') setOrder(null);
                  }}
                  style={{
                    minWidth: 64,
                    borderRadius:
                      i === 0
                        ? 'var(--radius) 0 0 var(--radius)'
                        : '0 var(--radius) var(--radius) 0',
                  }}
                >
                  {k.label}
                </button>
              );
            })}
          </div>
        </div>
        <div style={{ flex: '2 1 240px' }}>
          <label className="form-label" htmlFor="dl-desc">
            {isBreak ? 'Break name' : 'Working on'}
            {isBreak ? null : <span className="req"> *</span>}
          </label>
          <input
            id="dl-desc"
            className="innovic-input"
            maxLength={500}
            placeholder={isBreak ? 'Lunch, Tea, Prayer…' : 'What did you work on?'}
            value={desc}
            disabled={busy}
            onChange={(e) => setDesc(e.target.value)}
          />
        </div>
        {isBreak ? null : (
          <div style={{ flex: '1.6 1 220px' }}>
            <label className="form-label" htmlFor="dl-order">
              Against SO / JWSO
            </label>
            <SearchableSelect
              id="dl-order"
              value={order?.id ?? null}
              valueLabel={order?.code}
              selectedLabel={(o) => o.code ?? o.name}
              options={options}
              onSearch={setOrderSearch}
              loading={orders.isFetching}
              error={orders.error}
              placeholder="Type SO / JWSO no. or customer"
              disabled={busy}
              clearable
              onChange={(id) => {
                const o = orders.data?.find((x) => x.id === id);
                setOrder(o ? { type: o.type, id: o.id, code: o.code } : null);
              }}
            />
          </div>
        )}
        <div style={{ display: 'grid', gap: 3 }}>
          <label className="form-label" htmlFor="dl-start">
            Start time <span className="req">*</span>
          </label>
          <LockedTime
            id="dl-start"
            ariaLabel="Start time"
            value={start}
            title="Start is where the previous entry stopped (09:00 AM for the first)"
          />
        </div>
        <div style={{ display: 'grid', gap: 3 }}>
          <label className="form-label" htmlFor="dl-stop">
            Stop time
          </label>
          {timesLocked ? (
            <LockedTime
              id="dl-stop"
              ariaLabel="Stop time"
              value={editing?.toTime ?? null}
              title="Only the last entry may change its times"
            />
          ) : (
            <TimeField
              id="dl-stop"
              ariaLabel="Stop time"
              value={stop}
              onChange={setStop}
              nowMin={nowMin}
              disabled={busy}
              placeholder="open"
            />
          )}
        </div>
      </div>
      <div style={{ marginTop: 8 }}>
        <label className="form-label" htmlFor="dl-remarks">
          Remark
        </label>
        <textarea
          id="dl-remarks"
          className="innovic-textarea"
          rows={2}
          maxLength={2000}
          placeholder="What was done, what is pending, who was contacted"
          value={remarks}
          disabled={busy}
          onChange={(e) => setRemarks(e.target.value)}
        />
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8 }}>
        <button
          type="button"
          className="btn btn-primary"
          disabled={busy || blocked}
          onClick={() => void save()}
          style={{ minWidth: 110 }}
        >
          {busy ? 'Saving…' : editing ? 'Update entry' : 'Save'}
        </button>
        {editing ? (
          <button type="button" className="btn btn-ghost" disabled={busy} onClick={onDone}>
            Cancel edit
          </button>
        ) : null}
        {blocked ? (
          <span role="status" style={{ fontSize: 13, color: 'var(--text2)' }}>
            Stop {openEntry?.description || 'the open entry'} first
          </span>
        ) : null}
        {msg ? (
          <span
            role={msg.ok ? undefined : 'alert'}
            style={{ fontSize: 13, color: msg.ok ? 'var(--green2)' : 'var(--red2)' }}
          >
            {msg.text}
          </span>
        ) : null}
      </div>
    </div>
  );
}
