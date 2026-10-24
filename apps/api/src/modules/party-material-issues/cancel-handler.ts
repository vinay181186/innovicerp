// ADR-235 — Party Material Issue in the standard Cancel. Reuses
// cancelPartyMaterialIssueTx (the one PMI cancel writer: qty back into the
// customer material register, issued_qty down, row soft-deleted and stamped
// Cancelled) and its own refusal rule partyMaterialIssueCancelBlockers.

import type { CancelHandler } from '../cancel-requests/registry';
import {
  cancelPartyMaterialIssueTx,
  lockPartyMaterialIssueForCancel,
  partyMaterialIssueCancelBlockers,
  partyMaterialIssueCancelEffects,
} from './service';

export const partyMaterialIssueCancelHandler: CancelHandler = {
  docType: 'party_material_issue',
  // Party Material Issues are not enrolled in edit-approval.
  editEntity: null,

  async lock(tx, companyId, docId, forUpdate) {
    const iss = await lockPartyMaterialIssueForCancel(tx, companyId, docId, forUpdate);
    return iss
      ? { code: iss.code, cancelled: iss.cancelledAt != null || iss.deletedAt != null }
      : null;
  },

  // The worker's own rule — one place.
  blockers: partyMaterialIssueCancelBlockers,

  effects: partyMaterialIssueCancelEffects,

  async run(tx, companyId, docId, reason, actor) {
    await cancelPartyMaterialIssueTx(tx, companyId, docId, reason, actor);
  },
};
