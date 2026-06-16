// SO Status Review — two-pane master/detail, matching legacy renderSOStatus
// (L4543-4560): a left SO selector pane (search + rich SO cards with status
// dot, line count, customer, BOM-Pending tag, Qty/Done/progress) and a right
// detail pane (the shared SoStatusDetailView). Reuses GET /so-overview for the
// left list; the right pane fetches GET /so-status/$id on selection.

import { createRoute } from '@tanstack/react-router';
import { Loader2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { authenticatedRoute } from '@/routes/_authenticated';
import { useSoOverview } from '../../so-overview/api';
import { SoStatusDetailView } from '../components/so-status-detail';

export const soStatusIndexRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: 'so-status',
  component: SoStatusIndexPage,
});

// Map our richer overallStatus → legacy left-card dot colour
// (green=complete, amber=blocked, red=delayed, cyan/blue=in progress, grey=none).
function dotColor(status: string, hasWork: boolean): string {
  switch (status) {
    case 'completed':
      return 'var(--green)';
    case 'blocked':
      return 'var(--amber)';
    case 'delayed':
      return 'var(--red)';
    case 'on_track':
    case 'in_progress':
      return 'var(--cyan)';
    default:
      return hasWork ? 'var(--cyan)' : 'var(--text3)';
  }
}

function SoStatusIndexPage(): React.JSX.Element {
  const [search, setSearch] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const { data, isLoading, isError, error } = useSoOverview({});

  const filtered = useMemo(() => {
    if (!data) return [];
    const q = search.trim().toLowerCase();
    const sorted = [...data.rows].sort((a, b) => (b.soDate ?? '').localeCompare(a.soDate ?? ''));
    if (!q) return sorted;
    return sorted.filter((r) =>
      `${r.code} ${r.customerName ?? ''} ${r.clientPoNo ?? ''}`.toLowerCase().includes(q),
    );
  }, [data, search]);

  const selected = selectedId && filtered.some((r) => r.id === selectedId) ? selectedId : (filtered[0]?.id ?? null);

  if (isLoading) {
    return (
      <div className="text3" style={{ fontSize: 12, padding: 16 }}>
        <Loader2 size={14} className="inline animate-spin" /> Loading…
      </div>
    );
  }
  if (isError || !data) {
    return (
      <div className="empty-state" style={{ color: 'var(--red)', padding: 24 }}>
        {error instanceof Error ? error.message : 'Failed to load SO list'}
      </div>
    );
  }

  return (
    <div
      // Break out of #content's 20px padding on sides + bottom only (NOT top —
      // a negative top margin would pull the pane up over the breadcrumb and
      // hide it). Height nets the topbar + content top padding + breadcrumb row.
      style={{
        display: 'flex',
        height: 'calc(100vh - 104px)',
        margin: '0 -20px -20px',
        overflow: 'hidden',
      }}
    >
      {/* Left selector pane */}
      <div style={{ width: 270, minWidth: 270, borderRight: '1px solid var(--border)', overflowY: 'auto', background: 'var(--bg2)' }}>
        <div style={{ padding: '10px 14px', borderBottom: '1px solid var(--border)', background: 'var(--bg3)', position: 'sticky', top: 0, zIndex: 1 }}>
          <div className="text3" style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.08em', marginBottom: 6 }}>
            📊 SELECT SO / WO
          </div>
          <input
            className="innovic-input"
            style={{ width: '100%', fontSize: 12 }}
            placeholder="🔍 Search SO / customer…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        {filtered.length === 0 ? (
          <div style={{ padding: 24, textAlign: 'center', color: 'var(--text3)', fontSize: 12 }}>
            {data.rows.length === 0 ? 'No SOs found. Add SOs in SO Master.' : 'No SOs match your search.'}
          </div>
        ) : (
          filtered.map((r) => {
            const active = r.id === selected;
            const hasWork = r.totalDoneQty > 0 || r.overallStatus !== 'not_started';
            const bomPending = r.type === 'equipment' && !r.bomMasterId;
            return (
              <div
                key={r.id}
                onClick={() => setSelectedId(r.id)}
                style={{
                  padding: '10px 14px',
                  cursor: 'pointer',
                  borderLeft: `3px solid ${active ? 'var(--cyan)' : 'transparent'}`,
                  background: active ? 'var(--bg4)' : 'transparent',
                  borderBottom: '1px solid var(--border)',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                  <span style={{ width: 8, height: 8, borderRadius: '50%', background: dotColor(r.overallStatus, hasWork), flexShrink: 0 }} />
                  <span style={{ fontWeight: 700, fontSize: 13, color: active ? 'var(--cyan)' : 'var(--text)' }}>{r.code}</span>
                  <span className="text3" style={{ fontSize: 10, background: 'var(--bg4)', padding: '1px 5px', borderRadius: 3 }}>
                    {r.lineCount} line{r.lineCount === 1 ? '' : 's'}
                  </span>
                </div>
                <div className="text3" style={{ fontSize: 11, marginTop: 2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {r.customerName ?? ''}
                </div>
                {bomPending ? (
                  <div style={{ fontSize: 10, color: 'var(--amber)', fontWeight: 700, marginTop: 2 }}>⚠ BOM Pending</div>
                ) : null}
                <div style={{ display: 'flex', gap: 8, marginTop: 4, alignItems: 'center' }}>
                  <span className="text3" style={{ fontSize: 10 }}>Qty: <b>{r.totalRequiredQty}</b></span>
                  <span className="text3" style={{ fontSize: 10 }}>Done: <b style={{ color: 'var(--green)' }}>{r.totalDoneQty}</b></span>
                  <div style={{ flex: 1, height: 4, background: 'var(--bg5, var(--bg4))', borderRadius: 2, minWidth: 40 }}>
                    <div style={{ width: `${r.overallPct}%`, height: 4, background: dotColor(r.overallStatus, hasWork), borderRadius: 2 }} />
                  </div>
                  <span className="text3" style={{ fontSize: 10 }}>{r.overallPct}%</span>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Right detail pane */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '20px 24px' }}>
        {selected ? (
          <SoStatusDetailView soId={selected} />
        ) : (
          <div className="empty-state" style={{ padding: 60, fontSize: 14 }}>
            Select an SO from the list to review its status.
          </div>
        )}
      </div>
    </div>
  );
}
