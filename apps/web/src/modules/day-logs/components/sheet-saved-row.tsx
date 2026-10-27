// One SAVED row of the My Day Log sheet (owner "Option B", 2026-10-27), all
// on one line: # · Start · Stop · Time · SO / JWSO · Working on · action.
// A saved row is never removed. At the row end:
//   ✎                 — inline edit: Start, Stop, SO / JWSO and the Working on
//                       box, with "Send for approval" / Cancel under the box
//                       (same cell). The edit is
//                       NOT applied: it is staged until a Department Admin
//                       approves it (PATCH /day-logs/entries/:id).
//   ⏳                — instead of ✎ while an edit waits; the Working on cell
//                       shows "Waiting for approval → …" under the text.
//   Edit rejected: …  — orange, under the text; ✎ is offered again.
// The edit carries the updatedAt the row had when editing began (§20.4).

import type { DayLogEntry, DayLogOrder, UpdateDayLogEntryInput } from '@innovic/shared';
import { fmt12, fmtDuration, parseTime, updateDayLogEntryInputSchema } from '@innovic/shared';
import { useState } from 'react';
import { errText } from '../lib/format';
import { spanMinutes } from '../lib/sheet';
import { OrderSelect } from './order-select';
import { TimeField } from './time-field';
import { RowError, WorkBox, WorkText } from './work-line';

function EditRow({
  e,
  n,
  nowMin,
  busy,
  onUpdate,
  onCancel,
}: {
  e: DayLogEntry;
  n: number;
  nowMin: number | null;
  busy: boolean;
  onUpdate: (body: UpdateDayLogEntryInput) => Promise<unknown>;
  onCancel: () => void;
}): React.JSX.Element {
  const [start, setStart] = useState(fmt12(e.fromTime));
  const [stop, setStop] = useState(e.toTime ? fmt12(e.toTime) : '');
  const [desc, setDesc] = useState(e.description);
  const [order, setOrder] = useState<DayLogOrder | null>(e.order);
  const [loadedAt] = useState(e.updatedAt);
  const [err, setErr] = useState<string | null>(null);
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
      description: desc.trim(),
      startTime,
      stopTime,
      orderType: order?.type ?? null,
      orderId: order?.id ?? null,
      updatedAt: loadedAt,
    };
    const check = updateDayLogEntryInputSchema.safeParse(body);
    if (!check.success) return setErr(check.error.issues[0]?.message ?? 'Check the row.');
    try {
      await onUpdate(body);
    } catch (x) {
      setErr(errText(x));
    }
  }

  return (
    <div className="dl-cols dl-warn">
      <span className="dl-c dl-n">{n}</span>
      <div className="dl-field">
        <TimeField
          ariaLabel="Start time"
          value={start}
          onChange={setStart}
          nowMin={nowMin}
          disabled={busy}
          placeholder="Start *"
          fill
        />
      </div>
      <div className="dl-field">
        <TimeField
          ariaLabel="Stop time"
          value={stop}
          onChange={setStop}
          nowMin={nowMin}
          disabled={busy}
          placeholder="Stop *"
          fill
        />
      </div>
      <span className="dl-c dl-dur">{mins !== null ? fmtDuration(mins) : ''}</span>
      <div className="dl-field dl-sofield">
        <OrderSelect value={order} disabled={busy} onChange={setOrder} fill />
      </div>
      <WorkBox value={desc} onChange={setDesc} disabled={busy}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 6 }}>
          <button
            type="button"
            className="btn btn-primary btn-sm"
            disabled={busy}
            onClick={() => void send()}
          >
            {busy ? 'Sending…' : 'Send for approval'}
          </button>
          <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={onCancel}>
            Cancel
          </button>
        </div>
      </WorkBox>
      <span className="dl-c dl-act" />
      {err ? <RowError text={err} /> : null}
    </div>
  );
}

export function SheetSavedRow({
  e,
  n,
  nowMin,
  canEdit,
  editing,
  busy,
  onEdit,
  onCancelEdit,
  onUpdate,
}: {
  e: DayLogEntry;
  n: number;
  nowMin: number | null;
  /** The server lets the owner write this day (and it is not loading). */
  canEdit: boolean;
  editing: boolean;
  busy: boolean;
  onEdit: () => void;
  onCancelEdit: () => void;
  onUpdate: (body: UpdateDayLogEntryInput) => Promise<unknown>;
}): React.JSX.Element {
  if (editing && !e.pending) {
    return (
      <EditRow
        e={e}
        n={n}
        nowMin={nowMin}
        busy={busy}
        onUpdate={onUpdate}
        onCancel={onCancelEdit}
      />
    );
  }

  return (
    <div className="dl-cols">
      <span className="dl-c dl-n">{n}</span>
      <span className="dl-c dl-t">{fmt12(e.fromTime)}</span>
      <span className="dl-c dl-t">{fmt12(e.toTime)}</span>
      <span className="dl-c dl-dur">{fmtDuration(e.minutes)}</span>
      <span className="dl-c dl-so">{e.order?.code ?? '—'}</span>
      <WorkText e={e} />
      <span className="dl-c dl-act">
        {e.pending ? (
          <span
            className="fw-700"
            style={{ color: 'var(--amber2)' }}
            title="An edit of this row is waiting for approval"
            aria-label="Edit pending"
          >
            ⏳
          </span>
        ) : canEdit ? (
          <button
            type="button"
            className="btn btn-ghost btn-sm dl-icon"
            title="Edit — goes for approval"
            aria-label="Edit this row (goes for approval)"
            disabled={busy}
            onClick={onEdit}
          >
            ✎
          </button>
        ) : null}
      </span>
    </div>
  );
}
