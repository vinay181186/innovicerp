// Delivery Challan service (T-040a read-only + T-059a outward write).
//
// T-040a shipped list + detail only. T-059a adds the outward create + cancel
// flows from the legacy `printChallan` line 26133. Receive-back lands in
// T-059b. Writes go through service.ts so cascades into jc_ops.sentQty +
// outsource_status + store_transactions stay atomic with the DC row insert.

import { and, asc, eq, inArray, isNull, like, sql } from 'drizzle-orm';
import {
  deliveryChallanLines,
  deliveryChallanReceiptLines,
  deliveryChallanReceipts,
  deliveryChallans,
  items,
  jcOps,
  jobCards,
  jobWorkOrderLines,
  purchaseOrderLines,
  purchaseOrders,
  salesOrderLines,
  salesOrders,
  vendors,
} from '../../db/schema';
import { type AuthContext, type DbTransaction, withUserContext } from '../../db/with-user-context';
import { requireAnyFormAccess, requireFormAccess } from '../../lib/access';
import { readSf, sfOrderBy, sfWhere } from '../../lib/list-query';
import { assertActiveParty } from '../../lib/active-party';
import {
  AuthorizationError,
  ConflictError,
  NotFoundError,
  ValidationError,
} from '../../lib/errors';
import { lockDocSeries } from '../../lib/doc-series-lock';
import { assertProductionOrderNotShortClosedForPoLine } from '../../lib/production-order-stop';
import { lockPoLinesForSend, sumSentOnPoLines } from '../../lib/po-line-sent';
import { assertRowUpdated } from '../../lib/row-lock';
import { buildTimeline, section, toIsoDate } from '../../lib/traceability';
import { emitActivityLog } from '../activity-log/service';
import { tryCascadeJcComplete } from '../op-entry/sales-cascade';
import { onNcChallanCancelled, onNcChallanReceived } from '../nc-register/recovery';
import {
  applyOutwardToJcOp,
  jobWorkUnlinkedRefusal,
  loadOutwardSendable,
  reverseOutwardFromJcOp,
} from './cascades';
import { applyReceiveToJcOp, dcHasActiveReceipts, isDcFullyReconciled } from './receipt-cascades';
import { DC_SF_COLUMNS, DC_SF_JOINS } from './sf-columns';
import { insertGrnForOspReceipt } from '../goods-receipt-notes/service';
import {
  ActivityAction,
  bumpDocRevision,
  opSrNo,
  parseDocRevision,
  qtyUomProblem,
  roundQty,
  withDocRevision,
} from '@innovic/shared';
import type {
  DocumentEditStagedResult,
  DocumentTraceability,
  ReceiveDeliveryChallanResponse,
} from '@innovic/shared';
import { diffFields } from '../../lib/audit-trail';
import {
  DC_HEADER_EDIT_FIELDS,
  dcLineDiffFields,
  dcLineMaterialKey,
  dcLineQtyKey,
  dcLineRemarksKey,
} from './edit-fields';
import type {
  CreateDeliveryChallanInput,
  CreateDeliveryChallanReceiptInput,
  DcSendableLine,
  DcSendablePreview,
  DeliveryChallanListItem,
  DeliveryChallanReceipt,
  DeliveryChallanWithLines,
  ListDeliveryChallansQuery,
  ListDeliveryChallansResponse,
  UpdateDeliveryChallanInput,
} from './schema';

const requireCompany = (user: AuthContext): string => {
  if (!user.companyId) throw new AuthorizationError('User is not assigned to a company');
  return user.companyId;
};

function dateLike(v: unknown): string {
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return String(v);
}

function tsLike(v: unknown): string {
  if (v instanceof Date) return v.toISOString();
  return String(v);
}

function maybeTsLike(v: unknown): string | null {
  if (v == null) return null;
  return tsLike(v);
}

/** Escape the ILIKE metacharacters in a user's search term. Without this a
 *  user typing "50%" or "a_b" in the DC search box gets a wildcard pattern
 *  instead of a literal search — a bare "%" listed every DC in the company.
 *  The SQL side must pair it with an ESCAPE '\' clause on every ILIKE, or the
 *  escapes themselves start matching literally.
 *  Deliberately a local copy of the sales-orders / GRN helper rather than an
 *  export across modules: it is three lines, and each list must stay free to
 *  change its own search behaviour without dragging the others. */
function escapeLikeTerm(raw: string): string {
  return raw.replace(/[\\%_]/g, (ch) => `\\${ch}`);
}

export async function listDeliveryChallans(
  input: ListDeliveryChallansQuery,
  user: AuthContext,
): Promise<ListDeliveryChallansResponse> {
  const companyId = requireCompany(user);
  return withUserContext(user, async (tx) => {
    // Search covers every field the DC card (delivery-challans/components/
    // dc-card.tsx) actually shows: DC No., Vendor (the resolved name, then the
    // stored vendor text the card falls back to), the PO chip (the linked PO's
    // live code, then the amber snapshot text), the status badge, the DC date,
    // the SO cell (the resolved SO code, then the stored SO ref) and Transport.
    //
    // Two aliases the page query has are NOT available here — this same
    // fragment is reused by the total-count and KPI-summary queries below,
    // which join only `dc` + `v`. The PO code and both SO paths are therefore
    // reached with their own EXISTS on dc's own foreign keys, so all three
    // queries stay valid.
    //
    // Deliberately NOT searched:
    //  - the Sent quantity and the Lines count: numbers, so "2" would hit
    //    nearly every DC;
    //  - money of any kind. There is none on this card (OSP rates live on the
    //    PO), and this area's prices are gated by `canSeeFormPrice` — a
    //    searchable amount would let a user without that right confirm a value
    //    by guessing it;
    //  - vehicle no. and the line items: not on the list screen.
    const term = input.search ? `%${escapeLikeTerm(input.search)}%` : null;
    const searchFrag = term
      ? sql`AND (
          dc.code ILIKE ${term} ESCAPE '\\'
          -- Vendor cell renders vendorName ?? vendorCodeText.
          OR v.name ILIKE ${term} ESCAPE '\\'
          OR dc.vendor_code_text ILIKE ${term} ESCAPE '\\'
          -- PO chip renders poCode (green) ?? poCodeText (amber), so match the
          -- live PO's code as well as the text this DC stored when issued.
          OR dc.po_code_text ILIKE ${term} ESCAPE '\\'
          OR EXISTS (
            SELECT 1
            FROM public.purchase_orders spo
            WHERE spo.id = dc.purchase_order_id
              AND spo.deleted_at IS NULL
              AND spo.code ILIKE ${term} ESCAPE '\\'
          )
          OR dc.status::text ILIKE ${term} ESCAPE '\\'
          OR dc.dc_date::text ILIKE ${term} ESCAPE '\\'
          OR dc.transport ILIKE ${term} ESCAPE '\\'
          -- SO cell renders soCode ?? soRefText. soCode itself has two sources,
          -- the same two the SELECT COALESCEs: the DC's own SO line...
          OR dc.so_ref_text ILIKE ${term} ESCAPE '\\'
          -- ADR-207: the Internal SO No. of the SO a free-text so_ref_text names
          -- (no FK there, so matched by code within the company).
          OR EXISTS (
            SELECT 1
            FROM public.sales_orders srf
            WHERE srf.company_id = dc.company_id
              AND srf.code = dc.so_ref_text
              AND srf.deleted_at IS NULL
              AND srf.internal_so_no ILIKE ${term} ESCAPE '\\'
          )
          OR EXISTS (
            SELECT 1
            FROM public.sales_order_lines ssol
            JOIN public.sales_orders sso
              ON sso.id = ssol.sales_order_id AND sso.deleted_at IS NULL
            WHERE ssol.id = dc.sales_order_line_id
              AND ssol.deleted_at IS NULL
              AND (sso.code ILIKE ${term} ESCAPE '\\'
                OR sso.internal_so_no ILIKE ${term} ESCAPE '\\')
          )
          -- ...and, for an OSP DC that carries only a PO, the SO(s) behind that
          -- PO's lines.
          OR EXISTS (
            SELECT 1
            FROM public.purchase_order_lines spol
            JOIN public.sales_order_lines ssol2
              ON ssol2.id = spol.source_so_line_id AND ssol2.deleted_at IS NULL
            JOIN public.sales_orders sso2
              ON sso2.id = ssol2.sales_order_id AND sso2.deleted_at IS NULL
            WHERE spol.purchase_order_id = dc.purchase_order_id
              AND spol.deleted_at IS NULL
              AND (sso2.code ILIKE ${term} ESCAPE '\\'
                OR sso2.internal_so_no ILIKE ${term} ESCAPE '\\')
          )
        )`
      : sql``;
    const statusFrag = input.status ? sql`AND dc.status = ${input.status}::dc_status` : sql``;
    const vendorFrag = input.vendorId ? sql`AND dc.vendor_id = ${input.vendorId}::uuid` : sql``;
    const poFrag = input.purchaseOrderId
      ? sql`AND dc.purchase_order_id = ${input.purchaseOrderId}::uuid`
      : sql``;
    const fromFrag = input.fromDate ? sql`AND dc.dc_date >= ${input.fromDate}::date` : sql``;
    const toFrag = input.toDate ? sql`AND dc.dc_date <= ${input.toDate}::date` : sql``;
    // Sort & Filter (ADR-200): the screen's column filters + sort, through the
    // list's own field whitelist (sf-columns.ts). Applied to the list, the count
    // AND the KPI summary — the latter two add the page query's other joins
    // (DC_SF_JOINS, one row per DC) only while a filter needs them.
    const sf = readSf(input.sf);
    const sfFrag = sfWhere(DC_SF_COLUMNS, sf);
    const sfJoins = sf && sf.filters.length > 0 ? DC_SF_JOINS : sql``;
    const orderBy = sfOrderBy(DC_SF_COLUMNS, sf, sql`dc.dc_date DESC, dc.code DESC`);

    const result = await tx.execute(sql`
      SELECT
        dc.id, dc.company_id AS "companyId", dc.code,
        dc.dc_date AS "dcDate",
        dc.purchase_order_id AS "purchaseOrderId",
        dc.po_code_text AS "poCodeText",
        dc.vendor_id AS "vendorId",
        dc.vendor_code_text AS "vendorCodeText",
        dc.sales_order_line_id AS "salesOrderLineId",
        dc.so_ref_text AS "soRefText",
        dc.transport,
        dc.vehicle_no AS "vehicleNo",
        -- Return-to-vendor challan raised from an NC (design §5). Both codes
        -- are joined live rather than snapshotted: an NC or job card is never
        -- renamed, and the FK is the one true link. Null on an ordinary OSP DC.
        dc.nc_id AS "ncId",
        nc.code AS "ncCode",
        dc.job_card_id AS "jobCardId",
        njc.code AS "jobCardCode",
        dc.reason,
        dc.status,
        dc.created_at AS "createdAt", dc.created_by AS "createdBy",
        dc.updated_at AS "updatedAt", dc.updated_by AS "updatedBy",
        dc.deleted_at AS "deletedAt",
        v.name AS "vendorName",
        po.code AS "poCode",
        COALESCE(so.code, po_so.so_code) AS "soCode",
        -- ADR-207 Internal SO No., read live from the SAME SO the cell shows:
        -- the DC's own SO line, else the PO's single SO, else the SO a
        -- free-text so_ref_text names.
        CASE WHEN so.id IS NOT NULL THEN so.internal_so_no
             WHEN po_so.so_code IS NOT NULL THEN po_so.so_internal_no
             ELSE so_ref.internal_so_no END AS "soInternalNo",
        -- Header-level drawing revision, following soCode's two sources exactly,
        -- plus a third arm for a JWSO-sourced return-to-vendor challan: the
        -- job card the DC was raised for carries source_jw_line_id instead of
        -- an SO line, so the job-work line's revision is the fallback (ADR-177).
        -- Cast to text: the contract types it as a string, and the column is
        -- only text on a database that has had migration 0119; on one that has
        -- not it is still the old integer and a bare select would hand the UI a
        -- number. Never items.revision — a different column about the item.
        COALESCE(sol.revision::text, po_so.so_revision, njc_jwl.revision::text) AS "soLineRevision",
        COALESCE(line_agg.line_count, 0)::int AS "lineCount",
        COALESCE(line_agg.total_qty, 0)::text AS "totalQty"
      FROM public.delivery_challans dc
      LEFT JOIN public.vendors v ON v.id = dc.vendor_id AND v.deleted_at IS NULL
      -- PO / NC / job card / SO (direct, else through the PO's lines) and the
      -- line totals: one copy, shared with the count and summary (sf-columns.ts).
      ${DC_SF_JOINS}
      WHERE dc.company_id = ${companyId}::uuid
        AND dc.deleted_at IS NULL
        ${searchFrag}
        ${statusFrag}
        ${vendorFrag}
        ${poFrag}
        ${fromFrag}
        ${toFrag}
        ${sfFrag}
      ORDER BY ${orderBy}
      LIMIT ${input.limit} OFFSET ${input.offset}
    `);

    // Total behind "N DCs" and the pager. Runs the SAME fragments as the page
    // query above — search and dates included — so the header count, the
    // "Showing 1–25 of N" line and the page buttons agree with what is listed.
    // It used to be a Drizzle count that skipped the search and the date range,
    // so a search that matched two DCs still reported (and paged) the whole
    // company's DC count.
    const totalRows = await tx.execute(sql`
      SELECT COUNT(*)::int AS total
      FROM public.delivery_challans dc
      LEFT JOIN public.vendors v ON v.id = dc.vendor_id AND v.deleted_at IS NULL
      ${sfJoins}
      WHERE dc.company_id = ${companyId}::uuid
        AND dc.deleted_at IS NULL
        ${searchFrag}
        ${statusFrag}
        ${vendorFrag}
        ${poFrag}
        ${fromFrag}
        ${toFrag}
        ${sfFrag}
    `);
    const total = Number(
      (totalRows as unknown as Array<Record<string, unknown>>)[0]?.['total'] ?? 0,
    );

    // PL-DR-1b — KPI summary (matches the filter set). Legacy
    // renderDispatchRegister L10756–10770: Total Dispatched / Entries /
    // Items. entryCount = total DC lines, itemCount = distinct items.
    const summaryRows = await tx.execute(sql`
      SELECT
        COALESCE(SUM(dcl.qty), 0)::float       AS total_dispatched,
        COUNT(dcl.id)::int                     AS entry_count,
        COUNT(DISTINCT dcl.item_id)::int       AS item_count
      FROM public.delivery_challans dc
      LEFT JOIN public.vendors v ON v.id = dc.vendor_id AND v.deleted_at IS NULL
      ${sfJoins}
      LEFT JOIN public.delivery_challan_lines dcl
        ON dcl.delivery_challan_id = dc.id AND dcl.deleted_at IS NULL
      WHERE dc.company_id = ${companyId}::uuid
        AND dc.deleted_at IS NULL
        ${searchFrag}
        ${statusFrag}
        ${vendorFrag}
        ${poFrag}
        ${fromFrag}
        ${toFrag}
        ${sfFrag}
    `);
    const sumRow = (summaryRows as unknown as Array<Record<string, unknown>>)[0] ?? {};
    const summary = {
      totalDispatched: Number(sumRow['total_dispatched'] ?? 0),
      entryCount: Number(sumRow['entry_count'] ?? 0),
      itemCount: Number(sumRow['item_count'] ?? 0),
    };

    const items = (result as unknown as Array<Record<string, unknown>>).map(toListItem);
    return { items, total, limit: input.limit, offset: input.offset, summary };
  });
}

