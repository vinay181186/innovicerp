// Job Queue — mirrors legacy renderJobQueue (HTML L10363).
//
// Pending ops per machine, each machine panel its own shared fit table (ADR-199
// table standard 2026-10-01): every panel renders a <DataTable tableKey={
// TABLE_KEYS.jobQueue}> with the SAME columns, so all machines share one
// remembered column layout. The eight on-sheet columns and the ▸ detail columns
// (and the ▲/▼ reorder controls + ⋯ op-entry menu in the Action column) live in
// ../components/job-queue-columns. Same jc_create / op_entry access.
//
// 25 rows per page (ADR-201): the machine picker, the search and the paging run
// on the SERVER over the whole queue (machines by code, each in its saved
// order); the page's rows are grouped into machine panels. Panel figures
// (pending jobs / hours) and the picker counts are whole-queue figures from
// the server. Up/down asks the server to swap the row with its neighbour in the
// machine's FULL queue, so a move on page 2 never disturbs another page.

import type { JobQueueRow } from '@innovic/shared';
import { createRoute } from '@tanstack/react-router';
import { Loader2 } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { z } from 'zod';
import { normalizeSearchTerm } from '@/components/shared/search-match';
import { effectiveFormPerms, useMyAccess } from '@/lib/access-control';
import { todayIst } from '@/lib/date';
import { LIST_PAGE_SIZE, pageOffset, pageSearchParam, useClampPage } from '@/lib/list-paging';
import { useSession } from '@/lib/session';
import { authenticatedRoute } from '@/routes/_authenticated';
import { DataTable } from '@/ui/data';
import { TABLE_KEYS } from '@/ui/data/table-keys';
import { Select } from '@/ui/forms';
import { ListFooter, ListHeader } from '@/ui/layout';
import {
  JOB_QUEUE_HIDDEN_IDS,
  jobQueueColumns,
  jobQueueRowActions,
  jobQueueRowTint,
} from '../components/job-queue-columns';
import { useBackfillMachineIds, useJobQueue, useMoveJobQueueOp } from '../api';

const searchSchema = z.object({
  machine: z.string().optional(),
  search: z.string().optional(),
  page: pageSearchParam,
});

export const jobQueueRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: 'job-queue',
  validateSearch: searchSchema,
  component: JobQueuePage,
});

