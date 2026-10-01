// SO Cycle Time Report — mirror of legacy renderSOCycleTime (L18176).
//
// Per-SO phase durations + filtered-set averages. Filter (All / Completed /
// Active / by type) + text search are client-side; averages recompute over the
// filtered set (legacy behaviour). Read-only. Excel export of the full matrix.
//
// ADR-199 table standard (2026-10-01): the one ruled fit sheet <DataTable
// tableKey={TABLE_KEYS.soCycleTime}>. SO No. is the pinned first column; every
// phase-duration column is a right-aligned number (kind 'num'); a dispatched
// (completed) SO gets the green done-row tint. Column sort + filter come from
// the table's own ▾ header menus (ADR-200). Row click opens the Sales Order.
//
// Every duration rendered here is SERVER-computed (so-cycle-time/service.ts ->
// lib/so-phase-data.ts computeDurations). Nothing on this page derives a
// duration from raw records — we only render r.durations.* and take a mean of
// them over the rows already on screen.
//
// Note: the API also returns `averages` (over the FULL set). We do not use it —
// legacy recomputes averages over the filtered set on every render (L18199) and
// the filter is client-side, so a full-set average would not match the table.

import type { SoCycleTimeResponse, SoCycleTimeRow } from '@innovic/shared';
import { Link, createRoute, useNavigate } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { apiFetch } from '@/lib/api';
import { authenticatedRoute } from '@/routes/_authenticated';
import { DataTable, Panel, ROW_TINT, StatStrip, type DataTableColumn } from '@/ui/data';
import { TABLE_KEYS } from '@/ui/data/table-keys';
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

/** A phase-duration cell: "Nd" coloured amber > 10 / red > 20, "—" when the
 *  phase was never reached. Days footnote below the table explains the scale. */
function durContent(v: number | null): React.JSX.Element {
  if (v == null) return <span className="text3">—</span>;
  const color = v > 20 ? 'var(--red)' : v > 10 ? 'var(--amber)' : 'var(--text)';
  return (
    <span className="mono fw-700" style={{ color }}>
      {v}d
    </span>
  );
}

function soCycleTimeColumns(avgTotal: number): DataTableColumn<SoCycleTimeRow>[] {
  const dur = (
    id: string,
    header: string,
    get: (r: SoCycleTimeRow) => number | null,
  ): DataTableColumn<SoCycleTimeRow> => ({
    id,
    kind: 'num',
    header,
    filterValue: (r) => get(r),
    render: (r) => durContent(get(r)),
  });

  return [
    {
      id: 'so_no',
      kind: 'code',
      header: 'SO No.',
      nowrap: true,
      render: (r) => (
        <Link
          to="/sales-orders/$id"
          params={{ id: r.soId }}
          className="td-code"
          style={{ color: 'var(--cyan)', textDecoration: 'none' }}
          onClick={(e) => e.stopPropagation()}
        >
          {r.soNo}
        </Link>
      ),
    },
    {
      id: 'customer',
      kind: 'text',
      header: 'Customer',
      align: 'left',
      ellipsis: true,
      render: (r) => r.customer ?? '—',
      title: (r) => r.customer ?? '',
    },
    {
      id: 'so_type',
      kind: 'code',
      header: 'SO Type',
      filterValue: (r) => TYPE_LABEL[r.type ?? ''] ?? r.type ?? '',
      render: (r) => TYPE_LABEL[r.type ?? ''] ?? r.type ?? '—',
    },
    {
      id: 'so_status',
      kind: 'badge',
      header: 'SO Status',
      filterValue: (r) => (r.phases.dispatched ? 'Completed' : soStatusLabel(r.status)),
      render: (r) => {
        const done = Boolean(r.phases.dispatched);
        return (
          <span
            className={`badge ${done ? 'b-green' : r.status === 'cancelled' ? 'b-grey' : 'b-blue'}`}
          >
            {done ? 'Completed' : soStatusLabel(r.status)}
          </span>
        );
      },
    },
    dur('design', 'Design', (r) => r.durations.design),
    dur('material', 'Material', (r) => r.durations.materialProc),
    dur('production', 'Production', (r) => r.durations.production),
    dur('qc', 'QC', (r) => r.durations.qc),
    dur('assembly', 'Assembly', (r) => r.durations.assembly),
    dur('dispatch', 'Dispatch', (r) => r.durations.assemblyToDispatch),
    {
      id: 'total',
      kind: 'num',
      header: 'Total',
      filterValue: (r) => r.durations.total,
      render: (r) => {
        if (r.durations.total == null) return <span className="text3">—</span>;
        const over = r.durations.total > avgTotal;
        return (
          <span className="mono fw-700" style={{ color: over ? 'var(--amber)' : 'var(--green)' }}>
            {r.durations.total}d
          </span>
        );
      },
    },
  ];
}

function SoCycleTimePage(): React.JSX.Element {
  const { data, isLoading, isError, error } = useQuery<SoCycleTimeResponse>({
    queryKey: ['so-cycle-time'],
    queryFn: () => apiFetch<SoCycleTimeResponse>('/so-cycle-time'),
    staleTime: 30_000,
  });

  const navigate = useNavigate();
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
  const columns = useMemo(() => soCycleTimeColumns(averages.total), [averages.total]);

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
      <Panel bodyPadding="none">
        <DataTable<SoCycleTimeRow>
          tableKey={TABLE_KEYS.soCycleTime}
          columns={columns}
          rows={filtered}
          rowKey={(r) => r.soId}
          empty={search.trim() || filter !== 'all' ? 'No SOs match.' : 'No SOs yet.'}
          rowClassName={(r) => (r.phases.dispatched ? ROW_TINT.done : undefined)}
          onRowClick={(r) => void navigate({ to: '/sales-orders/$id', params: { id: r.soId } })}
        />
      </Panel>
    </ReportShell>
  );
}