function toListItem(r: Record<string, unknown>): DeliveryChallanListItem {
  return {
    id: r['id'] as string,
    companyId: r['companyId'] as string,
    code: r['code'] as string,
    dcDate: dateLike(r['dcDate']),
    purchaseOrderId: (r['purchaseOrderId'] as string | null) ?? null,
    poCodeText: r['poCodeText'] as string,
    vendorId: r['vendorId'] as string,
    vendorCodeText: r['vendorCodeText'] as string,
    salesOrderLineId: (r['salesOrderLineId'] as string | null) ?? null,
    soRefText: (r['soRefText'] as string | null) ?? null,
    transport: (r['transport'] as string | null) ?? null,
    vehicleNo: (r['vehicleNo'] as string | null) ?? null,
    ncId: (r['ncId'] as string | null) ?? null,
    ncCode: (r['ncCode'] as string | null) ?? null,
    jobCardId: (r['jobCardId'] as string | null) ?? null,
    jobCardCode: (r['jobCardCode'] as string | null) ?? null,
    reason: (r['reason'] as string | null) ?? null,
    status: r['status'] as DeliveryChallanListItem['status'],
    createdAt: tsLike(r['createdAt']),
    createdBy: r['createdBy'] as string,
    updatedAt: tsLike(r['updatedAt']),
    updatedBy: r['updatedBy'] as string,
    deletedAt: maybeTsLike(r['deletedAt']),
    vendorName: (r['vendorName'] as string | null) ?? null,
    poCode: (r['poCode'] as string | null) ?? null,
    soCode: (r['soCode'] as string | null) ?? null,
    soInternalNo: (r['soInternalNo'] as string | null) ?? null,
    soLineRevision: (r['soLineRevision'] as string | null) ?? null,
    lineCount: Number(r['lineCount'] ?? 0),
    totalQty: r['totalQty'] as string,
  };
}

async function loadDeliveryChallanWithLines(
  tx: DbTransaction,
  id: string,
  companyId: string,
): Promise<DeliveryChallanWithLines> {
  const headerRows = await tx.execute(sql`
      SELECT
        dc.id, dc.company_id AS "companyId", dc.code,
        dc.dc_date AS "dcDate",
        dc.purchase_order_id AS "purchaseOrderId",
        dc.po_code_text AS "poCodeText",
        dc.vendor_id AS "vendorId",
        dc.vendor_code_text AS "vendorCodeText",
        dc.sales_order_line_id AS "salesOrderLineId",
        dc.so_ref_text AS "soRefText",
        dc.transport,
        dc.vehicle_no AS "vehicleNo",
        -- Return-to-vendor challan raised from an NC (design §5). Both codes
        -- are joined live rather than snapshotted: an NC or job card is never
        -- renamed, and the FK is the one true link. Null on an ordinary OSP DC.
        dc.nc_id AS "ncId",
        nc.code AS "ncCode",
        dc.job_card_id AS "jobCardId",
        njc.code AS "jobCardCode",
        dc.reason,
        dc.status,
        dc.created_at AS "createdAt", dc.created_by AS "createdBy",
        dc.updated_at AS "updatedAt", dc.updated_by AS "updatedBy",
        dc.deleted_at AS "deletedAt",
        v.name AS "vendorName",
        po.code AS "poCode",
        COALESCE(so.code, po_so.so_code) AS "soCode",
        -- ADR-207 Internal SO No., read live from the SAME SO the cell shows:
        -- the DC's own SO line, else the PO's single SO, else the SO a
        -- free-text so_ref_text names.
        CASE WHEN so.id IS NOT NULL THEN so.internal_so_no
             WHEN po_so.so_code IS NOT NULL THEN po_so.so_internal_no
             ELSE so_ref.internal_so_no END AS "soInternalNo",
        -- Header-level drawing revision, following soCode's two sources exactly,
        -- plus a third arm for a JWSO-sourced return-to-vendor challan: the
        -- job card the DC was raised for carries source_jw_line_id instead of
        -- an SO line, so the job-work line's revision is the fallback (ADR-177).
        -- ::text because the contract types it as a string and the column is
        -- only text on a database that has had migration 0119. Never
        -- items.revision — a different column, about the item master.
        COALESCE(sol.revision::text, po_so.so_revision, njc_jwl.revision::text) AS "soLineRevision"
      FROM public.delivery_challans dc
      LEFT JOIN public.vendors v ON v.id = dc.vendor_id AND v.deleted_at IS NULL
      LEFT JOIN public.purchase_orders po
        ON po.id = dc.purchase_order_id AND po.deleted_at IS NULL
      LEFT JOIN public.nc_register nc ON nc.id = dc.nc_id AND nc.deleted_at IS NULL
      LEFT JOIN public.job_cards njc ON njc.id = dc.job_card_id AND njc.deleted_at IS NULL
      LEFT JOIN public.job_work_order_lines njc_jwl
        ON njc_jwl.id = njc.source_jw_line_id AND njc_jwl.deleted_at IS NULL
      LEFT JOIN public.sales_order_lines sol
        ON sol.id = dc.sales_order_line_id AND sol.deleted_at IS NULL
      LEFT JOIN public.sales_orders so
        ON so.id = sol.sales_order_id AND so.deleted_at IS NULL
      -- OSP/vendor DCs carry only purchase_order_id (no sales_order_line_id),
      -- so resolve the SO through the PO's lines' source_so_line_id as a fallback.
      LEFT JOIN LATERAL (
        SELECT string_agg(DISTINCT so2.code, ', ' ORDER BY so2.code) AS so_code,
          -- One drawing revision, or none at all. The SO code beside it is an
          -- aggregate over every line of the PO, so pairing "IN-SO-11, IN-SO-12"
          -- with "A, B" would leave the reader to guess which belongs to which.
          -- A revision is emitted only when all of the PO's SO lines agree on
          -- one; otherwise NULL, which prints as no revision rather than as a
          -- guess. ::text for the same pre-0119 reason as everywhere else.
          CASE WHEN COUNT(DISTINCT sol2.revision) = 1
               THEN MIN(sol2.revision)::text END AS so_revision,
          -- ADR-207: the Internal SO No. only when the PO serves ONE SO, for
          -- the same no-guessing reason as the revision.
          CASE WHEN COUNT(DISTINCT so2.id) = 1
               THEN MIN(so2.internal_so_no) END AS so_internal_no
        FROM public.purchase_order_lines pol
        JOIN public.sales_order_lines sol2
          ON sol2.id = pol.source_so_line_id AND sol2.deleted_at IS NULL
        JOIN public.sales_orders so2
          ON so2.id = sol2.sales_order_id AND so2.deleted_at IS NULL
        WHERE pol.purchase_order_id = dc.purchase_order_id
          AND pol.deleted_at IS NULL
      ) po_so ON TRUE
      LEFT JOIN public.sales_orders so_ref
        ON so_ref.company_id = dc.company_id AND so_ref.code = dc.so_ref_text
       AND so_ref.deleted_at IS NULL
      WHERE dc.id = ${id}::uuid
        AND dc.company_id = ${companyId}::uuid
        AND dc.deleted_at IS NULL
      LIMIT 1
    `);
  const headerRow = (headerRows as unknown as Array<Record<string, unknown>>)[0];
  if (!headerRow) throw new NotFoundError('DC not found. Refresh the page.');

  const lineRows = await tx
    .select({
      line: deliveryChallanLines,
      // Live items-master snapshot for each line's item_id (ADR-012 #10):
      // the DC stores itemCodeText/itemNameText at issue time, but the detail
      // page should show the current master code/name when the FK is set.
      itemCode: items.code,
      itemName: items.name,
      // The customer's drawing revision — see the joins below for why it is
      // null on most challan lines. SO line first; for an OSP PO raised off a
      // JWSO-sourced job card there is no SO line, so the job-work line the
      // card came from is the fallback (ADR-177 — a card has one source, never
      // both). ::text because the contract types it as a string and the column
      // is only text on a database that has had migration 0119; on one that
      // has not it is still the old integer. Never items.revision, which is a
      // different column, about the item master.
      itemRevision: sql<
        string | null
      >`COALESCE(${salesOrderLines.revision}::text, ${jobWorkOrderLines.revision}::text)`,
      // The customer's own PO line number, off the SAME SO line join as the
      // revision above, and only that side: a job-work line belongs to a
      // job-work order, not to a customer PO, so it has no client PO line
      // number to offer and the field stays null there.
      clientPoLineNo: salesOrderLines.clientPoLineNo,
    })
    .from(deliveryChallanLines)
    .leftJoin(items, and(eq(items.id, deliveryChallanLines.itemId), isNull(items.deletedAt)))
    // A challan line is a copy of a purchase-order line, and the PO line is the
    // only thing that knows which SO line the work belongs to.
    .leftJoin(
      purchaseOrderLines,
      and(
        eq(purchaseOrderLines.id, deliveryChallanLines.purchaseOrderLineId),
        isNull(purchaseOrderLines.deletedAt),
      ),
    )
    // ...and this join deliberately does NOT stop at "the PO line came from an
    // SO line". It also insists the SO line is for the SAME ITEM as the challan
    // line. A job-work PO raised off a job card carries the job card's item, so
    // the piece going to the vendor genuinely IS the customer's part and its
    // drawing revision is a true statement about it. A buying PO line is a bar
    // of raw material, and a bought-in line is hardware; on those the item ids
    // differ, the join finds nothing, and the code prints bare — which is the
    // point. `=` is already false when either item id is null, so an unlinked
    // line needs no extra guard. Every join here is LEFT: a line with no PO, no
    // SO or no matching item still comes back, with a null revision.
    .leftJoin(
      salesOrderLines,
      and(
        eq(salesOrderLines.id, purchaseOrderLines.sourceSoLineId),
        isNull(salesOrderLines.deletedAt),
        eq(salesOrderLines.itemId, deliveryChallanLines.itemId),
      ),
    )
    // JWSO fallback: PO line -> the JC op the OSP PO was raised for -> its job
    // card -> the job-work line the card was sourced from. Each hop is a
    // single-row FK, so nothing here can multiply the challan lines, and the
    // last join carries the same same-item guard as the SO-line join above.
    .leftJoin(jcOps, and(eq(jcOps.id, purchaseOrderLines.sourceJcOpId), isNull(jcOps.deletedAt)))
    .leftJoin(jobCards, and(eq(jobCards.id, jcOps.jobCardId), isNull(jobCards.deletedAt)))
    .leftJoin(
      jobWorkOrderLines,
      and(
        eq(jobWorkOrderLines.id, jobCards.sourceJwLineId),
        isNull(jobWorkOrderLines.deletedAt),
        eq(jobWorkOrderLines.itemId, deliveryChallanLines.itemId),
      ),
    )
    .where(
      and(
        eq(deliveryChallanLines.deliveryChallanId, id),
        eq(deliveryChallanLines.companyId, companyId),
        isNull(deliveryChallanLines.deletedAt),
      ),
    )
    .orderBy(deliveryChallanLines.lineNo);

  // T-059b — load receipts + their lines bundled with the DC detail.
  const receiptHeaders = await tx
    .select()
    .from(deliveryChallanReceipts)
    .where(
      and(
        eq(deliveryChallanReceipts.deliveryChallanId, id),
        eq(deliveryChallanReceipts.companyId, companyId),
        isNull(deliveryChallanReceipts.deletedAt),
      ),
    )
    .orderBy(asc(deliveryChallanReceipts.receiptDate), asc(deliveryChallanReceipts.receiptCode));

  const receipts: DeliveryChallanReceipt[] = [];
  if (receiptHeaders.length > 0) {
    const receiptIds = receiptHeaders.map((h) => h.id);
    const recLineRows = await tx
      .select()
      .from(deliveryChallanReceiptLines)
      .where(
        and(
          inArray(deliveryChallanReceiptLines.receiptId, receiptIds),
          eq(deliveryChallanReceiptLines.companyId, companyId),
          isNull(deliveryChallanReceiptLines.deletedAt),
        ),
      );
    const linesByReceipt = new Map<string, typeof recLineRows>();
    for (const rl of recLineRows) {
      const arr = linesByReceipt.get(rl.receiptId) ?? [];
      arr.push(rl);
      linesByReceipt.set(rl.receiptId, arr);
    }
    for (const h of receiptHeaders) {
      receipts.push({
        id: h.id,
        companyId: h.companyId,
        deliveryChallanId: h.deliveryChallanId,
        receiptCode: h.receiptCode,
        receiptDate: dateLike(h.receiptDate),
        vendorInvoiceText: h.vendorInvoiceText,
        remarks: h.remarks,
        createdAt: tsLike(h.createdAt),
        createdBy: h.createdBy,
        updatedAt: tsLike(h.updatedAt),
        updatedBy: h.updatedBy,
        deletedAt: maybeTsLike(h.deletedAt),
        lines: (linesByReceipt.get(h.id) ?? []).map((rl) => ({
          id: rl.id,
          companyId: rl.companyId,
          receiptId: rl.receiptId,
          deliveryChallanLineId: rl.deliveryChallanLineId,
          receivedQty: rl.receivedQty,
          rejectedQty: rl.rejectedQty,
          rejectReason: rl.rejectReason,
          remarks: rl.remarks,
          createdAt: tsLike(rl.createdAt),
          createdBy: rl.createdBy,
          updatedAt: tsLike(rl.updatedAt),
          updatedBy: rl.updatedBy,
          deletedAt: maybeTsLike(rl.deletedAt),
        })),
      });
    }
  }

  return {
    id: headerRow['id'] as string,
    companyId: headerRow['companyId'] as string,
    code: headerRow['code'] as string,
    dcDate: dateLike(headerRow['dcDate']),
    purchaseOrderId: (headerRow['purchaseOrderId'] as string | null) ?? null,
    poCodeText: headerRow['poCodeText'] as string,
    vendorId: headerRow['vendorId'] as string,
    vendorCodeText: headerRow['vendorCodeText'] as string,
    salesOrderLineId: (headerRow['salesOrderLineId'] as string | null) ?? null,
    soRefText: (headerRow['soRefText'] as string | null) ?? null,
    transport: (headerRow['transport'] as string | null) ?? null,
    vehicleNo: (headerRow['vehicleNo'] as string | null) ?? null,
    ncId: (headerRow['ncId'] as string | null) ?? null,
    ncCode: (headerRow['ncCode'] as string | null) ?? null,
    jobCardId: (headerRow['jobCardId'] as string | null) ?? null,
    jobCardCode: (headerRow['jobCardCode'] as string | null) ?? null,
    reason: (headerRow['reason'] as string | null) ?? null,
    status: headerRow['status'] as DeliveryChallanWithLines['status'],
    createdAt: tsLike(headerRow['createdAt']),
    createdBy: headerRow['createdBy'] as string,
    updatedAt: tsLike(headerRow['updatedAt']),
    updatedBy: headerRow['updatedBy'] as string,
    deletedAt: maybeTsLike(headerRow['deletedAt']),
    vendorName: (headerRow['vendorName'] as string | null) ?? null,
    poCode: (headerRow['poCode'] as string | null) ?? null,
    soCode: (headerRow['soCode'] as string | null) ?? null,
    soInternalNo: (headerRow['soInternalNo'] as string | null) ?? null,
    soLineRevision: (headerRow['soLineRevision'] as string | null) ?? null,
    lines: lineRows.map(({ line: l, itemCode, itemName, itemRevision, clientPoLineNo }) => ({
      id: l.id,
      companyId: l.companyId,
      deliveryChallanId: l.deliveryChallanId,
      lineNo: l.lineNo,
      itemId: l.itemId,
      itemCode: itemCode ?? null,
      itemRevision: itemRevision ?? null,
      clientPoLineNo: clientPoLineNo ?? null,
      itemName: itemName ?? null,
      itemCodeText: l.itemCodeText,
      itemNameText: l.itemNameText,
      qty: l.qty,
      uom: l.uom,
      materialText: l.materialText,
      dcRemarks: l.dcRemarks,
      purchaseOrderLineId: l.purchaseOrderLineId,
      createdAt: tsLike(l.createdAt),
      createdBy: l.createdBy,
      updatedAt: tsLike(l.updatedAt),
      updatedBy: l.updatedBy,
      deletedAt: maybeTsLike(l.deletedAt),
    })),
    receipts,
  };
}

