// Job Card detail — the OPERATIONS tab (owner-approved mock-up
// jobcard-detail-mockup.html, frame 1 + frame 3).
//
// ONE table, one row per operation in op order. It is today's Op Qty Flow
// table (flow-views/components/jc-flow-panels.tsx) — same group heads, same
// columns, same Check ✓ hover sum, same notes and Job Card check line, and the
// SAME hook (useOpFlow) for every figure: nothing is recomputed here — plus:
//
//   Operation    its cell opens the operation popup (jc-op-popup.tsx): what today's op
//                card body showed (jc-ops-table-detail.tsx), ‹ › to step
//   Operation · Machine / Vendor
//   Op Status    the op card's badge (lib/jc-op-labels.ts OP_STATUS)
//   Next Step    the ONE action today's action strip led with
//   ⋯            every other action that strip showed (RowMenu, ADR-199)
//
// Which actions, under which gates, lives in jc-ops-table-actions.ts — each
// gate copied verbatim from jc-op-actions.tsx with its source line.
//
// The current op (jc-view-summary.tsx currentOp) carries a 3px blue left edge.
// The PAGE scrolls (owner-approved option 4, 2026-11-02): the table shows every
// row at full height and its two header rows stick under the page's sticky
// band (summary strip + tabs, jc-detail.css --jc-sticky-h). Under the table:
// the per-op NC notes only (legend + "Job Card check" line removed by owner).
import type { JcOpEnriched, JobCardListItem, OpLog } from '@innovic/shared';
import { useCallback, useMemo, useState } from 'react';
import { useMyAccess } from '@/lib/access-control';
import { useOpFlow } from '@/modules/flow-views/api';
import type { useProductionOrderForJobCard } from '@/modules/production-orders/api';
import { useJobCardStatusExtras } from '../api';
import { JcOpsTableNotes } from './jc-ops-table-notes';
import { COLS, OpRow, OpRowWithBoard, type RowProps } from './jc-ops-table-row';
import { currentOp } from './jc-view-summary';
import './jc-ops-table.css';

export function JcOpsTable({
  jobCardId,
  jc,
  ops,
  logsByOp,
  stopped,
}: {
  jobCardId: string;
  jc: JobCardListItem;
  /** Sorted by opSeq. */
  ops: JcOpEnriched[];
  /** Every loaded log per op, latest first (jc-status-view.tsx). */
  logsByOp: Map<string, OpLog[]>;
  /** ADR-182 — the Production Order was short closed: no actions at all. */
  stopped: boolean;
  /** Part of the fixed contract; the stop rule already arrives as `stopped`. */
  productionOrder: ReturnType<typeof useProductionOrderForJobCard>['order'] | undefined;
}): React.JSX.Element {
  const { data: eff } = useMyAccess();
  // THE Op Qty Flow figures — the same hook jc-flow-panels.tsx uses.
  const flowQ = useOpFlow(jobCardId);
  // Per-op machine name + tool details, and JW client material (same query
  // key as the page's own call, so no second request).
  const { data: extras } = useJobCardStatusExtras(jobCardId);

  const flowById = useMemo(
    () => new Map((flowQ.data?.ops ?? []).map((r) => [r.jcOpId, r])),
    [flowQ.data],
  );
  const opExtraById = useMemo(
    () => new Map((extras?.opExtras ?? []).map((e) => [e.jcOpId, e])),
    [extras?.opExtras],
  );

  const cur = currentOp(ops);
  const firstOpId = ops[0]?.id ?? null;

  // The op whose popup is open (one at a time); ‹ › / ↑ ↓ step through ops.
  const [openId, setOpenId] = useState<string | null>(null);
  const step = useCallback(
    (dir: -1 | 1): void => {
      setOpenId((curId) => {
        const at = ops.findIndex((o) => o.id === curId);
        if (at < 0 || ops.length === 0) return curId;
        return ops[(at + dir + ops.length) % ops.length]?.id ?? curId;
      });
    },
    [ops],
  );
  const close = useCallback(() => setOpenId(null), []);

  const flowError = flowQ.isError
    ? flowQ.error instanceof Error
      ? flowQ.error.message
      : 'Could not load the op qty flow.'
    : null;

  return (
    <>
      <div className="tbl-wrap jc-ops-wrap">
        <table className="innovic-table tbl-nofreeze jc-ops-table">
          <thead>
            {/* Group heads — jc-flow-panels.tsx OP_FLOW_GROUPS, L216-221 */}
            <tr className="dt-head-groups">
              <th colSpan={2} />
              <th colSpan={7} className="vsep">
                At this operation
              </th>
              <th colSpan={3} className="vsep jc-ops-gv">
                With vendor (outsource)
              </th>
              <th colSpan={4} className="vsep" />
            </tr>
            <tr>
              <th>Op</th>
              <th>Operation · Machine / Vendor</th>
              <th className="th-num vsep">Input</th>
              <th className="th-num vsep">Done</th>
              <th className="th-num jc-ops-h-good">Accepted</th>
              <th className="th-num vsep jc-ops-h-warn">Deviated (NC)</th>
              <th className="th-num">Reworked</th>
              <th className="th-num jc-ops-h-bad">Rejected</th>
              <th className="th-num vsep">Pending</th>
              <th className="th-num vsep">Sent</th>
              <th className="th-num">Received</th>
              <th className="th-num">At Vendor</th>
              <th className="vsep">Check</th>
              <th>Op Status</th>
              <th>Next Step</th>
              <th aria-label="Actions" />
            </tr>
          </thead>
          <tbody>
            {ops.length === 0 ? (
              <tr>
                <td colSpan={COLS} className="text3">
                  No operations yet.
                </td>
              </tr>
            ) : (
              ops.map((op) => {
                const flow = flowById.get(op.id);
                const isQc = op.opType === 'qc';
                const isOut = op.opType === 'outsource';
                const needsBoard = isOut || (!isQc && flow?.hasOsp === true);
                const extra = opExtraById.get(op.id);
                const props: RowProps = {
                  jc,
                  op,
                  flow,
                  eff,
                  stopped,
                  open: openId === op.id,
                  current: cur?.id === op.id,
                  onOpen: () => setOpenId(op.id),
                  onClose: close,
                  onStep: step,
                  logs: logsByOp.get(op.id) ?? [],
                  machineName: extra?.machineName ?? null,
                  toolDetails: extra?.toolDetails ?? null,
                  // ADR-103 — the FIRST op only (jc-status-view.tsx L328-330).
                  rmAvailable: op.id === firstOpId ? (extras?.rmAvailable ?? null) : null,
                };
                return needsBoard ? (
                  <OpRowWithBoard key={op.id} {...props} />
                ) : (
                  <OpRow key={op.id} {...props} row={undefined} />
                );
              })
            )}
          </tbody>
        </table>
      </div>
      {ops.length > 0 ? <JcOpsTableNotes ops={flowQ.data?.ops ?? []} error={flowError} /> : null}
    </>
  );
}
