// ADR-235 Phase C part 2 — JW DC Receipt (inward) in the standard Cancel.
// Reuses cancelJwDcInwardTx (the one JW DC receipt cancel writer: its GRN
// cancelled with it, receipt + lines stamped Cancelled so the outward's
// returned figure drops it) and its own refusal rule jwDcInwardCancelBlockers
// (GRN Incoming QC touched, unlinked older receipt). Logic in inward-cancel.ts.

import type { CancelHandler } from '../cancel-requests/registry';
import {
  cancelJwDcInwardTx,
  jwDcInwardCancelBlockers,
  jwDcInwardCancelEffects,
  lockJwDcInwardForCancel,
} from './inward-cancel';

export const jwDcInwardCancelHandler: CancelHandler = {
  docType: 'jw_dc_inward',
  // JW DC receipts are not enrolled in edit-approval.
  editEntity: null,

  async lock(tx, companyId, docId, forUpdate) {
    const h = await lockJwDcInwardForCancel(tx, companyId, docId, forUpdate);
    return h ? { code: h.code, cancelled: h.cancelledAt != null || h.deletedAt != null } : null;
  },

  // The worker's own rule — one place.
  blockers: jwDcInwardCancelBlockers,

  effects: jwDcInwardCancelEffects,

  async run(tx, companyId, docId, reason, actor) {
    await cancelJwDcInwardTx(tx, companyId, docId, reason, actor);
  },
};
