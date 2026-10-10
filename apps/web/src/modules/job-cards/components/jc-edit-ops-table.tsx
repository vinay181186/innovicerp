// Edit Job Card — the operations, as ONE table in the page's one filling
// panel (the detail page's Operations panel, jc-ops-table.tsx, with inputs).
//
// Column order follows the detail table — ▸ · Op · the operation and where it
// runs · its figures · Op Status · ⋯ — with the fields this page edits in the
// row and the rest behind ▸. The detail page's 10 quantity columns are not
// repeated here (they are not editable and would leave the Operation box no
// room at 1280); the figures the old edit card showed (Completed, Pending, QC
// Pending, At Vendor, Back from Vendor) are in each row's ▸.
//
// The panel bar carries the count and the three Add buttons the old
// "Operations Detail" bar had, with the same words.
import type { JcOpEnriched, OpLog } from '@innovic/shared';
import { Panel } from '@/ui/data';
import { endsWithPinnedFinalQc } from '../lib/jc-pinned-final-qc';
import {
  EDIT_COLS,
  JcEditOpRow,
  type JcEditOpRowProps,
  type JcOpEditValues,
} from './jc-edit-op-row';
import './jc-ops-table.css';

type Shared = Pick<
  JcEditOpRowProps,
  | 'machines'
  | 'machineOptions'
  | 'machineGroupCodeById'
  | 'onMachineSearch'
  | 'vendorOptions'
  | 'onVendorSearch'
  | 'vendorsLoading'
>;

