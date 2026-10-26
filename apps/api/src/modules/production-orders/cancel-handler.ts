// ADR-235 — Production Order in the standard Cancel. Reuses
// cancelProductionOrderTx (the ONE Production Order cancel writer: its own Job
// Card(s) cancelled with it, the order stamped Cancelled, the plan's Pending
// given back) and its own refusal rule productionOrderCancelBlockers (Stock
// Received, not Open, stock booked, its Job Cards' own blockers). The
// preview's effects come from productionOrderCancelEffects, beside them.

import type { CancelHandler } from '../cancel-requests/registry';
import {
  cancelProductionOrderTx,
  lockProductionOrderForCancel,
  productionOrderCancelBlockers,
  productionOrderCancelEffects,
} from './cancel';

export const productionOrderCancelHandler: CancelHandler = {
  docType: 'production_order',
  // Production Order header edits are staged for approval (ADR-202 Phase 3)
  // under this entity; a pending staged edit blocks a Cancel Request.
  editEntity: 'ProductionOrder',

  async lock(tx, companyId, docId, forUpdate) {
    const h = await lockProductionOrderForCancel(tx, companyId, docId, forUpdate);
    // A trashed order (deleted_at, no cancelled_at) is not a live document
    // either — the request is refused as "already cancelled / gone".
    return h ? { code: h.code, cancelled: h.cancelledAt != null || h.deletedAt != null } : null;
  },

  // The worker's own rule — one place.
  blockers: productionOrderCancelBlockers,

  effects: productionOrderCancelEffects,

  async run(tx, companyId, docId, reason, actor) {
    await cancelProductionOrderTx(tx, companyId, docId, reason, actor);
  },
};
