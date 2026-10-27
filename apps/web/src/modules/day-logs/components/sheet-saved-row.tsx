// One SAVED row of the My Day Log sheet. Read view = the shared EntryCells
// plus actions: ■ Stop (Open row, today) · ✎ · 🗑 (last row only).
//   ■ Stop — a Break, or an entry that already has a remark, stops at once;
//            a Work / Others entry without one opens an inline "Remark *"
//            line with Save stop / Cancel (the remark is compulsory).
//   ✎      — inline edit: Working on (Reason for Others), SO / JWSO (Work
//            only), Remark; Stop only on the day's LAST row (lastEntryId) and
//            only when it is closed — or Open on an earlier day (the
//            stray-open fix). Update / Cancel. Start is never edited.
// The edit carries the updatedAt the row had when editing began (§20.4).

import type { DayLogEntry, DayLogOrder, UpdateDayLogEntryInput } from '@innovic/shared';
import {
  fmt12,
  fmtDuration,
  minToHhmm,
  parseTime,
  updateDayLogEntryInputSchema,
} from '@innovic/shared';
import { useState } from 'react';
import { errText } from '../lib/format';
import { entryTint, entryTypeText } from '../lib/sheet';
import { EntryCells } from './entries-table';
import { OrderSelect } from './order-select';
import { ReasonSelect } from './sheet-draft-row';
import { TimeField } from './time-field';

const EDIT_TINT: React.CSSProperties = { background: 'var(--amber3)' };

function ErrorLine({ text, tint }: { text: string; tint: React.CSSProperties }): React.JSX.Element {
  return (
    <tr style={tint}>
      <td />
      <td colSpan={8} role="alert" className="td-left" style={{ color: 'var(--red2)' }}>
        {text}
      </td>
    </tr>
  );
}

function EditRow({
  e,
  n,
  stopEditable,
  nowMin,
  busy,
  onUpdate,
  onCancel,
}: {
  e: DayLogEntry;
  n: number;
  stopEditable: boolean;
  nowMin: number | null;
  busy: boolean;
  onUpdate: (body: UpdateDayLogEntryInput) => Promise<unknown>;
  onCancel: () => void;
}): React.JSX.Element {
  const isOthers = e.kind === 'leave';
  const [desc, setDesc] = useState(e.description);
  const [order, setOrder] = useState<DayLogOrder | null>(e.order);
  const [remarks, setRemarks] = useState(e.remarks ?? '');
  const [stop, setStop] = useState(e.toTime ? fmt12(e.toTime) : '');
  const [loadedAt] = useState(e.updatedAt);
  const [err, setErr] = useState<string | null>(null);

  async function save(): Promise<void> {
    if (busy) return;
    setErr(null);
    const stopT = stopEditable ? (stop.trim() ? parseTime(stop) : null) : e.toTime;
    if (stopEditable && stop.trim() && !stopT)
      return setErr('Stop time: type it as 1130, 3pm or 03:15 PM.');
    const body: UpdateDayLogEntryInput = {
      kind: e.kind,
      description: desc.trim(),
      startTime: e.fromTime,
      stopTime: stopT,
      orderType: e.kind === 'work' ? (order?.type ?? null) : null,
      orderId: e.kind === 'work' ? (order?.id ?? null) : null,
      remarks: remarks.trim() || null,
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
      <tr style={EDIT_TINT}>
        <td className="mono">{n}</td>
        <td>{e.kind === 'break' ? <i>{entryTypeText(e)}</i> : entryTypeText(e)}</td>
        <td className="mono">{fmt12(e.fromTime)}</td>
        <td>
          {stopEditable ? (
            <TimeField
              ariaLabel="Stop time"
              value={stop}
              onChange={setStop}
              nowMin={isOthers ? null : nowMin}
              disabled={busy}
              placeholder="Stop"
            />
          ) : (
            <span className="mono">{e.toTime ? fmt12(e.toTime) : '● open'}</span>
          )}
        </td>
        <td>
          {isOthers ? (
            <ReasonSelect value={desc} disabled={busy} onChange={setDesc} />
          ) : (
            <input
              className="innovic-input"
              aria-label={e.kind === 'break' ? 'Break name' : 'Working on'}
              maxLength={500}
              value={desc}
              disabled={busy}
              onChange={(x) => setDesc(x.target.value)}
              style={{ minWidth: 180 }}
            />
          )}
        </td>
        <td>
          {e.kind === 'work' ? (
            <OrderSelect value={order} disabled={busy} onChange={setOrder} />
          ) : (
            <span className="text3">—</span>
          )}
        </td>
        <td>
          <input
            className="innovic-input"
            aria-label="Remark"
            maxLength={2000}
            placeholder={e.kind === 'break' ? 'Remark' : 'Remark *'}
            value={remarks}
            disabled={busy}
            onChange={(x) => setRemarks(x.target.value)}
            style={{ minWidth: 180 }}
          />
        </td>
        <td className="td-num mono">{fmtDuration(e.minutes)}</td>
        <td>
          <div style={{ display: 'inline-flex', gap: 4 }}>
            <button
              type="button"
              className="btn btn-primary btn-sm"
              disabled={busy}
              onClick={() => void save()}
            >
              {busy ? 'Saving…' : 'Update'}
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
      {err ? <ErrorLine text={err} tint={EDIT_TINT} /> : null}
    </>
  );
}

function StopLine({
  nowMin,
  busy,
  onStop,
  onCancel,
}: {
  nowMin: number | null;
  busy: boolean;
  onStop: (remarks: string) => Promise<unknown>;
  onCancel: () => void;
}): React.JSX.Element {
  const [remarks, setRemarks] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const tint: React.CSSProperties = { background: 'var(--blue3)' };
  const go = async (): Promise<void> => {
    if (busy) return;
    if (!remarks.trim()) return setErr('Remark is compulsory when you stop.');
    setErr(null);
    try {
      await onStop(remarks.trim());
    } catch (x) {
      setErr(errText(x));
    }
  };
  return (
    <>
      <tr style={tint}>
        <td />
        <td colSpan={8} className="td-left">
          <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8 }}>
            <b>Stop at {nowMin !== null ? fmt12(minToHhmm(nowMin)) : 'now'}</b>
            <input
              className="innovic-input"
              aria-label="Remark"
              autoFocus
              maxLength={2000}
              placeholder="Remark * — what was done"
              value={remarks}
              disabled={busy}
              onChange={(x) => setRemarks(x.target.value)}
              onKeyDown={(x) => {
                if (x.key === 'Enter') void go();
                if (x.key === 'Escape') onCancel();
              }}
              style={{ flex: 1, minWidth: 220 }}
            />
            <button
              type="button"
              className="btn btn-primary btn-sm"
              disabled={busy}
              onClick={() => void go()}
            >
              {busy ? 'Saving…' : 'Save stop'}
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
      {err ? <ErrorLine text={err} tint={tint} /> : null}
    </>
  );
}

