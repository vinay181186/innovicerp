// One NEW row of the My Day Log sheet (not saved yet): Type select (Work /
// Break / Others) · Start locked (shown only — the server works it out) ·
// Stop typed or picked (🕒) · Working on (Work / Break) or Reason (Others) ·
// SO / JWSO (Work only) · Time · ✕, then the Remark line under it ("Remark *"
// unless Break) — a full-width textarea. Enter in the last row's fields adds
// a row (the sheet focuses its Stop); Enter in the Remark is a newline.

import type { DayLogEntryKind } from '@innovic/shared';
import {
  DAY_LOG_ENTRY_KIND_LABELS,
  DAY_LOG_ENTRY_KINDS,
  DAY_LOG_OTHERS_REASONS,
  fmt12,
  fmtDuration,
} from '@innovic/shared';
import type { Draft } from '../lib/sheet';
import { draftMinutes } from '../lib/sheet';
import { SHEET_COLS } from './entries-table';
import { OrderSelect } from './order-select';
import { NO_GAP, RemarkEditLine } from './remark-line';
import { TimeField } from './time-field';

export function ReasonSelect({
  value,
  onChange,
  disabled,
}: {
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean | undefined;
}): React.JSX.Element {
  // A saved reason the list no longer has still shows as picked.
  const known = (DAY_LOG_OTHERS_REASONS as readonly string[]).includes(value);
  return (
    <select
      className="innovic-select"
      aria-label="Reason"
      value={value}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value)}
      style={{ minWidth: 140 }}
    >
      <option value="">Reason…</option>
      {DAY_LOG_OTHERS_REASONS.map((r) => (
        <option key={r} value={r}>
          {r}
        </option>
      ))}
      {value && !known ? <option value={value}>{value}</option> : null}
    </select>
  );
}

export function stopInputId(key: number): string {
  return `dl-draft-stop-${key}`;
}

export function SheetDraftRow({
  d,
  n,
  start,
  isLast,
  nowMin,
  error,
  busy,
  onChange,
  onDrop,
  onEnter,
}: {
  d: Draft;
  /** Row number in the sheet. */
  n: number;
  /** Shown Start ("HH:MM"), null = after the row above. */
  start: string | null;
  isLast: boolean;
  /** Today: the live minute (later times greyed in the picker); null otherwise. */
  nowMin: number | null;
  /** The server's "Row N: …" for this row. */
  error: string | null;
  busy: boolean;
  onChange: (patch: Partial<Draft>) => void;
  onDrop: () => void;
  /** Enter pressed in this row. */
  onEnter: () => void;
}): React.JSX.Element {
  const isOthers = d.kind === 'leave';
  const isBreak = d.kind === 'break';
  const mins = draftMinutes(start, d.stop);
  const enter = (e: React.KeyboardEvent): void => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    onEnter();
  };
  const tint: React.CSSProperties = error ? { background: 'var(--amber3)' } : {};
  return (
    <>
      <tr style={{ ...tint, ...NO_GAP }}>
        <td className="mono">{n}</td>
        <td>
          <select
            className="innovic-select"
            aria-label="Type"
            value={d.kind}
            disabled={busy}
            onKeyDown={enter}
            onChange={(e) => {
              const kind = e.target.value as DayLogEntryKind;
              // SO / JWSO belongs to Work only — cleared when the Type moves off it.
              onChange(kind === 'work' ? { kind } : { kind, order: null });
            }}
            style={{ minWidth: 96 }}
          >
            {DAY_LOG_ENTRY_KINDS.map((k) => (
              <option key={k} value={k}>
                {DAY_LOG_ENTRY_KIND_LABELS[k]}
              </option>
            ))}
          </select>
        </td>
        <td className="mono" style={{ color: 'var(--text3)' }}>
          {start ? fmt12(start) : <span className="text3">after row above</span>}
        </td>
        <td>
          <TimeField
            id={stopInputId(d.key)}
            ariaLabel="Stop time"
            value={d.stop}
            onChange={(stop) => onChange({ stop })}
            // An Others row may end later today; Work / Break never after now.
            nowMin={isOthers ? null : nowMin}
            disabled={busy}
            placeholder={isLast && !isOthers ? 'empty = open' : 'Stop'}
            onEnter={onEnter}
          />
        </td>
        <td>
          {isOthers ? (
            <ReasonSelect
              value={d.reason}
              disabled={busy}
              onChange={(reason) => onChange({ reason })}
            />
          ) : (
            <input
              className="innovic-input"
              aria-label={isBreak ? 'Break name' : 'Working on'}
              maxLength={500}
              placeholder={isBreak ? 'Lunch, Tea…' : 'What did you work on?'}
              value={d.desc}
              disabled={busy}
              onKeyDown={enter}
              onChange={(e) => onChange({ desc: e.target.value })}
              style={{ minWidth: 180 }}
            />
          )}
        </td>
        <td>
          {d.kind === 'work' ? (
            <OrderSelect
              value={d.order}
              disabled={busy}
              onChange={(order) => onChange({ order })}
            />
          ) : (
            <span className="text3">—</span>
          )}
        </td>
        <td className="td-num mono">{mins !== null ? fmtDuration(mins) : ''}</td>
        <td>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            title="Remove this unsaved row"
            aria-label="Remove this unsaved row"
            disabled={busy}
            onClick={onDrop}
          >
            ✕ Remove
          </button>
        </td>
      </tr>
      <RemarkEditLine
        value={d.remarks}
        onChange={(remarks) => onChange({ remarks })}
        required={!isBreak}
        disabled={busy}
        span={SHEET_COLS - 1}
        tint={tint}
      />
      {error ? (
        <tr style={tint}>
          <td />
          <td
            colSpan={SHEET_COLS - 1}
            role="alert"
            className="td-left"
            style={{ color: 'var(--red2)' }}
          >
            {error}
          </td>
        </tr>
      ) : null}
    </>
  );
}
