// SO Cycle Time Report — mirror of legacy renderSOCycleTime (L18176).
//
// Per-SO phase durations + averages over the filtered set (legacy behaviour).
// Read-only. Excel export of the full matrix.
//
// ADR-199 table standard (2026-10-01): the one ruled fit sheet <DataTable
// tableKey={TABLE_KEYS.soCycleTime}>. SO No. is the pinned first column; every
// phase-duration column is a right-aligned number (kind 'num'); a dispatched
// (completed) SO gets the green done-row tint. Row click opens the Sales Order.
//
// ADR-201 (2026-10-02): 25 SOs a page. The Show filter, the search, Sort &
// Filter (▾) and the page run on the SERVER over every SO (filter + page in the
// URL; any change → page 1). The average tiles are the server's averages over
// every MATCHING SO — never the 25 on screen. Excel = every matching SO.
//
// Every duration rendered here is SERVER-computed (so-cycle-time/service.ts ->
// lib/so-phase-data.ts computeDurations); this page only renders them.

import { SO_CYCLE_TIME_SHOW, type SoCycleTimeRow, type SoCycleTimeShow } from '@innovic/shared';
import { createRoute, useNavigate } from '@tanstack/react-router';
import { Loader2 } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { z } from 'zod';
import { normalizeSearchTerm } from '@/components/shared/search-match';
import { LIST_PAGE_SIZE, pageOffset, pageSearchParam, useClampPage } from '@/lib/list-paging';
import { authenticatedRoute } from '@/routes/_authenticated';
import { DataTable, Panel, ROW_TINT, StatStrip } from '@/ui/data';
import { useServerSortFilter } from '@/ui/data/sort-filter/server-state';
import { TABLE_KEYS } from '@/ui/data/table-keys';
import { ReportFilter, ReportShell } from '@/ui/data/ReportShell';
import { ListFooter } from '@/ui/layout';
import { fetchAllSoCycleTime, useSoCycleTime, type SoCycleTimeParams } from '../api';
import { soCycleTimeColumns } from '../lib/columns';
import { exportSoCycleTime } from '../lib/export';

const sctSearchSchema = z.object({
  show: z.enum(SO_CYCLE_TIME_SHOW).optional(),
  q: z.string().optional(),
  page: pageSearchParam,
});
type SctSearch = z.infer<typeof sctSearchSchema>;

export const soCycleTimeRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: 'so-cycle-time',
  validateSearch: sctSearchSchema,
  component: SoCycleTimePage,
});

const FILTERS: { value: SoCycleTimeShow; label: string }[] = [
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

function SoCycleTimePage(): React.JSX.Element {
  const urlSearch = soCycleTimeRoute.useSearch();
  const routeNavigate = soCycleTimeRoute.useNavigate();
  const navigate = useNavigate();
  const filter: SoCycleTimeShow = urlSearch.show ?? 'all';
  // Any filter change goes back to page 1 (a page change passes its own page).
  const go = useCallback(
    (patch: Partial<SctSearch>) =>
      void routeNavigate({
        search: (p) => ({ ...p, ...patch, page: patch.page ?? 1 }),
        replace: true,
      }),
    [routeNavigate],
  );

  // Typed search → URL after a short pause (page 1).
  const [search, setSearch] = useState(urlSearch.q ?? '');
  useEffect(() => {
    setSearch((prev) =>
      normalizeSearchTerm(prev) === (urlSearch.q ?? '') ? prev : (urlSearch.q ?? ''),
    );
  }, [urlSearch.q]);
  useEffect(() => {
    const t = normalizeSearchTerm(search);
    const next = t === '' ? undefined : t;
    if (next === urlSearch.q) return;
    const id = window.setTimeout(() => go({ q: next }), 300);
    return () => window.clearTimeout(id);
  }, [search, urlSearch.q, go]);

  const sf = useServerSortFilter(TABLE_KEYS.soCycleTime, () => go({}));
  const params: SoCycleTimeParams = useMemo(
    () => ({ show: filter, search: urlSearch.q, sf: sf.param }),
    [filter, urlSearch.q, sf.param],
  );
  const { data, isLoading, isError, error } = useSoCycleTime(
    params,
    LIST_PAGE_SIZE,
    pageOffset(urlSearch.page),
  );
  const gotoPage = useCallback((p: number) => go({ page: p }), [go]);
  useClampPage(urlSearch.page, data?.total, gotoPage);

  // Excel = every matching SO, fetched page by page (never just the 25 shown).
  const [exporting, setExporting] = useState(false);
  const runExport = (): void => {
    setExporting(true);
    void fetchAllSoCycleTime(params)
      .then((all) => exportSoCycleTime(all))
      .catch((e: unknown) =>
        window.alert(e instanceof Error ? e.message : 'Could not export. Try again.'),
      )
      .finally(() => setExporting(false));
  };

  const averages = data?.averages ?? { design: 0, production: 0, qc: 0, assembly: 0, total: 0 };
  const columns = useMemo(() => soCycleTimeColumns(averages.total), [averages.total]);

  const title = 'SO Cycle Time Report';
  if (isLoading && !data) {
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
              onChange={(e) => go({ show: e.target.value as SoCycleTimeShow })}
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
        void routeNavigate({ search: { page: 1 }, replace: true });
      }}
      onExport={{ excel: runExport, busy: exporting }}
      exportDisabled={data.total === 0}
      kpis={
        // Averages over every matching SO (server-side, all pages)
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
      footer={
        <>
          <ListFooter
            total={data.total}
            noun="SO"
            page={urlSearch.page}
            pageSize={LIST_PAGE_SIZE}
            onPage={gotoPage}
          />
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
          rows={data.rows}
          rowKey={(r) => r.soId}
          sortFilterServer={sf}
          empty={
            search.trim() || filter !== 'all' || sf.filtering ? 'No SOs match.' : 'No SOs yet.'
          }
          rowClassName={(r) => (r.phases.dispatched ? ROW_TINT.done : undefined)}
          onRowClick={(r) => void navigate({ to: '/sales-orders/$id', params: { id: r.soId } })}
        />
      </Panel>
    </ReportShell>
  );
}