export function SheetSavedRow({
  e,
  n,
  isLast,
  isToday,
  nowMin,
  canWrite,
  editing,
  busy,
  onEdit,
  onCancelEdit,
  onUpdate,
  onStop,
  onRemove,
}: {
  e: DayLogEntry;
  n: number;
  /** The day's last entry (lastEntryId) — its Stop may change; 🗑 shown. */
  isLast: boolean;
  isToday: boolean;
  nowMin: number | null;
  /** The server lets the owner write this day (and it is not loading). */
  canWrite: boolean;
  editing: boolean;
  busy: boolean;
  onEdit: () => void;
  onCancelEdit: () => void;
  onUpdate: (body: UpdateDayLogEntryInput) => Promise<unknown>;
  /** Stop at the server's now; `remarks` only when asked for. */
  onStop: (remarks: string | null) => Promise<unknown>;
  onRemove: () => void;
}): React.JSX.Element {
  const [stopping, setStopping] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const open = !e.toTime;

  if (editing) {
    return (
      <EditRow
        e={e}
        n={n}
        stopEditable={isLast && (!open || !isToday)}
        nowMin={nowMin}
        busy={busy}
        onUpdate={onUpdate}
        onCancel={onCancelEdit}
      />
    );
  }

  const stopNow = (): void => {
    setErr(null);
    if (e.kind === 'break' || (e.remarks ?? '').trim()) {
      onStop(null).catch((x: unknown) => setErr(errText(x)));
      return;
    }
    setStopping(true);
  };
  const tint = entryTint(e);

  return (
    <>
      <tr style={tint}>
        <EntryCells e={e} n={n} />
        <td>
          {canWrite ? (
            <div style={{ display: 'inline-flex', gap: 4 }}>
              {open && isToday ? (
                <button
                  type="button"
                  className="btn btn-primary btn-sm"
                  disabled={busy || stopping}
                  onClick={stopNow}
                >
                  ■ Stop
                </button>
              ) : null}
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                title="Edit this row"
                aria-label="Edit this row"
                disabled={busy}
                onClick={onEdit}
              >
                ✎
              </button>
              {isLast ? (
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  title="Remove this row"
                  aria-label="Remove this row"
                  disabled={busy}
                  onClick={onRemove}
                >
                  🗑
                </button>
              ) : null}
            </div>
          ) : null}
        </td>
      </tr>
      {stopping ? (
        <StopLine
          nowMin={nowMin}
          busy={busy}
          onStop={async (r) => {
            await onStop(r);
            setStopping(false);
          }}
          onCancel={() => setStopping(false)}
        />
      ) : null}
      {err ? <ErrorLine text={err} tint={tint} /> : null}
    </>
  );
}
