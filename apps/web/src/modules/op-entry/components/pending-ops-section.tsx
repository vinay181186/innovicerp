// The idle-machine panel of the "By Machine" Op Entry view: the ready-to-process
// "Pending Jobs for this Machine" table and the read-only "Made on this Machine"
// history. Split out of machine-op-entry-view.tsx (ADR-199) so both stay under
// the 400-line ceiling.
//
// CRITICAL: only the table DISPLAY moved onto <DataTable>. The ▶ Start action
// still opens the one shared OpEntryModal via `onStart`, and the op_entry entry
// permission gate is unchanged. No logging logic lives here.
//
// ADR-201: each table shows 25 rows with Prev / Next. These two lists are ONE
// machine's operations, read in one call (/op-entry/jc-ops?machineId) that the
// whole By-Machine view shares — "pending" needs the op calc engine's live
// figures (available, running session, QC hold), so the 25-row page is cut from
// that one machine's list here; the counts are of the whole machine list.

import type { JcOpEnriched } from '@innovic/shared';
import { Loader2 } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { effectiveFormPerms, useMyAccess } from '@/lib/access-control';
import { LIST_PAGE_SIZE, pageOffset, useClampPage } from '@/lib/list-paging';
import { DataTable } from '@/ui/data';
import { TABLE_KEYS } from '@/ui/data/table-keys';
import { ListFooter } from '@/ui/layout';
import {
  madeHereColumns,
  type MadeHereRow,
  PENDING_OPS_DEFAULT_HIDDEN,
  pendingOpsColumns,
} from './pending-ops-columns';

export type { MadeHereRow } from './pending-ops-columns';

interface PendingOpsSectionProps {
  machineCode: string;
  machineName: string;
  ops: JcOpEnriched[];
  producedOps: MadeHereRow[];
  isLoading: boolean;
  /** Asks the view to open the entry popup for THIS row. The section holds no
   *  entry state of its own any more — that is the whole point. */
  onStart: (op: JcOpEnriched) => void;
}

export function PendingOpsSection({
  machineCode,
  machineName,
  ops,
  producedOps,
  isLoading,
  onStart,
}: PendingOpsSectionProps): React.JSX.Element {
  // Starting a session records shop-floor work → op_entry entry (Production).
  const { data: eff } = useMyAccess();
  const canOpEntry = effectiveFormPerms(eff, 'op_entry').entry;
  const pendingCols = useMemo(() => pendingOpsColumns(), []);
  const madeCols = useMemo(() => madeHereColumns(), []);

  // 25-row pages; a different machine starts both tables on page 1.
  const [pendPage, setPendPage] = useState(1);
  const [madePage, setMadePage] = useState(1);
  useEffect(() => {
    setPendPage(1);
    setMadePage(1);
  }, [machineCode]);
  useClampPage(pendPage, isLoading ? undefined : ops.length, setPendPage);
  useClampPage(madePage, isLoading ? undefined : producedOps.length, setMadePage);
  const pendRows = useMemo(
    () => ops.slice(pageOffset(pendPage), pageOffset(pendPage) + LIST_PAGE_SIZE),
    [ops, pendPage],
  );
  const madeRows = useMemo(
    () => producedOps.slice(pageOffset(madePage), pageOffset(madePage) + LIST_PAGE_SIZE),
    [producedOps, madePage],
  );

  return (
    <div
      style={{
        background: 'var(--bg3)',
        border: '2px solid var(--border)',
        borderRadius: 10,
        padding: 16,
      }}
    >
      <div style={{ fontSize: 16, fontWeight: 800, color: 'var(--cyan)', marginBottom: 4 }}>
        {machineCode} — <span className="text3">⚪ Idle</span>
      </div>
      <div className="text3" style={{ fontSize: 12, marginBottom: 14 }}>
        {machineName}
      </div>
      {isLoading ? (
        <div className="empty-state" style={{ padding: 20 }}>
          <Loader2 className="mr-2 inline h-4 w-4 animate-spin" /> Loading pending jobs…
        </div>
      ) : ops.length > 0 ? (
        <>
          <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--amber2)', marginBottom: 8 }}>
            Pending Jobs for this Machine ({ops.length})
          </div>
          <DataTable
            tableKey={TABLE_KEYS.opEntryShopFloor}
            columns={pendingCols}
            rows={pendRows}
            defaultHidden={PENDING_OPS_DEFAULT_HIDDEN}
            // ▶ Start stays the inline button it has always been, shown only to
            // a user with op_entry entry. It opens the one shared OpEntryModal.
            rowActions={
              canOpEntry
                ? (op) => (
                    <button
                      type="button"
                      className="btn btn-primary btn-sm"
                      onClick={() => onStart(op)}
                    >
                      ▶ Start Operation
                    </button>
                  )
                : undefined
            }
          />
          <ListFooter
            total={ops.length}
            noun="pending job"
            page={pendPage}
            pageSize={LIST_PAGE_SIZE}
            onPage={setPendPage}
          />
        </>
      ) : (
        <div className="empty-state" style={{ padding: 20 }}>
          No pending jobs for this machine.
        </div>
      )}
      {/* MADE ON THIS MACHINE — history, not work. An op lands here because the
          per-machine breakdown says this machine produced pieces on it, even if
          the op has since been re-routed elsewhere. Informational only: no
          Start / entry buttons, because you cannot log production against an
          operation that no longer runs here. */}
      {!isLoading && producedOps.length > 0 ? (
        <>
          <div
            style={{
              fontSize: 12,
              fontWeight: 700,
              color: 'var(--green2)',
              marginTop: 16,
              marginBottom: 8,
            }}
          >
            Made on this Machine ({producedOps.length})
          </div>
          {/* Keyless: history, a different column set from the pending list. */}
          <DataTable columns={madeCols} rows={madeRows} rowKey={(row) => row.op.id} />
          <ListFooter
            total={producedOps.length}
            noun="operation"
            page={madePage}
            pageSize={LIST_PAGE_SIZE}
            onPage={setMadePage}
          />
        </>
      ) : null}
      {!isLoading && producedOps.length === 0 ? (
        <div className="text3" style={{ fontSize: 11, marginTop: 12 }}>
          No production has been recorded on {machineCode} yet.
        </div>
      ) : null}
    </div>
  );
}
