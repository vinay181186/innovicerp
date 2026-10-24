// ADR-235 — Invoice in the standard Cancel. Reuses cancelInvoiceTx (the one
// invoice cancel writer); this file only describes it for the preview.
//
// Blocker: invoiceCancelBlockers — the very rule the worker refuses on.
// Effects: each SO line's billed qty reopens (To Invoice is computed from live
// invoices, so a cancelled invoice frees it), plus the GST-portal note
// (ADR-235 point 9 — this system raises no IRN / e-way bill itself).

import type { CancelEffect } from '@innovic/shared';
import { sql } from 'drizzle-orm';
import type { CancelHandler } from '../cancel-requests/registry';
import { cancelInvoiceTx, invoiceCancelBlockers, lockInvoiceForCancel } from './service';

const GST_PORTAL_NOTE =
  'If an e-invoice IRN or e-way bill was generated for this invoice on the GST portal, ' +
  'cancel it there within 24 hours — after that issue a Credit Note instead.';

export const invoiceCancelHandler: CancelHandler = {
  docType: 'invoice',
  // Invoices are not enrolled in edit-approval (no staged edits to check).
  editEntity: null,

  async lock(tx, companyId, docId, forUpdate) {
    const inv = await lockInvoiceForCancel(tx, companyId, docId, forUpdate);
    return inv ? { code: inv.code, cancelled: inv.status === 'cancelled' } : null;
  },

  // The worker's own rule — one place (invoiceCancelBlockers).
  blockers: invoiceCancelBlockers,

  async effects(tx, _companyId, docId) {
    const rows = (await tx.execute(sql`
      SELECT il.line_no AS "lineNo", il.qty::int AS qty,
        COALESCE(i.code, il.item_code_text) AS "itemCode",
        sol.line_no AS "soLineNo", so.code AS "soCode"
      FROM public.invoice_lines il
      LEFT JOIN public.items i ON i.id = il.item_id
      LEFT JOIN public.sales_order_lines sol ON sol.id = il.sales_order_line_id
      LEFT JOIN public.sales_orders so ON so.id = sol.sales_order_id
      WHERE il.invoice_id = ${docId}::uuid AND il.deleted_at IS NULL
      ORDER BY il.line_no
    `)) as unknown as Array<{
      lineNo: number;
      qty: number;
      itemCode: string | null;
      soLineNo: number | null;
      soCode: string | null;
    }>;
    const out: CancelEffect[] = rows.map((r) => ({
      kind: 'reopen',
      text:
        r.soCode && r.soLineNo != null
          ? `${r.soCode} Ln ${r.soLineNo} — ${r.qty} billed qty reopens for invoicing`
          : `Ln ${r.lineNo}${r.itemCode ? ` ${r.itemCode}` : ''} — ${r.qty} billed qty reopens`,
      qty: Number(r.qty),
    }));
    out.push({ kind: 'note', text: GST_PORTAL_NOTE, qty: null });
    return out;
  },

  async run(tx, companyId, docId, reason, actor) {
    await cancelInvoiceTx(tx, companyId, docId, reason, actor);
  },
};
