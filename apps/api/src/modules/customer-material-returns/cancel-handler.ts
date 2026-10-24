// ADR-235 — Customer Material Return in the standard Cancel. Reuses
// cancelCustomerMaterialReturnTx (the one IN-CMR cancel writer: conditional
// status flip, good pieces back into the customer material register, deviated
// pieces back to held on their Party GRN line, Return to Customer NCs
// re-balanced) and its refusal rule customerMaterialReturnCancelBlockers.

import type { CancelHandler } from '../cancel-requests/registry';
import {
  cancelCustomerMaterialReturnTx,
  customerMaterialReturnCancelBlockers,
  customerMaterialReturnCancelEffects,
  lockCustomerMaterialReturnForCancel,
} from './service';

export const customerMaterialReturnCancelHandler: CancelHandler = {
  docType: 'customer_material_return',
  // Customer Material Returns are not enrolled in edit-approval.
  editEntity: null,

  async lock(tx, companyId, docId, forUpdate) {
    const r = await lockCustomerMaterialReturnForCancel(tx, companyId, docId, forUpdate);
    return r ? { code: r.code, cancelled: r.status === 'cancelled' } : null;
  },

  blockers: customerMaterialReturnCancelBlockers,

  effects: customerMaterialReturnCancelEffects,

  async run(tx, companyId, docId, reason, actor) {
    await cancelCustomerMaterialReturnTx(tx, companyId, docId, reason, actor);
  },
};