export async function getDeliveryChallan(
  id: string,
  user: AuthContext,
): Promise<DeliveryChallanWithLines> {
  const companyId = requireCompany(user);
  return withUserContext(user, async (tx) => loadDeliveryChallanWithLines(tx, id, companyId));
}

// ─── How many pieces may go out now (read-only preview) ────────────────────
//
// The DC form asks this the moment it opens, so the Send Now box can say what
// it will accept BEFORE anything is typed. Every number comes from
// loadOutwardSendable — the same helper the save-time guard uses — so the form
// and the challan can never disagree.

/** "1 pc" / "2 pcs" — a message that says "1 pcs" reads as a bug in the app
 *  and costs the sentence its authority. */
function pcs(n: number): string {
  return n === 1 ? '1 pc' : `${n} pcs`;
}

export async function getSendableForPo(
  purchaseOrderId: string,
  user: AuthContext,
): Promise<DcSendablePreview> {
  // A read, so `view` is enough: raising the challan is separately gated on
  // `entry` in createDeliveryChallan and on the form itself.
  await requireFormAccess(user, 'ospdc_create', 'view');
  const companyId = requireCompany(user);

  return withUserContext(user, async (tx) => {
    const poLines = await tx
      .select({ id: purchaseOrderLines.id, qty: purchaseOrderLines.qty })
      .from(purchaseOrderLines)
      .where(
        and(
          eq(purchaseOrderLines.purchaseOrderId, purchaseOrderId),
          eq(purchaseOrderLines.companyId, companyId),
          isNull(purchaseOrderLines.deletedAt),
        ),
      )
      .orderBy(asc(purchaseOrderLines.lineNo));

    const alreadyOnDcs = await sumSentQtyByPoLine(
      tx,
      poLines.map((l) => l.id),
      companyId,
    );

    const lines: DcSendableLine[] = [];
    for (const l of poLines) {
      const poQty = Number(l.qty ?? 0);
      const sentOnDcs = alreadyOnDcs.get(l.id) ?? 0;
      // roundQty: a KGS / MTR line keeps 3 decimals without 0.1 + 0.2 drift.
      const poBalance = Math.max(0, roundQty(poQty - sentOnDcs));
      const s = await loadOutwardSendable(tx, companyId, l.id);

      // A job-work line with no operation behind it can never be checked, so
      // nothing may go out on it. Say so here rather than at Save.
      if (s.kind === 'job_work_unlinked') {
        lines.push({
          purchaseOrderLineId: l.id,
          maxSendNow: 0,
          limitKind: 'not_linked',
          limitReason: jobWorkUnlinkedRefusal(s.poCode),
          jobCardCode: null,
          opSeq: null,
        });
        continue;
      }

      // Said the same way whether or not an operation stands behind the line:
      // when the purchase order line is exhausted, that IS the answer, and no
      // amount of shop-floor detail changes it.
      const fullySent = poQty > 0 && poBalance === 0;
      const fullySentReason =
        `All ${pcs(poQty)} on this PO line have already gone out on ` +
        `earlier challans. Nothing is Pending to send on it.`;

      // A buying PO: the PO line is the whole story.
      if (s.kind === 'unlinked') {
        lines.push({
          purchaseOrderLineId: l.id,
          maxSendNow: poBalance,
          limitKind: fullySent ? 'fully_sent' : sentOnDcs > 0 ? 'po_balance' : 'po_qty',
          limitReason: fullySent
            ? fullySentReason
            : sentOnDcs > 0
              ? `Earlier challans have already sent ${sentOnDcs} of the ${pcs(poQty)} on this PO line, so ${poBalance} are Pending.`
              : null,
          jobCardCode: null,
          opSeq: null,
        });
        continue;
      }

      const opAllowed = Math.max(0, s.effectiveSendable);
      const maxSendNow = Math.min(poBalance, opAllowed);
      // display rule — see opSrNo in @innovic/shared
      const where = `JC ${s.jcCode} Op ${opSrNo(s.op.opSeq)}`;
      // The same phrase for mid-sentence use. Written out rather than
      // where.toLowerCase() — that lowercased the job card CODE too, turning
      // IN-JC-26-00010 into "in-jc-26-00010", which is not its name and is not
      // what anyone would search for.
      const whereMid = `JC ${s.jcCode} Op ${opSrNo(s.op.opSeq)}`;

      // Which limit is actually doing the stopping decides what the user is
      // told, because each one has a different way out — finish the operation
      // before this one, issue the client's material, raise another PO, or
      // nothing at all because the line is already complete. One generic
      // "not available" sentence for all of them would be true and useless.
      let limitKind: DcSendableLine['limitKind'] = 'po_qty';
      let limitReason: string | null = null;

      const materialBinding = Boolean(s.cap) && s.effectiveSendable < s.sendable;
      const opBinding = opAllowed <= poBalance;

      if (fullySent) {
        limitKind = 'fully_sent';
        limitReason = fullySentReason;
      } else if (opBinding && materialBinding && s.cap) {
        limitKind = 'material';
        limitReason =
          `${where} is waiting on the customer's material — ` +
          `${maxSendNow === 0 ? 'nothing can go out yet' : `only ${pcs(maxSendNow)} can go out`}. ` +
          `JWSO ${s.cap.jwCode}: ${s.cap.received} of ${s.cap.orderQty} ` +
          `${s.cap.issuedBased ? 'issued to this job card' : 'received for this part'}.`;
      } else if (opBinding && maxSendNow === 0 && s.inputAvail === 0) {
        // Nothing has reached the operation at all. Naming the previous
        // operation as the thing to chase is the only useful instruction here.
        limitKind = 'not_started';
        limitReason =
          `${where} has not received any pieces yet — the operation before it has not ` +
          `cleared any. Nothing can go out until it does.`;
      } else if (opBinding && maxSendNow === 0 && s.inHouseCompleted > 0) {
        // ADR-081 dual lane: the balance went down the in-house lane instead.
        limitKind = 'done_in_house';
        limitReason =
          `Of the ${pcs(s.inputAvail)} ${whereMid} has received, ` +
          `${s.inHouseCompleted} finished in-house and ${s.alreadySent} already went to the ` +
          `vendor — nothing is Pending to send out.`;
      } else if (opBinding && maxSendNow === 0 && s.alreadySent > 0) {
        limitKind = 'at_vendor';
        limitReason =
          `All ${pcs(s.alreadySent)} that ${whereMid} has received are already ` +
          `with the vendor. More can go out only as the operation before it clears more.`;
      } else if (opBinding) {
        limitKind = 'operation';
        limitReason =
          `${where} has only ${pcs(maxSendNow)} ready to send — the operation before it has ` +
          `cleared ${s.inputAvail}, ${s.inHouseCompleted} finished in-house here, and ` +
          `${s.alreadySent} already went to the vendor.`;
      } else if (sentOnDcs > 0) {
        limitKind = 'po_balance';
        limitReason = `Earlier challans have already sent ${sentOnDcs} of the ${pcs(poQty)} on this PO line, so ${poBalance} are Pending.`;
      }

      lines.push({
        purchaseOrderLineId: l.id,
        maxSendNow,
        limitKind,
        limitReason,
        jobCardCode: s.jcCode || null,
        opSeq: s.op.opSeq,
      });
    }

    return { purchaseOrderId, lines };
  });
}

