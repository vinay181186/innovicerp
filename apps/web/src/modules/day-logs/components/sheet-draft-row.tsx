// One NEW row of the My Day Log sheet (not saved yet; owner "Option B",
// 2026-10-27) — all on one line: # · Start * · Stop * (typed or picked — the
// clock opens on click) · Time · SO / JWSO · Working on * (grows as you
// type) · ✕. Enter in the row's time boxes adds a row when it is the last
// one (the sheet focuses the new row's Start); Enter in Working on is a
// newline. "Row N: …" from the check / server shows under the row.

import { fmtDuration } from '@innovic/shared';
import type { Draft } from '../lib/sheet';
import { spanMinutes } from '../lib/sheet';
import { OrderSelect } from './order-select';
import { TimeField } from './time-field';
import { RowError, WorkBox } from './work-line';

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
  const tint = error ? ' dl-warn' : saving ? ' dl-new dl-saving' : ' dl-new';
  return (
    <div className={`dl-cols${tint}`}>
      <span className="dl-c dl-n">{n}</span>
      <div className="dl-field">
        <TimeField
          id={startInputId(d.key)}
          ariaLabel="Start time"
          value={d.start}
          onChange={(start) => onChange({ start })}
          nowMin={nowMin}
          disabled={saving}
          placeholder="Start *"
          onEnter={onEnter}
          fill
        />
      </div>
      <div className="dl-field">
        <TimeField
          ariaLabel="Stop time"
          value={d.stop}
          onChange={(stop) => onChange({ stop })}
          nowMin={nowMin}
          disabled={saving}
          placeholder="Stop *"
          onEnter={onEnter}
          fill
        />
      </div>
      <span className="dl-c dl-dur">{mins !== null ? fmtDuration(mins) : ''}</span>
      <div className="dl-field dl-sofield">
        <OrderSelect
          value={d.order}
          disabled={saving}
          onChange={(order) => onChange({ order })}
          fill
        />
      </div>
      <WorkBox value={d.desc} onChange={(desc) => onChange({ desc })} disabled={saving} />
      <span className="dl-c dl-act">
        <button
          type="button"
          className="btn btn-ghost btn-sm dl-icon"
          title={saving ? 'Saving…' : 'Remove this unsaved row'}
          aria-label="Remove this unsaved row"
          disabled={saving}
          onClick={onDrop}
        >
          ✕
        </button>
      </span>
      {error ? <RowError text={error} /> : null}
    </div>
  );
}
