// ADR-235 — Tool Issue in the standard Cancel. Reuses cancelToolIssueTx (the
// one Tool Issue cancel writer: the qty back into stock, every instrument back
// In Store) and its refusal rule toolIssueCancelBlockers (returns / write-offs
// recorded, item deleted). This file only adds the preview's effects.

import type { CancelEffect } from '@innovic/shared';
import { sql } from 'drizzle-orm';
import type { CancelHandler } from '../cancel-requests/registry';
import { cancelToolIssueTx, lockToolIssueForCancel, toolIssueCancelBlockers } from './cancel';

export const toolIssueCancelHandler: CancelHandler = {
  docType: 'tool_issue',
  // Tool Issues are not enrolled in edit-approval.
  editEntity: null,

  async lock(tx, companyId, docId, forUpdate) {
    const ti = await lockToolIssueForCancel(tx, companyId, docId, forUpdate);
    return ti ? { code: ti.code, cancelled: ti.returnStatus === 'cancelled' } : null;
  },

  // The worker's own rule — one place.
  blockers: toolIssueCancelBlockers,

  async effects(tx, companyId, docId) {
    const ti = await lockToolIssueForCancel(tx, companyId, docId, false);
    if (!ti) return [];
    const serials = (await tx.execute(sql`
      SELECT ins.serial_no AS "serialNo"
      FROM public.tool_issue_instruments l
      JOIN public.instruments ins ON ins.id = l.instrument_id
      WHERE l.tool_issue_id = ${docId}::uuid AND l.deleted_at IS NULL
        AND ins.company_id = ${companyId}::uuid
      ORDER BY lower(ins.serial_no)
    `)) as unknown as Array<{ serialNo: string }>;
    // Same qty the worker posts: one per instrument, else the issue qty.
    const qty = serials.length > 0 ? serials.length : ti.qty;
    const out: CancelEffect[] = [
      {
        kind: 'stock',
        text: `${ti.itemCode ?? ti.code} ${qty} comes back into stock`,
        qty,
      },
    ];
    if (serials.length > 0) {
      out.push({
        kind: 'note',
        text: `Instrument Serial No. ${serials.map((s) => s.serialNo).join(', ')} go back In Store.`,
        qty: null,
      });
    }
    return out;
  },

  async run(tx, companyId, docId, reason, actor) {
    await cancelToolIssueTx(tx, companyId, docId, reason, actor);
  },
};
