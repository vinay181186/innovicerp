// ADR-235 — Item Issue (store issue) in the standard Cancel. Reuses
// cancelStoreIssueTx (the one Item Issue cancel writer: every line back into
// stock, an assembly SO's used reservation held again) and its own refusal rule
// storeIssueCancelBlockers (returns made, parts fitted). This file only adds
// the preview's effects.

import type { CancelEffect } from '@innovic/shared';
import { sql } from 'drizzle-orm';
import type { CancelHandler } from '../cancel-requests/registry';
import { cancelStoreIssueTx, lockStoreIssueForCancel, storeIssueCancelBlockers } from './cancel';
import { readSlipLines } from './slip';

export const storeIssueCancelHandler: CancelHandler = {
  docType: 'store_issue',
  // Item Issues are not enrolled in edit-approval.
  editEntity: null,

  async lock(tx, companyId, docId, forUpdate) {
    const iss = await lockStoreIssueForCancel(tx, companyId, docId, forUpdate);
    return iss ? { code: iss.code, cancelled: iss.reversedAt !== null } : null;
  },

  // The worker's own rule — one place.
  blockers: storeIssueCancelBlockers,

  async effects(tx, companyId, docId) {
    const iss = await lockStoreIssueForCancel(tx, companyId, docId, false);
    if (!iss) return [];
    const { lines } = await readSlipLines(tx, iss.id);
    const out: CancelEffect[] = lines.map((l) => ({
      kind: 'stock',
      text: `${l.itemCodeText} ${l.qty} comes back into stock`,
      qty: Number(l.qty),
    }));

    if (iss.issueAgainst === 'assembly_so' && iss.salesOrderId) {
      const held = lines.filter((l) => Number(l.reservedUsedQty) > 0);
      if (held.length > 0) {
        const so = (await tx.execute(sql`
          SELECT code FROM public.sales_orders
          WHERE id = ${iss.salesOrderId}::uuid AND company_id = ${companyId}::uuid
        `)) as unknown as Array<{ code: string }>;
        out.push({
          kind: 'note',
          text:
            `${held.map((l) => `${l.itemCodeText} ${l.reservedUsedQty}`).join(', ')} ` +
            `taken from ${so[0]?.code ?? 'the SO'}'s reservation is reserved for it again.`,
          qty: null,
        });
      }
    }
    if (iss.jobCardId) {
      const jc = (await tx.execute(sql`
        SELECT code FROM public.job_cards
        WHERE id = ${iss.jobCardId}::uuid AND company_id = ${companyId}::uuid
      `)) as unknown as Array<{ code: string }>;
      out.push({
        kind: 'note',
        text: `${jc[0]?.code ?? 'The Job Card'} — this issue no longer counts as material issued to it.`,
        qty: null,
      });
    }
    return out;
  },

  async run(tx, companyId, docId, reason, actor) {
    await cancelStoreIssueTx(tx, companyId, docId, reason, actor);
  },
};
