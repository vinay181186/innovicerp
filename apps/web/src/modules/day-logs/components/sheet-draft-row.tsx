// One NEW row of the My Day Log sheet (not saved yet, owner final
// 2026-10-27): # · Start * · Stop * (both typed or picked — the clock opens
// on click) · SO / JWSO · Time · ✕ Remove, then the full-width "Working on *"
// box under it that grows as you type. Enter in the row's time boxes adds a
// row when it is the last one (the sheet focuses the new row's Start); Enter
// in Working on is a newline. "Row N: …" from the server shows under it.

import { fmtDuration } from '@innovic/shared';
import type { Draft } from '../lib/sheet';
import { spanMinutes } from '../lib/sheet';
import { SHEET_COLS } from './entries-table';
import { OrderSelect } from './order-select';
import { TimeField } from './time-field';
import { NO_GAP, RowError, WorkEditLine } from './work-line';

export function startInputId(key: number): string {
  return `dl-draft-start-${key}`;
}

export function SheetDraftRow({
  d,
  n,
  nowMin,
  error,
  saving,
  onChange,
  onDrop,
  onEnter,
}: {
  d: Draft;
  /** Row number in the sheet. */
  n: number;
  /** Today: the live minute (later times greyed in the picker); null otherwise. */
  nowMin: number | null;
  /** The check's / server's "Row N: …" for this row. */
  error: string | null;
  /** The running Save carries this row — locked until it answers. */
  saving: boolean;
  onChange: (patch: Partial<Draft>) => void;
  onDrop: () => void;
  /** Enter pressed in a time box of this row. */
  onEnter: () => void;
}): React.JSX.Element {
  const mins = spanMinutes(d.start, d.stop);
  const tint: React.CSSProperties = error
    ? { background: 'var(--amber3)' }
    : saving
      ? { opacity: 0.6 }
      : {};
  return (
    <>
      <tr style={{ ...tint, ...NO_GAP }}>
        <td className="mono">{n}</td>
        <td>
          <TimeField
            id={startInputId(d.key)}
            ariaLabel="Start time"
            value={d.start}
            onChange={(start) => onChange({ start })}
            nowMin={nowMin}
            disabled={saving}
            placeholder="Start *"
            onEnter={onEnter}
          />
        </td>
        <td>
          <TimeField
            ariaLabel="Stop time"
            value={d.stop}
            onChange={(stop) => onChange({ stop })}
            nowMin={nowMin}
            disabled={saving}
            placeholder="Stop *"
            onEnter={onEnter}
          />
        </td>
        <td>
          <OrderSelect
            value={d.order}
            disabled={saving}
            onChange={(order) => onChange({ order })}
          />
        </td>
        <td className="td-num mono">{mins !== null ? fmtDuration(mins) : ''}</td>
        <td>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            title="Remove this unsaved row"
            aria-label="Remove this unsaved row"
            disabled={saving}
            onClick={onDrop}
          >
            {saving ? 'Saving…' : '✕ Remove'}
          </button>
        </td>
      </tr>
      <WorkEditLine
        value={d.desc}
        onChange={(desc) => onChange({ desc })}
        disabled={saving}
        span={SHEET_COLS - 1}
        tint={tint}
      >
        {error ? <RowError text={error} /> : null}
      </WorkEditLine>
    </>
  );
}