// ─── Writes (T-059a outward) ───────────────────────────────────────────────

function dcDetail(code: string, vendorCodeText: string | null | undefined): string {
  return vendorCodeText ? `${code} — ${vendorCodeText}` : code;
}

/** Vendor exists, is in this company and is ACTIVE (A10 — a new challan is a
 *  new link). Returns the vendor's code for the challan's vendor-code column. */
async function assertVendorExists(
  tx: DbTransaction,
  vendorId: string,
  companyId: string,
): Promise<string> {
  return (await assertActiveParty(tx, 'vendor', vendorId, companyId)).code;
}

async function assertPurchaseOrderExists(
  tx: DbTransaction,
  purchaseOrderId: string,
  companyId: string,
): Promise<void> {
  const rows = await tx
    .select({ id: purchaseOrders.id, code: purchaseOrders.code, status: purchaseOrders.status })
    .from(purchaseOrders)
    .where(
      and(
        eq(purchaseOrders.id, purchaseOrderId),
        eq(purchaseOrders.companyId, companyId),
        isNull(purchaseOrders.deletedAt),
      ),
    )
    .limit(1);
  const po = rows[0];
  if (!po) {
    throw new ValidationError('Selected PO was not found. Please select the PO again.');
  }
  // ADR-189 — material goes out only against an approved, live PO (the GRN
  // side already refuses a draft PO; a DC is the same commitment to a vendor).
  if (po.status === 'draft') {
    throw new ConflictError(`Cannot send material against PO ${po.code}: it is not approved yet.`);
  }
  if (po.status === 'cancelled' || po.status === 'closed') {
    throw new ConflictError(
      `PO ${po.code} is ${po.status === 'closed' ? 'Closed' : 'Cancelled'}. Nothing more can be sent against it.`,
    );
  }
}

async function assertSalesOrderLineExists(
  tx: DbTransaction,
  salesOrderLineId: string,
  companyId: string,
): Promise<void> {
  const rows = await tx
    .select({ id: salesOrderLines.id })
    .from(salesOrderLines)
    .where(
      and(
        eq(salesOrderLines.id, salesOrderLineId),
        eq(salesOrderLines.companyId, companyId),
        isNull(salesOrderLines.deletedAt),
      ),
    )
    .limit(1);
  if (rows.length === 0) {
    throw new ValidationError('Selected SO line was not found. Please select it again.');
  }
}

/** Checks every item exists and returns each one's unit (items.uom), so a
 *  challan line carries the item's real unit — KGS / MTR, not a blanket NOS. */
async function assertItemIdsExist(
  tx: DbTransaction,
  itemIds: string[],
  companyId: string,
): Promise<Map<string, (typeof items.$inferSelect)['uom']>> {
  const out = new Map<string, (typeof items.$inferSelect)['uom']>();
  const unique = Array.from(new Set(itemIds));
  if (unique.length === 0) return out;
  const rows = await tx
    .select({ id: items.id, uom: items.uom })
    .from(items)
    .where(and(eq(items.companyId, companyId), inArray(items.id, unique), isNull(items.deletedAt)));
  if (rows.length !== unique.length) {
    throw new ValidationError('Item not found. Please select the Item Code again.');
  }
  for (const r of rows) out.set(r.id, r.uom);
  return out;
}

interface PoLineRef {
  id: string;
  purchaseOrderId: string;
  itemId: string | null;
  qty: number;
  /** Carried so a refusal can name the line the way the user sees it on screen.
   *  The over-ship error used to quote the row's uuid, which tells the person
   *  holding the challan nothing about which item to fix. */
  lineNo: number;
  itemCodeText: string | null;
}

async function loadPoLineMap(
  tx: DbTransaction,
  poLineIds: string[],
  companyId: string,
): Promise<Map<string, PoLineRef>> {
  const out = new Map<string, PoLineRef>();
  const unique = Array.from(new Set(poLineIds));
  if (unique.length === 0) return out;
  const rows = await tx
    .select({
      id: purchaseOrderLines.id,
      purchaseOrderId: purchaseOrderLines.purchaseOrderId,
      itemId: purchaseOrderLines.itemId,
      qty: purchaseOrderLines.qty,
      lineNo: purchaseOrderLines.lineNo,
      itemCodeText: purchaseOrderLines.itemCodeText,
    })
    .from(purchaseOrderLines)
    .where(
      and(
        eq(purchaseOrderLines.companyId, companyId),
        inArray(purchaseOrderLines.id, unique),
        isNull(purchaseOrderLines.deletedAt),
      ),
    );
  for (const r of rows) {
    out.set(r.id, {
      id: r.id,
      purchaseOrderId: r.purchaseOrderId,
      itemId: r.itemId,
      qty: Number(r.qty ?? 0),
      lineNo: r.lineNo,
      itemCodeText: r.itemCodeText,
    });
  }
  if (out.size !== unique.length) {
    throw new ValidationError('This PO line no longer exists. Please reload the PO.');
  }
  return out;
}

/**
 * Qty already sent out against each PO line on ORDINARY outward challans
 * (OSP DCs) plus JW DC Outwards.
 *
 * Return-to-vendor challans (no PO, `nc_id` set) are excluded (OSP chain gap
 * G6, 2026-09-16): their line carries the op's PO line so the challan print
 * names the order, but the pieces on it were already counted when they first
 * went out, so they must not eat the PO line's balance a second time.
 * Example: PO 10, ordinary DC 6, RTV 2 → was sentOnDcs 8 / balance 2; now
 * 6 / 4 — which matches the op-level sendable (cascades.ts), built on
 * outsource_sent_qty, which never counted return challans.
 */
async function sumSentQtyByPoLine(
  tx: DbTransaction,
  poLineIds: string[],
  companyId: string,
): Promise<Map<string, number>> {
  // ONE sent figure per PO line: OSP DCs AND JW DC Outwards together, so a
  // line cannot go out in full on each screen (lib/po-line-sent.ts).
  return sumSentOnPoLines(tx, poLineIds, companyId);
}

function assignLineNos(
  lines: ReadonlyArray<{ readonly lineNo?: number | undefined }>,
  startFrom: number,
): number[] {
  const provided = lines.filter((l) => l.lineNo !== undefined);
  if (provided.length > 0 && provided.length !== lines.length) {
    throw new ValidationError('Ln is required on every row, or leave all blank.');
  }
  if (provided.length === 0) return lines.map((_, i) => startFrom + i);
  const seen = new Set<number>();
  const out: number[] = [];
  for (const l of lines) {
    const n = l.lineNo!;
    if (seen.has(n)) throw new ValidationError(`Ln ${n} is used twice. Each row needs its own Ln.`);
    seen.add(n);
    out.push(n);
  }
  return out;
}

/** Next IN-DC-NNNNN for the company (highest numeric suffix + 1, 5-digit),
 *  mirroring nextPoCode. Used when the create form leaves the code blank.
 *
 *  The challan number carries a revision like the PO number does, so the scan
 *  tolerates a `/R<n>` tail and then ignores it: the running number is the part
 *  in FRONT of it, and IN-DC-00005/R2 is still challan 5. Without that, a
 *  revised challan would drop out of the count and its number be re-issued.
 *
 *  A new challan is born at revision 1 — IN-DC-00006/R1. */
async function nextDcCode(tx: DbTransaction, companyId: string): Promise<string> {
  // S2: queue behind any other save numbering a challan — OSP and NC return
  // challans share this series and this lock (lib/doc-series-lock).
  await lockDocSeries(tx, companyId, 'delivery_challans');
  const prefix = 'IN-DC-';
  const rows = await tx
    .select({ code: deliveryChallans.code })
    .from(deliveryChallans)
    .where(
      and(
        eq(deliveryChallans.companyId, companyId),
        isNull(deliveryChallans.deletedAt),
        like(deliveryChallans.code, `${prefix}%`),
      ),
    );
  let max = 0;
  for (const r of rows) {
    const m = r.code
      .trim()
      .slice(prefix.length)
      .match(/^(\d+)(?:\/R\d+)?$/i);
    if (m) max = Math.max(max, parseInt(m[1]!, 10));
  }
  return withDocRevision(`${prefix}${String(max + 1).padStart(5, '0')}`, 1);
}

