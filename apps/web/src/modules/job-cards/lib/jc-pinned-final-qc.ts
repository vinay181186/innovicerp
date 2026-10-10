// ADR-227 — the ONE answer to "is this op the system's own Final Inspection,
// the one pinned to the end of the routing?"
//
// Why it lives in its own module: the question is asked in three places on the
// Edit Job Card screen — the ⋯ menu's Move up / Move down gating and the
// read-only Operation box (jc-edit-ops-table.tsx), the swap itself
// (jc-status-content.tsx moveOp) and where a freshly added op is inserted
// (jc-status-content.tsx addOpInsertIndex). Three copies of the test drifted:
// two of them left out the id check, so a Final Inspection the person had just
// typed (no id yet) was treated as pinned by the swap but not by the menu —
// the menu offered Move up, moveOp silently refused it, and the next + Add Op
// went in ABOVE the person's own row. One definition, three callers.
//
// `Boolean(op.id)` is the load-bearing half. The server decides what is pinned
// by the STORED row's identity (it strips its own appended inspection by id
// before comparing the routing), so a row that has never been saved cannot be
// the system's inspection, whatever words are typed in it — and the QC Process
// picker does offer "Final Inspection" as a choice.

import { isGeneratedTerminalQcOp } from '@innovic/shared';

/** The shape this question needs: a saved row's id (absent on a new row) plus
 *  the two fields the shared name test reads. */
export interface PinnedFinalQcOp {
  id?: string;
  opType: string;
  operation: string;
}

/** True only for the system-added Final Inspection as the SERVER sees it: a
 *  row that is already stored (has an id) AND matches the shared terminal-QC
 *  name test. A QC op the person named themselves, and a brand-new row they
 *  are still filling in, are both false. */
export function isPinnedFinalQcOp(op: PinnedFinalQcOp | undefined): boolean {
  return op != null && Boolean(op.id) && isGeneratedTerminalQcOp(op);
}

/** True when the routing's LAST op is that pinned inspection. */
export function endsWithPinnedFinalQc(list: ReadonlyArray<PinnedFinalQcOp>): boolean {
  return isPinnedFinalQcOp(list[list.length - 1]);
}
