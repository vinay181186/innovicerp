// ADR-235 — Stock Count in the standard Cancel. Reuses cancelStockCountTx and
// its refusal rule stockCountCancelBlockers (a posted count). A draft or
// submitted count has posted nothing, so nothing moves in stock.

import type { CancelHandler } from '../cancel-requests/registry';
import { cancelStockCountTx, lockStockCountForCancel, stockCountCancelBlockers } from './cancel';

export const stockCountCancelHandler: CancelHandler = {
  docType: 'stock_count',
  // Stock Counts are not enrolled in edit-approval.
  editEntity: null,

  async lock(tx, companyId, docId, forUpdate) {
    const h = await lockStockCountForCancel(tx, companyId, docId, forUpdate);
    return h ? { code: h.code, cancelled: h.status === 'cancelled' } : null;
  },

  // The worker's own rule — one place.
  blockers: stockCountCancelBlockers,

  async effects() {
    return [
      {
        kind: 'note',
        text: 'Nothing moves in stock — this count was never posted. It is closed as Cancelled.',
        qty: null,
      },
    ];
  },

  async run(tx, companyId, docId, reason, actor) {
    await cancelStockCountTx(tx, companyId, docId, reason, actor);
  },
};
