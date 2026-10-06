// Return-to-vendor candidates by JW PO / DC No. (ADR-211).
//
// READ-ONLY. Finds the NCs whose rejected pieces are waiting to go back to the
// vendor, so the store can pick one by the JW PO No. / the DC No. the pieces
// first went out on. The challan itself is still raised by createNcDc
// (POST /nc-register/:id/create-dc) — one writer for RTV qty (CLAUDE.md §20.1).
//
// Four users of the same SQL (queryRtvCandidates):
//   - GET /delivery-challans/rtv-candidates (the "Against JW PO / DC" picker)
//   - the Against PO guard inside createDeliveryChallan (service.ts), which
//     refuses an ordinary send on a PO line that has RTV pieces waiting unless
//     the store confirms these are new pieces — assertNoRtvPending, below.
//   - ADR-217 phase 4: the SECOND outward route, createJwDcOutward (jw-dc
//     module), through the same assertNoRtvPending. ADR-211 had recorded that
//     path as "not covered"; it is covered now, which is why the guard lives
//     here next to its SQL and not inside one of the two callers.
//   - ADR-217 phase 3: the source-challan shortlist
//     (nc-register/source-challan.ts), which reads back the PO line ONE NC
//     traces to rather than deriving it a second time.

import { sql } from 'drizzle-orm';
import {
  type ListRtvCandidatesQuery,
  type ListRtvCandidatesResponse,
  type RtvCandidate,
  type RtvCandidateState,
  type RtvPendingConflictDetails,
  RTV_CANDIDATE_STATE_LABELS,
  roundQty,
} from '@innovic/shared';
import { type AuthContext, type DbTransaction, withUserContext } from '../../db/with-user-context';
import { requireFormAccess } from '../../lib/access';
import { AuthorizationError, ConflictError } from '../../lib/errors';
import { rtvReadyForChallanSql } from '../../lib/rtv-predicates';

const RTV_CANDIDATES_LIMIT = 500;

export interface RtvCandidateFilter {
  /** Only NCs whose resolved JW PO is this one. */
  purchaseOrderId?: string;
  /** Only NCs whose resolved PO line is one of these. Empty array = no rows. */
  purchaseOrderLineIds?: string[];
  /** ADR-217 — this ONE non-conformance. Used by the source-challan capture
   *  (nc-register/source-challan.ts) to read back the PO line this NC traces
   *  to, through the same `rpol` derivation the picker and the Against PO guard
   *  use, so the three can never name different PO lines. */
  ncId?: string;
}

function dateOnly(v: unknown): string {
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return String(v).slice(0, 10);
}

function toCandidate(r: Record<string, unknown>): RtvCandidate {
  const str = (k: string): string | null => (r[k] as string | null) ?? null;
  return {
    ncId: r['ncId'] as string,
    ncCode: r['ncCode'] as string,
    ncDate: dateOnly(r['ncDate']),
    state: r['state'] as RtvCandidateState,
    itemId: str('itemId'),
    itemCode: str('itemCode'),
    itemCodeText: str('itemCodeText'),
    itemRevision: str('itemRevision'),
    itemName: str('itemName'),
    itemNameText: str('itemNameText'),
    rejectedQty: String(r['rejectedQty'] ?? '0'),
    clientPoLineNo: str('clientPoLineNo'),
    jobCardId: str('jobCardId'),
    jcCode: str('jcCode'),
    opSeq: r['opSeq'] != null ? Number(r['opSeq']) : null,
    purchaseOrderId: str('purchaseOrderId'),
    poCode: str('poCode'),
    purchaseOrderLineId: str('purchaseOrderLineId'),
    sourceDeliveryChallanId: str('sourceDeliveryChallanId'),
    sourceDeliveryChallanCode: str('sourceDeliveryChallanCode'),
    vendorId: str('vendorId'),
    vendorCode: str('vendorCode'),
    vendorName: str('vendorName'),
  };
}

/**
 * One row per NC that is either READY for its return challan (the exact
 * createNcDc predicate, lib/rtv-predicates.ts) or a vendor-sourced NC still
 * AWAITING QC's decision. One SQL statement, no N+1.
 */
