// ADR-235 — GRN in the standard Cancel. Reuses cancelGrnTx (the ONE GRN cancel
// writer: header + lines stamped Cancelled, PO lines' received qty and PO
// status recalculated) and its own refusal rule grnCancelBlockers (Incoming QC
// recorded, made by a DC / JW DC / NC replacement receipt, live NC on a line).
// The preview's effects come from grnCancelEffects, beside them (cancel.ts).

import type { CancelHandler } from '../cancel-requests/registry';
import { cancelGrnTx, grnCancelBlockers, grnCancelEffects, lockGrnForCancel } from './cancel';

export const grnCancelHandler: CancelHandler = {
  docType: 'grn',
  // GRN header edits are staged for approval (ADR-202 / ADR-249) under this
  // entity; a pending staged edit blocks a Cancel Request.
  editEntity: 'GoodsReceiptNote',

  async lock(tx, companyId, docId, forUpdate) {
    const h = await lockGrnForCancel(tx, companyId, docId, forUpdate);
    // A trashed GRN (deleted_at, no cancelled_at) is not a live document
    // either — the request is refused as "already cancelled / gone".
    return h ? { code: h.code, cancelled: h.cancelledAt != null || h.deletedAt != null } : null;
  },

  // The worker's own rule — one place.
  blockers: grnCancelBlockers,

  effects: grnCancelEffects,

  async run(tx, companyId, docId, reason, actor) {
    await cancelGrnTx(tx, companyId, docId, reason, actor);
  },
};
