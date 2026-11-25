// ADR-320 — how far an SO line's OUTSOURCED operations are covered by approved
// POs, GRN receipts and Incoming QC (the PO Raised / GRN Received / QC Accepted
// chips on SO Status).
//
// Owner rules (24-11-2026):
//   - An op = a jc_ops row with op_type 'outsource' on the line's job cards.
//   - Only APPROVED PO qty counts (purchase_order_lines.approved_qty, 0262). A PO
//     waiting re-approval keeps its last approved qty; never-approved drafts are
//     shown, never counted; cancelled / deleted POs and lines are ignored.
//   - A short-closed PO counts only what was received on the line.
//   - A piece is covered only when EVERY outsourced op is: per job card the chip
//     is the LOWEST op; the line is the sum over its job cards, capped at the
//     line order qty. No "x || orderQty" fallbacks.
//
// One batched query for every op on the SO (CLAUDE.md §6). The math is pure
// (`computeOpCover`, `computeLineOspCover`) and unit-tested.

import { type SQL, sql } from 'drizzle-orm';
import type { SoStatusChip, SoStatusOspOp, SoStatusOspPoState } from '@innovic/shared';
import type { DbTransaction } from '../db/with-user-context';

/** The ONE op → PO-line link (shared with lib/osp-accepted.ts). Yields rows
 *  `(jc_op_id, po_line_id)` for every op on the given job cards:
 *  jc_ops.outsource_po_line_id ∪ live jc_op_po_lines ∪ purchase_order_lines.source_jc_op_id.
 *  UNION (not UNION ALL) so a PO line reached two ways is counted once.
 *  `includeSourceJcOp: false` keeps the older two-way set. */
export function ospOpPoLinkSql(
  companyId: string,
  jobCardIds: readonly string[],
  opts: { includeSourceJcOp?: boolean } = {},
): SQL {
  const jcList = sql.join(
    jobCardIds.map((id) => sql`${id}::uuid`),
    sql`, `,
  );
  const base = sql`
      SELECT o.id AS jc_op_id, o.outsource_po_line_id AS po_line_id
      FROM public.jc_ops o
      WHERE o.company_id = ${companyId}::uuid
        AND o.job_card_id IN (${jcList})
        AND o.deleted_at IS NULL
        AND o.outsource_po_line_id IS NOT NULL
      UNION
      SELECT jl.jc_op_id, jl.purchase_order_line_id
      FROM public.jc_op_po_lines jl
      JOIN public.jc_ops o ON o.id = jl.jc_op_id AND o.deleted_at IS NULL
      WHERE jl.company_id = ${companyId}::uuid
        AND o.job_card_id IN (${jcList})
        AND jl.deleted_at IS NULL`;
  if (opts.includeSourceJcOp === false) return base;
  return sql`${base}
      UNION
      SELECT pol.source_jc_op_id, pol.id
      FROM public.purchase_order_lines pol
      JOIN public.jc_ops o ON o.id = pol.source_jc_op_id AND o.deleted_at IS NULL
      WHERE pol.company_id = ${companyId}::uuid
        AND o.job_card_id IN (${jcList})
        AND pol.source_jc_op_id IS NOT NULL`;
}

/** One live PO line behind one op, with its GRN totals. */
export interface OspPoLineRow {
  poCode: string;
  poStatus: string;
  poShortClosed: boolean;
  /** An NC return-to-vendor replacement line (source_nc_id set, pre-ADR-221):
   *  it re-orders pieces already counted, so it adds receipts but no PO cover. */
  isReplacement: boolean;
  qty: number;
  /** null = never approved. */
  approvedQty: number | null;
  receivedQty: number;
  acceptedQty: number;
}

/** Live PO lines per jc_ops.id (live line, live PO, PO not cancelled), with
 *  Σ received / Σ QC accepted over live GRN lines on live GRNs. One query. */
