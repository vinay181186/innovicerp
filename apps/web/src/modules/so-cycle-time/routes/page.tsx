// SO Cycle Time Report — mirror of legacy renderSOCycleTime (L18176).
//
// Per-SO phase durations + filtered-set averages. Filter (All / Completed /
// Active / by type) + text search are client-side; averages recompute over the
// filtered set (legacy behaviour). Read-only. Excel export of the full matrix.
//
// Every duration rendered here is SERVER-computed (so-cycle-time/service.ts ->
// lib/so-phase-data.ts computeDurations). Nothing on this page derives a
// duration from raw records — we only render r.durations.* and take a mean of
// them over the rows already on screen.
//
// Note: the API also returns `averages` (over the FULL set). We do not use it —
// legacy recomputes averages over the filtered set on every render (L18199) and
// the filter is client-side, so a full-set average would not match the table.
// Consequence: `SoCycleTimeResponse.averages` is currently fetched and rendered
// nowhere. Resolving that needs a server-side filter param, not a UI change.

import type { SoCycleTimeResponse, SoCycleTimeRow } from '@innovic/shared';
import { Link, createRoute } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { apiFetch } from '@/lib/api';
import { authenticatedRoute } from '@/routes/_authenticated';
import { exportSoCycleTime } from '../lib/export';

export const soCycleTimeRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: 'so-cycle-time',
  component: SoCycleTimePage,
});

const TYPE_LABEL: Record<string, string> = {
  component_manufacturing: 'Component Mfg',
  equipment: 'Equipment',
  with_material: 'With Material',
};

const FILTERS: { value: string; label: string }[] = [
  { value: 'all', label: 'All SOs' },
  { value: 'completed', label: 'Completed Only' },
  { value: 'active', label: 'Active Only' },
  // Legacy L18215-18216 offers "Equipment Only" + "Job Work Only". Our SO type
  // vocabulary (SO_TYPES) has no 'job work'; the last two mirror legacy's
  // "<Type> Only" pattern over the types we actually have.
  { value: 'equipment', label: 'Equipment Only' },
  { value: 'component_manufacturing', label: 'Component Mfg Only' },
  { value: 'with_material', label: 'With Material Only' },
];

type AvgKey = 'design' | 'production' | 'qc' | 'assembly' | 'total';
const AVG_KEYS: AvgKey[] = ['design', 'production', 'qc', 'assembly', 'total'];

function avg(rows: SoCycleTimeRow[], key: AvgKey): number {
  let sum = 0;
  let count = 0;
  for (const r of rows) {
    const v = r.durations[key];
    if (v != null) {
      sum += v;
      count += 1;
    }
  }
  return count ? Math.round(sum / count) : 0;
}

