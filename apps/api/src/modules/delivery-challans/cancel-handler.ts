// ADR-235 — OSP Delivery Challan in the standard Cancel. Reuses
// cancelDeliveryChallanTx (the one DC cancel writer: the Job Card op's sent qty
// comes back off the op, an NC return-to-vendor challan sends its NC back to
// Disposed) and its own refusal rule deliveryChallanCancelBlockers (receipts,
// NC rules). This file only adds the preview's effects.
//
// The OSP DC is stock-neutral (ADR-067), so there is no stock effect: per line
// the op's sent pieces reopen (they can be sent again on the PO line).

import { opSrNo, type CancelEffect } from '@innovic/shared';
import { sql } from 'drizzle-orm';
import type { CancelHandler } from '../cancel-requests/registry';
import {
  cancelDeliveryChallanTx,
  deliveryChallanCancelBlockers,
  lockDeliveryChallanForCancel,
} from './service';

interface LineFacts {
  lineNo: number;
  qty: number;
  itemCode: string | null;
  poCode: string | null;
  poLineNo: number | null;
  jcCode: string | null;
  opSeq: number | null;
}

export const deliveryChallanCancelHandler: CancelHandler = {
  docType: 'delivery_challan',
  // A DC's line qty / material / remarks are staged for approval (ADR-202
  // Phase 3) under this entity; a pending staged edit blocks a Cancel Request.
  editEntity: 'DeliveryChallan',

  async lock(tx, companyId, docId, forUpdate) {
    const h = await lockDeliveryChallanForCancel(tx, companyId, docId, forUpdate);
    return h ? { code: h.code, cancelled: h.status === 'cancelled' } : null;
  },

  // The worker's own rule — one place.
  blockers: deliveryChallanCancelBlockers,

  async effects(tx, companyId, docId) {
    const h = await lockDeliveryChallanForCancel(tx, companyId, docId, false);
    if (!h) return [];
    const out: CancelEffect[] = [];

    if (h.ncId) {
      const nc = (await tx.execute(sql`
        SELECT code FROM public.nc_register
        WHERE id = ${h.ncId}::uuid AND company_id = ${companyId}::uuid
      `)) as unknown as Array<{ code: string }>;
      out.push({
        kind: 'note',
        text:
          `${nc[0]?.code ?? 'The NC'} goes back to Disposed — its pieces are no longer out ` +
          `with the vendor and a return-to-vendor challan can be raised again.`,
        qty: null,
      });
      return out;
    }

    // Same hop reverseOutwardFromJcOp takes: DC line → PO line → jc_op_po_lines → op.
    const lines = (await tx.execute(sql`
      SELECT dl.line_no AS "lineNo", dl.qty::float8 AS qty,
        COALESCE(i.code, dl.item_code_text) AS "itemCode",
        po.code AS "poCode", pol.line_no AS "poLineNo",
        op.jc_code AS "jcCode", op.op_seq AS "opSeq"
      FROM public.delivery_challan_lines dl
      LEFT JOIN public.items i ON i.id = dl.item_id
      LEFT JOIN public.purchase_order_lines pol ON pol.id = dl.purchase_order_line_id
      LEFT JOIN public.purchase_orders po ON po.id = pol.purchase_order_id
      LEFT JOIN LATERAL (
        SELECT jc.code AS jc_code, o.op_seq
        FROM public.jc_op_po_lines x
        JOIN public.jc_ops o ON o.id = x.jc_op_id AND o.deleted_at IS NULL
        JOIN public.job_cards jc ON jc.id = o.job_card_id
        WHERE x.purchase_order_line_id = dl.purchase_order_line_id
          AND x.company_id = ${companyId}::uuid AND x.deleted_at IS NULL
        LIMIT 1
      ) op ON true
      WHERE dl.delivery_challan_id = ${docId}::uuid AND dl.deleted_at IS NULL
      ORDER BY dl.line_no
    `)) as unknown as LineFacts[];

    for (const l of lines) {
      const qty = Math.round(Number(l.qty));
      if (l.jcCode && l.opSeq != null) {
        out.push({
          kind: 'reopen',
          text:
            `${l.jcCode} Op ${opSrNo(l.opSeq)} — ${qty} pcs sent on this DC come off the op ` +
            `and can be sent again${l.poCode ? ` on ${l.poCode} Ln ${l.poLineNo ?? '?'}` : ''}`,
          qty,
        });
      } else {
        out.push({
          kind: 'note',
          text: `Ln ${l.lineNo}${l.itemCode ? ` ${l.itemCode}` : ''} — ${qty} pcs: no Job Card operation to give back`,
          qty: null,
        });
      }
    }
    out.push({
      kind: 'note',
      text: 'No stock moves — an OSP challan does not move stock.',
      qty: null,
    });
    return out;
  },

  async run(tx, companyId, docId, reason, actor) {
    await cancelDeliveryChallanTx(tx, companyId, docId, reason, actor);
  },
};
