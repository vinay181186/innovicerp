// <Timeline> — ONE chronological history design, at two densities.
//
//   density="regular"  the rail: a 20px coloured dot per event and a bordered
//                      event card beside it (the SO Timeline screen).
//   density="compact"  the same rail at 10px, one line per event
//                      (the Document Timeline inside Related Documents).
//
// These were two separate implementations — `so-timeline/timeline-body.tsx`
// and a local `Timeline()` inside `related-docs-panel.tsx`, the second of
// which drew its rail and dots in raw greys (#e5e7eb, #9ca3af) instead of
// tokens. One component, one look, a density prop; the greys are now
// `var(--border)` and `var(--text3)`.
//
// Pure: the caller passes the events it has already fetched and formatted.
// `code` is a ReactNode so a list can hand in its own <Link> without this
// component knowing a single route.

import { EmptyState } from './EmptyState';

export interface TimelineEvent {
  /** Stable key when two events share a date and label. */
  key?: string | undefined;
  /** Already formatted for reading — ISO date, or `YYYY-MM-DD HH:mm`. */
  date?: string | null | undefined;
  label: React.ReactNode;
  /** The second line on a regular event card. Ignored when compact. */
  detail?: React.ReactNode | undefined;
  /** Dot + card accent, token only. Defaults to the muted text colour. */
  color?: string | undefined;
  /** Emoji shown inside the dot. Regular density only — a 10px dot has no
   *  room for a glyph. */
  icon?: React.ReactNode | undefined;
  /** The document this event is about, usually a <Link> around its code. */
  code?: React.ReactNode | undefined;
}

export interface TimelineProps {
  events: TimelineEvent[];
  /** 'regular' = event cards on a rail · 'compact' = one line per event. */
  density?: 'regular' | 'compact' | undefined;
  /** Heading above the rail (e.g. "📅 SO Timeline — IN-SO-26-0142"). */
  title?: React.ReactNode | undefined;
  /** Shown instead of the rail when there are no events. */
  emptyText?: string | undefined;
  className?: string | undefined;
  style?: React.CSSProperties | undefined;
}

/** Rail geometry per density: dot diameter, rail x, and the left padding that
 *  clears it. Taken from the design reference; kept together so the dot can
 *  never drift off its own rail. */
const RAIL = {
  regular: { dot: 20, left: 13, pad: 30, gap: 'var(--sp-4)' },
  compact: { dot: 10, left: 5, pad: 18, gap: 'var(--sp-1)' },
} as const;

export function Timeline({
  events,
  density = 'regular',
  title,
  emptyText = 'No events recorded yet.',
  className,
  style,
}: TimelineProps): React.JSX.Element {
  const compact = density === 'compact';
  const rail = compact ? RAIL.compact : RAIL.regular;

  const heading =
    title === undefined || title === null ? null : compact ? (
      <div
        className="text3"
        style={{
          fontSize: 'var(--fs-xs)',
          textTransform: 'uppercase',
          letterSpacing: '0.06em',
          marginBottom: 'var(--sp-2)',
        }}
      >
        {title}
      </div>
    ) : (
      <div style={{ fontSize: 'var(--fs-sm)', fontWeight: 700, marginBottom: 'var(--sp-3)' }}>
        {title}
      </div>
    );

  if (events.length === 0) {
    return (
      <div className={className} style={style}>
        {heading}
        <EmptyState>{emptyText}</EmptyState>
      </div>
    );
  }

  return (
    <div className={className} style={style}>
      {heading}
      <div style={{ position: 'relative', paddingLeft: rail.pad }}>
        {/* The rail itself — one hairline from the first dot to the last. */}
        <div
          style={{
            position: 'absolute',
            left: rail.left,
            top: 0,
            bottom: 0,
            width: 2,
            background: 'var(--border)',
          }}
        />
        {events.map((e, i) => {
          const color = e.color ?? 'var(--text3)';
          return (
            <div
              key={e.key ?? `${String(e.date ?? '')}-${i}`}
              style={{ position: 'relative', marginBottom: rail.gap }}
            >
              <div
                style={{
                  position: 'absolute',
                  // Centre the dot on the rail, measured back from the content
                  // edge — so both densities sit on their own rail exactly.
                  left: -(rail.pad - rail.left) - rail.dot / 2 + 1,
                  top: 4,
                  width: rail.dot,
                  height: rail.dot,
                  borderRadius: '50%',
                  background: color,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: 'var(--fs-xs)',
                  color: 'var(--bg2)',
                  zIndex: 1,
                  // The dot punches a hole in the rail it sits on.
                  border: '2px solid var(--bg2)',
                }}
              >
                {compact ? null : e.icon}
              </div>
              {compact ? (
                <div style={{ fontSize: 'var(--fs-sm)' }}>
                  <span
                    className="mono text2"
                    style={{ fontSize: 'var(--fs-xs)', marginRight: 'var(--sp-2)' }}
                  >
                    {e.date ?? '—'}
                  </span>
                  {e.label}
                  {e.code ? (
                    <span
                      className="td-code"
                      style={{ marginLeft: 'var(--sp-1)', color: 'var(--blue)' }}
                    >
                      {e.code}
                    </span>
                  ) : null}
                </div>
              ) : (
                <div
                  style={{
                    background: 'var(--bg2)',
                    border: '1px solid var(--border)',
                    borderRadius: 'var(--radius2)',
                    padding: 'var(--sp-2) var(--sp-3)',
                    borderLeft: `3px solid ${color}`,
                  }}
                >
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      gap: 'var(--sp-2)',
                      marginBottom: 2,
                    }}
                  >
                    <span style={{ fontSize: 'var(--fs-sm)', fontWeight: 700, color }}>
                      {e.label}
                      {/* The document code is the main thing on the line: it
                          stays `.td-code` mono/600 in the code blue, never the
                          event's status colour inherited from this span. */}
                      {e.code ? (
                        <span
                          className="td-code"
                          style={{ marginLeft: 'var(--sp-1)', color: 'var(--blue)' }}
                        >
                          {e.code}
                        </span>
                      ) : null}
                    </span>
                    <span
                      className="mono"
                      style={{ fontSize: 'var(--fs-xs)', color: 'var(--text3)', flexShrink: 0 }}
                    >
                      {e.date ?? '—'}
                    </span>
                  </div>
                  {e.detail ? (
                    <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--text2)' }}>
                      {e.detail}
                    </div>
                  ) : null}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