export async function createDeliveryChallan(
  input: CreateDeliveryChallanInput,
  user: AuthContext,
): Promise<DeliveryChallanWithLines> {
  // Tier gate (was requireWriteRole, which only knew admin/manager). L2 Data
  // Entry can raise an outward DC; L1 Viewer and L4 Approver cannot.
  await requireFormAccess(user, 'ospdc_create', 'entry');
  const companyId = requireCompany(user);

  return withUserContext(user, async (tx) => {
    // Blank code ⇒ auto-generate the next IN-DC-#####/R1 (canonical, like the
    // PO). A code typed by hand is kept as typed, with /R1 stamped on it when it
    // arrives without a revision — otherwise a hand-numbered challan would be
    // the only one in the system without one.
    //
    // WHERE THE BUMP WOULD GO: there is no edit/PATCH route for a delivery
    // challan — create, cancel and receive are the only writes — so a challan's
    // revision is stamped here at create and nothing moves it afterwards. If an
    // edit path is ever added, it must bump the code the way updatePurchaseOrder
    // does: bumpDocRevision, and rewrite every stored text copy of the old
    // number in the same transaction.
    await lockDocSeries(tx, companyId, 'delivery_challans');
    const supplied = input.header.code?.trim();
    const suppliedRev = supplied ? parseDocRevision(supplied) : null;
    const code = suppliedRev
      ? withDocRevision(suppliedRev.base, suppliedRev.revision)
      : await nextDcCode(tx, companyId);
    const dup = await tx
      .select({ id: deliveryChallans.id })
      .from(deliveryChallans)
      .where(
        and(
          eq(deliveryChallans.companyId, companyId),
          eq(deliveryChallans.code, code),
          isNull(deliveryChallans.deletedAt),
        ),
      )
      .limit(1);
    if (dup.length > 0) {
      throw new ConflictError(`DC No. "${code}" already exists.`);
    }

    // Vendor/item may be an FK OR free text (ADR-015 / ADR-012 #10), mirroring
    // the Job-Work PO this DC is generated from. Only validate the FK when set;
    // vendor_code_text / item_code_text always carry the human identifier.
    // The vendor-code column holds the VENDOR's code (A32) — the master's code
    // when the vendor is linked, never the PO number the screen used to send.
    let vendorCodeText = input.header.vendorCodeText?.trim() || null;
    if (input.header.vendorId) {
      vendorCodeText = await assertVendorExists(tx, input.header.vendorId, companyId);
    }
    if (!vendorCodeText) {
      throw new ValidationError('Vendor is required. Please select the Vendor.');
    }
    if (input.header.purchaseOrderId) {
      await assertPurchaseOrderExists(tx, input.header.purchaseOrderId, companyId);
    }
    if (input.header.salesOrderLineId) {
      await assertSalesOrderLineExists(tx, input.header.salesOrderLineId, companyId);
    }

    const itemIds = input.lines.map((l) => l.itemId).filter((id): id is string => Boolean(id));
    const itemUoms = await assertItemIdsExist(tx, itemIds, companyId);

    const poLineIds = input.lines
      .map((l) => l.purchaseOrderLineId)
      .filter((id): id is string => Boolean(id));
    // ADR-182 — an outward challan may not be raised for an outsource op whose
    // Production Order has been short closed. Checked before any write; a
    // challan line that is not for a JC op resolves to nothing and is allowed.
    for (const poLineId of poLineIds) {
      await assertProductionOrderNotShortClosedForPoLine(tx, poLineId);
    }
    const poLines = await loadPoLineMap(tx, poLineIds, companyId);
    // Lock the PO lines first, so a concurrent OSP DC / JW DC Outward on the
    // same line waits here and then reads this challan's qty (no over-send).
    await lockPoLinesForSend(tx, poLineIds, companyId);
    const alreadySent = await sumSentQtyByPoLine(tx, poLineIds, companyId);

    // Pre-write validation: each PO line's cumulative-sent + this DC's qty
    // must not exceed the PO line qty.
    const incomingByPoLine = new Map<string, number>();
    for (const l of input.lines) {
      if (!l.purchaseOrderLineId) continue;
      const pol = poLines.get(l.purchaseOrderLineId)!;
      if (input.header.purchaseOrderId && pol.purchaseOrderId !== input.header.purchaseOrderId) {
        throw new ValidationError(
          `Ln ${pol.lineNo}: this line is not on the selected PO. Please pick it again.`,
        );
      }
      const prev = incomingByPoLine.get(l.purchaseOrderLineId) ?? 0;
      incomingByPoLine.set(l.purchaseOrderLineId, roundQty(prev + l.qty));
    }
    for (const [poLineId, inc] of incomingByPoLine) {
      const pol = poLines.get(poLineId)!;
      const already = alreadySent.get(poLineId) ?? 0;
      const remaining = roundQty(pol.qty - already);
      if (inc > remaining) {
        throw new ConflictError(
          `Ln ${pol.lineNo}${pol.itemCodeText ? ` (${pol.itemCodeText})` : ''}: ` +
            `Qty (${inc}) cannot be more than Pending (${remaining}) — PO Qty ${pol.qty}.`,
        );
      }
    }

    const lineNos = assignLineNos(input.lines, 1);

    // The item master's unit wins over whatever the form sent: the line is
    // what the print and the vendor go by (dc-create-po#1). Decimals follow
    // that unit (S9): KGS / MTR take up to 3, NOS / SET must be whole. The form
    // checked its own unit already; this checks the one that is stored.
    const lineUoms = input.lines.map(
      (l) => (l.itemId ? itemUoms.get(l.itemId) : undefined) ?? l.uom,
    );
    input.lines.forEach((l, i) => {
      const problem = qtyUomProblem(l.qty, lineUoms[i], 'Qty');
      if (problem) {
        throw new ValidationError(
          `Ln ${lineNos[i]}${l.itemCodeText ? ` (${l.itemCodeText})` : ''}: ${problem}`,
        );
      }
    });

    const inserted = await tx
      .insert(deliveryChallans)
      .values({
        companyId,
        code,
        dcDate: input.header.dcDate,
        purchaseOrderId: input.header.purchaseOrderId ?? null,
        poCodeText: input.header.poCodeText,
        vendorId: input.header.vendorId ?? null,
        vendorCodeText,
        salesOrderLineId: input.header.salesOrderLineId ?? null,
        soRefText: input.header.soRefText ?? null,
        transport: input.header.transport ?? null,
        vehicleNo: input.header.vehicleNo ?? null,
        status: 'issued',
        // ADR-197: who issued the challan (it is issued the moment it is saved).
        issuedBy: user.id,
        issuedAt: new Date(),
        createdBy: user.id,
        updatedBy: user.id,
      })
      .returning();
    const header = inserted[0]!;

    const lineValues = input.lines.map((l, i) => ({
      companyId,
      deliveryChallanId: header.id,
      lineNo: lineNos[i]!,
      itemId: l.itemId ?? null,
      itemCodeText: l.itemCodeText,
      itemNameText: l.itemNameText ?? null,
      qty: roundQty(l.qty).toFixed(3),
      uom: lineUoms[i]!,
      materialText: l.materialText ?? null,
      dcRemarks: l.dcRemarks ?? null,
      purchaseOrderLineId: l.purchaseOrderLineId ?? null,
      createdBy: user.id,
      updatedBy: user.id,
    }));
    const insertedLines = await tx.insert(deliveryChallanLines).values(lineValues).returning();

    // Cascades: stock OUT ledger + jc_op flip per line.
    const opCascades: Array<{ jcCode: string; jobCardId: string; opSeq: number; qty: number }> = [];
    for (const dl of insertedLines) {
      // Kept to 3 decimals: a buying PO line in KGS / MTR goes out as 12.5. A
      // line tied to a JC operation is whole pieces — applyOutwardToJcOp
      // refuses a fraction there rather than truncating it.
      const lineQty = roundQty(Number(dl.qty));
      // Option A (ADR-067): OSP send is stock-neutral — issuing an outward JW
      // DC no longer debits finished stock. Material out for processing is
      // tracked as "at vendor" via v_osp_wip (jc_op counters); production is
      // credited only on QC-accept of the return. This removes the
      // send(−jw_out)/receive(+grn_qc) pair that netted to zero and let a
      // later dispatch drive on-hand negative (SO-517 / CONNECTING ROD trace).
      if (dl.purchaseOrderLineId) {
        const result = await applyOutwardToJcOp({
          tx,
          companyId,
          adminUserId: user.id,
          dcCode: header.code,
          dcDate: header.dcDate,
          purchaseOrderLineId: dl.purchaseOrderLineId,
          qty: lineQty,
        });
        if (result.fired && result.jcCode && result.jobCardId && result.opSeq) {
          opCascades.push({
            jcCode: result.jcCode,
            jobCardId: result.jobCardId,
            opSeq: result.opSeq,
            qty: lineQty,
          });
        }
      }
    }

    // Audit emissions in the same tx (ADR-197): one SEND on the challan (qty =
    // everything that left on it), one SEND per Job Card op it moved.
    const sentTotal = roundQty(insertedLines.reduce((sum, dl) => sum + Number(dl.qty), 0));
    await emitActivityLog(
      tx,
      {
        action: ActivityAction.Send,
        entity: 'DeliveryChallan',
        entityId: header.id,
        refId: header.code,
        qty: sentTotal,
        detail: `${dcDetail(header.code, header.vendorCodeText)} — issued, ${sentTotal} sent`,
      },
      companyId,
      user,
    );
    for (const op of opCascades) {
      await emitActivityLog(
        tx,
        {
          action: ActivityAction.Send,
          entity: 'JobCard',
          entityId: op.jobCardId,
          refId: op.jcCode,
          opRef: `Op ${opSrNo(op.opSeq)}`,
          qty: op.qty,
          detail: `${op.jcCode} Op ${opSrNo(op.opSeq)} — sent ${op.qty} pcs via ${header.code}${header.vendorCodeText ? ` to ${header.vendorCodeText}` : ''}`,
        },
        companyId,
        user,
      );
    }

    return loadDeliveryChallanWithLines(tx, header.id, companyId);
  });
}

export async function cancelDeliveryChallan(
  id: string,
  user: AuthContext,
  /** Why (ADR-197) — required at the route (`cancelDeliveryChallanInputSchema`). */
  reason?: string,
): Promise<DeliveryChallanWithLines> {
  // Destructive: reverses jc_op state + writes compensating stock ledger rows.
  // Cancel is not one of the four tier actions, so it is expressed as the pair
  // that only L5 Department Admin and above hold: edit AND approve. L3 Editor
  // has edit but not approve; L4 Approver has approve but not edit. Previously
  // this was admin-only, which locked out the very tier meant to run the dept.
  await requireFormAccess(user, 'ospdc_create', 'edit');
  await requireFormAccess(user, 'ospdc_create', 'approve');
  const companyId = requireCompany(user);

  return withUserContext(user, async (tx) => {
    // S6 — lock the challan first. A cancel racing a receive (or a second
    // cancel) waits here, then re-reads the committed status / receipts and is
    // refused by the checks below, so the op's sent qty is reversed only once.
    const headerRows = await tx
      .select()
      .from(deliveryChallans)
      .where(
        and(
          eq(deliveryChallans.id, id),
          eq(deliveryChallans.companyId, companyId),
          isNull(deliveryChallans.deletedAt),
        ),
      )
      .limit(1)
      .for('update');
    const header = headerRows[0];
    if (!header) throw new NotFoundError('DC not found. Refresh the page.');
    if (header.status === 'cancelled') {
      throw new ConflictError(
        `DC ${header.code} is already Cancelled — someone else may have cancelled it just now. Reload the page.`,
      );
    }
    if (header.status === 'received') {
      throw new ConflictError(`Cannot cancel DC ${header.code}: it is Received.`);
    }
    // T-059b — block cancel once receipts exist. Reversing receipts cleanly
    // (reverse the stock IN, unwind any auto-NC, restore JC status) is out
    // of scope for this slice. Admin must void the receipts first if that
    // flow is ever needed (no UI today).
    if (await dcHasActiveReceipts(tx, id)) {
      throw new ConflictError(
        `Cannot cancel DC ${header.code}: receipts are recorded. Cancel those receipts first.`,
      );
    }

    const lineRows = await tx
      .select()
      .from(deliveryChallanLines)
      .where(
        and(eq(deliveryChallanLines.deliveryChallanId, id), isNull(deliveryChallanLines.deletedAt)),
      )
      .orderBy(asc(deliveryChallanLines.id))
      .for('update');

    const opCascades: Array<{ jcCode: string; jobCardId: string; opSeq: number; qty: number }> = [];
    if (header.ncId) {
      // Return-to-vendor challan (createNcDc, ADR-166). Its one line carries
      // the origin op's PO line for the print, but createNcDc never added its
      // qty to jc_ops.outsource_sent_qty (that column counts ordinary sends
      // only), so reverseOutwardFromJcOp must NOT run here — it would subtract
      // pieces that were never added. What has to be unwound instead is the
      // NC's rtv ledger, the op status createNcDc demoted, and the PO line
      // received_qty the ADR-165 formula lowered when the challan went out.
      // Receipts are already ruled out above (dcHasActiveReceipts).
      await onNcChallanCancelled(
        tx,
        { ncId: header.ncId, deliveryChallanId: id, reason },
        companyId,
        user,
      );
    }
    for (const dl of lineRows) {
      // reverseOutwardFromJcOp takes back whole pieces from the op (its sent
      // counter is a piece count); a buying line's decimals never reach it.
      const lineQty = roundQty(Number(dl.qty));
      // Option A (ADR-067): OSP send no longer touches stock, so cancel has no
      // ledger movement to reverse — only the jc_op sent-qty is unwound below.
      if (dl.purchaseOrderLineId && !header.ncId) {
        const result = await reverseOutwardFromJcOp({
          tx,
          companyId,
          adminUserId: user.id,
          dcCode: header.code,
          dcDate: header.dcDate,
          purchaseOrderLineId: dl.purchaseOrderLineId,
          qty: lineQty,
        });
        if (result.fired && result.jcCode && result.jobCardId && result.opSeq) {
          opCascades.push({
            jcCode: result.jcCode,
            jobCardId: result.jobCardId,
            opSeq: result.opSeq,
            qty: Math.round(lineQty),
          });
        }
      }
    }

    const cancelledAt = new Date();
    const cancelledRows = await tx
      .update(deliveryChallans)
      .set({
        status: 'cancelled',
        // ADR-197: who cancelled, and when (the reason is on the CANCEL log row).
        cancelledBy: user.id,
        cancelledAt,
        updatedBy: user.id,
        updatedAt: cancelledAt,
      })
      // Cancel once: only from the status read under the lock above.
      .where(and(eq(deliveryChallans.id, id), eq(deliveryChallans.status, header.status)))
      .returning({ id: deliveryChallans.id });
    assertRowUpdated(cancelledRows, `DC ${header.code}`);

    const cancelledQty = roundQty(lineRows.reduce((sum, dl) => sum + Number(dl.qty), 0));
    await emitActivityLog(
      tx,
      {
        action: ActivityAction.Cancel,
        entity: 'DeliveryChallan',
        entityId: id,
        refId: header.code,
        qty: cancelledQty,
        reason: reason ?? null,
        detail: `${dcDetail(header.code, header.vendorCodeText)} — cancelled`,
      },
      companyId,
      user,
    );
    // The send each op received from this challan is taken back: a REVERSE
    // on the Job Card naming the challan, with the same reason.
    for (const op of opCascades) {
      await emitActivityLog(
        tx,
        {
          action: ActivityAction.Reverse,
          entity: 'JobCard',
          entityId: op.jobCardId,
          refId: op.jcCode,
          opRef: `Op ${opSrNo(op.opSeq)}`,
          qty: op.qty,
          reason: reason ?? null,
          detail: `${op.jcCode} Op ${opSrNo(op.opSeq)} — reversed ${op.qty} pcs sent on ${header.code} (DC cancelled)`,
        },
        companyId,
        user,
      );
    }

    return loadDeliveryChallanWithLines(tx, id, companyId);
  });
}

// ─── Writes (ADR-202 Phase 3 — EDIT an issued OSP DC) ───────────────────────
//
// The OSP DC is STOCK-NEUTRAL (ADR-067): there is NO stock ledger movement and
// NO rate. Editing a line's Challan Qty drives ONE number — the job-card op
// counter jc_ops.outsource_sent_qty — so the edit REVERSES that counter for the
// current qty, then REPOSTS it for the new qty, in one transaction (never
// postStockMove). The reverse makes the op read as if this DC never sent, so the
// repost validates each new qty as a fresh send against the op's sendable + the
// PO line's cumulative-sent cap — the exact caps createDeliveryChallan enforces.
// §20.1: outsource_sent_qty keeps its single writer (applyOutwardToJcOp /
// reverseOutwardFromJcOp). The line SET is fixed (a DC's items come from the PO
// selection); add / remove is refused.

/** The in-tx body — also replayed by the edit-approval engine's applyEdit, which
 *  already holds the DC row FOR UPDATE. */