export async function queryRtvCandidates(
  tx: DbTransaction,
  companyId: string,
  filter: RtvCandidateFilter = {},
): Promise<RtvCandidate[]> {
  if (filter.purchaseOrderLineIds && filter.purchaseOrderLineIds.length === 0) return [];

  const ready = rtvReadyForChallanSql('nc');
  const ncFrag = filter.ncId ? sql`AND nc.id = ${filter.ncId}::uuid` : sql``;
  const poFrag = filter.purchaseOrderId ? sql`AND po.id = ${filter.purchaseOrderId}::uuid` : sql``;
  const poLineFrag = filter.purchaseOrderLineIds
    ? sql`AND rpol.pol_id IN (${sql.join(
        filter.purchaseOrderLineIds.map((id) => sql`${id}::uuid`),
        sql`, `,
      )})`
    : sql``;

  const result = await tx.execute(sql`
    SELECT
      nc.id AS "ncId",
      nc.code AS "ncCode",
      nc.nc_date AS "ncDate",
      CASE WHEN ${ready} THEN 'ready' ELSE 'awaiting_decision' END AS "state",
      nc.item_id AS "itemId",
      i.code AS "itemCode",
      nc.item_code_text AS "itemCodeText",
      -- Same revision / POL hops as the NC list (listNcRegister).
      COALESCE(sol.revision::text, rev_jwl.revision::text) AS "itemRevision",
      i.name AS "itemName",
      nc.item_name_text AS "itemNameText",
      nc.rejected_qty::text AS "rejectedQty",
      sol.client_po_line_no AS "clientPoLineNo",
      nc.job_card_id AS "jobCardId",
      jc.code AS "jcCode",
      nc.op_seq AS "opSeq",
      po.id AS "purchaseOrderId",
      po.code AS "poCode",
      rpol.pol_id AS "purchaseOrderLineId",
      sdc.id AS "sourceDeliveryChallanId",
      sdc.code AS "sourceDeliveryChallanCode",
      src.vendor_id AS "vendorId",
      v.code AS "vendorCode",
      v.name AS "vendorName"
    FROM public.nc_register nc
    LEFT JOIN public.job_cards jc
      ON jc.id = nc.job_card_id AND jc.deleted_at IS NULL
    LEFT JOIN public.items i
      ON i.id = nc.item_id AND i.deleted_at IS NULL
    LEFT JOIN public.sales_order_lines sol
      ON sol.id = jc.source_so_line_id AND sol.deleted_at IS NULL
    LEFT JOIN public.job_work_order_lines rev_jwl
      ON rev_jwl.id = jc.source_jw_line_id AND rev_jwl.deleted_at IS NULL
    -- Origin op. MIRRORS createNcDc and resolveNcSource (b), which both read
    -- the op by id + company only (no deleted_at filter) — kept identical so
    -- this list resolves the same PO line / vendor those functions will use.
    LEFT JOIN public.jc_ops oo
      ON oo.id = nc.jc_op_id AND oo.company_id = nc.company_id
    -- The rejected GRN line, as resolveNcSource (a) reads it (company + live),
    -- then its GRN, then the OSP DC the pieces went out on ("Sent on DC No.").
    LEFT JOIN public.goods_receipt_note_lines gl
      ON gl.id = nc.grn_line_id AND gl.company_id = nc.company_id AND gl.deleted_at IS NULL
    LEFT JOIN public.goods_receipt_notes grn
      ON grn.id = gl.goods_receipt_note_id AND grn.deleted_at IS NULL
    -- ADR-217 — the STORED source challan wins when somebody recorded it
    -- (nc.source_delivery_challan_id): there is no piece or lot tracking in
    -- this system, so for an NC raised at the machine the person who packed it
    -- is the only source, and no GRN hop can answer. The derived hop stays as
    -- the answer for an Incoming-QC reject. Same COALESCE as resolveNcSource
    -- (nc-register/cascades.ts), so the two readers cannot disagree.
    LEFT JOIN public.delivery_challans sdc
      -- ADR-217: only an ORDINARY receipt can say which challan the pieces went
      -- OUT on. A replacement receipt (grn.nc_id set) carries the PARENT
      -- deviation's RETURN challan, so deriving from it names the challan these
      -- pieces came BACK on, under a label that means the opposite. The guard is
      -- INSIDE the COALESCE, not on the join: the grn alias is also read by the
      -- vendor LATERAL below, and guarding the join would blank the vendor and
      -- change which deviations this picker lists. (No backticks in here: the
      -- whole SELECT is a TypeScript template literal and one would close it.)
      ON sdc.id = COALESCE(
        nc.source_delivery_challan_id,
        CASE WHEN grn.nc_id IS NULL THEN grn.delivery_challan_id END
      )
        AND sdc.company_id = nc.company_id
        AND sdc.deleted_at IS NULL
    -- PO line — MIRRORS createNcDc (nc-register/service.ts, poLineId):
    --   origin op with (op_type = 'outsource' OR outsource_po_line_id set)
    --     -> jc_ops.outsource_po_line_id. That condition is true whenever the
    --     column is non-null, so it reduces to oo.outsource_po_line_id;
    --   else, an NC with NO job card and a GRN line -> that GRN line's
    --     purchase_order_line_id (read by id only, as createNcDc does).
    LEFT JOIN LATERAL (
      SELECT COALESCE(
        oo.outsource_po_line_id,
        CASE WHEN nc.job_card_id IS NULL AND nc.grn_line_id IS NOT NULL THEN
          (SELECT g.purchase_order_line_id
             FROM public.goods_receipt_note_lines g
            WHERE g.id = nc.grn_line_id
            LIMIT 1)
        END
      ) AS pol_id
    ) rpol ON TRUE
    LEFT JOIN public.purchase_order_lines pol
      ON pol.id = rpol.pol_id AND pol.company_id = nc.company_id AND pol.deleted_at IS NULL
    LEFT JOIN public.purchase_orders po
      ON po.id = pol.purchase_order_id AND po.deleted_at IS NULL
    -- Source vendor — MIRRORS resolveNcSource (nc-register/cascades.ts):
    --   (a) GRN line set -> the GRN's vendor;
    --   (b) else origin op is an outsource op -> the vendor of the PO line
    --       raised for that op (source_jc_op_id), PO-backed rows first, newest.
    LEFT JOIN LATERAL (
      SELECT po2.vendor_id
        FROM public.purchase_order_lines pol2
        LEFT JOIN public.purchase_orders po2
          ON po2.id = pol2.purchase_order_id AND po2.deleted_at IS NULL
       WHERE pol2.source_jc_op_id = oo.id AND pol2.deleted_at IS NULL
       ORDER BY (po2.id IS NOT NULL) DESC, pol2.created_at DESC
       LIMIT 1
    ) opo ON nc.grn_line_id IS NULL AND oo.op_type = 'outsource'
    LEFT JOIN LATERAL (
      SELECT CASE
        WHEN nc.grn_line_id IS NOT NULL THEN grn.vendor_id
        WHEN oo.op_type = 'outsource' THEN opo.vendor_id
      END AS vendor_id
    ) src ON TRUE
    LEFT JOIN public.vendors v
      ON v.id = src.vendor_id AND v.deleted_at IS NULL
    WHERE nc.company_id = ${companyId}::uuid
      AND nc.deleted_at IS NULL
      AND (
        ${ready}
        -- awaiting_decision: still NC Raised AND vendor-sourced exactly as
        -- resolveNcSource.isVendorSourced (the dispose guard, cascades.ts):
        -- a GRN line, or an origin op of type outsource.
        OR (nc.status = 'pending'::nc_status
            AND (nc.grn_line_id IS NOT NULL OR oo.op_type = 'outsource'))
      )
      ${ncFrag}
      ${poFrag}
      ${poLineFrag}
    -- Ready first, so the cap never hides a Ready to Send NC behind
    -- awaiting-decision ones.
    ORDER BY (CASE WHEN ${ready} THEN 0 ELSE 1 END), nc.nc_date DESC, nc.code DESC
    LIMIT ${RTV_CANDIDATES_LIMIT}
  `);
  return (result as unknown as Array<Record<string, unknown>>).map(toCandidate);
}

