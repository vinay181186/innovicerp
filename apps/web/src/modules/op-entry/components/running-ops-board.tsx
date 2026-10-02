// Live operations board — the two shop-floor list tables (Running now / Recent)
// rendered on the ADR-199 fit table. Columns live in running-ops-columns.tsx;
// this file keeps the Stop mutation, the Stop popup and the permission gate.
//
// CRITICAL: only the DISPLAY of the tables moved onto <DataTable>. The Stop
// mutation (useStopOp → commits produced qty to op_log → op_entry entry), the
// StopOpModal flow, the op_entry entry permission gate and the realtime refresh
// (owned by the parent route) are all unchanged.
//
// ADR-201 (2026-10-02): both tables are 25-row server pages with Prev / Next
// (page held in component state — two tables on one route). "Running now" is
// sorted / filtered on the server (its ▾ is server mode); "Recent" is every
// finished / cancelled session, newest first — no longer the last 20 of 200.

import type { RunningOp, StopOpInput } from '@innovic/shared';
import { useMemo, useState } from 'react';
import { effectiveFormPerms, useMyAccess } from '@/lib/access-control';
import { LIST_PAGE_SIZE, pageOffset, useClampPage } from '@/lib/list-paging';
import { DataTable } from '@/ui/data';
import { useServerSortFilter } from '@/ui/data/sort-filter/server-state';
import { TABLE_KEYS } from '@/ui/data/table-keys';
import { ListFooter } from '@/ui/layout';
import { useStopOp } from '../api';
import { useRunningOpsPage } from '../running-ops-page-api';
import {
  RUNNING_OPS_DEFAULT_HIDDEN,
  recentOpsColumns,
  runningNowColumns,
  type RunningOpRow,
} from './running-ops-columns';
import { StopOpModal } from './stop-op-modal';

export function RunningOpsBoard(): React.JSX.Element {
  const stop = useStopOp();
  // Stopping a session commits produced qty to op_log → op_entry entry (Production).
  const { data: eff } = useMyAccess();
  const canOpEntry = effectiveFormPerms(eff, 'op_entry').entry;

  // Running vs Recent is decided on the SERVER (view=running|recent), one
  // 25-row page each; every ▾ change sends "Running now" back to page 1.
  const [runPage, setRunPage] = useState(1);
  const [recentPage, setRecentPage] = useState(1);
  const sf = useServerSortFilter(TABLE_KEYS.runningOps, () => setRunPage(1));
  const runQ = useRunningOpsPage({
    view: 'running',
    sf: sf.param,
    limit: LIST_PAGE_SIZE,
    offset: pageOffset(runPage),
  });
  const recentQ = useRunningOpsPage({
    view: 'recent',
    limit: LIST_PAGE_SIZE,
    offset: pageOffset(recentPage),
  });
  const running = (runQ.data?.items ?? []) as RunningOpRow[];
  const recent = (recentQ.data?.items ?? []) as RunningOpRow[];
  const runTotal = runQ.data?.total ?? 0;
  const recentTotal = recentQ.data?.total ?? 0;
  useClampPage(runPage, runQ.data?.total, setRunPage);
  useClampPage(recentPage, recentQ.data?.total, setRecentPage);
  // The row whose Stop box is open, and the server's message if it refused.
  const [stopRow, setStopRow] = useState<RunningOp | null>(null);
  const [stopError, setStopError] = useState<string | null>(null);

  const runningCols = useMemo(() => runningNowColumns(), []);
  const recentCols = useMemo(() => recentOpsColumns(), []);

  function submitStop(input: StopOpInput): void {
    if (!stopRow) return;
    setStopError(null);
    stop.mutate(
      { id: stopRow.id, ...input },
      {
        onSuccess: () => setStopRow(null),
        onError: (e) =>
          setStopError(e instanceof Error ? e.message : 'Could not stop operation. Try again.'),
      },
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div className="panel">
        <div className="panel-hdr">
          <span className="panel-title">Running now</span>
          <span className="mono text3" style={{ fontSize: 11 }}>
            {runTotal} session{runTotal !== 1 ? 's' : ''}
          </span>
        </div>
        <DataTable
          tableKey={TABLE_KEYS.runningOps}
          columns={runningCols}
          rows={running}
          loading={runQ.isLoading}
          sortFilterServer={sf}
          defaultHidden={RUNNING_OPS_DEFAULT_HIDDEN}
          emptyText={sf.filtering ? 'No running operations match.' : 'No operations running.'}
          // Stop stays the ⋯ row action it has always been — shown only to a
          // user with op_entry entry, busy-locked while a stop is in flight.
          rowMenu={
            canOpEntry
              ? (r) => [
                  {
                    key: 'stop',
                    label: 'Stop Operation',
                    icon: 'square',
                    group: 'workflow',
                    disabledReason: stop.isPending ? 'Stopping…' : undefined,
                    onSelect: () => {
                      setStopError(null);
                      setStopRow(r);
                    },
                  },
                ]
              : undefined
          }
        />
        <ListFooter
          total={runTotal}
          noun="session"
          page={runPage}
          pageSize={LIST_PAGE_SIZE}
          onPage={setRunPage}
        />
      </div>

      {recentTotal > 0 ? (
        <div className="panel">
          <div className="panel-hdr">
            <span className="panel-title">Recent</span>
            <span className="mono text3" style={{ fontSize: 11 }}>
              {recentTotal} session{recentTotal !== 1 ? 's' : ''}
            </span>
          </div>
          {/* Keyless on purpose: "Recent" is a different column set (Ended +
              Op Status, no Stop) from the live board above, so it must not share
              the runningOps saved layout. It renders as the same ruled sheet. */}
          <DataTable columns={recentCols} rows={recent} loading={recentQ.isLoading} />
          <ListFooter
            total={recentTotal}
            noun="session"
            page={recentPage}
            pageSize={LIST_PAGE_SIZE}
            onPage={setRecentPage}
          />
        </div>
      ) : null}

      {stopRow ? (
        <StopOpModal
          target={{
            runningOpId: stopRow.id,
            jobCardCode: stopRow.jobCardCode,
            opSeq: stopRow.opSeq,
            operation: stopRow.operation,
            machineLabel: stopRow.machineCode ?? (stopRow.isOsp ? 'OSP' : '—'),
            // Planned beside actual (ADR-164). Spread, not `undefined`, on an
            // OSP row: exactOptionalPropertyTypes refuses an explicit undefined.
            ...(stopRow.isOsp
              ? {}
              : { plannedMachineLabel: stopRow.plannedMachineCode ?? stopRow.machineCode ?? '—' }),
            availableQty: stopRow.availableQty,
            // The Stop box names the part as well as the job. `RunningOp`
            // carries all three, and the box is where an operator checks they
            // are stopping the right row before typing a quantity — the one
            // moment a wrong job card costs real pieces.
            itemCode: stopRow.itemCode,
            itemRevision: stopRow.itemRevision,
            itemName: stopRow.itemName,
            // POL — the CUSTOMER's own PO line number, shown beside the item.
            clientPoLineNo: stopRow.clientPoLineNo,
          }}
          pending={stop.isPending}
          errorText={stopError}
          onCancel={() => {
            setStopRow(null);
            setStopError(null);
          }}
          onSubmit={submitStop}
        />
      ) : null}
    </div>
  );
}
