// ADR-235 — Party GRN in the standard Cancel. Reuses cancelPartyGrnTx (the one
// Party GRN cancel writer: accepted pieces out of the customer material
// register, received_qty down, open NCs closed, header + lines soft-deleted and
// stamped Cancelled) and its own refusal rule partyGrnCancelBlockers. The
// preview's effects come from partyGrnCancelEffects, beside them.

import type { CancelHandler } from '../cancel-requests/registry';
import {
  cancelPartyGrnTx,
  lockPartyGrnForCancel,
  partyGrnCancelBlockers,
  partyGrnCancelEffects,
} from './service';

export const partyGrnCancelHandler: CancelHandler = {
  docType: 'party_grn',
  // Party GRN edits are staged for approval (ADR-202 Phase 3) under this
  // entity; a pending staged edit blocks a Cancel Request.
  editEntity: 'PartyGrn',

  async lock(tx, companyId, docId, forUpdate) {
    const h = await lockPartyGrnForCancel(tx, companyId, docId, forUpdate);
    return h ? { code: h.code, cancelled: h.cancelledAt != null || h.deletedAt != null } : null;
  },

  // The worker's own rule — one place.
  blockers: partyGrnCancelBlockers,

  effects: partyGrnCancelEffects,

  async run(tx, companyId, docId, reason, actor) {
    await cancelPartyGrnTx(tx, companyId, docId, reason, actor);
  },
};
