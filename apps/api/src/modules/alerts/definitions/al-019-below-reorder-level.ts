// AL-019 — Below Reorder Level (store). ADR-193 phase 5, spec §15.
// Items whose Available + On PO has fallen under their Reorder Level — the
// same rule, and the same suggested qty, as the Store Reorder List
// (store-inventory/reorder-rule.ts). Open PR lists the PRs already raised for
// the item, so the reader can tell "needs a PR" from "PR waiting on a PO".

import { docNavPage } from '@innovic/shared';
import {
  readBelowReorder,
  readOpenPrsByItem,
  suggestedReorderQty,
} from '../../store-inventory/reorder-rule';
import type { RegisteredAlert } from '../registry';

export const al019BelowReorderLevel: RegisteredAlert = {
  definition: {
    code: 'AL-019',
    dept: 'store',
    name: 'Below Reorder Level',
    description: 'Items whose Available + On PO is below their Reorder Level.',
    columns: [
      { key: 'item_code', label: 'Item Code', type: 'text' },
      { key: 'item_name', label: 'Item Name', type: 'text' },
      { key: 'available_qty', label: 'Available', type: 'number' },
      { key: 'on_po_qty', label: 'On PO', type: 'number' },
      { key: 'reorder_level', label: 'Reorder Level', type: 'number' },
      { key: 'suggested_qty', label: 'Suggested Qty', type: 'number' },
      { key: 'open_pr', label: 'Open PR', type: 'text' },
    ],
    defaultActive: true,
  },
  async run({ tx, companyId }) {
    const below = await readBelowReorder(tx, companyId);
    const openPrs = await readOpenPrsByItem(
      tx,
      companyId,
      below.map((r) => r.itemId),
    );
    const rows = below.map((r) => ({
      navPage: docNavPage('item', r.itemId),
      item_code: r.itemCode,
      item_name: r.itemName ?? '',
      available_qty: r.availableQty,
      on_po_qty: r.onPoQty,
      reorder_level: r.reorderLevel,
      suggested_qty: suggestedReorderQty(r),
      // Each open PR with its balance still to order, e.g. "IN-PR-00012 (5)".
      open_pr: (openPrs.get(r.itemId) ?? []).map((p) => `${p.code} (${p.qty})`).join(', '),
    }));
    return { records: rows };
  },
};
