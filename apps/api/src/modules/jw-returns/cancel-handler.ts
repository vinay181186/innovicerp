// ADR-235 — JW Return (JW Dispatch) in the standard Cancel. Reuses
// cancelJwReturnChallanTx (the one JW Return cancel writer: goods back into
// stock, JWSO line returned qty down, JWSO header status re-derived) and its
// own refusal rule jwReturnCancelBlockers (live JW Invoices billing the line).

import type { CancelHandler } from '../cancel-requests/registry';
import {
  cancelJwReturnChallanTx,
  jwReturnCancelBlockers,
  jwReturnCancelEffects,
  lockJwReturnForCancel,
} from './service';

export const jwReturnCancelHandler: CancelHandler = {
  docType: 'jw_return',
  // JW Returns are not enrolled in edit-approval.
  editEntity: null,

  async lock(tx, companyId, docId, forUpdate) {
    const r = await lockJwReturnForCancel(tx, companyId, docId, forUpdate);
    return r ? { code: r.code, cancelled: r.status === 'cancelled' } : null;
  },

  // The worker's own rule — one place.
  blockers: jwReturnCancelBlockers,

  effects: jwReturnCancelEffects,

  async run(tx, companyId, docId, reason, actor) {
    await cancelJwReturnChallanTx(tx, companyId, docId, reason, actor);
  },
};