export async function updateDeliveryChallanTx(
  tx: DbTransaction,
  id: string,
  input: UpdateDeliveryChallanInput,
  user: AuthContext,
): Promise<DeliveryChallanWithLines> {
  const companyId = requireCompany(user);

  // S6 — lock the DC header FIRST: a concurrent edit / cancel / receive waits
  // here, then re-reads the committed status / receipts and is refused below.
  const headerRows = await tx
    .select()
    .from(deliveryChallans)
    .where(
      and(
        eq(deliveryChallans.id, id),
        eq(deliveryChallans.companyId, companyId),
        isNull(deliveryChallans.deletedAt),
      ),
    )
    .limit(1)
    .for('update');
  const header = headerRows[0];
  if (!header) throw new NotFoundError('DC not found. Refresh the page.');
  // Only an ISSUED DC with no receipts is editable. A received / cancelled DC,
  // or one with receipts, is settled downstream and must not be re-sent.
  if (header.status !== 'issued') {
    throw new ConflictError(
      `Cannot edit DC ${header.code}: it is ${header.status === 'received' ? 'Received' : 'Cancelled'}. Only an issued DC can be edited.`,
    );
  }
  if (await dcHasActiveReceipts(tx, id)) {
    throw new ConflictError(
      `Cannot edit DC ${header.code}: receipts are recorded against it. Cancel those receipts first.`,
    );
  }
  // Return-to-vendor challan (header.ncId): its pieces were counted when they
  // first went out, so it never adds to outsource_sent_qty and the reverse /
  // repost below would subtract pieces that were never added. That NC sub-flow
  // is excluded from this phase.
  if (header.ncId) {
    throw new ConflictError(
      `DC ${header.code} is a return-to-vendor challan raised from an NC — it cannot be edited here.`,
    );
  }

  // S6 — lock the DC lines under the same tx. Ordered by lineNo so the diff
  // labels ("Line 1 · …") read in the order the user sees on screen.
  const currentLines = await tx
    .select()
    .from(deliveryChallanLines)
    .where(
      and(eq(deliveryChallanLines.deliveryChallanId, id), isNull(deliveryChallanLines.deletedAt)),
    )
    .orderBy(asc(deliveryChallanLines.lineNo))
    .for('update');

  // The line SET is fixed: every input line must be a current line AND every
  // current line must be in the input. Add / remove is refused — a DC's items
  // come from the PO selection at create; only qty / material / remarks change.
  const byId = new Map(currentLines.map((l) => [l.id, l]));
  const inputById = new Map<string, UpdateDeliveryChallanInput['lines'][number]>();
  for (const il of input.lines) {
    if (!byId.has(il.id)) {
      throw new ConflictError(
        `A line in this edit is not on DC ${header.code} — reload the page. ` +
          `A DC's items are fixed from the PO selection.`,
      );
    }
    if (inputById.has(il.id)) {
      throw new ValidationError(`A DC line appears twice in the edit — reload the page.`);
    }
    inputById.set(il.id, il);
  }
  for (const c of currentLines) {
    if (!inputById.has(c.id)) {
      throw new ConflictError(
        `DC ${header.code}: lines cannot be added or removed — a DC's items are fixed from the ` +
          `PO selection. Only Challan Qty / Material / Remarks can be edited.`,
      );
    }
  }

  // Final per-line values: qty from the input (required), material / remarks kept
  // at the current value when the input omits them.
  const newQtyById = new Map<string, number>();
  for (const c of currentLines) newQtyById.set(c.id, roundQty(inputById.get(c.id)!.qty));
  if (![...newQtyById.values()].some((q) => q > 0)) {
    throw new ValidationError('Enter a Challan Qty greater than 0 on at least one line.');
  }

  // Whole-piece / UOM check per line, exactly as create does (a NOS / SET line is
  // refused a fraction; an op-linked line's whole-piece rule is re-checked inside
  // applyOutwardToJcOp below).
  for (const c of currentLines) {
    const newQty = newQtyById.get(c.id)!;
    const problem = qtyUomProblem(newQty, c.uom, 'Qty');
    if (problem) {
      throw new ValidationError(
        `Ln ${c.lineNo}${c.itemCodeText ? ` (${c.itemCodeText})` : ''}: ${problem}`,
      );
    }
  }

  // PO-line cumulative-sent cap (as create does), minus THIS DC's own current
  // contribution so the edit is validated against the OTHER challans only.
  const poLineIds = [
    ...new Set(currentLines.flatMap((l) => (l.purchaseOrderLineId ? [l.purchaseOrderLineId] : []))),
  ];
  // ADR-182 — no re-send against an outsource op whose Production Order was short
  // closed, same as create.
  for (const poLineId of poLineIds) {
    await assertProductionOrderNotShortClosedForPoLine(tx, poLineId);
  }
  const poLines = await loadPoLineMap(tx, poLineIds, companyId);
  // Lock the PO lines first (id order), so a concurrent send on the same line
  // serialises and reads this edit's committed qty.
  await lockPoLinesForSend(tx, poLineIds, companyId);
  const alreadySentAll = await sumSentQtyByPoLine(tx, poLineIds, companyId);
  // This DC's current qty per PO line — the part of alreadySentAll that belongs
  // to the challan being edited, so the baseline is the other challans only.
  const thisDcCurrentByPoLine = new Map<string, number>();
  for (const c of currentLines) {
    if (!c.purchaseOrderLineId) continue;
    const prev = thisDcCurrentByPoLine.get(c.purchaseOrderLineId) ?? 0;
    thisDcCurrentByPoLine.set(c.purchaseOrderLineId, roundQty(prev + Number(c.qty)));
  }
  const newIncByPoLine = new Map<string, number>();
  for (const c of currentLines) {
    if (!c.purchaseOrderLineId) continue;
    const prev = newIncByPoLine.get(c.purchaseOrderLineId) ?? 0;
    newIncByPoLine.set(c.purchaseOrderLineId, roundQty(prev + newQtyById.get(c.id)!));
  }
  for (const [poLineId, inc] of newIncByPoLine) {
    const pol = poLines.get(poLineId)!;
    const baseline = roundQty((alreadySentAll.get(poLineId) ?? 0) - (thisDcCurrentByPoLine.get(poLineId) ?? 0));
    const remaining = roundQty(pol.qty - baseline);
    if (inc > remaining) {
      throw new ConflictError(
        `Ln ${pol.lineNo}${pol.itemCodeText ? ` (${pol.itemCodeText})` : ''}: ` +
          `Qty (${inc}) cannot be more than Pending (${remaining}) — PO Qty ${pol.qty}.`,
      );
    }
  }

  const oldCode = header.code;
  const newCode = bumpDocRevision(oldCode);
  const newDcDate = input.dcDate ?? header.dcDate;

  // REVERSE-then-REPOST the op counter per op-linked line (§20.1 single writer).
  // Run for EVERY op-linked line, not only the ones whose qty changed, so the
  // op's stored outsource_dc_no is rewritten from the old code to the bumped one
  // (the only other stored text copy of the DC number — receipts are ruled out
  // above). The activity log below records a REVERSE / SEND only where qty moved.
  const opMoves: Array<{
    jcCode: string;
    jobCardId: string;
    opSeq: number;
    oldQty: number;
    newQty: number;
  }> = [];
  for (const c of currentLines) {
    if (!c.purchaseOrderLineId) continue;
    const oldQty = roundQty(Number(c.qty));
    const newQty = newQtyById.get(c.id)!;
    // Reverse under the OLD code (clears outsource_dc_no when it matches), then
    // repost under the NEW code. loadOutwardSendable inside applyOutwardToJcOp
    // re-validates newQty against the op's sendable on the reversed state.
    const rev = await reverseOutwardFromJcOp({
      tx,
      companyId,
      adminUserId: user.id,
      dcCode: oldCode,
      dcDate: header.dcDate,
      purchaseOrderLineId: c.purchaseOrderLineId,
      qty: oldQty,
    });
    const app = await applyOutwardToJcOp({
      tx,
      companyId,
      adminUserId: user.id,
      dcCode: newCode,
      dcDate: newDcDate,
      purchaseOrderLineId: c.purchaseOrderLineId,
      qty: newQty,
    });
    const fired = app.fired ? app : rev;
    if (fired.fired && fired.jcCode && fired.jobCardId && fired.opSeq && oldQty !== newQty) {
      opMoves.push({
        jcCode: fired.jcCode,
        jobCardId: fired.jobCardId,
        opSeq: fired.opSeq,
        oldQty,
        newQty,
      });
    }
  }

  // Apply the new line values (qty + optional material / remarks).
  for (const c of currentLines) {
    const il = inputById.get(c.id)!;
    const lineUpdates: Partial<typeof deliveryChallanLines.$inferInsert> = {
      qty: newQtyById.get(c.id)!.toFixed(3),
      updatedBy: user.id,
    };
    if (il.materialText !== undefined) lineUpdates.materialText = il.materialText ?? null;
    if (il.dcRemarks !== undefined) lineUpdates.dcRemarks = il.dcRemarks ?? null;
    await tx
      .update(deliveryChallanLines)
      .set(lineUpdates)
      .where(eq(deliveryChallanLines.id, c.id));
  }

  // Header: travel details + the revision bump. Conditional on status (§20.2) —
  // a concurrent cancel that moved status off 'issued' writes 0 rows here.
  const headerUpdates: Partial<typeof deliveryChallans.$inferInsert> = {
    code: newCode,
    updatedBy: user.id,
    updatedAt: new Date(),
  };
  if (input.dcDate !== undefined) headerUpdates.dcDate = input.dcDate;
  if (input.transport !== undefined) headerUpdates.transport = input.transport ?? null;
  if (input.vehicleNo !== undefined) headerUpdates.vehicleNo = input.vehicleNo ?? null;
  const updatedRows = await tx
    .update(deliveryChallans)
    .set(headerUpdates)
    .where(and(eq(deliveryChallans.id, id), eq(deliveryChallans.status, 'issued')))
    .returning({ id: deliveryChallans.id });
  assertRowUpdated(updatedRows, `DC ${oldCode}`);

  // Activity: EDIT with the before → after list (keys match the registry). The
  // engine emits REQUEST / APPROVE / REJECT for a staged edit; this is the
  // direct-apply log.
  const before: Record<string, unknown> = {
    dcDate: header.dcDate,
    transport: header.transport,
    vehicleNo: header.vehicleNo,
  };
  const after: Record<string, unknown> = {};
  if (input.dcDate !== undefined) after['dcDate'] = input.dcDate;
  if (input.transport !== undefined) after['transport'] = input.transport ?? null;
  if (input.vehicleNo !== undefined) after['vehicleNo'] = input.vehicleNo ?? null;
  for (const c of currentLines) {
    const il = inputById.get(c.id)!;
    before[dcLineQtyKey(c.id)] = Number(c.qty);
    after[dcLineQtyKey(c.id)] = newQtyById.get(c.id)!;
    before[dcLineMaterialKey(c.id)] = c.materialText;
    before[dcLineRemarksKey(c.id)] = c.dcRemarks;
    if (il.materialText !== undefined) after[dcLineMaterialKey(c.id)] = il.materialText ?? null;
    if (il.dcRemarks !== undefined) after[dcLineRemarksKey(c.id)] = il.dcRemarks ?? null;
  }
  const changes = diffFields(before, after, [
    ...DC_HEADER_EDIT_FIELDS,
    ...dcLineDiffFields(currentLines),
  ]);
  if (changes.length > 0) {
    await emitActivityLog(
      tx,
      {
        action: ActivityAction.Edit,
        entity: 'DeliveryChallan',
        entityId: id,
        refId: newCode,
        changes,
        ...(input.reason ? { reason: input.reason } : {}),
        detail: `${oldCode === newCode ? oldCode : `${oldCode} → ${newCode}`} — DC edited`,
      },
      companyId,
      user,
    );
  }
  // Per-op REVERSE (old qty) + SEND (new qty) for each op whose sent qty moved —
  // the same pair cancel / create emit, so the Job Card's history shows the shift.
  for (const op of opMoves) {
    await emitActivityLog(
      tx,
      {
        action: ActivityAction.Reverse,
        entity: 'JobCard',
        entityId: op.jobCardId,
        refId: op.jcCode,
        opRef: `Op ${opSrNo(op.opSeq)}`,
        qty: Math.round(op.oldQty),
        ...(input.reason ? { reason: input.reason } : {}),
        detail: `${op.jcCode} Op ${opSrNo(op.opSeq)} — reversed ${Math.round(op.oldQty)} pcs on ${oldCode} (DC edited)`,
      },
      companyId,
      user,
    );
    await emitActivityLog(
      tx,
      {
        action: ActivityAction.Send,
        entity: 'JobCard',
        entityId: op.jobCardId,
        refId: op.jcCode,
        opRef: `Op ${opSrNo(op.opSeq)}`,
        qty: Math.round(op.newQty),
        detail: `${op.jcCode} Op ${opSrNo(op.opSeq)} — sent ${Math.round(op.newQty)} pcs via ${newCode}${header.vendorCodeText ? ` to ${header.vendorCodeText}` : ''} (DC edited)`,
      },
      companyId,
      user,
    );
  }

  return loadDeliveryChallanWithLines(tx, id, companyId);
}

