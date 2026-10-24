// ADR-235 — JW Invoice in the standard Cancel. Reuses cancelJwInvoiceTx (the
// one writer that gives job_work_order_lines.invoiced_qty back) and its own
// refusal rule jwInvoiceCancelBlockers (counter out of step, ADR-203).
// Effect: the JWSO line's invoiced qty goes down by the invoice qty.

import type { CancelEffect } from '@innovic/shared';
import { sql } from 'drizzle-orm';
import type { CancelHandler } from '../cancel-requests/registry';
import { cancelJwInvoiceTx, jwInvoiceCancelBlockers, lockJwInvoiceForCancel } from './service';

export const jwInvoiceCancelHandler: CancelHandler = {
  docType: 'jw_invoice',
  // JW invoices are not enrolled in edit-approval.
  editEntity: null,

  async lock(tx, companyId, docId, forUpdate) {
    const inv = await lockJwInvoiceForCancel(tx, companyId, docId, forUpdate);
    return inv ? { code: inv.code, cancelled: inv.status === 'cancelled' } : null;
  },

  // The worker's own rule — one place.
  blockers: jwInvoiceCancelBlockers,

  async effects(tx, companyId, docId) {
    const rows = (await tx.execute(sql`
      SELECT ji.qty::int AS qty, jwl.line_no AS "lineNo",
        COALESCE(jw.code, ji.jw_code_text, '') AS "jwCode"
      FROM public.jw_invoices ji
      JOIN public.job_work_order_lines jwl ON jwl.id = ji.job_work_order_line_id
      JOIN public.job_work_orders jw ON jw.id = jwl.job_work_order_id
      WHERE ji.id = ${docId}::uuid AND ji.company_id = ${companyId}::uuid
      LIMIT 1
    `)) as unknown as Array<{ qty: number; lineNo: number; jwCode: string }>;
    const l = rows[0];
    if (!l) return [];
    const out: CancelEffect[] = [
      {
        kind: 'reopen',
        text: `${l.jwCode} Ln ${l.lineNo} invoiced qty −${l.qty} (can be billed again)`,
        qty: Number(l.qty),
      },
    ];
    return out;
  },

  async run(tx, companyId, docId, reason, actor) {
    await cancelJwInvoiceTx(tx, companyId, docId, reason, actor);
  },
};