export async function loadOspPoLinesByOp(
  tx: DbTransaction,
  companyId: string,
  jobCardIds: readonly string[],
): Promise<Map<string, OspPoLineRow[]>> {
  const out = new Map<string, OspPoLineRow[]>();
  if (jobCardIds.length === 0) return out;
  const rows = await tx.execute(sql`
    SELECT l.jc_op_id                        AS "jcOpId",
           po.code                           AS "poCode",
           po.status::text                   AS "poStatus",
           (po.short_closed_at IS NOT NULL)  AS "poShortClosed",
           (pol.source_nc_id IS NOT NULL)    AS "isReplacement",
           pol.qty::text                     AS "qty",
           pol.approved_qty::text            AS "approvedQty",
           COALESCE(g.recv, 0)::text         AS "receivedQty",
           COALESCE(g.acc, 0)::text          AS "acceptedQty"
    FROM (${ospOpPoLinkSql(companyId, jobCardIds)}) l
    JOIN public.purchase_order_lines pol
      ON pol.id = l.po_line_id AND pol.deleted_at IS NULL
    JOIN public.purchase_orders po
      ON po.id = pol.purchase_order_id
     AND po.company_id = ${companyId}::uuid
     AND po.deleted_at IS NULL
     AND po.status <> 'cancelled'
    LEFT JOIN LATERAL (
      SELECT SUM(grl.received_qty) AS recv, SUM(grl.qc_accepted_qty) AS acc
      FROM public.goods_receipt_note_lines grl
      JOIN public.goods_receipt_notes grn
        ON grn.id = grl.goods_receipt_note_id AND grn.deleted_at IS NULL
      WHERE grl.purchase_order_line_id = pol.id AND grl.deleted_at IS NULL
    ) g ON TRUE
    ORDER BY po.code
  `);
  for (const r of rows as unknown as Array<{
    jcOpId: string;
    poCode: string;
    poStatus: string;
    poShortClosed: boolean;
    isReplacement: boolean;
    qty: string;
    approvedQty: string | null;
    receivedQty: string;
    acceptedQty: string;
  }>) {
    const row: OspPoLineRow = {
      poCode: r.poCode,
      poStatus: r.poStatus,
      poShortClosed: r.poShortClosed === true,
      isReplacement: r.isReplacement === true,
      qty: Number(r.qty),
      approvedQty: r.approvedQty === null ? null : Number(r.approvedQty),
      receivedQty: Number(r.receivedQty),
      acceptedQty: Number(r.acceptedQty),
    };
    const arr = out.get(r.jcOpId);
    if (arr) arr.push(row);
    else out.set(r.jcOpId, [row]);
  }
  return out;
}

/** Purchase qty is numeric(14,3) — keep sums on 3 decimals (no 0.30000000004). */
const r3 = (n: number): number => Math.round(n * 1000) / 1000;

export interface OpCover {
  approvedPoQty: number;
  draftPoQty: number;
  poState: SoStatusOspPoState;
  poCodes: string[];
  grnReceivedQty: number;
  qcAcceptedQty: number;
}

/** Rule 3 — one op's cover from its live PO lines. Pure. Assumes the caller
 *  already dropped cancelled / deleted POs and lines (the loader does). */
export function computeOpCover(lines: readonly OspPoLineRow[], jcOrderQty: number): OpCover {
  let approved = 0;
  let draft = 0;
  let received = 0;
  let accepted = 0;
  let anyApproved = false;
  let anyReapproval = false;
  let anyDraft = false;
  const codes = new Set<string>();
  for (const l of lines) {
    if (l.poStatus === 'cancelled') continue; // defensive — loader already drops them
    codes.add(l.poCode);
    if (l.isReplacement) {
      received += l.receivedQty;
      accepted += l.acceptedQty;
      continue;
    }
    const isDraft = l.poStatus === 'draft';
    if (l.approvedQty === null) {
      if (isDraft) {
        draft += l.qty;
        anyDraft = true;
      }
      continue;
    }
    if (isDraft) anyReapproval = true;
    else anyApproved = true;
    approved += l.poShortClosed ? Math.min(l.approvedQty, l.receivedQty) : l.approvedQty;
    received += l.receivedQty;
    accepted += l.acceptedQty;
  }
  const approvedPoQty = r3(Math.min(approved, jcOrderQty));
  const grnReceivedQty = r3(Math.min(received, approvedPoQty));
  const qcAcceptedQty = r3(Math.min(accepted, grnReceivedQty));
  const poState: SoStatusOspPoState = anyApproved
    ? 'approved'
    : anyReapproval
      ? 'reapproval'
      : anyDraft
        ? 'draft'
        : 'none';
  return {
    approvedPoQty,
    draftPoQty: r3(draft),
    poState,
    poCodes: [...codes].sort(),
    grnReceivedQty,
    qcAcceptedQty,
  };
}