function SoCycleTimePage(): React.JSX.Element {
  const { data, isLoading, isError, error } = useQuery<SoCycleTimeResponse>({
    queryKey: ['so-cycle-time'],
    queryFn: () => apiFetch<SoCycleTimeResponse>('/so-cycle-time'),
    staleTime: 30_000,
  });

  const [filter, setFilter] = useState('all');
  const [search, setSearch] = useState('');

  const allRows = data?.rows ?? [];
  const filtered = useMemo(() => {
    const s = search.trim().toLowerCase();
    return allRows.filter((r) => {
      if (s && !`${r.soNo} ${r.customer ?? ''}`.toLowerCase().includes(s)) return false;
      if (filter === 'completed' && !r.phases.dispatched) return false;
      if (filter === 'active' && r.phases.dispatched) return false;
      if (
        (filter === 'equipment' ||
          filter === 'component_manufacturing' ||
          filter === 'with_material') &&
        r.type !== filter
      )
        return false;
      return true;
    });
  }, [allRows, filter, search]);

  const averages = useMemo(
    () => Object.fromEntries(AVG_KEYS.map((k) => [k, avg(filtered, k)])) as Record<AvgKey, number>,
    [filtered],
  );

  if (isLoading) {
    return (
      <div className="empty-state" style={{ padding: 40 }}>
        <Loader2 className="inline h-4 w-4 animate-spin" /> Loading…
      </div>
    );
  }
  if (isError || !data) {
    return (
      <div className="empty-state" style={{ padding: 40, color: 'var(--red)' }}>
        {error instanceof Error ? error.message : 'Failed to load'}
      </div>
    );
  }

  return (
    <div>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: 8,
        }}
      >
        <div className="section-hdr" style={{ marginBottom: 0 }}>
          ⏱ SO Cycle Time Report
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <input
            className="innovic-input"
            placeholder="🔍 Search..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{ fontSize: 12, padding: '6px 10px', minWidth: 160 }}
          />
          <select
            className="innovic-select"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            style={{ fontSize: 12, padding: '6px 10px' }}
          >
            {FILTERS.map((f) => (
              <option key={f.value} value={f.value}>
                {f.label}
              </option>
            ))}
          </select>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => exportSoCycleTime(filtered)}
          >
            📊 Export Excel
          </button>
        </div>
      </div>

      {/* Averages over the filtered set */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
          gap: 8,
          margin: '12px 0 16px',
        }}
      >
        <Avg label="Avg Design" value={averages.design} color="var(--purple)" />
        <Avg label="Avg Production" value={averages.production} color="var(--cyan)" />
        <Avg label="Avg QC" value={averages.qc} color="var(--red)" />
        <Avg label="Avg Assembly" value={averages.assembly} color="var(--blue)" />
        <Avg label="Avg Total Cycle" value={averages.total} color="var(--green)" />
      </div>

      <div className="panel">
        <div className="tbl-wrap">
          <table className="innovic-table">
            <thead>
              <tr>
                <th>SO</th>
                <th>Customer</th>
                <th>Type</th>
                <th>Status</th>
                <th className="td-ctr">Design</th>
                <th className="td-ctr">Material</th>
                <th className="td-ctr">Production</th>
                <th className="td-ctr">QC</th>
                <th className="td-ctr">Assembly</th>
                <th className="td-ctr">Dispatch</th>
                <th className="td-ctr">Total</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={11} className="empty-state">
                    No SOs match
                  </td>
                </tr>
              ) : (
                filtered.map((r) => {
                  const done = Boolean(r.phases.dispatched);
                  const totalOverAvg =
                    r.durations.total != null && r.durations.total > averages.total;
                  return (
                    <tr key={r.soId} style={done ? { background: 'rgba(34,197,94,0.02)' } : undefined}>
                      <td>
                        <Link
                          to="/sales-orders/$id"
                          params={{ id: r.soId }}
                          className="td-code"
                          style={{ color: 'var(--cyan)', textDecoration: 'none' }}
                        >
                          {r.soNo}
                        </Link>
                      </td>
                      <td style={{ fontSize: 12 }}>{r.customer ?? '—'}</td>
                      <td style={{ fontSize: 11 }}>{TYPE_LABEL[r.type ?? ''] ?? r.type ?? '—'}</td>
                      <td>
                        <span
                          className={`badge ${done ? 'b-green' : r.status === 'cancelled' ? 'b-grey' : 'b-cyan'}`}
                        >
                          {done ? 'Done' : r.status}
                        </span>
                      </td>
                      <DurCell v={r.durations.design} />
                      <DurCell v={r.durations.materialProc} />
                      <DurCell v={r.durations.production} />
                      <DurCell v={r.durations.qc} />
                      <DurCell v={r.durations.assembly} />
                      <DurCell v={r.durations.assemblyToDispatch} />
                      <td
                        className="td-ctr mono fw-700"
                        style={{
                          color: totalOverAvg ? 'var(--amber)' : 'var(--green)',
                          fontSize: 14,
                        }}
                      >
                        {r.durations.total != null ? `${r.durations.total}d` : '—'}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
      <div className="text3" style={{ fontSize: 11, marginTop: 8 }}>
        💡 Durations in days. Amber = over 10d, Red = over 20d. Green rows = dispatched. Averages
        reflect the current filter.
      </div>
    </div>
  );
}

function DurCell({ v }: { v: number | null }): React.JSX.Element {
  if (v == null) return <td className="td-ctr text3">—</td>;
  const color = v > 20 ? 'var(--red)' : v > 10 ? 'var(--amber)' : 'var(--text)';
  return (
    <td className="td-ctr mono fw-700" style={{ color }}>
      {v}d
    </td>
  );
}

function Avg({
  label,
  value,
  color,
}: {
  label: string;
  value: number;
  color: string;
}): React.JSX.Element {
  return (
    <div className="panel" style={{ padding: 12, textAlign: 'center' }}>
      <div className="text3" style={{ fontSize: 10 }}>
        {label}
      </div>
      <div className="fw-700" style={{ fontSize: 22, color }}>
        {value}d
      </div>
    </div>
  );
}
