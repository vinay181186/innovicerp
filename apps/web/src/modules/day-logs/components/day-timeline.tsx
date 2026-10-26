// The 09:00 → 18:00 bar: work (blue), breaks (grey), the running timer
// (light blue), and whatever is not covered shows the striped "missing"
// background. Display only — time is logged through the work box.

import type { DayLogEntry } from '@innovic/shared';
import { hourMarks, timelineSegments, type TimelineSegment } from '../lib/format';

const SEG_STYLE: Record<TimelineSegment['kind'], React.CSSProperties> = {
  work: { background: 'var(--blue)', color: 'var(--bg2)' },
  break: { background: 'var(--text3)', color: 'var(--bg2)' },
  running: {
    background: 'var(--blue3)',
    color: 'var(--blue)',
    borderLeft: '2px solid var(--blue)',
  },
};

export function DayTimeline({
  entries,
  workFrom,
  workTo,
  nowMin,
}: {
  entries: readonly DayLogEntry[];
  workFrom: string;
  workTo: string;
  nowMin: number;
}): React.JSX.Element {
  const segs = timelineSegments(entries, workFrom, workTo, nowMin);
  const hours = hourMarks(workFrom, workTo);
  return (
    <div
      className="panel"
      style={{ padding: '10px 14px', marginBottom: 10 }}
      aria-label="Day timeline"
    >
      <div
        style={{
          position: 'relative',
          height: 30,
          borderRadius: 'var(--radius-sm)',
          overflow: 'hidden',
          border: '1px solid var(--amber)',
          background: 'repeating-linear-gradient(135deg, var(--amber3) 0 8px, var(--bg2) 8px 16px)',
        }}
        title="Striped = not logged yet"
      >
        {segs.map((s) => (
          <div
            key={s.key}
            title={s.title}
            className="mono"
            style={{
              position: 'absolute',
              top: 0,
              bottom: 0,
              left: `${s.leftPct}%`,
              width: `${s.widthPct}%`,
              fontSize: 'var(--fs-xs)',
              fontWeight: 700,
              display: 'flex',
              alignItems: 'center',
              paddingLeft: 6,
              overflow: 'hidden',
              whiteSpace: 'nowrap',
              textOverflow: 'ellipsis',
              borderRight: '2px solid var(--bg2)',
              ...SEG_STYLE[s.kind],
            }}
          >
            {s.label}
          </div>
        ))}
      </div>
      <div style={{ display: 'flex', gap: 4, marginTop: 6 }}>
        <span className="mono text3" style={{ fontSize: 'var(--fs-xs)', alignSelf: 'center' }}>
          {workFrom}
        </span>
        {hours.map((h) => (
          <span
            key={h}
            className="mono text3"
            style={{ flex: 1, textAlign: 'right', fontSize: 'var(--fs-xs)' }}
          >
            {h}
          </span>
        ))}
      </div>
    </div>
  );
}
