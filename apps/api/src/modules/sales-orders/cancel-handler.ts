// ADR-235 — Sales Order in the standard Cancel. Reuses cancelSalesOrderTx (the
// ONE header-cancel writer — the PATCH path refuses status → cancelled) and its
// own refusal rule salesOrderCancelBlockers. This file only adds the preview's
// effects: per line, the booked stock handed back to free stock, and the note
// that every line becomes Cancelled.

import type { CancelEffect } from '@innovic/shared';
import type { CancelHandler } from '../cancel-requests/registry';
import {
  cancelSalesOrderTx,
  lockSalesOrderForCancel,
  salesOrderCancelBlockers,
  salesOrderHeldBookings,
} from './cancel';

export const salesOrderCancelHandler: CancelHandler = {
  docType: 'sales_order',
  // Live-SO header edits are staged for approval (ADR-202) under this entity.
  editEntity: 'SalesOrder',

  async lock(tx, companyId, docId, forUpdate) {
    const so = await lockSalesOrderForCancel(tx, companyId, docId, forUpdate);
    return so ? { code: so.code, cancelled: so.status === 'cancelled' } : null;
  },

  // The worker's own rule — one place.
  blockers: salesOrderCancelBlockers,

  async effects(tx, companyId, docId) {
    const held = await salesOrderHeldBookings(tx, companyId, docId);
    const out: CancelEffect[] = held.map((h) => ({
      kind: 'release',
      text: `Ln ${h.lineNo}${h.itemCode ? ` ${h.itemCode}` : ''}: ${h.held} booked stock released to free stock`,
      qty: h.held,
    }));
    out.push({ kind: 'note', text: 'All lines become Cancelled', qty: null });
    return out;
  },

  async run(tx, companyId, docId, reason, actor) {
    await cancelSalesOrderTx(tx, companyId, docId, reason, actor);
  },
};
