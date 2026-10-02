// The idle-machine panel of the "By Machine" Op Entry view: the ready-to-process
// "Pending Jobs for this Machine" table and the read-only "Made on this Machine"
// history. Split out of machine-op-entry-view.tsx (ADR-199) so both stay under
// the 400-line ceiling.
//
// CRITICAL: only the table DISPLAY moved onto <DataTable>. The ▶ Start action
// still opens the one shared OpEntryModal via `onStart`, and the op_entry entry
// permission gate is unchanged. No logging logic lives here.

import type { JcOpEnriched } from '@innovic/shared';
import { Loader2 } from 'lucide-react';
import { useMemo } from 'react';
import { effectiveFormPerms, useMyAccess } from '@/lib/access-control';
import { DataTable } from '@/ui/data';
import { TABLE_KEYS } from '@/ui/data/table-keys';
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
            rows={ops}
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
          <DataTable columns={madeCols} rows={producedOps} rowKey={(row) => row.op.id} />
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
