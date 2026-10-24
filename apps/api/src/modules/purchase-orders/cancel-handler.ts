// ADR-235 — Purchase Order in the standard Cancel. Reuses cancelPurchaseOrderTx
// (the ONE PO cancel writer, shared with Reject and Short Close's stop-wholly
// branch) and its own refusal rule purchaseOrderCancelBlockers (live GRN / DC /
// JW DC, part received, closed). This file only adds the preview's effects —
// read with the same rules releaseJcOpsForCancelledPo applies:
//   - each PR line handed back to the PR's Pending;
//   - each outsourced JC op: stays on another live PO, back to PR Raised, or
//     back to no PR.

import { type CancelEffect, opSrNo } from '@innovic/shared';
import { sql } from 'drizzle-orm';
import type { CancelHandler } from '../cancel-requests/registry';
import {
  cancelPurchaseOrderTx,
  lockPurchaseOrderForCancel,
  purchaseOrderCancelBlockers,
} from './cancel';
import { poCancelNote, poJcOpReleaseText, poPrReopenText } from './cancel-text';

export const purchaseOrderCancelHandler: CancelHandler = {
  docType: 'purchase_order',
  // Live-PO edits are staged for approval (ADR-202) under this entity.
  editEntity: 'PurchaseOrder',

  async lock(tx, companyId, docId, forUpdate) {
    const po = await lockPurchaseOrderForCancel(tx, companyId, docId, forUpdate);
    return po ? { code: po.code, cancelled: po.status === 'cancelled' } : null;
  },

  // The worker's own rule — one place.
  blockers: purchaseOrderCancelBlockers,

  async effects(tx, companyId, docId) {
    const po = await lockPurchaseOrderForCancel(tx, companyId, docId, false);
    if (!po) return [];
    const [prLines, ops] = await Promise.all([
      tx.execute(sql`
        SELECT pol.line_no AS "lineNo", pol.qty::float8 AS qty, pr.code AS "prCode"
        FROM public.purchase_order_lines pol
        JOIN public.purchase_requests pr ON pr.id = pol.source_pr_id
        WHERE pol.purchase_order_id = ${docId}::uuid AND pol.company_id = ${companyId}::uuid
          AND pol.deleted_at IS NULL AND pr.deleted_at IS NULL AND pr.status <> 'cancelled'
        ORDER BY pol.line_no
      `),
      tx.execute(sql`
        SELECT jc.code AS "jcCode", o.op_seq AS "opSeq", o.operation,
          CASE WHEN pr.id IS NOT NULL AND pr.deleted_at IS NULL AND pr.status <> 'cancelled'
               THEN pr.code END AS "prCode",
          EXISTS (
            SELECT 1 FROM public.jc_op_po_lines l
            JOIN public.purchase_order_lines pl ON pl.id = l.purchase_order_line_id
            JOIN public.purchase_orders p ON p.id = pl.purchase_order_id
            WHERE l.jc_op_id = o.id AND l.deleted_at IS NULL AND pl.deleted_at IS NULL
              AND p.deleted_at IS NULL AND p.status <> 'cancelled' AND p.id <> ${docId}::uuid
          ) AS "otherPo"
        FROM public.jc_ops o
        JOIN public.job_cards jc ON jc.id = o.job_card_id
        LEFT JOIN public.purchase_requests pr ON pr.id = o.outsource_pr_id
        WHERE o.company_id = ${companyId}::uuid AND o.deleted_at IS NULL
          AND o.outsource_po_line_id IN (
            SELECT id FROM public.purchase_order_lines WHERE purchase_order_id = ${docId}::uuid)
        ORDER BY jc.code, o.op_seq
      `),
    ]);

    const out: CancelEffect[] = [];
    for (const l of prLines as unknown as Array<{ lineNo: number; qty: number; prCode: string }>) {
      out.push({
        kind: 'reopen',
        text: poPrReopenText(l.prCode, Number(l.qty), l.lineNo),
        qty: Number(l.qty),
      });
    }
    for (const o of ops as unknown as Array<{
      jcCode: string;
      opSeq: number;
      operation: string | null;
      prCode: string | null;
      otherPo: boolean;
    }>) {
      out.push({
        kind: 'release',
        text: poJcOpReleaseText(o.jcCode, opSrNo(Number(o.opSeq)), o.operation, {
          otherPo: Boolean(o.otherPo),
          prCode: o.prCode,
        }),
        qty: null,
      });
    }
    out.push({ kind: 'note', text: poCancelNote(po.code), qty: null });
    return out;
  },

  async run(tx, companyId, docId, reason, actor) {
    await cancelPurchaseOrderTx(tx, companyId, docId, reason, actor);
  },
};
