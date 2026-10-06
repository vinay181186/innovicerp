// ADR-217 phase 3 — "Sent on DC No." (NAMING.md): which OUTWARD challan the
// rejected pieces went out on, ASKED and never guessed.
//
// There is no piece, lot or batch tracking in this system (`lot_no` is
// `so_milestones`, i.e. SO delivery lots). When a job went out on two challans
// against one purchase-order line, NO query can say which one carried the piece
// an operator rejected two operations later — only the person who packed it. So
// the server's whole job here is to OFFER the honest shortlist and to refuse
// anything outside it; the screen asks, and the answer is stored on
// `nc_register.source_delivery_challan_id` (migration 0200).
//
// Two functions, one acceptance rule:
//   listNcSourceChallanCandidates — the shortlist (newest first).
//   assertSourceDeliveryChallan   — accepts exactly what the shortlist offers,
//                                   and says precisely why when it refuses.
// The second is implemented ON TOP of the first on purpose: the server can then
// never accept a challan it would not have offered, and the two cannot drift.
//
// The PO line both of them hang off is NOT derived here. It comes from
// `queryRtvCandidates` (delivery-challans/rtv-candidates.ts), the same `rpol`
// derivation the "Against JW PO / DC" picker and the Against PO guard already
// use — origin outsource op's `jc_ops.outsource_po_line_id`, else (no job card)
// the rejected GRN line's `purchase_order_line_id`. One derivation, three
// readers, so they cannot name different PO lines.

import { sql } from 'drizzle-orm';
import { type AuthContext, type DbTransaction, withUserContext } from '../../db/with-user-context';
import { requireFormAccess } from '../../lib/access';
import { AuthorizationError, NotFoundError, ValidationError } from '../../lib/errors';
import { queryRtvCandidates } from '../delivery-challans/rtv-candidates';

/** One outward challan the rejected pieces could have gone out on. Field names
 *  are the registered ones (NAMING.md: `Sent on DC No.` =
 *  `sourceDeliveryChallanCode` / `sourceDeliveryChallanId`). */
export interface NcSourceChallanCandidate {
  sourceDeliveryChallanId: string;
  sourceDeliveryChallanCode: string;
  /** The challan's own date (`delivery_challans.dc_date`), YYYY-MM-DD. */
  dcDate: string;
  /** What went out for THIS purchase-order line on THAT challan — the sum of
   *  its live lines for the line, so a challan that carried the item twice
   *  shows one row with the total. Decimal string (KGS / MTR items). */
  sentQty: string;
  purchaseOrderId: string | null;
  poCode: string | null;
}

export interface NcSourceChallanCandidatesResponse {
  /** The purchase-order line the NC traces to, so the screen can say what the
   *  shortlist is of. Null = nothing resolved, and then `items` is empty. */
  purchaseOrderLineId: string | null;
  items: NcSourceChallanCandidate[];
}

// A picker, not a report: one PO line's outward challans are bounded by its own
// qty, so this cap is a safety stop and never a page size.
const SOURCE_CHALLAN_LIMIT = 100;

function dateOnly(v: unknown): string {
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return String(v).slice(0, 10);
}

/**
 * The purchase-order line an NC's rejected pieces came from, read back through
 * the ONE shared derivation (`queryRtvCandidates`, filtered to this NC).
 *
 * Null when nothing resolves — an in-house reject, or a job-card NC whose
 * operation was never outsourced. That query only returns NCs that are READY
 * for their return challan or still awaiting QC's decision, which is exactly
 * the population this phase serves: the disposition screen asks while the NC is
 * still NC Raised, and `disposeNcCascade` validates under its FOR UPDATE lock
 * before the status moves.
 */
async function resolveNcPoLineId(
  tx: DbTransaction,
  companyId: string,
  ncId: string,
): Promise<string | null> {
  const rows = await queryRtvCandidates(tx, companyId, { ncId });
  return rows[0]?.purchaseOrderLineId ?? null;
}

/**
 * The outward challans the pieces could have gone out on, newest first.
 *
 * Which challans count as "pieces went out on it" is NOT a new rule: it is the
 * SENT predicate of lib/po-line-sent.ts (DC_SENT_WHERE) — a live line on a live
 * challan that is not cancelled and is not itself a return-to-vendor challan
 * (`nc_id` set). A return challan is where pieces went BACK, so offering one
 * here would answer the opposite question under this label.
 */
