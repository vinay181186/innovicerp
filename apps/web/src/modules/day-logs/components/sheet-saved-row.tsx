// One SAVED row of the My Day Log sheet (owner final 2026-10-27). A saved
// row is never removed. Read view = the shared EntryCells, then:
//   ✎                 — inline edit: Start, Stop, SO / JWSO and the Working on
//                       box, with "Send for approval" / Cancel. The edit is
//                       NOT applied: it is staged until a Department Admin
//                       approves it (PATCH /day-logs/entries/:id).
//   ⏳ Edit pending    — instead of ✎ while an edit waits; the Working on line
//                       shows "Waiting for approval → …".
//   Edit rejected: …  — orange, under Working on; ✎ is offered again.
// The edit carries the updatedAt the row had when editing began (§20.4).

import type { DayLogEntry, DayLogOrder, UpdateDayLogEntryInput } from '@innovic/shared';
import { fmt12, fmtDuration, parseTime, updateDayLogEntryInputSchema } from '@innovic/shared';
import { useState } from 'react';
import { errText } from '../lib/format';
import { spanMinutes } from '../lib/sheet';
import { EntryCells, PendingTag, SHEET_COLS } from './entries-table';
import { OrderSelect } from './order-select';
import { TimeField } from './time-field';
import { NO_GAP, RowError, WorkEditLine, WorkLine } from './work-line';

const EDIT_TINT: React.CSSProperties = { background: 'var(--amber3)' };

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
    <>
      <tr style={{ ...EDIT_TINT, ...NO_GAP }}>
        <td className="mono">{n}</td>
        <td>
          <TimeField
            ariaLabel="Start time"
            value={start}
            onChange={setStart}
            nowMin={nowMin}
            disabled={busy}
            placeholder="Start *"
          />
        </td>
        <td>
          <TimeField
            ariaLabel="Stop time"
            value={stop}
            onChange={setStop}
            nowMin={nowMin}
            disabled={busy}
            placeholder="Stop *"
          />
        </td>
        <td>
          <OrderSelect value={order} disabled={busy} onChange={setOrder} />
        </td>
        <td className="td-num mono">{mins !== null ? fmtDuration(mins) : ''}</td>
        <td>
          <div style={{ display: 'inline-flex', gap: 4 }}>
            <button
              type="button"
              className="btn btn-primary btn-sm"
              disabled={busy}
              onClick={() => void send()}
            >
              {busy ? 'Sending…' : 'Send for approval'}
            </button>
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              disabled={busy}
              onClick={onCancel}
            >
              Cancel
            </button>
          </div>
        </td>
      </tr>
      <WorkEditLine
        value={desc}
        onChange={setDesc}
        disabled={busy}
        span={SHEET_COLS - 1}
        tint={EDIT_TINT}
        placeholder="Working on *"
      >
        {err ? <RowError text={err} /> : null}
      </WorkEditLine>
    </>
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
    <>
      <tr style={NO_GAP}>
        <EntryCells e={e} n={n} />
        <td>
          {e.pending ? (
            <PendingTag e={e} />
          ) : canEdit ? (
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              title="Edit — goes for approval"
              aria-label="Edit this row (goes for approval)"
              disabled={busy}
              onClick={onEdit}
            >
              ✎
            </button>
          ) : null}
        </td>
      </tr>
      <WorkLine e={e} span={SHEET_COLS - 1} />
    </>
  );
}