export function JcEditOpsTable({
  ops,
  enrichedById,
  logsByOp,
  shared,
  openKeys,
  flashKey,
  newRowRef,
  onToggle,
  onAdd,
  onChange,
  onMachineChange,
  onGroupChange,
  onMove,
  onRemove,
  onOutsourceBalance,
}: {
  ops: JcOpEditValues[];
  enrichedById: Map<string, JcOpEnriched>;
  /** Every loaded log per op, latest first. */
  logsByOp: Map<string, OpLog[]>;
  shared: Shared;
  /** rowKeys of the rows whose ▸ detail is open. */
  openKeys: ReadonlySet<string>;
  /** rowKey of the operation just added (ringed for a moment), or null. */
  flashKey: string | null;
  /** Scroll target: the row just added. */
  newRowRef: (el: HTMLTableRowElement | null) => void;
  onToggle: (key: string) => void;
  onAdd: (kind: 'process' | 'qc' | 'outsource') => void;
  onChange: (i: number, patch: Partial<JcOpEditValues>) => void;
  onMachineChange: (i: number, code: string) => void;
  onGroupChange: (i: number, groupId: string | null) => void;
  onMove: (i: number, dir: -1 | 1) => void;
  onRemove: (i: number) => void;
  onOutsourceBalance: (i: number) => void;
}): React.JSX.Element {
  const opCount = ops.filter((o) => o.opType !== 'qc').length;
  const qcCount = ops.filter((o) => o.opType === 'qc').length;
  // ADR-227: a routing that ends in the system-added Final Inspection keeps it
  // last, so the ⋯ menu does not offer the two swaps that would displace it —
  // Move up on the inspection itself, and Move down on the op directly above
  // it. A QC op the user named themselves is not matched by the predicate and
  // still moves freely.
  const lastIdx = ops.length - 1;
  // ADR-227 — pinned means "the Final Inspection the SERVER added", and the
  // server decides that by the stored row's identity, not by its name. So a row
  // the person has only just typed (no id yet) must NOT be pinned, even if they
  // typed the words "Final Inspection": locking the field someone is still
  // filling in, when the server would have let them rename it, is the screen and
  // the server disagreeing — the exact fault this change exists to remove. The
  // test is the ONE predicate in ../lib/jc-pinned-final-qc.ts, shared with the
  // swap and the add-position in jc-status-content.tsx, so the menu it greys out
  // and the code that refuses the move always say the same thing.
  const pinnedFinalQcLast = endsWithPinnedFinalQc(ops);
  // ADR-227: once that inspection has LOGGED WORK there is nowhere left to put
  // a new operation. Above it would renumber a started op (the server refuses
  // "Cannot move Op N — it already has logged work."), and after it displaces
  // the inspection (TERMINAL_QC_DISPLACED_MESSAGE) — and the inspection cannot
  // be moved back, so the person could never clear either refusal. So the three
  // Add buttons say it up front instead of failing on Save, in the same clipped
  // voice as the ⋯ menu's greyed reasons.
  const addBlockedReason =
    pinnedFinalQcLast && ops[lastIdx]!.hasStarted
      ? 'Final Inspection already has logged work — no operation can be added after it'
      : undefined;
  const addOff = Boolean(addBlockedReason);

  return (
    <Panel
      fill
      bodyPadding="none"
      title={
        <span className="jc-edit-ops-title">
          Operations
          <span className="badge b-blue">{ops.length}</span>
          <span className="jc-edit-ops-count">
            {opCount} op{opCount !== 1 ? 's' : ''}
            {qcCount > 0 ? ` + ${qcCount} QC` : ''}
          </span>
        </span>
      }
      actions={
        <>
          {/* Each wrapper carries the hover text: a disabled button gets none
              (the same pattern as this page's Save Changes). */}
          <span title={addBlockedReason}>
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              disabled={addOff}
              title={addBlockedReason}
              onClick={() => onAdd('process')}
            >
              + Add Op
            </button>
          </span>
          <span title={addBlockedReason}>
            <button
              type="button"
              className="btn btn-sm jc-edit-add-qc"
              disabled={addOff}
              title={addBlockedReason}
              onClick={() => onAdd('qc')}
            >
              + Add QC Op
            </button>
          </span>
          <span title={addBlockedReason}>
            <button
              type="button"
              className="btn btn-sm jc-edit-add-osp"
              disabled={addOff}
              title={addBlockedReason}
              onClick={() => onAdd('outsource')}
            >
              + Add Outsource Op
            </button>
          </span>
        </>
      }
    >
      <div className="tbl-wrap">
        <table className="innovic-table tbl-edit tbl-fixed tbl-nofreeze jc-ops-table jc-edit-ops">
          {/* Fixed widths; Operation takes what is left. */}
          <colgroup>
            <col style={{ width: 26 }} />
            <col style={{ width: 44 }} />
            <col />
            <col style={{ width: 96 }} />
            <col style={{ width: 184 }} />
            <col style={{ width: 136 }} />
            <col style={{ width: 96 }} />
            <col style={{ width: 148 }} />
            <col style={{ width: 116 }} />
            <col style={{ width: 36 }} />
          </colgroup>
          <thead>
            <tr>
              <th aria-label="Expand" />
              <th>Op</th>
              <th>
                Operation<span className="req">★</span>
              </th>
              <th>Group</th>
              <th>
                Machine / Vendor<span className="req">★</span>
              </th>
              <th className="th-num">Cycle Time (min)</th>
              <th>Program</th>
              <th>Outsource</th>
              <th>Op Status</th>
              <th aria-label="Actions" />
            </tr>
          </thead>
          <tbody>
            {ops.length === 0 ? (
              <tr>
                <td colSpan={EDIT_COLS} className="text3">
                  No operations yet.
                </td>
              </tr>
            ) : (
              ops.map((o, i) => {
                // Stable per-op key (op id, or a client-made one for a new
                // op) — ▸ open state and the row itself follow the op on Move.
                const key = o.rowKey;
                const en = o.id ? enrichedById.get(o.id) : undefined;
                // Op No. = the op's STORED op_seq, never its position on screen.
                // The server quotes the stored number in every refusal it sends
                // back ("Cannot move Op 20 — it already has logged work."), so a
                // position-derived number would point the person at a different
                // row than the message is about — remove the first of three ops
                // and the one the server is complaining about has silently
                // renumbered. A row added on this screen has no stored number,
                // so it shows none (an em dash) rather than borrowing a position
                // the server has never heard of.
                return (
                  <JcEditOpRow
                    key={key}
                    {...shared}
                    op={o}
                    index={i}
                    seqLabel={o.opSeq ?? null}
                    enriched={en}
                    logs={o.id ? (logsByOp.get(o.id) ?? []).slice(0, 3) : []}
                    isFirst={i === 0}
                    isLast={i === lastIdx}
                    isPinnedFinalQc={pinnedFinalQcLast && i === lastIdx}
                    isAbovePinnedFinalQc={pinnedFinalQcLast && i === lastIdx - 1}
                    open={openKeys.has(key)}
                    flash={flashKey === key}
                    rowRef={flashKey === key ? newRowRef : undefined}
                    onToggle={() => onToggle(key)}
                    onChange={(patch) => onChange(i, patch)}
                    onMachineChange={(code) => onMachineChange(i, code)}
                    onGroupChange={(gid) => onGroupChange(i, gid)}
                    onMove={(dir) => onMove(i, dir)}
                    onRemove={() => onRemove(i)}
                    onOutsourceBalance={() => onOutsourceBalance(i)}
                  />
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}
