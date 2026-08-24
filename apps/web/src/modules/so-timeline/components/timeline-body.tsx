// SO Timeline rail — reusable chronological event view for one SO.
// Extracted from the former standalone /so-timeline screen so it can render
// both on its own and as the "Timeline" tab inside SO Status Review.
// Mirrors legacy renderSOTimeline L17847-17862.

import type { SoTimelineResponse } from '@innovic/shared';

export function SoTimelineBody({ data }: { data: SoTimelineResponse }): React.JSX.Element {
  // Legacy L17844: header line is the SO number only — no customer/type/count.
  const header = (
    <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 12 }}>
      📅 SO Timeline — {data.soCode}
    </div>
  );

  if (data.events.length === 0) {
    // Legacy L17845.
    return (
      <>
        {header}
        <div className="empty-state">No events recorded yet.</div>
      </>
    );
  }

  return (
    <>
      {header}
      {/* Legacy L17847-17862: vertical rail at left:13px with a colour dot per event. */}
      <div style={{ position: 'relative', paddingLeft: 30 }}>
        <div
          style={{
            position: 'absolute',
            left: 13,
            top: 0,
            bottom: 0,
            width: 2,
            background: 'var(--border)',
          }}
        />
        {data.events.map((evt, idx) => (
          <div key={`${evt.kind}-${idx}-${evt.date}`} style={{ position: 'relative', marginBottom: 16 }}>
            <div
              style={{
                position: 'absolute',
                left: -24,
                top: 4,
                width: 20,
                height: 20,
                borderRadius: '50%',
                background: evt.color,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: 10,
                color: '#fff',
                zIndex: 1,
                border: '2px solid var(--bg)',
              }}
            >
              {evt.icon}
            </div>
            <div
              style={{
                background: 'var(--bg2)',
                border: '1px solid var(--border)',
                borderRadius: 10,
                padding: '10px 14px',
                borderLeft: `3px solid ${evt.color}`,
              }}
            >
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  marginBottom: 2,
                }}
              >
                <span style={{ fontSize: 12, fontWeight: 700, color: evt.color }}>{evt.label}</span>
                <span style={{ fontSize: 10, color: 'var(--text3)' }}>
                  {formatTimelineDate(evt.date)}
                </span>
              </div>
              <div style={{ fontSize: 11, color: 'var(--text2)' }}>{evt.detail}</div>
            </div>
          </div>
        ))}
      </div>
    </>
  );
}

function formatTimelineDate(iso: string): string {
  // Tolerates both `YYYY-MM-DD` and full ISO timestamps. Date-only events
  // render without a time; timestamps render with HH:mm.
  if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso;
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    const date = d.toISOString().slice(0, 10);
    const time = d.toISOString().slice(11, 16);
    return `${date} ${time}`;
  } catch {
    return iso;
  }
}
