// ADR-235 — Purchase Request in the standard Cancel. Reuses
// cancelPurchaseRequestTx (the shared "dead PR" writer, as Reject) and its own
// refusal rule purchaseRequestCancelBlockers (each live PO line ordering it).
// This file only adds the preview's effects: the JC op(s) handed back — the
// same selection releaseSourceJcOps makes — and a closing note.

import { type CancelEffect, opSrNo } from '@innovic/shared';
import { sql } from 'drizzle-orm';
import type { CancelHandler } from '../cancel-requests/registry';
import {
  cancelPurchaseRequestTx,
  lockPurchaseRequestForCancel,
  purchaseRequestCancelBlockers,
} from './cancel';
import { prCancelNote, prJcOpReleaseText } from './cancel-text';

export const purchaseRequestCancelHandler: CancelHandler = {
  docType: 'purchase_request',
  // PR edits now save directly (owner rule 2026-10-31); kept so a PR edit
  // staged before that rule (ADR-202) still blocks a cancel until decided.
  editEntity: 'PurchaseRequest',

  async lock(tx, companyId, docId, forUpdate) {
    const pr = await lockPurchaseRequestForCancel(tx, companyId, docId, forUpdate);
    return pr ? { code: pr.code, cancelled: pr.status === 'cancelled' } : null;
  },

  // The worker's own rule — one place.
  blockers: purchaseRequestCancelBlockers,

  async effects(tx, companyId, docId) {
    const pr = await lockPurchaseRequestForCancel(tx, companyId, docId, false);
    if (!pr) return [];
    // Same WHERE as releaseSourceJcOps (pr-cancel-writer.ts).
    const ops = (await tx.execute(sql`
      SELECT jc.code AS "jcCode", o.op_seq AS "opSeq", o.operation
      FROM public.jc_ops o
      JOIN public.job_cards jc ON jc.id = o.job_card_id
      WHERE o.outsource_pr_id = ${docId}::uuid AND o.company_id = ${companyId}::uuid
        AND o.outsource_po_line_id IS NULL AND o.deleted_at IS NULL
        AND o.outsource_status IN ('pending', 'pr_raised')
      ORDER BY jc.code, o.op_seq
    `)) as unknown as Array<{ jcCode: string; opSeq: number; operation: string | null }>;
    const out: CancelEffect[] = ops.map((o) => ({
      kind: 'release',
      text: prJcOpReleaseText(o.jcCode, opSrNo(Number(o.opSeq)), o.operation),
      qty: null,
    }));
    out.push({ kind: 'note', text: prCancelNote(pr.code), qty: null });
    return out;
  },

  async run(tx, companyId, docId, reason, actor) {
    await cancelPurchaseRequestTx(tx, companyId, docId, reason, actor);
  },
};
