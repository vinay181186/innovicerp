// SO Timeline (PL-SOTL-1) — chronological event view across an SO's lifecycle.
// Mirrors legacy renderSOTimeline L19971 + _soTimeline L17679. Reuses the
// existing /so-overview list endpoint for the SO picker.
//
// See docs/PARITY/sotimeline.md for the legacy spec.

import { createRoute } from '@tanstack/react-router';
import { Loader2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { authenticatedRoute } from '@/routes/_authenticated';
import { useSoOverview } from '../../so-overview/api';
import { useSoTimeline } from '../api';

export const soTimelineIndexRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: 'so-timeline',
  component: SoTimelinePage,
});

function SoTimelinePage(): React.JSX.Element {
  const { data: overview, isLoading: ovLoading, isError: ovError } = useSoOverview({});
  const [selectedSoId, setSelectedSoId] = useState<string | null>(null);

  const soList = useMemo(() => {
    if (!overview) return [];
    return [...overview.rows].sort((a, b) => (b.soDate ?? '').localeCompare(a.soDate ?? ''));
  }, [overview]);

  const timelineQ = useSoTimeline(selectedSoId);

  return (
    <div>
      {/* Legacy L19979-19983: flex header, section-hdr with margin-bottom:0, select in a flex box. */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: 16,
        }}
      >
        <div className="section-hdr" style={{ marginBottom: 0 }}>
          📅 SO Timeline
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <select
            className="innovic-select"
            value={selectedSoId ?? ''}
            onChange={(e) => setSelectedSoId(e.target.value || null)}
            style={{ minWidth: 250 }}
          >
            <option value="">— Select SO —</option>
            {soList.map((s) => (
              <option key={s.id} value={s.id}>
                {s.code} — {s.customerName ?? ''} ({s.type.replaceAll('_', ' ')})
              </option>
            ))}
          </select>
        </div>
      </div>

      {ovLoading ? (
        <div className="empty-state">
          <Loader2 size={14} className="inline animate-spin" /> Loading SO list…
        </div>
      ) : ovError ? (
        <div className="empty-state" style={{ color: 'var(--red)' }}>
          Failed to load SO list.
        </div>
      ) : !selectedSoId ? (
        /* Legacy L19987. */
        <div className="empty-state">Select a Sales Order above to view its timeline.</div>
      ) : timelineQ.isLoading ? (
        <div className="empty-state">
          <Loader2 size={14} className="inline animate-spin" /> Loading timeline…
        </div>
      ) : timelineQ.isError || !timelineQ.data ? (
        <div className="empty-state" style={{ color: 'var(--red)' }}>
          {timelineQ.error instanceof Error ? timelineQ.error.message : 'Failed to load timeline'}
        </div>
      ) : (
        <TimelineBody data={timelineQ.data} />
      )}
    </div>
  );
}

function TimelineBody({
  data,
}: {
  data: import('@innovic/shared').SoTimelineResponse;
}): React.JSX.Element {
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
