// ADR-235 Phase C part 2 — DC Receipt (OSP receive-back) in the standard
// Cancel. Reuses cancelDcReceiptTx (the one DC receipt cancel writer: its GRN
// cancelled with it, receipt + lines stamped Cancelled, the op / DC statuses
// the receive moved forward put back) and its own refusal rule
// dcReceiptCancelBlockers (GRN Incoming QC touched, NC replacement, unlinked
// older receipt, Job Card already complete). Logic lives in receipt-cancel.ts.

import type { CancelHandler } from '../cancel-requests/registry';
import {
  cancelDcReceiptTx,
  dcReceiptCancelBlockers,
  dcReceiptCancelEffects,
  lockDcReceiptForCancel,
} from './receipt-cancel';

export const dcReceiptCancelHandler: CancelHandler = {
  docType: 'dc_receipt',
  // DC receipts are not enrolled in edit-approval.
  editEntity: null,

  async lock(tx, companyId, docId, forUpdate) {
    const h = await lockDcReceiptForCancel(tx, companyId, docId, forUpdate);
    return h
      ? { code: h.receiptCode, cancelled: h.cancelledAt != null || h.deletedAt != null }
      : null;
  },

  // The worker's own rule — one place.
  blockers: dcReceiptCancelBlockers,

  effects: dcReceiptCancelEffects,

  async run(tx, companyId, docId, reason, actor) {
    await cancelDcReceiptTx(tx, companyId, docId, reason, actor);
  },
};
