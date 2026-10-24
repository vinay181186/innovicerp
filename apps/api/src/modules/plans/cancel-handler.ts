// ADR-235 — Plan in the standard Cancel. Reuses cancelPlanTx (the one Plan
// cancel writer: status → Cancelled, stamped) and its own refusal rule
// planCancelBlockers (Production Orders, live Job Card, PRs not cancelled).

import type { CancelHandler } from '../cancel-requests/registry';
import { cancelPlanTx, lockPlanForCancel, planCancelBlockers, planCancelEffects } from './cancel';

export const planCancelHandler: CancelHandler = {
  docType: 'plan',
  // Plan edits are staged for approval under this entity; a pending staged
  // edit blocks a Cancel Request.
  editEntity: 'Plan',

  async lock(tx, companyId, docId, forUpdate) {
    const p = await lockPlanForCancel(tx, companyId, docId, forUpdate);
    return p ? { code: p.code, cancelled: p.planStatus === 'cancelled' } : null;
  },

  // The worker's own rule — one place.
  blockers: planCancelBlockers,

  effects: planCancelEffects,

  async run(tx, companyId, docId, reason, actor) {
    await cancelPlanTx(tx, companyId, docId, reason, actor);
  },
};