function JobQueuePage(): React.JSX.Element {
  const { data: me } = useSession();
  // Tier-driven, per department (Production). Reordering the queue rewrites saved
  // jc_ops → jc_create edit. Start / Log Op open /op-entry, so they use the SAME
  // key as that page (op_entry entry).
  const { data: eff } = useMyAccess();
  const canReorder = effectiveFormPerms(eff, 'jc_create').edit;
  const canOpEntry = effectiveFormPerms(eff, 'op_entry').entry;
  const search = jobQueueRoute.useSearch();
  const navigate = jobQueueRoute.useNavigate();
  const selectedMachineCode = search.machine ?? '';

  // The machine-code backfill stays a pure admin data-hygiene tool (the server
  // gates it requireAdminRole), so it is not part of the tier model.
  const isAdmin = me?.role === 'admin';

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
  const searching = (search.search ?? '') !== '';

  // The URL carries the machine CODE; the server pages by machine id. Every
  // paged response carries ALL machine summaries, so the code resolves from
  // the last response (a cold deep link first asks for a 1-row page to learn it).
  const [machineIdByCode, setMachineIdByCode] = useState<Map<string, string>>(new Map());
  const machineId = selectedMachineCode ? machineIdByCode.get(selectedMachineCode) : undefined;
  const waitingForMachineId = selectedMachineCode !== '' && machineId === undefined;

  const { data, isLoading, isError, error } = useJobQueue({
    machineId,
    search: search.search,
    limit: waitingForMachineId ? 1 : LIST_PAGE_SIZE,
    offset: waitingForMachineId ? 0 : pageOffset(search.page),
  });
  const moveMut = useMoveJobQueueOp();
  const backfillMut = useBackfillMachineIds();

  const machines = useMemo(() => data?.machines ?? [], [data?.machines]);
  useEffect(() => {
    if (machines.length === 0) return;
    setMachineIdByCode((prev) => {
      if (machines.every((m) => prev.get(m.machineCode) === m.machineId)) return prev;
      return new Map(machines.map((m) => [m.machineCode, m.machineId]));
    });
  }, [machines]);
  const selectedMachine = useMemo(
    () =>
      selectedMachineCode
        ? (machines.find((m) => m.machineCode === selectedMachineCode) ?? null)
        : null,
    [machines, selectedMachineCode],
  );
  const total = waitingForMachineId ? undefined : data?.total;

  const setPage = useCallback(
    (p: number): void => {
      void navigate({ search: (prev) => ({ ...prev, page: p }), replace: true });
    },
    [navigate],
  );
  useClampPage(search.page, total, setPage);

  // The page's rows, grouped into machine panels (machines in code order). A
  // picked machine with nothing pending still shows its "no pending" panel.
  const shownMachines = waitingForMachineId
    ? []
    : selectedMachine
      ? [selectedMachine]
      : machines.filter((m) => m.rows.length > 0);

  const today = todayIst();

  const setMachine = (code: string | null): void => {
    void navigate({ search: (prev) => ({ ...prev, machine: code ?? undefined, page: 1 }) });
  };

  const onMove = (mid: string, opId: string, dir: 'up' | 'down'): void => {
    moveMut.mutate({ machineId: mid, input: { jcOpId: opId, dir } });
  };

  return (
    <div>
      <ListHeader
        title="Job Queue"
        icon="⬛"
        count={total}
        noun="pending op"
        filterNote={selectedMachine ? selectedMachine.machineCode : undefined}
        search={searchInput}
        onSearch={setSearchInput}
        searchPlaceholder="Search JC no., POL, item, SO no., customer, operation…"
        // The machine picker (owner's filter-bar decision 2026-09-26): the
        // clickable machine-card strip became this dropdown — each label carries
        // the pending-op count the card showed, and ▶n when ops are running.
        filters={
          <Select
            aria-label="Machine"
            title="Machine"
            value={selectedMachine ? selectedMachine.machineCode : ''}
            options={[
              {
                value: '',
                label: `All machines (${machines.reduce((n, m) => n + m.pendingCount, 0)})`,
              },
              ...machines.map((m) => ({
                value: m.machineCode,
                label: `${m.machineCode} (${m.pendingCount})${m.runningCount > 0 ? ` ▶${m.runningCount}` : ''}`,
              })),
            ]}
            onChange={(e) => setMachine(e.target.value === '' ? null : e.target.value)}
          />
        }
        onClearFilters={() => {
          setSearchInput('');
          void navigate({
            search: (prev) => ({ ...prev, machine: undefined, search: undefined, page: 1 }),
          });
        }}
        filtersActive={searchInput !== '' || selectedMachineCode !== ''}
        tools={
          <>
            {isAdmin ? (
              <button
                type="button"
                className="btn btn-ghost"
                disabled={backfillMut.isPending}
                title="Safe to run repeatedly."
                onClick={() => backfillMut.mutate()}
              >
                {backfillMut.isPending
                  ? 'Linking…'
                  : backfillMut.isSuccess
                    ? `Linked ${backfillMut.data.updated} op(s) ✓`
                    : 'Link machine codes'}
              </button>
            ) : null}
          </>
        }
      />

      {isLoading ? (
        <div className="panel">
          <div className="panel-body">
            <div className="text3" style={{ fontSize: 12 }}>
              <Loader2 size={14} className="inline animate-spin" /> Loading…
            </div>
          </div>
        </div>
      ) : isError ? (
        <div className="panel">
          <div className="panel-body">
            <div className="empty-state" style={{ color: 'var(--red2)' }}>
              {error instanceof Error ? error.message : 'Could not load job queue. Try again.'}
            </div>
          </div>
        </div>
      ) : shownMachines.length === 0 ? (
        <div className="panel">
          <div className="empty-state" style={{ padding: 32 }}>
            {searching ? 'No pending operations match.' : 'No pending operations.'}
          </div>
        </div>
      ) : (
        shownMachines.map((m) => {
          // Position in the machine's FULL queue (from the server), so Sr No and
          // the up/down limits stay true on any page and while a search narrows it.
          const posById = new Map(m.rows.map((r, i) => [r.jcOpId, r.queueIndex ?? i]));
          const machineRows = m.rows;
          return (
            <div key={m.machineId} className="panel" style={{ marginBottom: 14 }}>
              <div className="panel-hdr" style={{ background: 'var(--bg4)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, flex: 1 }}>
                  <span className="mono fw-700" style={{ fontSize: 15 }}>
                    {m.machineCode}
                  </span>
                  <span className="text2" style={{ fontSize: 12 }}>
                    {m.machineName ?? ''}
                  </span>
                  <span className="mono text3" style={{ fontSize: 11 }}>
                    {m.pendingHrs}h pending
                  </span>
                </div>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <span
                    style={{
                      padding: '2px 8px',
                      borderRadius: 10,
                      fontSize: 11,
                      fontWeight: 700,
                      background:
                        m.pendingHrs > 80
                          ? 'rgba(239,68,68,0.10)'
                          : m.pendingHrs > 40
                            ? 'rgba(245,158,11,0.10)'
                            : 'rgba(34,197,94,0.10)',
                      color:
                        m.pendingHrs > 80
                          ? 'var(--red)'
                          : m.pendingHrs > 40
                            ? 'var(--amber)'
                            : 'var(--green)',
                    }}
                  >
                    {m.pendingHrs > 80 ? 'Overloaded' : m.pendingHrs > 40 ? 'Busy' : 'Clear'}
                  </span>
                  <span className="mono amber" style={{ fontSize: 11 }}>
                    {m.pendingCount} jobs
                  </span>
                </div>
              </div>
              {machineRows.length === 0 ? (
                <div className="empty-state" style={{ padding: 18 }}>
                  ✓ No pending jobs for this machine
                </div>
              ) : (
                <DataTable<JobQueueRow>
                  tableKey={TABLE_KEYS.jobQueue}
                  columns={jobQueueColumns({ machine: m, posById, today })}
                  rows={machineRows}
                  rowKey={(r) => r.jcOpId}
                  defaultHidden={JOB_QUEUE_HIDDEN_IDS}
                  // Manual queue order must stay — no browser sort/filter on top
                  // of the ▲/▼ reorder (the page's own search already narrows).
                  sortFilter={false}
                  rowClassName={(r) => jobQueueRowTint(r, today)}
                  onRowClick={(r) =>
                    void navigate({ to: '/job-cards/$id', params: { id: r.jcId } })
                  }
                  rowActions={(r) =>
                    jobQueueRowActions({
                      row: r,
                      machine: m,
                      posById,
                      canReorder,
                      canOpEntry,
                      searching,
                      onMove,
                    })
                  }
                />
              )}
            </div>
          );
        })
      )}

      <ListFooter
        total={total ?? 0}
        noun="pending op"
        page={search.page}
        pageSize={LIST_PAGE_SIZE}
        onPage={setPage}
      />
    </div>
  );
}
