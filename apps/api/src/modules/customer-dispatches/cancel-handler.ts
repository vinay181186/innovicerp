// ADR-235 — Customer Dispatch in the standard Cancel. Reuses cancelDispatchTx
// (the one dispatch cancel writer: stock back in, SO dispatched qty down,
// booking restored, SO header re-synced) and its own refusal rule
// dispatchCancelBlockers (invoiced pieces, per SO line). This file only adds
// the preview's effects: per line, the stock coming back (replayed from the
// ledger for an old per-component dispatch, as the worker does) and the SO
// line's dispatch qty reopening.

import type { CancelEffect } from '@innovic/shared';
import { sql } from 'drizzle-orm';
import type { CancelHandler } from '../cancel-requests/registry';
import {
  cancelDispatchTx,
  dispatchCancelBlockers,
  loadDispatchedComponentsByLine,
  lockDispatchForCancel,
} from './service';

interface LineFacts {
  dispatchCode: string;
  lineNo: number;
  qty: number;
  itemId: string | null;
  itemCode: string | null;
  soLineId: string | null;
  soLineNo: number | null;
  soCode: string | null;
}

export const customerDispatchCancelHandler: CancelHandler = {
  docType: 'customer_dispatch',
  // A dispatch's line qty is staged for approval (ADR-202 Phase 3) under this
  // entity; a pending staged edit blocks a Cancel Request.
  editEntity: 'Dispatch',

  async lock(tx, companyId, docId, forUpdate) {
    const h = await lockDispatchForCancel(tx, companyId, docId, forUpdate);
    return h ? { code: h.code, cancelled: h.status === 'cancelled' } : null;
  },

  // The worker's own rule — one place.
  blockers: dispatchCancelBlockers,

  async effects(tx, companyId, docId) {
    const lines = (await tx.execute(sql`
      SELECT cd.code AS "dispatchCode", cdl.line_no AS "lineNo", cdl.qty::int AS qty,
        cdl.item_id AS "itemId", COALESCE(i.code, cdl.item_code_text) AS "itemCode",
        cdl.sales_order_line_id AS "soLineId", sol.line_no AS "soLineNo",
        COALESCE(so.code, cd.so_code_text) AS "soCode"
      FROM public.customer_dispatch_lines cdl
      JOIN public.customer_dispatches cd ON cd.id = cdl.customer_dispatch_id
      LEFT JOIN public.items i ON i.id = cdl.item_id
      LEFT JOIN public.sales_order_lines sol ON sol.id = cdl.sales_order_line_id
      LEFT JOIN public.sales_orders so ON so.id = sol.sales_order_id
      WHERE cdl.customer_dispatch_id = ${docId}::uuid
        AND cd.company_id = ${companyId}::uuid
        AND cdl.deleted_at IS NULL
      ORDER BY cdl.line_no
    `)) as unknown as LineFacts[];
    const first = lines[0];
    if (!first) return [];
    // One ledger read for every line (the worker replays these exact rows).
    const byLine = await loadDispatchedComponentsByLine(tx, companyId, first.dispatchCode);

    const out: CancelEffect[] = [];
    for (const l of lines) {
      const qty = Number(l.qty);
      const moved = byLine.get(l.lineNo) ?? [];
      if (moved.length > 0) {
        for (const m of moved) {
          out.push({
            kind: 'stock',
            text: `${m.itemCode} ${m.qty} comes back into stock`,
            qty: m.qty,
          });
        }
      } else if (l.itemId) {
        out.push({
          kind: 'stock',
          text: `${l.itemCode ?? `Ln ${l.lineNo}`} ${qty} comes back into stock`,
          qty,
        });
      }
      if (l.soLineId) {
        out.push({
          kind: 'reopen',
          text: `${l.soCode ?? 'SO'} Ln ${l.soLineNo ?? '?'} dispatch qty reopens`,
          qty,
        });
      }
    }
    out.push({
      kind: 'note',
      text: 'Stock this dispatch took from an SO booking is booked to that SO again.',
      qty: null,
    });
    return out;
  },

  async run(tx, companyId, docId, reason, actor) {
    await cancelDispatchTx(tx, companyId, docId, reason, actor);
  },
};
