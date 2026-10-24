// ADR-235 — JW DC (outward) in the standard Cancel. Reuses cancelJwDcOutwardTx
// (the one JW DC cancel writer: each line's stock put back, header + lines
// soft-deleted and stamped Cancelled) and its own refusal rule
// jwDcOutwardCancelBlockers (a live JW DC receipt against it).

import type { CancelHandler } from '../cancel-requests/registry';
import {
  cancelJwDcOutwardTx,
  jwDcOutwardCancelBlockers,
  jwDcOutwardCancelEffects,
  lockJwDcOutwardForCancel,
} from './cancel';

export const jwDcOutwardCancelHandler: CancelHandler = {
  docType: 'jw_dc_outward',
  // JW DCs are not enrolled in edit-approval.
  editEntity: null,

  async lock(tx, companyId, docId, forUpdate) {
    const h = await lockJwDcOutwardForCancel(tx, companyId, docId, forUpdate);
    return h ? { code: h.code, cancelled: h.cancelledAt != null || h.deletedAt != null } : null;
  },

  // The worker's own rule — one place.
  blockers: jwDcOutwardCancelBlockers,

  effects: jwDcOutwardCancelEffects,

  async run(tx, companyId, docId, reason, actor) {
    await cancelJwDcOutwardTx(tx, companyId, docId, reason, actor);
  },
};
