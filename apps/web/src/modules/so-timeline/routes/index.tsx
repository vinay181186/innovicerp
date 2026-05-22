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
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="section-hdr m-0">📅 SO Timeline</div>
        <select
          className="innovic-select"
          value={selectedSoId ?? ''}
          onChange={(e) => setSelectedSoId(e.target.value || null)}
          style={{ minWidth: 280, fontSize: 13 }}
        >
          <option value="">— Select SO —</option>
          {soList.map((s) => (
            <option key={s.id} value={s.id}>
              {s.code} — {s.customerName ?? ''} ({s.type.replaceAll('_', ' ')})
            </option>
          ))}
        </select>
      </div>

      {ovLoading ? (
        <div className="panel">
          <div className="panel-body">
            <div className="text3" style={{ fontSize: 12 }}>
              <Loader2 size={14} className="inline animate-spin" /> Loading SO list…
            </div>
          </div>
        </div>
      ) : ovError ? (
        <div className="panel">
          <div className="panel-body">
            <div className="empty-state" style={{ color: 'var(--red)' }}>
              Failed to load SO list.
            </div>
          </div>
        </div>
      ) : !selectedSoId ? (
        <div className="panel">
          <div className="panel-body">
            <div className="empty-state">
              <div className="empty-icon">📅</div>
              Select a Sales Order above to view its timeline.
            </div>
          </div>
        </div>
      ) : timelineQ.isLoading ? (
        <div className="panel">
          <div className="panel-body">
            <div className="text3" style={{ fontSize: 12 }}>
              <Loader2 size={14} className="inline animate-spin" /> Loading timeline…
            </div>
          </div>
        </div>
      ) : timelineQ.isError || !timelineQ.data ? (
        <div className="panel">
          <div className="panel-body">
            <div className="empty-state" style={{ color: 'var(--red)' }}>
              {timelineQ.error instanceof Error
                ? timelineQ.error.message
                : 'Failed to load timeline'}
            </div>
          </div>
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
  if (data.events.length === 0) {
    return (
      <div className="panel">
        <div className="panel-body">
          <div className="empty-state">
            <div className="empty-icon">📅</div>
            No events recorded for this SO yet.
          </div>
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="panel" style={{ marginBottom: 12, padding: '12px 14px' }}>
        <div style={{ fontSize: 16, fontWeight: 800, color: 'var(--cyan)' }}>{data.soCode}</div>
        <div style={{ fontSize: 12, color: 'var(--text3)', marginTop: 2 }}>
          {data.customerName ?? '—'} · {data.type.replaceAll('_', ' ')} · {data.events.length}{' '}
          event{data.events.length === 1 ? '' : 's'}
        </div>
      </div>

      <div className="panel" style={{ padding: 0 }}>
        {data.events.map((evt, idx) => (
          <div
            key={`${evt.kind}-${idx}-${evt.date}`}
            style={{
              padding: '10px 14px',
              borderLeft: `3px solid ${evt.color}`,
              borderBottom:
                idx < data.events.length - 1 ? '1px solid var(--border)' : undefined,
              fontSize: 12,
            }}
          >
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'start',
                gap: 12,
                marginBottom: 4,
              }}
            >
              <span style={{ fontWeight: 700 }}>
                {evt.icon} {evt.label}
              </span>
              <span style={{ fontSize: 11, color: 'var(--text3)', whiteSpace: 'nowrap' }}>
                {formatTimelineDate(evt.date)}
              </span>
            </div>
            <div style={{ color: 'var(--text2)', lineHeight: 1.5 }}>{evt.detail}</div>
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
