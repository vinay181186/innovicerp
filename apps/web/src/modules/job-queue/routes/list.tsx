// Job Queue — mirrors legacy renderJobQueue (HTML L10363).
//
// Pending ops per machine in ONE shared fit table (ADR-203 frozen header): the
// former per-machine panels are full-width group headings inside the one table
// ("VMC-1 · 9 jobs · 12.5 h · Busy"), so the page has one scrollbar and one
// column header that never scrolls away (`page-fill` + `<Panel fill>`, ADR-202).
// The eight on-sheet columns and the ▸ detail columns (and the ▲/▼ reorder
// controls + ⋯ op-entry menu in the Action column) live in
// ../components/job-queue-columns. Same jc_create / op_entry access.
//
// 25 rows per page (ADR-201): the machine picker, the search and the paging run
// on the SERVER over the whole queue (machines by code, each in its saved
// order); the page's rows are grouped under machine headings. Heading figures
// (pending jobs / hours) and the picker counts are whole-queue figures from
// the server. Up/down asks the server to swap the row with its neighbour in the
// machine's FULL queue, so a move on page 2 never disturbs another page.

import { createRoute } from '@tanstack/react-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { z } from 'zod';
import { normalizeSearchTerm } from '@/components/shared/search-match';
import { effectiveFormPerms, useMyAccess } from '@/lib/access-control';
import { todayIst } from '@/lib/date';
import { LIST_PAGE_SIZE, pageOffset, pageSearchParam, useClampPage } from '@/lib/list-paging';
import { useSession } from '@/lib/session';
import { authenticatedRoute } from '@/routes/_authenticated';
import { DataTable, Panel } from '@/ui/data';
import { TABLE_KEYS } from '@/ui/data/table-keys';
import { Select } from '@/ui/forms';
import { ListFooter, ListHeader } from '@/ui/layout';
import {
  flattenQueue,
  JOB_QUEUE_HIDDEN_IDS,
  type JobQueueSheetRow,
  jobQueueColumns,
  MachineGroupHeading,
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
  const resolvingMachine = selectedMachineCode !== '' && machineId === undefined;

  const { data, isLoading, isError, error } = useJobQueue({
    machineId,
    search: search.search,
    limit: resolvingMachine ? 1 : LIST_PAGE_SIZE,
    offset: resolvingMachine ? 0 : pageOffset(search.page),
  });
  const moveMut = useMoveJobQueueOp();
  const backfillMut = useBackfillMachineIds();

  const machines = useMemo(() => data?.machines ?? [], [data?.machines]);
  // The lookup answered (every response carries ALL machines) and the URL's
  // code is not among them: stop waiting and say so, never spin forever.
  const machineNotFound =
    resolvingMachine &&
    data !== undefined &&
    !machines.some((m) => m.machineCode === selectedMachineCode);
  const waitingForMachineId = resolvingMachine && !machineNotFound;
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
  const total = waitingForMachineId ? undefined : machineNotFound ? 0 : data?.total;

  const setPage = useCallback(
    (p: number): void => {
      void navigate({ search: (prev) => ({ ...prev, page: p }), replace: true });
    },
    [navigate],
  );
  useClampPage(search.page, total, setPage);

  // The page's rows as ONE list, grouped under machine headings (machines in
  // code order). A picked machine with nothing pending shows its own
  // "no pending jobs" empty state.
  const sheetRows = useMemo(
    () =>
      waitingForMachineId || machineNotFound
        ? []
        : flattenQueue(selectedMachine ? [selectedMachine] : machines),
    [waitingForMachineId, machineNotFound, selectedMachine, machines],
  );

  const today = todayIst();
  const columns = useMemo(() => jobQueueColumns({ today }), [today]);
  const emptyText = machineNotFound
    ? `Machine ${selectedMachineCode} not found.`
    : selectedMachine
      ? `✓ No pending jobs for ${selectedMachine.machineCode}`
      : searching
        ? 'No pending operations match.'
        : 'No pending operations.';

  const setMachine = (code: string | null): void => {
    void navigate({ search: (prev) => ({ ...prev, machine: code ?? undefined, page: 1 }) });
  };

  const onMove = (mid: string, opId: string, dir: 'up' | 'down'): void => {
    moveMut.mutate({ machineId: mid, input: { jcOpId: opId, dir } });
  };

  return (
    <div className="page-fill">
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

      {isError ? (
        <div className="panel">
          <div className="panel-body">
            <div className="empty-state" style={{ color: 'var(--red2)' }}>
              {error instanceof Error ? error.message : 'Could not load job queue. Try again.'}
            </div>
          </div>
        </div>
      ) : (
        <Panel fill bodyPadding="none">
          <DataTable<JobQueueSheetRow>
            tableKey={TABLE_KEYS.jobQueue}
            columns={columns}
            rows={sheetRows}
            rowKey={(r) => `${r.queueMachine.machineId}:${r.jcOpId}`}
            loading={isLoading || waitingForMachineId}
            emptyText={emptyText}
            defaultHidden={JOB_QUEUE_HIDDEN_IDS}
            // Manual queue order must stay — no browser sort/filter on top
            // of the ▲/▼ reorder (the page's own search already narrows).
            sortFilter={false}
            groupRow={(r, _i, prev) =>
              prev && prev.queueMachine.machineId === r.queueMachine.machineId ? null : (
                <MachineGroupHeading m={r.queueMachine} />
              )
            }
            rowClassName={(r) => jobQueueRowTint(r, today)}
            onRowClick={(r) => void navigate({ to: '/job-cards/$id', params: { id: r.jcId } })}
            rowActions={(r) =>
              jobQueueRowActions({ row: r, canReorder, canOpEntry, searching, onMove })
            }
          />
        </Panel>
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
