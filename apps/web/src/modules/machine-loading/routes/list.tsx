// Machine Loading (Production Wave 3). Ports legacy renderLoading (HTML L5021):
// machine cards + the open-operations table + Capacity Summary.
//
// ADR-199 table standard (2026-10-01): the open-operations table is now THE
// Innovic fit table — JC No. pinned first and carrying the row's ▸ reveal, the
// primary facts each their own column, the secondary facts (POL, Item Name, SO,
// Priority, JC Qty, Completed) in the ▸ detail. Columns / tint / reveal live in
// components/machine-loading-columns; the machine card strip and the Capacity
// Summary live in components/machine-load-cards.
//
// 25 rows per page (ADR-201): the machine pick, the search, the Operation-View
// filter and Sort & Filter run on the SERVER; the cards + Capacity Summary are
// whole-queue figures from the server; Print Queue fetches every row.
//
// The old "Job Queue View" toggle is gone (2026-09-26): it drew a second copy
// of the Job Queue screen. There is now ONE queue screen — the "Job Queue →"
// button opens /job-queue?machine=<code> for the picked machine (or all).

import type { MachineLoadCard, MachineLoadOp } from '@innovic/shared';
import { Link, createRoute } from '@tanstack/react-router';
import { Loader2, Printer } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { z } from 'zod';
import { normalizeSearchTerm } from '@/components/shared/search-match';
import {
  LIST_PAGE_SIZE,
  fetchAllPages,
  pageOffset,
  pageSearchParam,
  useClampPage,
} from '@/lib/list-paging';
import { authenticatedRoute } from '@/routes/_authenticated';
import { DataTable, Panel } from '@/ui/data';
import { useServerSortFilter } from '@/ui/data/sort-filter/server-state';
import { TABLE_KEYS } from '@/ui/data/table-keys';
import { ListFooter, ListHeader } from '@/ui/layout';
import { CapacitySummary, MachineLoadCardView } from '../components/machine-load-cards';
import { OpsExpanded, opRowTint, opsColumns } from '../components/machine-loading-columns';
import { useMyCompany } from '../../settings/api';
import { fetchMachineLoading, useMachineLoading } from '../api';
import { printMachineQueue } from '../lib/print-machine-queue';

const searchSchema = z.object({
  m: z.string().uuid().optional(),
  // Kept only so an old bookmarked ?view=queue link still parses; the queue
  // itself now lives on /job-queue (see the file header).
  view: z.enum(['ops', 'queue']).optional(),
  search: z.string().optional(),
  page: pageSearchParam,
});

export const machineLoadingRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: 'machine-loading',
  validateSearch: searchSchema,
  component: MachineLoadingPage,
});

