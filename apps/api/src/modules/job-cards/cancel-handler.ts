// ADR-235 — Job Card in the standard Cancel. Reuses cancelJobCardTx (the ONE
// Job Card cancel writer: card + live ops stamped Cancelled) and its own
// refusal rule jobCardCancelBlockers (anything made on / for the card, or a
// Production Order that owns it). The preview's effects come from
// jobCardCancelEffects, beside them (cancel.ts).

import type { CancelHandler } from '../cancel-requests/registry';
import {
  cancelJobCardTx,
  jobCardCancelBlockers,
  jobCardCancelEffects,
  lockJobCardForCancel,
} from './cancel';

export const jobCardCancelHandler: CancelHandler = {
  docType: 'job_card',
  // Job Card edits are staged for approval (ADR-202 / ADR-249) under this
  // entity; a pending staged edit blocks a Cancel Request.
  editEntity: 'JobCard',

  async lock(tx, companyId, docId, forUpdate) {
    const h = await lockJobCardForCancel(tx, companyId, docId, forUpdate);
    return h ? { code: h.code, cancelled: h.cancelled } : null;
  },

  // The worker's own rule — one place. Asked directly, a Production Order's
  // card is refused (cancel the order instead).
  blockers: (tx, companyId, docId) => jobCardCancelBlockers(tx, companyId, docId),

  effects: jobCardCancelEffects,

  async run(tx, companyId, docId, reason, actor) {
    await cancelJobCardTx(tx, companyId, docId, reason, actor);
  },
};
