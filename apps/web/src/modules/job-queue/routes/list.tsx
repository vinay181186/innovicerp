// Job Queue — mirrors legacy renderJobQueue (HTML L10363).
//
// Pending ops per machine, each machine panel its own shared fit table (ADR-199
// table standard 2026-10-01): every panel renders a <DataTable tableKey={
// TABLE_KEYS.jobQueue}> with the SAME columns, so all machines share one
// remembered column layout. The eight on-sheet columns and the ▸ detail columns
// (and the ▲/▼ reorder controls + ⋯ op-entry menu in the Action column) live in
// ../components/job-queue-columns. The DATA and RULES stay: same query, same
// jc_create / op_entry access, same machine picker, same client-side search,
// same optimistic reorder.

import type { JobQueueRow } from '@innovic/shared';
import { createRoute } from '@tanstack/react-router';
import { Loader2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { z } from 'zod';
import { effectiveFormPerms, useMyAccess } from '@/lib/access-control';
import { todayIst } from '@/lib/date';
import { itemCodeWithRev } from '@/lib/item-code';
import { useSession } from '@/lib/session';
import { authenticatedRoute } from '@/routes/_authenticated';
import { DataTable } from '@/ui/data';
import { TABLE_KEYS } from '@/ui/data/table-keys';
import { Select } from '@/ui/forms';
import { ListHeader } from '@/ui/layout';
import {
  JOB_QUEUE_HIDDEN_IDS,
  jobQueueColumns,
  jobQueueRowActions,
  jobQueueRowTint,
} from '../components/job-queue-columns';
import { useBackfillMachineIds, useJobQueue, useReorderJobQueue } from '../api';

const searchSchema = z.object({
  machine: z.string().optional(),
});

export const jobQueueRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: 'job-queue',
  validateSearch: (search) => searchSchema.parse(search),
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
  const { data, isLoading, isError, error } = useJobQueue({});
  const reorderMut = useReorderJobQueue();
  const backfillMut = useBackfillMachineIds();

  const machines = data?.machines ?? [];
  const selectedMachine = useMemo(
    () =>
      selectedMachineCode
        ? (machines.find((m) => m.machineCode === selectedMachineCode) ?? null)
        : null,
    [machines, selectedMachineCode],
  );
  const displayMachines = selectedMachine ? [selectedMachine] : machines;

  // Client-side search over the columns each row shows — JC no., POL, item
  // code / name, SO no., customer, operation. The queue is one fetch, so every
  // row is already here. While a term is typed the ▲/▼ arrows are hidden: a
  // move swaps a row with its neighbour in the FULL queue, which a filtered
  // view no longer shows.
  const [searchInput, setSearchInput] = useState('');
  const term = searchInput.trim().toLowerCase();
  const matches = (r: JobQueueRow): boolean =>
    term === '' ||
    [
      r.jcCode,
      r.clientPoLineNo,
      itemCodeWithRev(r.itemCode, r.itemRevision, ''),
      r.itemName,
      r.soCode,
      r.soCustomer,
      r.operation,
    ].some((v) => v != null && String(v).toLowerCase().includes(term));
  const shownMachines = term
    ? displayMachines.filter((m) => m.rows.some(matches))
    : displayMachines;
  const pendingShown = displayMachines.reduce((n, m) => n + m.rows.filter(matches).length, 0);

  const today = todayIst();

  const setMachine = (code: string | null): void => {
    void navigate({ search: () => ({ machine: code ?? undefined }) });
  };

  const onMove = (machineId: string, opId: string, dir: 'up' | 'down'): void => {
    const machine = machines.find((m) => m.machineId === machineId);
    if (!machine) return;
    const ids = machine.rows.map((r) => r.jcOpId);
    const idx = ids.indexOf(opId);
    if (idx === -1) return;
    const swap = dir === 'up' ? idx - 1 : idx + 1;
    if (swap < 0 || swap >= ids.length) return;
    const next = [...ids];
    next[idx] = ids[swap]!;
    next[swap] = opId;
    reorderMut.mutate({ machineId, input: { jcOpIds: next } });
  };

  return (
    <div>
      <ListHeader
        title="Job Queue"
        icon="⬛"
        count={isLoading ? undefined : pendingShown}
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
          setMachine(null);
        }}
        filtersActive={term !== '' || selectedMachine != null}
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
            {term ? 'No pending operations match.' : 'No pending operations.'}
          </div>
        </div>
      ) : (
        shownMachines.map((m) => {
          // Position in the FULL queue (not the filtered rows), so Sr No and the
          // ▲/▼ neighbours stay true while a search narrows what is shown.
          const posById = new Map(m.rows.map((r, i) => [r.jcOpId, i]));
          const machineRows = m.rows.filter(matches);
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
                      searching: term !== '',
                      onMove,
                    })
                  }
                />
              )}
            </div>
          );
        })
      )}
    </div>
  );
}