function MachineLoadingPage(): React.JSX.Element {
  const search = machineLoadingRoute.useSearch();
  const navigate = machineLoadingRoute.useNavigate();
  const { data: company } = useMyCompany();
  const selMachineId = search.m ?? null;

  // Search box -> URL (debounced), always back to page 1.
  const [searchInput, setSearchInput] = useState(search.search ?? '');
  useEffect(() => {
    setSearchInput((prev) =>
      normalizeSearchTerm(prev) === (search.search ?? '') ? prev : (search.search ?? ''),
    );
  }, [search.search]);
  useEffect(() => {
    const trimmed = normalizeSearchTerm(searchInput);
    const next = trimmed === '' ? undefined : trimmed;
    if (next === search.search) return;
    const id = window.setTimeout(() => {
      void navigate({ search: (prev) => ({ ...prev, search: next, page: 1 }), replace: true });
    }, 300);
    return () => window.clearTimeout(id);
  }, [searchInput, search.search, navigate]);

  // Sort & Filter on the SERVER (ADR-200); every change goes to page 1.
  const sf = useServerSortFilter(TABLE_KEYS.machineLoading, () => {
    void navigate({ search: (prev) => ({ ...prev, page: 1 }), replace: true });
  });

  // The Operation View (legacy renderLoading L5060: available > 0 OR partly
  // done), the machine pick and the search run on the server over every op.
  const { data, isLoading, isFetching, isError, error } = useMachineLoading({
    machineId: selMachineId ?? undefined,
    search: search.search,
    sf: sf.param,
    limit: LIST_PAGE_SIZE,
    offset: pageOffset(search.page),
  });

  const machines = data?.machines ?? [];
  const pageOps = data?.ops ?? [];
  const total = data?.total;

  const setPage = useCallback(
    (p: number): void => {
      void navigate({ search: (prev) => ({ ...prev, page: p }), replace: true });
    },
    [navigate],
  );
  useClampPage(search.page, total, setPage);

  // Print Queue: EVERY non-complete op of the machine (or all), fetched page by
  // page — never just the 25 rows on screen.
  const [printing, setPrinting] = useState(false);
  async function onPrintQueue(machineId: string | null): Promise<void> {
    setPrinting(true);
    try {
      const ops = await fetchAllPages(async (limit, offset) => {
        const res = await fetchMachineLoading({
          machineId: machineId ?? undefined,
          scope: 'queue',
          limit,
          offset,
        });
        return { items: res.ops, total: res.total ?? res.ops.length };
      });
      if (!printMachineQueue({ machines, ops, company, machineId })) {
        window.alert('Allow popups to print.');
      }
    } catch (e) {
      window.alert(e instanceof Error ? e.message : 'Could not load the queue to print.');
    } finally {
      setPrinting(false);
    }
  }

  // Legacy's selMach IS the machine code (its PK); ours is a uuid, so the panel
  // title (legacy L5179: `${selMach} — Job Queue`) needs a lookup.
  const selMachineCode = selMachineId
    ? (machines.find((m) => m.machineId === selMachineId)?.machineCode ?? null)
    : null;

  // The row's ▸ opens its detail reveal; a Set — many can be open at once.
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const toggleExpand = (id: string): void =>
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const columns = useMemo(() => opsColumns(), []);

  function selectMachine(id: string): void {
    void navigate({
      search: (prev) => ({ ...prev, m: id, view: undefined, page: 1 }),
      replace: true,
    });
  }

  return (
    <div>
      <ListHeader
        title="Machine Loading"
        icon="▣"
        count={total}
        noun="open operation"
        filterNote={selMachineCode ?? undefined}
        search={searchInput}
        onSearch={setSearchInput}
        searchPlaceholder="Search JC no., POL, item, SO no., operation…"
        updating={isFetching && !isLoading}
        // The machine load cards below stay (they ARE this page's content —
        // load bars, hours, days to clear); a card click still picks the
        // machine. Clear resets that pick and the search (it replaced the old
        // "All Machines ×" button — owner's filter-bar decision 2026-09-26).
        onClearFilters={() => {
          setSearchInput('');
          sf.clearFilters();
          void navigate({
            search: (prev) => ({ ...prev, m: undefined, search: undefined, page: 1 }),
            replace: true,
          });
        }}
        filtersActive={searchInput !== '' || selMachineId != null || sf.filtering}
        tools={
          <>
            {/* ONE queue screen: the Job Queue, filtered to the picked machine. */}
            <Link
              to="/job-queue"
              search={selMachineCode ? { machine: selMachineCode } : {}}
              className="btn btn-ghost"
              title={
                selMachineCode
                  ? `Open the Job Queue for ${selMachineCode}`
                  : 'Open the Job Queue for every machine'
              }
            >
              Job Queue →
            </Link>
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => void onPrintQueue(selMachineId)}
              disabled={machines.length === 0 || printing}
              title={selMachineId ? 'Print this machine queue' : 'Print all machine queues'}
            >
              <Printer size={13} /> Print Queue
            </button>
          </>
        }
      />

      {isLoading ? (
        <div className="panel">
          <div className="empty-state">
            <Loader2 className="mr-2 inline h-4 w-4 animate-spin" /> Loading machine load…
          </div>
        </div>
      ) : isError ? (
        <div className="panel">
          <div className="empty-state" style={{ color: 'var(--red2)' }}>
            {error instanceof Error ? error.message : 'Could not load machine loading. Try again.'}
          </div>
        </div>
      ) : (
        <>
          {/* Machine cards — legacy .mach-cards (L221): 5 fixed columns, gap 10,
              margin-bottom 16. Not ported to our theme, so inlined verbatim. */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(5, 1fr)',
              gap: 10,
              marginBottom: 16,
            }}
          >
            {machines.map((m: MachineLoadCard) => (
              <MachineLoadCardView
                key={m.machineId}
                card={m}
                selected={m.machineId === selMachineId}
                onClick={() => selectMachine(m.machineId)}
              />
            ))}
            {machines.length === 0 ? (
              <div className="text3" style={{ fontSize: 12 }}>
                No machines configured.
              </div>
            ) : null}
          </div>

          {/* The open-operations fit table (ADR-199). */}
          <Panel
            title={selMachineCode ? `${selMachineCode} — Job Queue` : 'All Open Operations'}
            actions={
              <span className="mono" style={{ color: 'var(--amber2)', fontSize: 12 }}>
                {total ?? 0} ops
              </span>
            }
            bodyPadding="none"
          >
            <DataTable
              tableKey={TABLE_KEYS.machineLoading}
              columns={columns}
              rows={pageOps}
              sortFilterServer={sf}
              rowKey={(op: MachineLoadOp) => op.jcOpId}
              emptyText={
                search.search || sf.filtering
                  ? 'No pending operations match.'
                  : 'No pending operations.'
              }
              rowClassName={(op) => opRowTint(op)}
              onRowClick={(op) =>
                void navigate({ to: '/job-cards/$id', params: { id: op.jobCardId } })
              }
              // The fit table's ▸ is the row's one expand control: it opens the
              // op's secondary facts. renderExpanded returns null for a closed row.
              renderExpanded={(op) => (expandedIds.has(op.jcOpId) ? <OpsExpanded op={op} /> : null)}
              onToggleExpanded={(op) => toggleExpand(op.jcOpId)}
            />
          </Panel>

          <ListFooter
            total={total ?? 0}
            noun="open operation"
            page={search.page}
            pageSize={LIST_PAGE_SIZE}
            onPage={setPage}
          />

          <CapacitySummary machines={machines} />
        </>
      )}
    </div>
  );
}
