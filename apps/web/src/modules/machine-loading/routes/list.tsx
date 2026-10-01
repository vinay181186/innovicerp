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
// The old "Job Queue View" toggle is gone (2026-09-26): it drew a second copy
// of the Job Queue screen. There is now ONE queue screen — the "Job Queue →"
// button opens /job-queue?machine=<code> for the picked machine (or all).

import type { MachineLoadCard, MachineLoadOp } from '@innovic/shared';
import { Link, createRoute } from '@tanstack/react-router';
import { Loader2, Printer } from 'lucide-react';
import { useMemo, useState } from 'react';
import { z } from 'zod';
import { itemCodeWithRev } from '@/lib/item-code';
import { authenticatedRoute } from '@/routes/_authenticated';
import { DataTable, Panel } from '@/ui/data';
import { TABLE_KEYS } from '@/ui/data/table-keys';
import { ListHeader } from '@/ui/layout';
import { CapacitySummary, MachineLoadCardView } from '../components/machine-load-cards';
import { OpsExpanded, opRowTint, opsColumns } from '../components/machine-loading-columns';
import { useMyCompany } from '../../settings/api';
import { useMachineLoading } from '../api';
import { printMachineQueue } from '../lib/print-machine-queue';

const searchSchema = z.object({
  m: z.string().uuid().optional(),
  // Kept only so an old bookmarked ?view=queue link still parses; the queue
  // itself now lives on /job-queue (see the file header).
  view: z.enum(['ops', 'queue']).optional(),
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
  const { data, isLoading, isFetching, isError, error } = useMachineLoading();
  const { data: company } = useMyCompany();

  const selMachineId = search.m ?? null;

  const machines = data?.machines ?? [];
  const allOps = data?.ops ?? [];

  function onPrintQueue(machineId: string | null): void {
    if (!printMachineQueue({ machines, ops: allOps, company, machineId })) {
      window.alert('Allow popups to print.');
    }
  }

  // Operation View re-applies legacy's narrow ops filter (renderLoading L5060:
  // available > 0 OR In Progress). The service now returns the wider Job-Queue
  // set (all non-complete ops) so the Job Queue View can surface waiting /
  // qc_pending / running (ISSUE-068); this keeps the ops table unchanged.
  // Client-side search over the columns the ops table shows — JC no., POL,
  // item code / name, SO no., operation. One fetch, so every row is here.
  const [searchInput, setSearchInput] = useState('');
  const term = searchInput.trim().toLowerCase();
  const filteredOps = useMemo(
    () =>
      allOps.filter(
        (o) =>
          (selMachineId ? o.machineId === selMachineId : true) &&
          (o.available > 0 || o.computedStatus === 'in_progress') &&
          (term === '' ||
            [
              o.jobCardCode,
              o.clientPoLineNo,
              itemCodeWithRev(o.itemCode, o.itemRevision, ''),
              o.itemName,
              o.soCode,
              o.operation,
            ].some((v) => v != null && String(v).toLowerCase().includes(term))),
      ),
    [allOps, selMachineId, term],
  );

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
      search: (prev) => ({ ...prev, m: id, view: undefined }),
      replace: true,
    });
  }
  function clearFilter(): void {
    void navigate({ search: (prev) => ({ ...prev, m: undefined }), replace: true });
  }

  return (
    <div>
      <ListHeader
        title="Machine Loading"
        icon="▣"
        count={isLoading ? undefined : filteredOps.length}
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
          clearFilter();
        }}
        filtersActive={term !== '' || selMachineId != null}
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
              onClick={() => onPrintQueue(selMachineId)}
              disabled={machines.length === 0}
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
                {filteredOps.length} ops
              </span>
            }
            bodyPadding="none"
          >
            <DataTable
              tableKey={TABLE_KEYS.machineLoading}
              columns={columns}
              rows={filteredOps}
              rowKey={(op: MachineLoadOp) => op.jcOpId}
              emptyText={term !== '' ? 'No pending operations match.' : 'No pending operations.'}
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

          <CapacitySummary machines={machines} />
        </>
      )}
    </div>
  );
}