export interface CoverJcInput {
  jcId: string;
  jcCode: string;
  jcOrderQty: number;
  /** The job card's item. On an Equipment / BOM line the child parts' job cards
   *  carry the SAME SO line but a different item (plans.soLineId). */
  itemId: string | null;
  /** The job card's outsourced ops, in op_seq order. Empty = all in-house. */
  ops: ReadonlyArray<{
    jcOpId: string;
    opSeq: number;
    operation: string;
    poLines: readonly OspPoLineRow[];
  }>;
}

export interface LineOspCover {
  poRaised: SoStatusChip;
  grnReceived: SoStatusChip;
  qcAccepted: SoStatusChip;
  ospOps: SoStatusOspOp[];
}

/** Rules 4-6 — the line's three purchase chips + the per-op list. Pure.
 *  `jobCards` in JC-code order.
 *
 *  Job cards are grouped by item. Within one item the job cards split the
 *  pieces, so their cover adds up; a job card of that item with no outsourced
 *  op needs no PO, so all its pieces count as covered. Across items (an
 *  Equipment / BOM line: one job card per child part) a set is covered only when
 *  EVERY part is, so the line takes the LOWEST item, as a share of what that item
 *  needs: the line's own item needs the line order qty, a child part needs its
 *  job cards' qty. Items with no outsourced op at all do not take part. */
export function computeLineOspCover(
  lineOrderQty: number,
  jobCards: readonly CoverJcInput[],
  lineItemId: string | null = null,
): LineOspCover {
  const ospOps: SoStatusOspOp[] = [];
  const groups = new Map<string, { need: number; po: number; grn: number; qc: number; anyOp: boolean }>();
  for (const jc of jobCards) {
    // A job card with no item (legacy) belongs to the line's own item.
    const key = jc.itemId ?? lineItemId ?? 'line';
    const g = groups.get(key) ?? { need: 0, po: 0, grn: 0, qc: 0, anyOp: false };
    groups.set(key, g);
    g.need += jc.jcOrderQty;
    if (jc.ops.length === 0) {
      g.po += jc.jcOrderQty;
      g.grn += jc.jcOrderQty;
      g.qc += jc.jcOrderQty;
      continue;
    }
    g.anyOp = true;
    let jcPo = Infinity;
    let jcGrn = Infinity;
    let jcQc = Infinity;
    for (const op of jc.ops) {
      const c = computeOpCover(op.poLines, jc.jcOrderQty);
      jcPo = Math.min(jcPo, c.approvedPoQty);
      jcGrn = Math.min(jcGrn, c.grnReceivedQty);
      jcQc = Math.min(jcQc, c.qcAcceptedQty);
      ospOps.push({
        jcId: jc.jcId,
        jcCode: jc.jcCode,
        jcOpId: op.jcOpId,
        opSeq: op.opSeq,
        operation: op.operation,
        ...c,
      });
    }
    g.po += jcPo;
    g.grn += jcGrn;
    g.qc += jcQc;
  }
  const req = [...groups.entries()].filter(([, g]) => g.anyOp);
  if (req.length === 0) {
    const none: SoStatusChip = { qty: 0, total: 0, required: false };
    return { poRaised: none, grnReceived: { ...none }, qcAccepted: { ...none }, ospOps };
  }
  const single = groups.size === 1;
  let po = Infinity;
  let grn = Infinity;
  let qc = Infinity;
  for (const [key, g] of req) {
    const own = single || key === (lineItemId ?? 'line');
    if (own) {
      // The line's own item: pieces, against the line order qty.
      po = Math.min(po, g.po);
      grn = Math.min(grn, g.grn);
      qc = Math.min(qc, g.qc);
    } else {
      // A child part: its share of what it needs, in line units (sets).
      const share = (v: number): number => (g.need > 0 ? (Math.min(v, g.need) / g.need) * lineOrderQty : 0);
      po = Math.min(po, share(g.po));
      grn = Math.min(grn, share(g.grn));
      qc = Math.min(qc, share(g.qc));
    }
  }
  const poQty = r3(Math.min(po, lineOrderQty));
  const grnQty = r3(Math.min(grn, poQty));
  const qcQty = r3(Math.min(qc, grnQty));
  return {
    poRaised: { qty: poQty, total: lineOrderQty, required: true },
    grnReceived: { qty: grnQty, total: poQty, required: true },
    qcAccepted: { qty: qcQty, total: grnQty, required: true },
    ospOps,
  };
}