/** PUBLIC edit — access-gated wrapper around updateDeliveryChallanTx. */
export async function updateDeliveryChallan(
  id: string,
  input: UpdateDeliveryChallanInput,
  user: AuthContext,
): Promise<DeliveryChallanWithLines> {
  await requireFormAccess(user, 'ospdc_create', 'edit');
  return withUserContext(user, async (tx) => updateDeliveryChallanTx(tx, id, input, user));
}

/**
 * The PATCH entry point (ADR-202). When the Document Edit Approval gate is ON and
 * the DC is LIVE (issued, no receipts, not an NC return-to-vendor challan), the
 * edit is STAGED for approval and the request row is returned; otherwise it
 * applies directly. Add / remove of lines is refused clearly on both paths.
 */
export async function updateDeliveryChallanOrStage(
  id: string,
  input: UpdateDeliveryChallanInput,
  user: AuthContext,
): Promise<DeliveryChallanWithLines | DocumentEditStagedResult> {
  await requireFormAccess(user, 'ospdc_create', 'edit');
  const companyId = requireCompany(user);

  // Imported dynamically to avoid a static import cycle with the registry (which
  // imports updateDeliveryChallanTx from this file).
  const { isDocEditApprovalOn, requestDocumentEdit } = await import('../document-edits/service');
  const shouldStage = await withUserContext(user, async (tx) => {
    if (!(await isDocEditApprovalOn(tx, companyId))) return false;
    const rows = await tx
      .select({ status: deliveryChallans.status, ncId: deliveryChallans.ncId })
      .from(deliveryChallans)
      .where(
        and(
          eq(deliveryChallans.id, id),
          eq(deliveryChallans.companyId, companyId),
          isNull(deliveryChallans.deletedAt),
        ),
      )
      .limit(1);
    const row = rows[0];
    // isLive mirrors the registry: only an issued DC with no receipts and no NC
    // link is editable. Otherwise fall through to the direct edit, which raises
    // the precise refusal (404 / status / receipts / nc).
    if (!row || row.status !== 'issued' || row.ncId) return false;
    if (await dcHasActiveReceipts(tx, id)) return false;

    // Refuse add / remove at stage time too, so a staged edit never silently
    // drops or invents a line.
    const currentIds = (
      await tx
        .select({ id: deliveryChallanLines.id })
        .from(deliveryChallanLines)
        .where(
          and(
            eq(deliveryChallanLines.deliveryChallanId, id),
            isNull(deliveryChallanLines.deletedAt),
          ),
        )
    ).map((r) => r.id);
    const currentSet = new Set(currentIds);
    const inputSet = new Set(input.lines.map((l) => l.id));
    const sameSet =
      currentSet.size === inputSet.size && [...inputSet].every((x) => currentSet.has(x));
    if (!sameSet) {
      throw new ConflictError(
        `DC ${id}: lines cannot be added or removed — a DC's items are fixed from the PO ` +
          `selection. Only Challan Qty / Material / Remarks can be edited.`,
      );
    }
    return true;
  });
  if (shouldStage) {
    const request = await requestDocumentEdit(
      'DeliveryChallan',
      id,
      input,
      input.expectedUpdatedAt,
      user,
    );
    return { staged: true, request };
  }

  return updateDeliveryChallan(id, input, user);
}

// ─── Writes (T-059b receive-back) ──────────────────────────────────────────

async function generateReceiptCode(
  tx: DbTransaction,
  companyId: string,
  dcCode: string,
): Promise<string> {
  // Format: RCPT-<dcCode>-NN (zero-padded, 1-based per DC). Read the existing
  // count + 1 inside the same tx. Re-checks with a uniqueness probe loop in
  // case of concurrent inserts (extremely rare; bail after 5 attempts).
  // S2: the receipt series lock makes two receipts on one DC queue up.
  await lockDocSeries(tx, companyId, 'delivery_challan_receipts');
  for (let attempt = 0; attempt < 5; attempt++) {
    const countRows = (await tx.execute(sql`
      SELECT COUNT(*)::int AS n
      FROM public.delivery_challan_receipts dcr
      INNER JOIN public.delivery_challans dc ON dc.id = dcr.delivery_challan_id
      WHERE dcr.company_id = ${companyId}::uuid
        AND dc.code = ${dcCode}
        AND dcr.deleted_at IS NULL
    `)) as unknown as Array<{ n: number }>;
    const seq = (countRows[0]?.n ?? 0) + 1 + attempt;
    const code = `RCPT-${dcCode}-${String(seq).padStart(2, '0')}`;
    const dup = await tx
      .select({ id: deliveryChallanReceipts.id })
      .from(deliveryChallanReceipts)
      .where(
        and(
          eq(deliveryChallanReceipts.companyId, companyId),
          eq(deliveryChallanReceipts.receiptCode, code),
          isNull(deliveryChallanReceipts.deletedAt),
        ),
      )
      .limit(1);
    if (dup.length === 0) return code;
  }
  throw new ConflictError(`Could not number the receipt for DC ${dcCode}. Try again.`);
}

export async function receiveAgainstDeliveryChallan(
  deliveryChallanId: string,
  input: CreateDeliveryChallanReceiptInput,
  user: AuthContext,
): Promise<ReceiveDeliveryChallanResponse> {
  // Booking material back from the vendor creates a receipt, so it is `entry` —
  // the same right that raised the DC. Was requireWriteRole. The GRN screen's
  // "Against JW PO / DC" and "Against NC" types save through here too, and they
  // open on GRN entry rights — so a GRN storekeeper (grn_create entry) may book
  // the receipt as well; it lands on an auto-GRN as QC pending either way.
  await requireAnyFormAccess(user, [
    ['ospdc_create', 'entry'],
    ['grn_create', 'entry'],
  ]);
  const companyId = requireCompany(user);

  return withUserContext(user, async (tx) => {
    // S6 — lock the challan and its lines before reading what was already
    // received: two receipts (or a receipt and a cancel) on one DC serialize,
    // and the second re-reads the first one's receipt lines, so Received can
    // never pass Sent.
    const headerRows = await tx
      .select()
      .from(deliveryChallans)
      .where(
        and(
          eq(deliveryChallans.id, deliveryChallanId),
          eq(deliveryChallans.companyId, companyId),
          isNull(deliveryChallans.deletedAt),
        ),
      )
      .limit(1)
      .for('update');
    const dcHeader = headerRows[0];
    if (!dcHeader) throw new NotFoundError('DC not found. Refresh the page.');
    if (dcHeader.status === 'cancelled') {
      throw new ConflictError(`Cannot receive against DC ${dcHeader.code}: it is Cancelled.`);
    }
    if (dcHeader.status === 'received') {
      throw new ConflictError(
        `Cannot receive against DC ${dcHeader.code}: it is already fully Received.`,
      );
    }

    // Load outward lines for this DC + validate every input line belongs to it.
    const dcLineRows = await tx
      .select()
      .from(deliveryChallanLines)
      .where(
        and(
          eq(deliveryChallanLines.deliveryChallanId, deliveryChallanId),
          eq(deliveryChallanLines.companyId, companyId),
          isNull(deliveryChallanLines.deletedAt),
        ),
      )
      .orderBy(asc(deliveryChallanLines.id))
      .for('update');
    const dcLineById = new Map(dcLineRows.map((l) => [l.id, l]));

    const inputLineIds = input.lines.map((l) => l.deliveryChallanLineId);
    for (const id of inputLineIds) {
      if (!dcLineById.has(id)) {
        throw new ValidationError(`A line is not on DC ${dcHeader.code}. Please reload the DC.`);
      }
    }

    // ADR-182 — booking material back from the vendor is WORK: it auto-creates
    // a GRN (insertGrnForOspReceipt, a second GRN path that never goes through
    // createGoodsReceiptNote and so never meets its guard), moves the jc_op's
    // received / accepted qty on, and writes a store txn. None of that may
    // happen on a short-closed Production Order. Checked here, before the
    // receipt header is inserted, so nothing is half-written.
    const receivePoLineIds = [
      ...new Set(
        inputLineIds
          .map((id) => dcLineById.get(id)?.purchaseOrderLineId)
          .filter((v): v is string => Boolean(v)),
      ),
    ];
    for (const poLineId of receivePoLineIds) {
      await assertProductionOrderNotShortClosedForPoLine(tx, poLineId);
    }

    // Per-line over-receive check: cumulative received across all prior
    // receipts + this receipt's received qty must not exceed the outward
    // line's qty. (Legacy rows may carry a rejected_qty; include it so the
    // cumulative total stays consistent with pre-change history.)
    const priorRows = await tx
      .select({
        dcLineId: deliveryChallanReceiptLines.deliveryChallanLineId,
        sumQty: sql<string>`COALESCE(SUM(${deliveryChallanReceiptLines.receivedQty} + ${deliveryChallanReceiptLines.rejectedQty}), 0)::numeric`,
      })
      .from(deliveryChallanReceiptLines)
      .where(
        and(
          inArray(deliveryChallanReceiptLines.deliveryChallanLineId, inputLineIds),
          eq(deliveryChallanReceiptLines.companyId, companyId),
          isNull(deliveryChallanReceiptLines.deletedAt),
        ),
      )
      .groupBy(deliveryChallanReceiptLines.deliveryChallanLineId);
    const priorByLine = new Map<string, number>();
    for (const r of priorRows) priorByLine.set(r.dcLineId, Number(r.sumQty));

    // Decimals follow the challan line's unit (S9): the receipt line carries
    // no unit of its own, so a NOS / SET line must come back in whole pieces
    // while a KGS / MTR line takes up to 3 decimals.
    for (const il of input.lines) {
      const dcLine = dcLineById.get(il.deliveryChallanLineId)!;
      const problem = qtyUomProblem(il.receivedQty, dcLine.uom, 'Received Qty');
      if (problem) {
        throw new ValidationError(
          `Ln ${dcLine.lineNo}${dcLine.itemCodeText ? ` (${dcLine.itemCodeText})` : ''}: ${problem}`,
        );
      }
    }

    const incomingByLine = new Map<string, number>();
    for (const il of input.lines) {
      const prev = incomingByLine.get(il.deliveryChallanLineId) ?? 0;
      incomingByLine.set(il.deliveryChallanLineId, roundQty(prev + il.receivedQty));
    }
    for (const [dcLineId, incReceived] of incomingByLine) {
      const dcLine = dcLineById.get(dcLineId)!;
      const sentQty = Number(dcLine.qty);
      const prior = priorByLine.get(dcLineId) ?? 0;
      const totalAfter = roundQty(prior + incReceived);
      if (totalAfter > sentQty) {
        throw new ConflictError(
          `Ln ${dcLine.lineNo}: Received (${totalAfter}) cannot be more than Sent Qty (${sentQty}). Reduce the Qty.`,
        );
      }
    }

    // Generate receipt code + insert header.
    const receiptCode = await generateReceiptCode(tx, companyId, dcHeader.code);
    const insertedHeader = await tx
      .insert(deliveryChallanReceipts)
      .values({
        companyId,
        deliveryChallanId,
        receiptCode,
        receiptDate: input.receiptDate,
        vendorInvoiceText: input.vendorInvoiceText ?? null,
        remarks: input.remarks ?? null,
        createdBy: user.id,
        updatedBy: user.id,
      })
      .returning();
    const receiptHeader = insertedHeader[0]!;

    // Insert receipt lines.
    const receiptLineValues = input.lines.map((il) => ({
      companyId,
      receiptId: receiptHeader.id,
      deliveryChallanLineId: il.deliveryChallanLineId,
      receivedQty: roundQty(il.receivedQty).toFixed(3),
      // No reject at receive — rejected_qty defaults to 0, reject_reason null.
      // Quality accept/reject is decided at Incoming QC on the auto-GRN below.
      remarks: il.remarks ?? null,
      createdBy: user.id,
      updatedBy: user.id,
    }));
    const insertedLines = await tx
      .insert(deliveryChallanReceiptLines)
      .values(receiptLineValues)
      .returning();

    // Cascades per receipt line: auto-GRN (pending QC) for the received qty +
    // jc_op flip. Track per-po-line aggregates so we only invoke
    // applyReceiveToJcOp once per po_line even when multiple receipt lines target it.
    // NOTE: received qty does NOT credit stock here — it goes onto an auto-created
    // GRN (below) and credits at Incoming-QC accept, mirroring the regular GRN
    // path. There is no reject at receive: the accept/reject decision and any
    // defect record (NC) are made at Incoming QC.
    const poLineQtyAdded = new Map<string, number>();
    const grnLines: Array<{
      purchaseOrderLineId: string | null;
      itemId: string | null;
      itemCodeText: string | null;
      itemName: string;
      receivedQty: number;
    }> = [];
    for (const rl of insertedLines) {
      const dcLine = dcLineById.get(rl.deliveryChallanLineId)!;
      // 3 decimals kept (S9): 2.5 KGS back from the vendor lands on the GRN as
      // 2.5, not 3. A JC operation's whole-piece rule is applied in
      // applyReceiveToJcOp.
      const receivedQty = roundQty(Number(rl.receivedQty));

      if (receivedQty > 0) {
        grnLines.push({
          purchaseOrderLineId: dcLine.purchaseOrderLineId,
          itemId: dcLine.itemId,
          itemCodeText: dcLine.itemCodeText,
          itemName: dcLine.itemNameText ?? dcLine.itemCodeText ?? 'Item',
          receivedQty,
        });
      }

      if (dcLine.purchaseOrderLineId) {
        const prev = poLineQtyAdded.get(dcLine.purchaseOrderLineId) ?? 0;
        poLineQtyAdded.set(dcLine.purchaseOrderLineId, roundQty(prev + receivedQty));
      }
    }

    // Auto-create the GRN (pending Incoming QC) for the good received qty. This
    // routes OSP receive-backs through Incoming QC instead of crediting stock
    // directly (restores the legacy receiveOutsourceOp → createGRNfromPO flow).
    // Kept as { id, code }: the response carries it back so the GRN screen's
    // "Against JWPO / DC" tab can land on the GRN it just raised.
    let autoGrn: { id: string; code: string } | null = null;
    if (grnLines.length > 0) {
      // The GRN's vendor-code copy is the VENDOR's code (A32): the master's
      // code when the challan has a linked vendor — never the challan's old
      // text, which on pre-0182 challans held the PO number.
      let grnVendorCodeText = dcHeader.vendorCodeText;
      if (dcHeader.vendorId) {
        const [v] = await tx
          .select({ code: vendors.code })
          .from(vendors)
          .where(and(eq(vendors.id, dcHeader.vendorId), eq(vendors.companyId, companyId)))
          .limit(1);
        if (v) grnVendorCodeText = v.code;
      }
      const grn = await insertGrnForOspReceipt(tx, companyId, user, {
        grnDate: input.receiptDate,
        purchaseOrderId: dcHeader.purchaseOrderId,
        poCodeText: dcHeader.poCodeText,
        vendorId: dcHeader.vendorId,
        vendorCodeText: grnVendorCodeText,
        dcNo: dcHeader.code,
        deliveryChallanId: dcHeader.id,
        invoiceNo: receiptHeader.vendorInvoiceText,
        remarks: receiptHeader.remarks ?? `Auto GRN from OSP receipt ${receiptCode}`,
        lines: grnLines,
        // A return-to-vendor challan's receipt is the vendor's REPLACEMENT
        // (design §5): the GRN carries the NC so Incoming QC can settle it.
        ncId: dcHeader.ncId ?? null,
      });
      autoGrn = { id: grn.id, code: grn.code };
    }

    // Return-to-vendor challan (design §5): book the pieces as back from the
    // vendor on the NC (rtv_received_qty, status received_qc_pending). This
    // call's total, not the line's cumulative — the cascade adds. Interlock 4
    // (cumulative received <= sent) is already enforced per line by the
    // over-receive check above, and the NC's own DB check
    // (rtv_received_qty <= rtv_sent_qty) backs it.
    if (dcHeader.ncId) {
      const totalReceivedThisCall = roundQty(
        insertedLines.reduce((sum, rl) => sum + Number(rl.receivedQty), 0),
      );
      if (totalReceivedThisCall > 0) {
        await onNcChallanReceived(
          tx,
          { ncId: dcHeader.ncId, receivedQty: totalReceivedThisCall, deliveryChallanId },
          companyId,
          user,
        );
      }
    }

    // jc_op flip per po_line.
    const opCascades: Array<{
      jcCode: string;
      opSeq: number;
      fullyReceived: boolean;
      statusChanged: boolean;
      jobCardId: string;
      poLineId: string;
    }> = [];
    for (const [poLineId, qtyAdded] of poLineQtyAdded) {
      const cascadeResult = await applyReceiveToJcOp({
        tx,
        companyId,
        adminUserId: user.id,
        receiptCode,
        receiptDate: input.receiptDate,
        purchaseOrderLineId: poLineId,
        qtyAdded,
      });
      if (cascadeResult.fired && cascadeResult.jcCode && cascadeResult.opSeq) {
        opCascades.push({
          jcCode: cascadeResult.jcCode,
          opSeq: cascadeResult.opSeq,
          fullyReceived: Boolean(cascadeResult.fullyReceived),
          statusChanged: Boolean(cascadeResult.statusChanged),
          jobCardId: cascadeResult.jobCardId!,
          poLineId,
        });
      }
    }

    // No reject at receive: the rejected-goods NC is no longer raised here.
    // Everything received is now sitting on the auto-GRN as pending QC, and
    // Incoming QC is the single place a reject raises a defect record (NC).

    // ADR-197: who booked the latest receipt against the challan, and when.
    const receivedAt = new Date();
    await tx
      .update(deliveryChallans)
      .set({ receivedBy: user.id, receivedAt, updatedBy: user.id, updatedAt: receivedAt })
      .where(eq(deliveryChallans.id, deliveryChallanId));

    // DC status flip when ALL outward lines fully reconciled.
    let dcMarkedReceived = false;
    if (await isDcFullyReconciled(tx, deliveryChallanId)) {
      await tx
        .update(deliveryChallans)
        .set({ status: 'received', updatedBy: user.id })
        .where(eq(deliveryChallans.id, deliveryChallanId));
      dcMarkedReceived = true;
    }

    // Audit emissions in the same tx (ADR-197): one RECEIVE row per challan
    // line that took pieces in this receipt, qty = that line's received qty.
    for (const rl of insertedLines) {
      const dcLine = dcLineById.get(rl.deliveryChallanLineId)!;
      const receivedQty = Number(rl.receivedQty);
      await emitActivityLog(
        tx,
        {
          action: ActivityAction.Receive,
          entity: 'DeliveryChallan',
          entityId: dcHeader.id,
          refId: dcHeader.code,
          lineRef: `Line ${dcLine.lineNo}`,
          qty: receivedQty,
          detail:
            `${dcHeader.code} Ln ${dcLine.lineNo}${dcLine.itemCodeText ? ` (${dcLine.itemCodeText})` : ''}` +
            ` — ${receivedQty} received on ${receiptCode}${autoGrn ? ` → GRN ${autoGrn.code} (QC Pending)` : ''}`,
        },
        companyId,
        user,
      );
    }
    // Only when the op's status actually moved in THIS receipt. A
    // return-to-vendor receipt against the same PO line re-evaluates an op
    // that is already 'received' (or that onNcChallanReceived just flipped,
    // with its own audit row) as fully received, and used to log it again.
    for (const op of opCascades) {
      if (op.fullyReceived && op.statusChanged) {
        await emitActivityLog(
          tx,
          {
            action: ActivityAction.Receive,
            entity: 'JobCard',
            entityId: op.jobCardId,
            refId: op.jcCode,
            opRef: `Op ${opSrNo(op.opSeq)}`,
            qty: poLineQtyAdded.get(op.poLineId) ?? null,
            detail: `${op.jcCode} Op ${opSrNo(op.opSeq)} — fully received via ${receiptCode}`,
          },
          companyId,
          user,
        );
      }
    }
    if (dcMarkedReceived) {
      await emitActivityLog(
        tx,
        {
          action: ActivityAction.Complete,
          entity: 'DeliveryChallan',
          entityId: dcHeader.id,
          refId: dcHeader.code,
          detail: `${dcHeader.code} — all lines fully reconciled`,
        },
        companyId,
        user,
      );
    }
    // Sales-cascade: a fully-received outsource op may make the JC complete.
    // Run only for jobs whose outsource op just flipped to fully-received.
    for (const op of opCascades) {
      if (op.fullyReceived) {
        await tryCascadeJcComplete(tx, op.jobCardId, user);
      }
    }

    const dc = await loadDeliveryChallanWithLines(tx, deliveryChallanId, companyId);
    return { ...dc, autoGrn: autoGrn ? { id: autoGrn.id, code: autoGrn.code } : null };
  });
}

