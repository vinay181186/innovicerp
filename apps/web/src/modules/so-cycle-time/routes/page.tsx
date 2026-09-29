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
import { StatStrip } from '@/ui/data';
import { ReportFilter, ReportShell } from '@/ui/data/ReportShell';
import { ListFooter } from '@/ui/layout';
import { soStatusLabel } from '@/modules/sales-orders/lib/so-status-label';
import { exportSoCycleTime } from '../lib/export';

export const soCycleTimeRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: 'so-cycle-time',
  component: SoCycleTimePage,
});

const TYPE_LABEL: Record<string, string> = {
  component_manufacturing: 'Component',
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
  { value: 'component_manufacturing', label: 'Component Only' },
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

  const title = 'SO Cycle Time Report';
  if (isLoading) {
    return (
      <ReportShell title={title}>
        <div className="empty-state">
          <Loader2 className="inline h-4 w-4 animate-spin" /> Loading…
        </div>
      </ReportShell>
    );
  }
  if (isError || !data) {
    return (
      <ReportShell title={title}>
        <div className="empty-state" style={{ color: 'var(--red2)' }}>
          {error instanceof Error ? error.message : 'Could not load SO cycle time. Try again.'}
        </div>
      </ReportShell>
    );
  }

  return (
    <ReportShell
      title={title}
      filters={
        <>
          <ReportFilter label="Search" htmlFor="sct-search" size="lg">
            <input
              id="sct-search"
              className="innovic-input"
              placeholder="Search SO No., customer…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </ReportFilter>
          <ReportFilter label="Show" htmlFor="sct-filter">
            <select
              id="sct-filter"
              className="innovic-select"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
            >
              {FILTERS.map((f) => (
                <option key={f.value} value={f.value}>
                  {f.label}
                </option>
              ))}
            </select>
          </ReportFilter>
        </>
      }
      onClear={() => {
        setSearch('');
        setFilter('all');
      }}
      onExport={{ excel: () => exportSoCycleTime(filtered) }}
      kpis={
        // Averages over the filtered set
        <StatStrip
          items={[
            {
              key: 'design',
              label: 'Avg Design',
              count: `${averages.design}d`,
              color: 'var(--purple)',
            },
            {
              key: 'production',
              label: 'Avg Production',
              count: `${averages.production}d`,
              color: 'var(--cyan)',
            },
            { key: 'qc', label: 'Avg QC', count: `${averages.qc}d`, color: 'var(--text)' },
            {
              key: 'assembly',
              label: 'Avg Assembly',
              count: `${averages.assembly}d`,
              color: 'var(--blue)',
            },
            {
              key: 'total',
              label: 'Avg Total Cycle',
              count: `${averages.total}d`,
              color: 'var(--green)',
            },
          ]}
        />
      }
      rowCount={filtered.length}
      rowNoun="SO"
      footer={
        <>
          <ListFooter total={filtered.length} noun="SO" />
          <div className="text3" style={{ fontSize: 'var(--fs-xs)', marginTop: 'var(--sp-1)' }}>
            Days · amber &gt; 10 · red &gt; 20 · green = dispatched
          </div>
        </>
      }
    >
      <div className="panel">
        <div className="tbl-wrap">
          <table className="innovic-table">
            <thead>
              <tr>
                <th>SO No.</th>
                <th>Customer</th>
                <th>SO Type</th>
                <th>SO Status</th>
                <th className="th-num">Design</th>
                <th className="th-num">Material</th>
                <th className="th-num">Production</th>
                <th className="th-num">QC</th>
                <th className="th-num">Assembly</th>
                <th className="th-num">Dispatch</th>
                <th className="th-num">Total</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={11} className="empty-state">
                    {search.trim() || filter !== 'all' ? 'No SOs match.' : 'No SOs yet.'}
                  </td>
                </tr>
              ) : (
                filtered.map((r) => {
                  const done = Boolean(r.phases.dispatched);
                  const totalOverAvg =
                    r.durations.total != null && r.durations.total > averages.total;
                  return (
                    <tr
                      key={r.soId}
                      style={done ? { background: 'rgba(34,197,94,0.02)' } : undefined}
                    >
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
                      <td>{r.customer ?? '—'}</td>
                      <td>{TYPE_LABEL[r.type ?? ''] ?? r.type ?? '—'}</td>
                      <td>
                        <span
                          className={`badge ${done ? 'b-green' : r.status === 'cancelled' ? 'b-grey' : 'b-blue'}`}
                        >
                          {done ? 'Completed' : soStatusLabel(r.status)}
                        </span>
                      </td>
                      <DurCell v={r.durations.design} />
                      <DurCell v={r.durations.materialProc} />
                      <DurCell v={r.durations.production} />
                      <DurCell v={r.durations.qc} />
                      <DurCell v={r.durations.assembly} />
                      <DurCell v={r.durations.assemblyToDispatch} />
                      <td
                        className="td-num mono fw-700"
                        style={{ color: totalOverAvg ? 'var(--amber)' : 'var(--green)' }}
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
    </ReportShell>
  );
}

function DurCell({ v }: { v: number | null }): React.JSX.Element {
  if (v == null) return <td className="td-num text3">—</td>;
  const color = v > 20 ? 'var(--red)' : v > 10 ? 'var(--amber)' : 'var(--text)';
  return (
    <td className="td-num mono fw-700" style={{ color }}>
      {v}d
    </td>
  );
}