export async function listNcSourceChallanCandidates(
  tx: DbTransaction,
  companyId: string,
  ncId: string,
): Promise<NcSourceChallanCandidatesResponse> {
  const purchaseOrderLineId = await resolveNcPoLineId(tx, companyId, ncId);
  if (!purchaseOrderLineId) return { purchaseOrderLineId: null, items: [] };
  const rows = (await tx.execute(sql`
    SELECT dc.id AS "sourceDeliveryChallanId",
           dc.code AS "sourceDeliveryChallanCode",
           dc.dc_date AS "dcDate",
           SUM(dcl.qty)::text AS "sentQty",
           po.id AS "purchaseOrderId",
           COALESCE(po.code, dc.po_code_text) AS "poCode"
    FROM public.delivery_challan_lines dcl
    JOIN public.delivery_challans dc
      ON dc.id = dcl.delivery_challan_id
      AND dc.company_id = ${companyId}::uuid
      AND dc.deleted_at IS NULL
      -- Same two conditions as the SENT figure (lib/po-line-sent.ts).
      AND dc.nc_id IS NULL
      AND dc.status <> 'cancelled'
    LEFT JOIN public.purchase_orders po
      ON po.id = dc.purchase_order_id AND po.deleted_at IS NULL
    WHERE dcl.purchase_order_line_id = ${purchaseOrderLineId}::uuid
      AND dcl.company_id = ${companyId}::uuid
      AND dcl.deleted_at IS NULL
    GROUP BY dc.id, dc.code, dc.dc_date, dc.po_code_text, po.id
    ORDER BY dc.dc_date DESC, dc.code DESC
    LIMIT ${SOURCE_CHALLAN_LIMIT}
  `)) as unknown as Array<Record<string, unknown>>;
  return {
    purchaseOrderLineId,
    items: rows.map((r) => ({
      sourceDeliveryChallanId: r['sourceDeliveryChallanId'] as string,
      sourceDeliveryChallanCode: r['sourceDeliveryChallanCode'] as string,
      dcDate: dateOnly(r['dcDate']),
      sentQty: String(r['sentQty'] ?? '0'),
      purchaseOrderId: (r['purchaseOrderId'] as string | null) ?? null,
      poCode: (r['poCode'] as string | null) ?? null,
    })),
  };
}

/**
 * Refuse a `sourceDeliveryChallanId` the server would not have offered, and say
 * why in words the store can act on.
 *
 * Accepted = it is one of `listNcSourceChallanCandidates`. The checks the
 * message distinguishes are therefore all failures of that one rule:
 *   - the NC traces to no purchase-order line → nothing can be recorded;
 *   - no such challan in THIS company, or it is in the trash;
 *   - it is itself a return-to-vendor challan (`nc_id` set);
 *   - it is cancelled — nothing went out on it;
 *   - it carries no line for the purchase-order line this NC came from.
 * Storing any of those would put a meaningless number behind "Sent on DC No.",
 * which is worse than leaving it blank.
 */
export async function assertSourceDeliveryChallan(
  tx: DbTransaction,
  companyId: string,
  nc: { id: string; code: string },
  sourceDeliveryChallanId: string,
): Promise<void> {
  const { purchaseOrderLineId, items } = await listNcSourceChallanCandidates(tx, companyId, nc.id);
  if (!purchaseOrderLineId) {
    throw new ValidationError(
      `NC ${nc.code} does not trace to a purchase order line, so the challan the pieces ` +
        'went out on cannot be recorded. Leave Sent on DC No. blank.',
    );
  }
  if (items.some((c) => c.sourceDeliveryChallanId === sourceDeliveryChallanId)) return;
  // Refusal path only: one extra read, to name the reason instead of a flat
  // "not allowed".
  const rows = (await tx.execute(sql`
    SELECT dc.code AS "code",
           (dc.nc_id IS NOT NULL) AS "isReturn",
           (dc.status = 'cancelled') AS "isCancelled"
    FROM public.delivery_challans dc
    WHERE dc.id = ${sourceDeliveryChallanId}::uuid
      AND dc.company_id = ${companyId}::uuid
      AND dc.deleted_at IS NULL
    LIMIT 1
  `)) as unknown as Array<{ code: string; isReturn: boolean; isCancelled: boolean }>;
  const dc = rows[0];
  if (!dc) {
    throw new ValidationError(
      'That Delivery Challan no longer exists. Reload the page and pick Sent on DC No. again.',
    );
  }
  if (dc.isReturn) {
    throw new ValidationError(
      `DC ${dc.code} is a return-to-vendor challan — it is how pieces go BACK to the vendor, ` +
        'not how they went out. Pick the outward challan the pieces left on.',
    );
  }
  if (dc.isCancelled) {
    throw new ValidationError(
      `DC ${dc.code} is cancelled, so nothing went out on it. Pick the outward challan the ` +
        'pieces left on.',
    );
  }
  throw new ValidationError(
    `DC ${dc.code} was not raised against the purchase order line NC ${nc.code} came from. ` +
      'Pick one of the challans offered for this NC.',
  );
}

/** GET /nc-register/:id/source-challan-candidates — feeds the Sent on DC No.
 *  field on the disposition screen. Same form key as the dispose action it
 *  serves (`nc_dispose`, edit tier): the shortlist exists only to be answered,
 *  and nobody who cannot dispose can answer it. Returns an empty list — never
 *  an error — when the NC resolves to no purchase-order line. */
export async function getNcSourceChallanCandidates(
  ncId: string,
  user: AuthContext,
): Promise<NcSourceChallanCandidatesResponse> {
  await requireFormAccess(user, 'nc_dispose', 'edit');
  const companyId = user.companyId;
  if (!companyId) throw new AuthorizationError('User is not assigned to a company');
  return withUserContext(user, async (tx) => {
    const ncRows = (await tx.execute(sql`
      SELECT nc.id FROM public.nc_register nc
      WHERE nc.id = ${ncId}::uuid AND nc.company_id = ${companyId}::uuid
        AND nc.deleted_at IS NULL
      LIMIT 1
    `)) as unknown as Array<{ id: string }>;
    if (!ncRows[0]) throw new NotFoundError('NC not found. Refresh the page.');
    return listNcSourceChallanCandidates(tx, companyId, ncId);
  });
}
