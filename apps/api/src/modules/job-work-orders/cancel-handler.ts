// ADR-235 — JWSO in the standard Cancel. Reuses cancelJobWorkOrderTx (the ONE
// JWSO cancel writer) and its own refusal rule jobWorkOrderCancelBlockers. This
// file only adds the preview's effect: the JWSO and its lines become Cancelled.

import type { CancelHandler } from '../cancel-requests/registry';
import {
  cancelJobWorkOrderTx,
  jobWorkOrderCancelBlockers,
  jobWorkOrderLiveLineCount,
  lockJobWorkOrderForCancel,
} from './cancel';

export const jobWorkOrderCancelHandler: CancelHandler = {
  docType: 'job_work_order',
  // Live-JWSO edits are staged for approval (ADR-202) under this entity.
  editEntity: 'JobWorkOrder',

  async lock(tx, companyId, docId, forUpdate) {
    const jw = await lockJobWorkOrderForCancel(tx, companyId, docId, forUpdate);
    return jw ? { code: jw.code, cancelled: jw.status === 'cancelled' } : null;
  },

  // The worker's own rule — one place.
  blockers: jobWorkOrderCancelBlockers,

  async effects(tx, companyId, docId) {
    const n = await jobWorkOrderLiveLineCount(tx, companyId, docId);
    return [
      {
        kind: 'note',
        text: `JWSO and its ${n} line${n === 1 ? '' : 's'} become Cancelled — no new Party GRN / Job Card can be made on it`,
        qty: null,
      },
    ];
  },

  async run(tx, companyId, docId, reason, actor) {
    await cancelJobWorkOrderTx(tx, companyId, docId, reason, actor);
  },
};
