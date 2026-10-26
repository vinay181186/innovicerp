// My Day Log's ONE entry form (design approved 2026-10-26): Type Work /
// Break · Working on (Break name for a break) · Against SO / JWSO (work
// only, type-to-search) · Start time · Stop time (empty = the entry stays
// Open) · Remark · Save. While editing: "Update entry" + "Cancel edit".
// The input is checked with the shared schema (the same rules the server
// applies); overlap, break limit and "not after now" are the server's.

import type { DayLogDetail, DayLogEntry, DayLogEntryKind, DayLogOrder } from '@innovic/shared';
import {
  addDayLogEntryInputSchema,
  DAY_LOG_RULES,
  hhmmToMin,
  minToHhmm,
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
import { errText, parseHhmm } from '../lib/format';
import { TimeField } from './time-field';

/** Where the next entry starts: the day's last stop (or 09:00), never after now. */
export function nextStart(day: DayLogDetail, nowMin: number | null): string {
  const t = day.summary.lastStop ?? DAY_LOG_RULES.workFrom;
  return nowMin !== null && hhmmToMin(t) > nowMin ? minToHhmm(nowMin) : t;
}

const KINDS: { kind: DayLogEntryKind; label: string }[] = [
  { kind: 'work', label: 'Work' },
  { kind: 'break', label: 'Break' },
];

export function EntryForm({
  day,
  q,
  nowMin,
  editing,
  onDone,
}: {
  day: DayLogDetail;
  q: DayQuery;
  /** Today: the live server minute; null on another day. */
  nowMin: number | null;
  /** The entry being edited, or null for a new one. */
  editing: DayLogEntry | null;
  /** Edit saved or cancelled. */
  onDone: () => void;
}): React.JSX.Element {
  const saveKey = useSaveKey();
  const add = useAddDayLogEntry(q, saveKey);
  const update = useUpdateDayLogEntry(q);
  const [kind, setKind] = useState<DayLogEntryKind>(editing?.kind ?? 'work');
  const [desc, setDesc] = useState(editing?.description ?? '');
  const [order, setOrder] = useState<DayLogOrder | null>(editing?.order ?? null);
  const [start, setStart] = useState(editing?.fromTime ?? nextStart(day, nowMin));
  const [stop, setStop] = useState(editing?.toTime ?? '');
  const [remarks, setRemarks] = useState(editing?.remarks ?? '');
  // §20.4: the edit carries the updatedAt the entry had when editing began.
  const [loadedAt] = useState(editing?.updatedAt ?? '');
  const [orderSearch, setOrderSearch] = useState('');
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const orders = useDayLogOrderOptions(orderSearch, kind === 'work');
  const busy = add.isPending || update.isPending;
  const isBreak = kind === 'break';

  const options = (orders.data ?? []).map((o) => ({
    id: o.id,
    code: o.code,
    name: [o.ref, o.party].filter(Boolean).join(' · ') || (o.type === 'so' ? 'SO' : 'JWSO'),
  }));

  async function save(): Promise<void> {
    if (busy) return;
    setMsg(null);
    const startT = parseHhmm(start);
    const stopT = stop.trim() === '' ? null : parseHhmm(stop);
    if (!startT) return setMsg({ ok: false, text: 'Start time: type it as 930 or 09:30.' });
    if (stop.trim() !== '' && !stopT)
      return setMsg({ ok: false, text: 'Stop time: type it as 1130 or 11:30, or leave it empty.' });
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
      const fresh = await add.mutateAsync({ ...body, date: day.date });
      setKind('work');
      setDesc('');
      setOrder(null);
      setStop('');
      setRemarks('');
      setStart(nextStart(fresh, nowMin));
      setMsg({
        ok: true,
        text: stopT ? `Saved ${startT} – ${stopT}.` : `Saved — open since ${startT}.`,
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
        <div>
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
                  disabled={busy}
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
        <div>
          <label className="form-label" htmlFor="dl-start">
            Start time <span className="req">*</span>
          </label>
          <TimeField
            id="dl-start"
            ariaLabel="Start time"
            value={start}
            onChange={setStart}
            nowMin={nowMin}
            disabled={busy}
            placeholder={DAY_LOG_RULES.workFrom}
          />
        </div>
        <div>
          <label className="form-label" htmlFor="dl-stop">
            Stop time
          </label>
          <TimeField
            id="dl-stop"
            ariaLabel="Stop time"
            value={stop}
            onChange={setStop}
            nowMin={nowMin}
            disabled={busy}
            placeholder="empty = open"
          />
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
          disabled={busy}
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