// ─── Related documents (read-only traceability) ────────────────────────────
//
// GET /delivery-challans/:id/related. FK-derived, company-scoped +
// soft-delete-filtered, all inside a single withUserContext tx (RLS applied).
//
// Upstream (source):
//   - delivery_challans.purchase_order_id      → purchase_orders (the OSP PO)
//   - delivery_challans.vendor_id              → vendors (the receiving vendor)
//   - delivery_challans.sales_order_line_id    → sales_order_lines → sales_orders
//   - DISTINCT delivery_challan_lines.item_id  → items (the dispatched parts)
// Downstream: none external — receipts are internal children of the DC.
export async function getDeliveryChallanRelated(
  id: string,
  user: AuthContext,
): Promise<DocumentTraceability> {
  const companyId = requireCompany(user);
  return withUserContext(user, async (tx) => {
    const headers = await tx
      .select({
        id: deliveryChallans.id,
        code: deliveryChallans.code,
        dcDate: deliveryChallans.dcDate,
        status: deliveryChallans.status,
        purchaseOrderId: deliveryChallans.purchaseOrderId,
        vendorId: deliveryChallans.vendorId,
        salesOrderLineId: deliveryChallans.salesOrderLineId,
      })
      .from(deliveryChallans)
      .where(
        and(
          eq(deliveryChallans.id, id),
          eq(deliveryChallans.companyId, companyId),
          isNull(deliveryChallans.deletedAt),
        ),
      )
      .limit(1);
    const header = headers[0];
    if (!header) throw new NotFoundError('DC not found. Refresh the page.');

    // ── Upstream: source PO (nullable header FK) ────────────────────────────
    const poRows = header.purchaseOrderId
      ? await tx
          .select({
            id: purchaseOrders.id,
            code: purchaseOrders.code,
            status: purchaseOrders.status,
            date: purchaseOrders.poDate,
          })
          .from(purchaseOrders)
          .where(
            and(
              eq(purchaseOrders.id, header.purchaseOrderId),
              eq(purchaseOrders.companyId, companyId),
              isNull(purchaseOrders.deletedAt),
            ),
          )
          .limit(1)
      : [];

    // ── Upstream: receiving vendor (master) ─────────────────────────────────
    const vendorRows = header.vendorId
      ? await tx
          .select({ id: vendors.id, code: vendors.code, name: vendors.name })
          .from(vendors)
          .where(
            and(
              eq(vendors.id, header.vendorId),
              eq(vendors.companyId, companyId),
              isNull(vendors.deletedAt),
            ),
          )
          .limit(1)
      : [];

    // ── Upstream: source SO via the linked SO line (resolve line → header) ──
    const soRows = header.salesOrderLineId
      ? await tx
          .select({
            id: salesOrders.id,
            code: salesOrders.code,
            internalSoNo: salesOrders.internalSoNo,
            status: salesOrders.status,
            date: salesOrders.soDate,
          })
          .from(salesOrderLines)
          .innerJoin(salesOrders, eq(salesOrders.id, salesOrderLines.salesOrderId))
          .where(
            and(
              eq(salesOrderLines.id, header.salesOrderLineId),
              eq(salesOrderLines.companyId, companyId),
              isNull(salesOrderLines.deletedAt),
              isNull(salesOrders.deletedAt),
            ),
          )
          .limit(1)
      : [];

    // ── Upstream: distinct dispatched items (master) ────────────────────────
    const itemRows = await tx
      .selectDistinct({ id: items.id, code: items.code, name: items.name })
      .from(items)
      .innerJoin(deliveryChallanLines, eq(deliveryChallanLines.itemId, items.id))
      .where(
        and(
          eq(deliveryChallanLines.deliveryChallanId, id),
          eq(deliveryChallanLines.companyId, companyId),
          isNull(deliveryChallanLines.deletedAt),
          eq(items.companyId, companyId),
          isNull(items.deletedAt),
        ),
      )
      .orderBy(asc(items.code));

    const row = (
      id_: string,
      code: string,
      status: string | null,
      date: unknown,
      label?: string | null,
    ) => ({
      id: id_,
      code,
      status,
      date: toIsoDate(date),
      linkId: null,
      label: label ?? null,
    });

    const upstream = [
      section(
        'purchase-order',
        'Purchase Order',
        '🧾',
        'purchase-order',
        poRows.map((r) => row(r.id, r.code, r.status, r.date)),
      ),
      section(
        'vendor',
        'Vendor',
        '🏭',
        'vendor',
        vendorRows.map((r) => row(r.id, r.code, null, null, r.name)),
      ),
      section(
        'sales-order',
        'Sales Order',
        '📄',
        'sales-order',
        soRows.map((r) => row(r.id, r.code, r.status, r.date, r.internalSoNo)),
      ),
      section(
        'item',
        'Items',
        '📦',
        'item',
        itemRows.map((r) => row(r.id, r.code, null, null, r.name)),
      ),
    ];
    const downstream: ReturnType<typeof section>[] = [];

    return {
      self: { module: 'delivery-challans', code: header.code },
      upstream,
      downstream,
      related: [],
      timeline: buildTimeline(
        {
          ts: toIsoDate(header.dcDate),
          label: 'Delivery Challan issued',
          code: header.code,
          routeKind: 'delivery-challan',
          linkId: id,
        },
        [...upstream, ...downstream],
      ),
    };
  });
}