const RTV_MESSAGE_MAX_NCS = 3;

/** ADR-211 — 409 (details.kind = 'rtv_pending') when any of these PO lines has
 *  return-to-vendor pieces waiting that the store has NOT confirmed as
 *  different pieces. Confirmation is per NC: an NC whose id is in
 *  `confirmedNcIds` is let through; any other waiting NC refuses the save, and
 *  only those unconfirmed NCs are listed. Same SQL as
 *  GET /delivery-challans/rtv-candidates.
 *
 *  ADR-217 phase 4 — called by BOTH outward routes (createDeliveryChallan and
 *  createJwDcOutward), each AFTER lockPoLinesForSend on the same lines, so the
 *  two can neither deadlock against each other nor disagree about what is
 *  waiting. Not race-proof, and deliberately so: the NC writers (dispose,
 *  Incoming QC, createNcDc) do not take the PO-line lock, so an NC committed in
 *  the same instant as a save slips past; the next save on the line re-checks.
 *  Making it race-proof would mean locking NC rows from the challan paths,
 *  which is a bigger change than the risk (one challan, re-checked next time)
 *  justifies. */
export async function assertNoRtvPending(
  tx: DbTransaction,
  companyId: string,
  poLineIds: string[],
  confirmedNcIds: readonly string[],
): Promise<void> {
  const confirmed = new Set(confirmedNcIds);
  const waiting = (
    await queryRtvCandidates(tx, companyId, { purchaseOrderLineIds: poLineIds })
  ).filter((c) => !confirmed.has(c.ncId));
  if (waiting.length === 0) return;
  const shown = waiting
    .slice(0, RTV_MESSAGE_MAX_NCS)
    .map(
      (c) =>
        `${c.ncCode} (${roundQty(Number(c.rejectedQty))} pcs, ${RTV_CANDIDATE_STATE_LABELS[c.state]})`,
    );
  const more = waiting.length - shown.length;
  const list =
    more > 0
      ? `${shown.join(', ')} and ${more} more`
      : shown.length > 1
        ? `${shown.slice(0, -1).join(', ')} and ${shown[shown.length - 1]}`
        : shown[0]!;
  const one = waiting.length === 1;
  const anyReady = waiting.some((c) => c.state === 'ready');
  const anyAwaiting = waiting.some((c) => c.state === 'awaiting_decision');
  // A 'Waiting for QC Decision' NC cannot be sent yet (the picker greys it), so
  // only point Ready to Send pieces at the return route.
  const message =
    `${list} ${one ? 'on this PO line is' : 'on these PO lines are'} waiting to go back to the vendor. ` +
    (anyReady ? 'Send Ready to Send pieces with DC Against → Against JW PO / DC. ' : '') +
    (anyAwaiting ? 'Pieces Waiting for QC Decision cannot be sent until QC decides. ' : '') +
    'If these are different pieces, tick “These are new pieces, not the ones waiting to go back”.';
  const details: RtvPendingConflictDetails = {
    kind: 'rtv_pending',
    ncs: waiting.map((c) => ({
      ncId: c.ncId,
      ncCode: c.ncCode,
      itemCode: c.itemCode ?? c.itemCodeText,
      rejectedQty: c.rejectedQty,
      state: c.state,
      // Filtered on purchaseOrderLineIds, so the resolved line is always set.
      poLineId: c.purchaseOrderLineId ?? '',
    })),
  };
  throw new ConflictError(message, details);
}

/** GET /delivery-challans/rtv-candidates */
export async function listRtvCandidates(
  query: ListRtvCandidatesQuery,
  user: AuthContext,
): Promise<ListRtvCandidatesResponse> {
  await requireFormAccess(user, 'ospdc_create', 'view');
  const companyId = user.companyId;
  if (!companyId) throw new AuthorizationError('User is not assigned to a company');
  return withUserContext(user, async (tx) => {
    const items = await queryRtvCandidates(
      tx,
      companyId,
      query.purchaseOrderId ? { purchaseOrderId: query.purchaseOrderId } : {},
    );
    return { items };
  });
}
