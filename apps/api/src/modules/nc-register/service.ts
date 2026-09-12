// NC Register service.
//
// Read + create + light-update + softDelete, plus the disposition workflow
// (T-040b, cascades.ts) and — since the QC–NC handling procedure of
// 2026-09-12 (docs/QC-NC-HANDLING-DESIGN.md) — the return-to-vendor challan,
// the closure gate and the single close path every route goes through.
// Update is restricted to date / reason / reportedBy fields; status stays
// 'pending' until the dispose action flips it. SoftDelete blocks once status
// leaves 'pending' — disposed/closed NCs are permanent records.

import { and, asc, desc, eq, isNull, like, sql } from 'drizzle-orm';
import { type DocumentTraceability, type RelatedDoc, withDocRevision } from '@innovic/shared';
import {
  capaRecords,
  deliveryChallanLines,
  deliveryChallans,
  items,
  jcOps,
  jobCards,
  ncRegister,
  purchaseOrderLines,
  salesOrderLines,
  users,
  vendors,
} from '../../db/schema';
import { type AuthContext, type DbTransaction, withUserContext } from '../../db/with-user-context';
import { canSeeFormPrice, requireFormAccess } from '../../lib/access';
import { requireOpEntryRole } from '../../lib/auth';
import { buildTimeline, section, toIsoDate } from '../../lib/traceability';
import {
  AuthorizationError,
  ConflictError,
  NotFoundError,
  ValidationError,
} from '../../lib/errors';
import { emitActivityLog } from '../activity-log/service';
import { recalcPoLineReceivedQty } from '../goods-receipt-notes/cascades';
import { type DisposeNcContext, disposeNcCascade } from './cascades';
import { markNcClosed, ncCloseBlockedReason, ncOpenQty } from './recovery';
import type {
  CloseNcReworkInput,
  CreateNcDcInput,
  CreateNcDcResult,
  CreateNcRegisterInput,
  DisposeNcInput,
  DisposeNcResult,
  ListNcRegisterQuery,
  ListNcRegisterResponse,
  NcRegister,
  NcRegisterListItem,
  NcRegisterSummary,
  UpdateNcRegisterInput,
} from './schema';

const requireCompany = (user: AuthContext): string => {
  if (!user.companyId) throw new AuthorizationError('User is not assigned to a company');
  return user.companyId;
};

function ncDetail(
  code: string,
  itemCodeText: string | null | undefined,
  rejectedQty: string,
): string {
  const item = itemCodeText && itemCodeText.length > 0 ? itemCodeText : '—';
  return `${code} — ${item} qty=${rejectedQty}`;
}

// ─── FK validation helpers ────────────────────────────────────────────────

async function assertJobCardExists(
  tx: DbTransaction,
  jobCardId: string,
  companyId: string,
): Promise<void> {
  const rows = await tx
    .select({ id: jobCards.id })
    .from(jobCards)
    .where(
      and(
        eq(jobCards.id, jobCardId),
        eq(jobCards.companyId, companyId),
        isNull(jobCards.deletedAt),
      ),
    )
    .limit(1);
  if (rows.length === 0) {
    throw new ValidationError(`Job card ${jobCardId} not found in this company`);
  }
}

async function assertJcOpExists(
  tx: DbTransaction,
  jcOpId: string,
  companyId: string,
): Promise<void> {
  const rows = await tx
    .select({ id: jcOps.id })
    .from(jcOps)
    .where(and(eq(jcOps.id, jcOpId), eq(jcOps.companyId, companyId), isNull(jcOps.deletedAt)))
    .limit(1);
  if (rows.length === 0) {
    throw new ValidationError(`JC op ${jcOpId} not found in this company`);
  }
}

async function assertItemExists(
  tx: DbTransaction,
  itemId: string,
  companyId: string,
): Promise<void> {
  const rows = await tx
    .select({ id: items.id, code: items.code })
    .from(items)
    .where(and(eq(items.id, itemId), eq(items.companyId, companyId), isNull(items.deletedAt)))
    .limit(1);
  if (rows.length === 0) {
    throw new ValidationError(`Item ${itemId} not found in this company`);
  }
}

async function getItemCode(
  tx: DbTransaction,
  itemId: string,
  companyId: string,
): Promise<string | null> {
  const rows = await tx
    .select({ code: items.code })
    .from(items)
    .where(and(eq(items.id, itemId), eq(items.companyId, companyId), isNull(items.deletedAt)))
    .limit(1);
  return rows[0]?.code ?? null;
}

// ─── Helpers ──────────────────────────────────────────────────────────────

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

function maybeDateLike(v: unknown): string | null {
  if (v == null) return null;
  return dateLike(v);
}

/** The joined values a bare nc_register row does not carry. The read paths
 *  resolve all of them; the write paths go through readNc so they do too. */
interface NcJoins {
  linkedCapaCode?: string | null;
  itemCode?: string | null;
  itemName?: string | null;
  itemRevision?: string | null;
  childJobCardCode?: string | null;
  deliveryChallanCode?: string | null;
}

function toNcRegister(row: typeof ncRegister.$inferSelect, joins: NcJoins = {}): NcRegister {
  const linkedCapaCode = joins.linkedCapaCode ?? null;
  const itemCode = joins.itemCode ?? null;
  const itemName = joins.itemName ?? null;
  const itemRevision = joins.itemRevision ?? null;
  const childJobCardCode = joins.childJobCardCode ?? null;
  const deliveryChallanCode = joins.deliveryChallanCode ?? null;
  return {
    id: row.id,
    companyId: row.companyId,
    code: row.code,
    ncDate: row.ncDate,
    jobCardId: row.jobCardId,
    jcOpId: row.jcOpId,
    opSeq: row.opSeq,
    operationText: row.operationText,
    qcOperationText: row.qcOperationText,
    itemId: row.itemId,
    itemCodeText: row.itemCodeText,
    itemNameText: row.itemNameText,
    // Live values resolved from the items master (LEFT JOIN in getNcRegister).
    itemCode,
    itemName,
    // The customer's drawing revision, resolved live off the SO line behind this
    // NC's job card (LEFT JOIN in getNcRegister and in the list reader). It is
    // display-only and is never appended to itemCodeText, which stays the durable
    // snapshot of what the reporter typed. The write paths below pass nothing and
    // so return null, exactly as they already do for itemCode and itemName.
    itemRevision,
    soCodeText: row.soCodeText,
    machineCodeText: row.machineCodeText,
    operatorText: row.operatorText,
    rejectedQty: row.rejectedQty,
    reasonCategory: row.reasonCategory,
    reason: row.reason,
    disposition: row.disposition,
    dispositionDate: row.dispositionDate,
    dispositionByText: row.dispositionByText,
    dispositionRemarks: row.dispositionRemarks,
    reworkJcCodeText: row.reworkJcCodeText,
    reworkOpSeq: row.reworkOpSeq,
    reworkDoneQty: row.reworkDoneQty,
    // QC–NC handling ledger (design §3). openQty and closeBlockedReason are
    // computed here, never stored, so they can never drift from the columns.
    qcLogId: row.qcLogId,
    grnLineId: row.grnLineId,
    splitFromNcId: row.splitFromNcId,
    childJobCardId: row.childJobCardId,
    childJobCardCode,
    deliveryChallanId: row.deliveryChallanId,
    deliveryChallanCode,
    rtvSentQty: row.rtvSentQty,
    rtvReceivedQty: row.rtvReceivedQty,
    clearedQty: row.clearedQty,
    failedQty: row.failedQty,
    closedAt: maybeTsLike(row.closedAt),
    closedBy: row.closedBy,
    openQty: ncOpenQty(row).toFixed(2),
    closeBlockedReason: ncCloseBlockedReason({ ...row, childJobCardCode }),
    scrapCost: row.scrapCost,
    status: row.status,
    reportedByText: row.reportedByText,
    timeLogged: maybeTsLike(row.timeLogged),
    linkedCapaCode,
    createdAt: tsLike(row.createdAt),
    createdBy: row.createdBy,
    updatedAt: tsLike(row.updatedAt),
    updatedBy: row.updatedBy,
    deletedAt: maybeTsLike(row.deletedAt),
  };
}

// Look up the CAPA code whose ncRefs jsonb array contains this NC code.
// Mirrors legacy `_capaForNC` (HTML L22758). nc_refs is jsonb (a JSON array),
// so use the @> containment operator with a jsonb array literal.
async function lookupLinkedCapaCode(
  tx: DbTransaction,
  companyId: string,
  ncCode: string,
): Promise<string | null> {
  const rows = await tx.execute(sql`
    SELECT code
    FROM public.capa_records
    WHERE company_id = ${companyId}::uuid
      AND deleted_at IS NULL
      AND nc_refs @> ${JSON.stringify([ncCode])}::jsonb
    ORDER BY created_at ASC
    LIMIT 1
  `);
  const list = rows as unknown as Array<{ code: string }>;
  return list[0]?.code ?? null;
}

// ─── Reads ────────────────────────────────────────────────────────────────

// Money-hiding for L1 Viewers ("Can See Price"). An NC's only money is its
// scrap cost, nulled for price-restricted viewers on list + detail.
function hideNcMoney<T extends { scrapCost: string | null }>(r: T): T {
  return { ...r, scrapCost: null };
}

/** Escape the ILIKE metacharacters in a user's search term. Without this a
 *  user typing "50%" or "a_b" in the NC Register search box gets a wildcard
 *  pattern instead of a literal search — a bare "%" returned every NC. The SQL
 *  side must pair it with an ESCAPE '\' clause on every ILIKE, or the escapes
 *  match literally.
 *  Deliberately a local copy of the sales-orders helper rather than an export
 *  across modules: it is three lines, and each list must be free to change its
 *  own search behaviour without dragging the others with it. */
function escapeLikeTerm(raw: string): string {
  return raw.replace(/[\\%_]/g, (ch) => `\\${ch}`);
}

export async function listNcRegister(
  input: ListNcRegisterQuery,
  user: AuthContext,
): Promise<ListNcRegisterResponse> {
  const companyId = requireCompany(user);
  const showMoney = await canSeeFormPrice(user, 'nc_dispose');
  return withUserContext(user, async (tx) => {
    // Search covers every column the NC list table actually shows — Rej No.,
    // Date, JC No., Operation (the resolved op name, falling back to the stored
    // operation / QC-operation text), Item (master code + name and the stored
    // code + name text), Reason, Disposition, Status, and the linked CAPA code
    // printed in the Actions cell. `nc.reason` is kept from the original clause
    // set: the Reason column shows the category, but the free-text reason is the
    // NC's own description and users search it.
    // Deliberately NOT searched: rejected qty, rework-done qty and the op
    // sequence number — matching numbers would make "2" hit almost every NC.
    // And NOT scrap_cost: it is money, hidden behind `canSeeFormPrice`
    // (hideNcMoney above), so a searchable amount would let a user who may not
    // see prices confirm a scrap value by guessing at it.
    const term = input.search ? `%${escapeLikeTerm(input.search)}%` : null;
    const searchFrag = term
      ? sql`AND (
          nc.code ILIKE ${term} ESCAPE '\\'
          OR nc.nc_date::text ILIKE ${term} ESCAPE '\\'
          -- JC No. column — jc is the job_cards join already in the SELECT.
          OR jc.code ILIKE ${term} ESCAPE '\\'
          -- Operation column: "Op<seq>: <name>", name resolved in this order.
          OR jo.operation ILIKE ${term} ESCAPE '\\'
          OR nc.operation_text ILIKE ${term} ESCAPE '\\'
          OR nc.qc_operation_text ILIKE ${term} ESCAPE '\\'
          -- Item column: master row first, stored snapshot second, so an item
          -- renamed after the NC was raised is found under either name.
          OR i.code ILIKE ${term} ESCAPE '\\'
          OR i.name ILIKE ${term} ESCAPE '\\'
          OR nc.item_code_text ILIKE ${term} ESCAPE '\\'
          OR nc.item_name_text ILIKE ${term} ESCAPE '\\'
          OR nc.reason ILIKE ${term} ESCAPE '\\'
          -- The three badge columns.
          OR nc.reason_category::text ILIKE ${term} ESCAPE '\\'
          OR nc.disposition::text ILIKE ${term} ESCAPE '\\'
          OR nc.status::text ILIKE ${term} ESCAPE '\\'
          -- Linked CAPA code, printed in the Actions cell (cap is the LATERAL
          -- join below).
          OR cap.code ILIKE ${term} ESCAPE '\\'
        )`
      : sql``;
    const statusFrag = input.status ? sql`AND nc.status = ${input.status}::nc_status` : sql``;
    const reasonFrag = input.reasonCategory
      ? sql`AND nc.reason_category = ${input.reasonCategory}::nc_reason_category`
      : sql``;
    const jcFrag = input.jobCardId ? sql`AND nc.job_card_id = ${input.jobCardId}::uuid` : sql``;
    const fromFrag = input.fromDate ? sql`AND nc.nc_date >= ${input.fromDate}::date` : sql``;
    const toFrag = input.toDate ? sql`AND nc.nc_date <= ${input.toDate}::date` : sql``;

    const result = await tx.execute(sql`
      SELECT
        nc.id, nc.company_id AS "companyId", nc.code,
        nc.nc_date AS "ncDate",
        nc.job_card_id AS "jobCardId", nc.jc_op_id AS "jcOpId", nc.op_seq AS "opSeq",
        nc.operation_text AS "operationText", nc.qc_operation_text AS "qcOperationText",
        nc.item_id AS "itemId", nc.item_code_text AS "itemCodeText",
        nc.item_name_text AS "itemNameText",
        nc.so_code_text AS "soCodeText", nc.machine_code_text AS "machineCodeText",
        nc.operator_text AS "operatorText",
        nc.rejected_qty::text AS "rejectedQty",
        nc.reason_category AS "reasonCategory", nc.reason,
        nc.disposition,
        nc.disposition_date AS "dispositionDate",
        nc.disposition_by_text AS "dispositionByText",
        nc.disposition_remarks AS "dispositionRemarks",
        nc.rework_jc_code_text AS "reworkJcCodeText",
        nc.rework_op_seq AS "reworkOpSeq",
        nc.rework_done_qty::text AS "reworkDoneQty",
        nc.scrap_cost::text AS "scrapCost",
        nc.status,
        nc.reported_by_text AS "reportedByText",
        nc.time_logged AS "timeLogged",
        -- QC–NC handling ledger and links (design §3).
        nc.qc_log_id AS "qcLogId",
        nc.grn_line_id AS "grnLineId",
        nc.split_from_nc_id AS "splitFromNcId",
        nc.child_job_card_id AS "childJobCardId",
        cjc.code AS "childJobCardCode",
        nc.delivery_challan_id AS "deliveryChallanId",
        dc.code AS "deliveryChallanCode",
        nc.rtv_sent_qty::text AS "rtvSentQty",
        nc.rtv_received_qty::text AS "rtvReceivedQty",
        nc.cleared_qty::text AS "clearedQty",
        nc.failed_qty::text AS "failedQty",
        nc.closed_at AS "closedAt",
        nc.closed_by AS "closedBy",
        nc.created_at AS "createdAt", nc.created_by AS "createdBy",
        nc.updated_at AS "updatedAt", nc.updated_by AS "updatedBy",
        nc.deleted_at AS "deletedAt",
        jc.code AS "jcCode",
        jo.op_seq AS "jcOpSeqResolved",
        jo.operation AS "jcOpOperation",
        i.code AS "itemCode",
        -- The customer's drawing revision, read live off the SO line behind this
        -- NC's job card. It is display-only: nothing here touches itemCodeText,
        -- which stays the snapshot the reporter typed. Null when the card has no
        -- SO line behind it, and null renders as the bare code. It is NOT
        -- items.revision, which describes the item master -- a wrong revision on
        -- a rejection record is worse than no revision at all.
        --
        -- Cast to text on purpose: the contract types this as a string, and the
        -- column is only text on a database that has had migration 0119. On one
        -- that has not it is still the old integer and would arrive here as a
        -- number wearing a string type. The cast is a no-op once 0119 is in.
        sol.revision::text AS "itemRevision",
        i.name AS "itemName",
        cap.code AS "linkedCapaCode"
      FROM public.nc_register nc
      LEFT JOIN public.job_cards jc
        ON jc.id = nc.job_card_id AND jc.deleted_at IS NULL
      LEFT JOIN public.jc_ops jo
        ON jo.id = nc.jc_op_id AND jo.deleted_at IS NULL
      LEFT JOIN public.items i
        ON i.id = nc.item_id AND i.deleted_at IS NULL
      -- Second hop to the drawing revision. LEFT, and one row per NC (job_cards
      -- has at most one source SO line), so it cannot change which NCs come back
      -- -- the COUNT query below deliberately does not repeat it.
      LEFT JOIN public.sales_order_lines sol
        ON sol.id = jc.source_so_line_id AND sol.deleted_at IS NULL
      -- The rework/repair child card and the return-to-vendor challan, both
      -- one-per-NC FKs, so neither can multiply rows.
      LEFT JOIN public.job_cards cjc
        ON cjc.id = nc.child_job_card_id AND cjc.deleted_at IS NULL
      LEFT JOIN public.delivery_challans dc
        ON dc.id = nc.delivery_challan_id AND dc.deleted_at IS NULL
      LEFT JOIN LATERAL (
        SELECT c.code
        FROM public.capa_records c
        WHERE c.company_id = nc.company_id
          AND c.deleted_at IS NULL
          AND c.nc_refs @> to_jsonb(ARRAY[nc.code])
        ORDER BY c.created_at ASC
        LIMIT 1
      ) cap ON TRUE
      WHERE nc.company_id = ${companyId}::uuid
        AND nc.deleted_at IS NULL
        ${searchFrag}
        ${statusFrag}
        ${reasonFrag}
        ${jcFrag}
        ${fromFrag}
        ${toFrag}
      ORDER BY nc.nc_date DESC, nc.code DESC
      LIMIT ${input.limit} OFFSET ${input.offset}
    `);

    // Total = exactly the rows the query above returns without its LIMIT: same
    // FROM, same joins, the SAME fragment objects. It used to be a Drizzle
    // count() that skipped the search and the dates, which is why the pager
    // offered a page 2 that came back empty — the total was the whole
    // register, not the search. A Drizzle count on nc_register alone cannot
    // express the search (it reads the job card, the op, the item and the
    // linked CAPA code), so the count is raw SQL too and the predicate stays
    // defined once. Every join here is one row per NC (the CAPA lateral is
    // LIMIT 1), so none of them can change the count.
    const totalRows = await tx.execute(sql`
      SELECT COUNT(*)::int AS total
      FROM public.nc_register nc
      LEFT JOIN public.job_cards jc
        ON jc.id = nc.job_card_id AND jc.deleted_at IS NULL
      LEFT JOIN public.jc_ops jo
        ON jo.id = nc.jc_op_id AND jo.deleted_at IS NULL
      LEFT JOIN public.items i
        ON i.id = nc.item_id AND i.deleted_at IS NULL
      LEFT JOIN LATERAL (
        SELECT c.code
        FROM public.capa_records c
        WHERE c.company_id = nc.company_id
          AND c.deleted_at IS NULL
          AND c.nc_refs @> to_jsonb(ARRAY[nc.code])
        ORDER BY c.created_at ASC
        LIMIT 1
      ) cap ON TRUE
      WHERE nc.company_id = ${companyId}::uuid
        AND nc.deleted_at IS NULL
        ${searchFrag}
        ${statusFrag}
        ${reasonFrag}
        ${jcFrag}
        ${fromFrag}
        ${toFrag}
    `);
    const total = Number(
      (totalRows as unknown as Array<Record<string, unknown>>)[0]?.['total'] ?? 0,
    );

    const mapped = (result as unknown as Array<Record<string, unknown>>).map(toListItem);
    const rowsList = showMoney ? mapped : mapped.map(hideNcMoney);
    return { items: rowsList, total, limit: input.limit, offset: input.offset };
  });
}

function toListItem(r: Record<string, unknown>): NcRegisterListItem {
  const str = (k: string): string | null => (r[k] as string | null) ?? null;
  const num = (k: string): string => String(r[k] ?? '0');
  const childJobCardCode = str('childJobCardCode');
  const ledger = {
    status: r['status'] as NcRegister['status'],
    disposition: (r['disposition'] as NcRegister['disposition']) ?? null,
    rejectedQty: r['rejectedQty'] as string,
    clearedQty: num('clearedQty'),
    failedQty: num('failedQty'),
    rtvSentQty: num('rtvSentQty'),
    rtvReceivedQty: num('rtvReceivedQty'),
    reworkOpSeq: r['reworkOpSeq'] != null ? Number(r['reworkOpSeq']) : null,
    deliveryChallanId: str('deliveryChallanId'),
    childJobCardCode,
  };
  return {
    id: r['id'] as string,
    companyId: r['companyId'] as string,
    code: r['code'] as string,
    ncDate: dateLike(r['ncDate']),
    jobCardId: r['jobCardId'] as string,
    jcOpId: (r['jcOpId'] as string | null) ?? null,
    opSeq: r['opSeq'] != null ? Number(r['opSeq']) : null,
    operationText: (r['operationText'] as string | null) ?? null,
    qcOperationText: (r['qcOperationText'] as string | null) ?? null,
    itemId: r['itemId'] as string,
    itemCodeText: r['itemCodeText'] as string,
    itemNameText: (r['itemNameText'] as string | null) ?? null,
    soCodeText: (r['soCodeText'] as string | null) ?? null,
    machineCodeText: (r['machineCodeText'] as string | null) ?? null,
    operatorText: (r['operatorText'] as string | null) ?? null,
    rejectedQty: r['rejectedQty'] as string,
    reasonCategory: r['reasonCategory'] as NcRegister['reasonCategory'],
    reason: (r['reason'] as string | null) ?? null,
    disposition: (r['disposition'] as NcRegister['disposition']) ?? null,
    dispositionDate: maybeDateLike(r['dispositionDate']),
    dispositionByText: (r['dispositionByText'] as string | null) ?? null,
    dispositionRemarks: (r['dispositionRemarks'] as string | null) ?? null,
    reworkJcCodeText: (r['reworkJcCodeText'] as string | null) ?? null,
    reworkOpSeq: r['reworkOpSeq'] != null ? Number(r['reworkOpSeq']) : null,
    reworkDoneQty: (r['reworkDoneQty'] as string | null) ?? null,
    qcLogId: str('qcLogId'),
    grnLineId: str('grnLineId'),
    splitFromNcId: str('splitFromNcId'),
    childJobCardId: str('childJobCardId'),
    childJobCardCode,
    deliveryChallanId: ledger.deliveryChallanId,
    deliveryChallanCode: str('deliveryChallanCode'),
    rtvSentQty: ledger.rtvSentQty,
    rtvReceivedQty: ledger.rtvReceivedQty,
    clearedQty: ledger.clearedQty,
    failedQty: ledger.failedQty,
    closedAt: maybeTsLike(r['closedAt']),
    closedBy: str('closedBy'),
    openQty: ncOpenQty(ledger).toFixed(2),
    closeBlockedReason: ncCloseBlockedReason(ledger),
    scrapCost: r['scrapCost'] as string,
    status: ledger.status,
    reportedByText: (r['reportedByText'] as string | null) ?? null,
    timeLogged: maybeTsLike(r['timeLogged']),
    linkedCapaCode: (r['linkedCapaCode'] as string | null) ?? null,
    createdAt: tsLike(r['createdAt']),
    createdBy: r['createdBy'] as string,
    updatedAt: tsLike(r['updatedAt']),
    updatedBy: r['updatedBy'] as string,
    deletedAt: maybeTsLike(r['deletedAt']),
    jcCode: (r['jcCode'] as string | null) ?? null,
    jcOpSeqResolved: r['jcOpSeqResolved'] != null ? Number(r['jcOpSeqResolved']) : null,
    jcOpOperation: (r['jcOpOperation'] as string | null) ?? null,
    itemCode: (r['itemCode'] as string | null) ?? null,
    itemRevision: (r['itemRevision'] as string | null) ?? null,
    itemName: (r['itemName'] as string | null) ?? null,
  };
}

/** One NC with every join the contract carries. Used by the detail read AND
 *  by every write path's return value, so the row a screen gets back after a
 *  disposition already names the child card / challan it just raised. */
async function readNc(tx: DbTransaction, id: string, companyId: string): Promise<NcRegister> {
  const rows = await tx
    .select({
      nc: ncRegister,
      itemCode: items.code,
      itemName: items.name,
      // Cast to text on purpose: the contract types this as a string, and the
      // column is only text on a database that has had migration 0119. On one
      // that has not it is still the old integer and would arrive here as a
      // number wearing a string type. The cast is a no-op once 0119 is in.
      itemRevision: sql<string | null>`${salesOrderLines.revision}::text`,
      // The child card and the challan live in tables joined by their own FK
      // on the NC row, so both are plain scalar subqueries — no alias juggling
      // on job_cards, which is already joined once for the SO line.
      childJobCardCode: sql<string | null>`(
        SELECT cjc.code FROM public.job_cards cjc
        WHERE cjc.id = ${ncRegister.childJobCardId} AND cjc.deleted_at IS NULL
      )`,
      deliveryChallanCode: sql<string | null>`(
        SELECT dc.code FROM public.delivery_challans dc
        WHERE dc.id = ${ncRegister.deliveryChallanId} AND dc.deleted_at IS NULL
      )`,
    })
    .from(ncRegister)
    // Resolve item code/name from the live items master, not the stale
    // *Text snapshot columns. Mirrors the LIST reader's join (and GRN detail).
    .leftJoin(items, and(eq(items.id, ncRegister.itemId), isNull(items.deletedAt)))
    // Two more LEFT hops for the customer's drawing revision: the NC's job card,
    // then the SO line it was raised against. Both stay LEFT so an NC on a
    // JW-sourced or standalone card still comes back, with a null revision.
    .leftJoin(jobCards, and(eq(jobCards.id, ncRegister.jobCardId), isNull(jobCards.deletedAt)))
    .leftJoin(
      salesOrderLines,
      and(eq(salesOrderLines.id, jobCards.sourceSoLineId), isNull(salesOrderLines.deletedAt)),
    )
    .where(
      and(eq(ncRegister.id, id), eq(ncRegister.companyId, companyId), isNull(ncRegister.deletedAt)),
    )
    .limit(1);
  const found = rows[0];
  if (!found) throw new NotFoundError(`NC ${id} not found`);
  const row = found.nc;
  const linkedCapaCode = await lookupLinkedCapaCode(tx, companyId, row.code);
  return toNcRegister(row, {
    linkedCapaCode,
    itemCode: found.itemCode,
    itemName: found.itemName,
    itemRevision: found.itemRevision,
    childJobCardCode: found.childJobCardCode,
    deliveryChallanCode: found.deliveryChallanCode,
  });
}

export async function getNcRegister(id: string, user: AuthContext): Promise<NcRegister> {
  const companyId = requireCompany(user);
  const showMoney = await canSeeFormPrice(user, 'nc_dispose');
  return withUserContext(user, async (tx) => {
    const nc = await readNc(tx, id, companyId);
    return showMoney ? nc : hideNcMoney(nc);
  });
}

// ─── Related documents (read-only traceability) ────────────────────────────
//
// GET /nc-register/:id/related. Mirrors getSalesOrderRelated: one
// withUserContext transaction, an existence check, then company-scoped +
// soft-delete-filtered subqueries shaped into a DocumentTraceability. Never
// writes.
//
// Upstream (what this NC was raised FROM):
//   - nc_register.job_card_id → job_cards (the JC on the shop floor)
//   - nc_register.item_id     → items [MASTER]
// Downstream (generated from disposition):
//   - job_cards.parent_nc_id = :id  (supplementary / rework JCs)
// Related (soft link — NOT an FK):
//   - capa_records whose nc_refs jsonb array contains this NC's code
export async function getNcRegisterRelated(
  id: string,
  user: AuthContext,
): Promise<DocumentTraceability> {
  const companyId = requireCompany(user);
  return withUserContext(user, async (tx) => {
    const headers = await tx
      .select({
        id: ncRegister.id,
        code: ncRegister.code,
        ncDate: ncRegister.ncDate,
        status: ncRegister.status,
        jobCardId: ncRegister.jobCardId,
        jcOpId: ncRegister.jcOpId,
        opSeq: ncRegister.opSeq,
        itemId: ncRegister.itemId,
        childJobCardId: ncRegister.childJobCardId,
        deliveryChallanId: ncRegister.deliveryChallanId,
        splitFromNcId: ncRegister.splitFromNcId,
      })
      .from(ncRegister)
      .where(
        and(
          eq(ncRegister.id, id),
          eq(ncRegister.companyId, companyId),
          isNull(ncRegister.deletedAt),
        ),
      )
      .limit(1);
    const header = headers[0];
    if (!header) throw new NotFoundError(`NC ${id} not found`);

    const ncPick = {
      id: ncRegister.id,
      code: ncRegister.code,
      status: ncRegister.status,
      date: ncRegister.ncDate,
      rejectedQty: ncRegister.rejectedQty,
    };

    // ── Sibling NCs from a partial disposition (design §3) ──────────────────
    // Either direction: the row this one was split from, and every row split
    // from this one. All still the same rejection event, just different
    // dispositions.
    const siblingRows = await tx
      .select(ncPick)
      .from(ncRegister)
      .where(
        and(
          eq(ncRegister.companyId, companyId),
          isNull(ncRegister.deletedAt),
          header.splitFromNcId
            ? sql`(${ncRegister.id} = ${header.splitFromNcId}::uuid OR ${ncRegister.splitFromNcId} = ${id}::uuid OR (${ncRegister.splitFromNcId} = ${header.splitFromNcId}::uuid AND ${ncRegister.id} <> ${id}::uuid))`
            : eq(ncRegister.splitFromNcId, id),
        ),
      )
      .orderBy(asc(ncRegister.code));

    // ── The rework / repair child card and the NCs raised on it (design §4) ─
    const childRows = header.childJobCardId
      ? await tx
          .select({
            id: jobCards.id,
            code: jobCards.code,
            date: jobCards.jcDate,
            closedAt: jobCards.closedAt,
            recoveryKind: jobCards.recoveryKind,
          })
          .from(jobCards)
          .where(
            and(
              eq(jobCards.id, header.childJobCardId),
              eq(jobCards.companyId, companyId),
              isNull(jobCards.deletedAt),
            ),
          )
          .limit(1)
      : [];
    const child = childRows[0] ?? null;
    const followOnRows = child
      ? await tx
          .select(ncPick)
          .from(ncRegister)
          .where(
            and(
              eq(ncRegister.companyId, companyId),
              isNull(ncRegister.deletedAt),
              eq(ncRegister.jobCardId, child.id),
            ),
          )
          .orderBy(asc(ncRegister.code))
      : [];

    // ── The return-to-vendor challan (design §5) ────────────────────────────
    const dcRows = header.deliveryChallanId
      ? await tx
          .select({
            id: deliveryChallans.id,
            code: deliveryChallans.code,
            status: deliveryChallans.status,
            date: deliveryChallans.dcDate,
            vendorCodeText: deliveryChallans.vendorCodeText,
          })
          .from(deliveryChallans)
          .where(
            and(
              eq(deliveryChallans.id, header.deliveryChallanId),
              eq(deliveryChallans.companyId, companyId),
              isNull(deliveryChallans.deletedAt),
            ),
          )
          .limit(1)
      : [];
    const dc = dcRows[0] ?? null;

    // ── Upstream: the source Job Card ───────────────────────────────────────
    const jcRows = header.jobCardId
      ? await tx
          .select({
            id: jobCards.id,
            code: jobCards.code,
            date: jobCards.jcDate,
            closedAt: jobCards.closedAt,
          })
          .from(jobCards)
          .where(
            and(
              eq(jobCards.id, header.jobCardId),
              eq(jobCards.companyId, companyId),
              isNull(jobCards.deletedAt),
            ),
          )
          .limit(1)
      : [];
    const jc = jcRows[0] ?? null;

    // ── Upstream: the source Item (master) ──────────────────────────────────
    const itemRows = header.itemId
      ? await tx
          .select({ id: items.id, code: items.code, name: items.name })
          .from(items)
          .where(
            and(
              eq(items.id, header.itemId),
              eq(items.companyId, companyId),
              isNull(items.deletedAt),
            ),
          )
          .limit(1)
      : [];
    const item = itemRows[0] ?? null;

    // ── Downstream: rework / supplementary Job Cards created from this NC ────
    const reworkRows = await tx
      .select({
        id: jobCards.id,
        code: jobCards.code,
        date: jobCards.jcDate,
        closedAt: jobCards.closedAt,
      })
      .from(jobCards)
      .where(
        and(
          eq(jobCards.companyId, companyId),
          isNull(jobCards.deletedAt),
          eq(jobCards.parentNcId, id),
        ),
      )
      .orderBy(desc(jobCards.jcDate));

    // ── Related: CAPA records referencing this NC's code ────────────────────
    // Soft link only — capa_records.nc_refs is a jsonb text-array, not an FK.
    // Same @> containment pattern as lookupLinkedCapaCode above. CAPA has no
    // detail route → routeKind null (reference-only rows).
    const capaRows = await tx
      .select({
        id: capaRecords.id,
        code: capaRecords.code,
        status: capaRecords.status,
        date: capaRecords.capaDate,
      })
      .from(capaRecords)
      .where(
        and(
          eq(capaRecords.companyId, companyId),
          isNull(capaRecords.deletedAt),
          sql`${capaRecords.ncRefs} @> ${JSON.stringify([header.code])}::jsonb`,
        ),
      )
      .orderBy(asc(capaRecords.code));

    const row = (
      id_: string,
      code: string,
      status: string | null,
      date: unknown,
      extra?: { linkId?: string; label?: string },
    ): RelatedDoc => ({
      id: id_,
      code,
      status,
      date: toIsoDate(date),
      linkId: extra?.linkId ?? null,
      label: extra?.label ?? null,
    });

    // ── Upstream sections ───────────────────────────────────────────────────
    const jobCardSection = section(
      'job-card',
      'Job Card',
      '📋',
      'job-card',
      // Plain header FK → link by the JC's own id (linkId null). job_cards has
      // no status column; derive closed/open from closed_at. If the NC pins a
      // specific op, surface its seq as the row label.
      jc
        ? [
            row(jc.id, jc.code, jc.closedAt ? 'closed' : 'open', jc.date, {
              ...(header.jcOpId && header.opSeq != null ? { label: `Op${header.opSeq}` } : {}),
            }),
          ]
        : [],
    );
    const itemSection = section(
      'item',
      'Item',
      '📦',
      'item',
      item ? [row(item.id, item.code, null, null, { label: item.name })] : [],
    );

    // ── Downstream sections ─────────────────────────────────────────────────
    // The rework/repair child is listed by name first; the parent_nc_id scan
    // below (make_fresh supplementaries, and the child again) is filtered so
    // the same card is not shown twice.
    const recoverySection = section(
      'recovery-jc',
      child?.recoveryKind === 'repair' ? 'Repair Job Card' : 'Rework Job Card',
      '🔧',
      'job-card',
      child ? [row(child.id, child.code, child.closedAt ? 'closed' : 'open', child.date)] : [],
    );
    const reworkSection = section(
      'rework-jc',
      'Rework Job Cards',
      '📋',
      'job-card',
      reworkRows
        .filter((r) => r.id !== child?.id)
        .map((r) => row(r.id, r.code, r.closedAt ? 'closed' : 'open', r.date)),
    );
    const dcSection = section(
      'return-dc',
      'Return-to-Vendor Challan',
      '🚚',
      'delivery-challan',
      dc ? [row(dc.id, dc.code, dc.status, dc.date, { label: dc.vendorCodeText })] : [],
    );
    const followOnSection = section(
      'follow-on-nc',
      'NCs raised on the recovery card',
      '⚠',
      'nc',
      followOnRows.map((r) =>
        row(r.id, r.code, r.status, r.date, { label: `${r.rejectedQty} pcs` }),
      ),
    );

    // ── Related sections (lateral soft links) ───────────────────────────────
    const siblingSection = section(
      'sibling-nc',
      'Split NCs (same rejection)',
      '⚠',
      'nc',
      siblingRows.map((r) =>
        row(r.id, r.code, r.status, r.date, { label: `${r.rejectedQty} pcs` }),
      ),
    );
    const capaSection = section(
      'capa',
      'CAPA (referenced)',
      '🛡',
      null,
      capaRows.map((r) => row(r.id, r.code, r.status, r.date)),
    );

    const upstream = [jobCardSection, itemSection];
    const downstream = [recoverySection, reworkSection, dcSection, followOnSection];
    const related = [siblingSection, capaSection];
    return {
      self: { module: 'nc-register', code: header.code },
      upstream,
      downstream,
      related,
      timeline: buildTimeline(
        {
          ts: toIsoDate(header.ncDate),
          label: 'NC raised',
          code: header.code,
          routeKind: 'nc',
          linkId: id,
        },
        [...upstream, ...downstream],
      ),
    };
  });
}

// ─── Summary (company-wide stat cards — legacy HTML L22508-22519) ───────────

export async function getNcRegisterSummary(user: AuthContext): Promise<NcRegisterSummary> {
  const companyId = requireCompany(user);
  return withUserContext(user, async (tx) => {
    const result = await tx.execute(sql`
      SELECT
        COUNT(*)::int AS "total",
        COUNT(*) FILTER (WHERE status = 'pending')::int AS "pending",
        COALESCE(SUM(rejected_qty), 0)::float8 AS "totalQty",
        COALESCE(SUM(rejected_qty) FILTER (WHERE disposition = 'rework'), 0)::float8 AS "reworkQty",
        COALESCE(SUM(rejected_qty) FILTER (WHERE disposition = 'scrap'), 0)::float8 AS "scrapQty"
      FROM public.nc_register
      WHERE company_id = ${companyId}::uuid
        AND deleted_at IS NULL
    `);
    const row = (result as unknown as Array<Record<string, unknown>>)[0] ?? {};
    return {
      total: Number(row['total'] ?? 0),
      pending: Number(row['pending'] ?? 0),
      totalQty: Number(row['totalQty'] ?? 0),
      reworkQty: Number(row['reworkQty'] ?? 0),
      scrapQty: Number(row['scrapQty'] ?? 0),
    };
  });
}

// ─── Writes ───────────────────────────────────────────────────────────────

export async function createNcRegister(
  input: CreateNcRegisterInput,
  user: AuthContext,
): Promise<NcRegister> {
  requireOpEntryRole(user);
  // ADR-035: the role guard alone let anyone with a write role raise an NC even
  // when their QC department tier is L1 (view-only). Reporting an NC is a
  // create, so it needs `entry` on NC Register. Admins bypass; the matrix can
  // only narrow what the role already allows.
  await requireFormAccess(user, 'nc_dispose', 'entry');
  const companyId = requireCompany(user);

  return withUserContext(user, async (tx) => {
    const dup = await tx
      .select({ id: ncRegister.id })
      .from(ncRegister)
      .where(
        and(
          eq(ncRegister.companyId, companyId),
          eq(ncRegister.code, input.code),
          isNull(ncRegister.deletedAt),
        ),
      )
      .limit(1);
    if (dup.length > 0) {
      throw new ConflictError(`NC code "${input.code}" already exists`);
    }

    await assertJobCardExists(tx, input.jobCardId, companyId);
    await assertItemExists(tx, input.itemId, companyId);
    if (input.jcOpId) await assertJcOpExists(tx, input.jcOpId, companyId);

    // Snapshot itemCodeText from the items row so the durable text matches the
    // master at creation time. Same pattern as legacy auto-NC capture.
    const itemCode = await getItemCode(tx, input.itemId, companyId);

    const inserted = await tx
      .insert(ncRegister)
      .values({
        companyId,
        code: input.code,
        ncDate: input.ncDate,
        jobCardId: input.jobCardId,
        jcOpId: input.jcOpId ?? null,
        opSeq: input.opSeq ?? null,
        operationText: input.operationText ?? null,
        qcOperationText: input.qcOperationText ?? null,
        itemId: input.itemId,
        itemCodeText: itemCode ?? '',
        itemNameText: input.itemNameText ?? null,
        soCodeText: input.soCodeText ?? null,
        machineCodeText: input.machineCodeText ?? null,
        operatorText: input.operatorText ?? null,
        rejectedQty: input.rejectedQty.toFixed(2),
        reasonCategory: input.reasonCategory,
        reason: input.reason ?? null,
        // Disposition fields stay null until T-040b's dispose action.
        status: 'pending',
        reportedByText: input.reportedByText ?? null,
        timeLogged: new Date(),
        createdBy: user.id,
        updatedBy: user.id,
      })
      .returning();
    const row = inserted[0]!;
    await emitActivityLog(
      tx,
      {
        action: 'CREATE',
        entity: 'NonConformance',
        detail: ncDetail(row.code, row.itemCodeText, row.rejectedQty),
        refId: row.code,
      },
      companyId,
      user,
    );
    return toNcRegister(row);
  });
}

export async function updateNcRegister(
  id: string,
  input: UpdateNcRegisterInput,
  user: AuthContext,
): Promise<NcRegister> {
  requireOpEntryRole(user);
  // Changing a saved NC is `edit`, not `entry` — an L2 Data Entry hand may
  // raise an NC but must not go back and rewrite the reason on one.
  await requireFormAccess(user, 'nc_dispose', 'edit');
  const companyId = requireCompany(user);

  return withUserContext(user, async (tx) => {
    const existing = await tx
      .select({ id: ncRegister.id, status: ncRegister.status })
      .from(ncRegister)
      .where(
        and(
          eq(ncRegister.id, id),
          eq(ncRegister.companyId, companyId),
          isNull(ncRegister.deletedAt),
        ),
      )
      .limit(1);
    if (existing.length === 0) {
      throw new NotFoundError(`NC ${id} not found`);
    }
    if (existing[0]!.status !== 'pending') {
      throw new ConflictError(
        `NC ${id} is ${existing[0]!.status} — only pending NCs can be edited (use disposition workflow for closed NCs)`,
      );
    }

    const updates: Record<string, unknown> = { updatedBy: user.id };
    if (input.ncDate !== undefined) updates['ncDate'] = input.ncDate;
    if (input.reasonCategory !== undefined) updates['reasonCategory'] = input.reasonCategory;
    if (input.reason !== undefined) updates['reason'] = input.reason ?? null;
    if (input.reportedByText !== undefined)
      updates['reportedByText'] = input.reportedByText ?? null;
    if (input.operatorText !== undefined) updates['operatorText'] = input.operatorText ?? null;

    await tx.update(ncRegister).set(updates).where(eq(ncRegister.id, id));

    const reread = await tx.select().from(ncRegister).where(eq(ncRegister.id, id)).limit(1);
    const row = reread[0]!;
    await emitActivityLog(
      tx,
      {
        action: 'EDIT',
        entity: 'NonConformance',
        detail: ncDetail(row.code, row.itemCodeText, row.rejectedQty),
        refId: row.code,
      },
      companyId,
      user,
    );
    return toNcRegister(row);
  });
}

// ─── Dispose (T-040b, reshaped for design §1–§4) ─────────────────────────

async function resolveUserName(tx: DbTransaction, userId: string): Promise<string> {
  const rows = await tx
    .select({ email: users.email })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  // users table has email but no name field — use email's local part as the
  // user-facing name (matches the existing seed admin pattern).
  const email = rows[0]?.email ?? '';
  const localPart = email.split('@')[0];
  return localPart && localPart.length > 0 ? localPart : email;
}

export async function disposeNcRegister(
  id: string,
  input: DisposeNcInput,
  user: AuthContext,
): Promise<DisposeNcResult> {
  requireOpEntryRole(user);
  // Disposition decides scrap vs rework and moves stock — it rewrites a saved
  // NC, so it is `edit` (L3 Editor and above), never `entry`. Scrap carries a
  // second, `approve` gate inside the cascade (§3).
  await requireFormAccess(user, 'nc_dispose', 'edit');
  const companyId = requireCompany(user);

  return withUserContext(user, async (tx) => {
    const userName = await resolveUserName(tx, user.id);
    const ctx: DisposeNcContext = { companyId, userId: user.id, userName, user };
    const result = await disposeNcCascade(tx, id, input, ctx);
    const nc = await readNc(tx, id, companyId);
    // Detail captures the disposition action, the qty it covered, and the key
    // side-effect (child card, supplementary JC, sibling, scrap cost).
    const parts: string[] = [];
    if (result.remainderNcCode) parts.push(`remainder ${result.remainderNcCode}`);
    if (result.childJcCode) parts.push(`${input.action} JC ${result.childJcCode}`);
    if (input.action === 'make_fresh' && result.newJcCode)
      parts.push(`supplementary JC ${result.newJcCode}`);
    if (input.action === 'scrap' && input.scrapCost !== undefined)
      parts.push(`scrapCost=${input.scrapCost}`);
    const sideEffect = parts.length > 0 ? `; ${parts.join('; ')}` : '';
    await emitActivityLog(
      tx,
      {
        action: 'NC_DISPOSE',
        entity: 'NonConformance',
        detail: `${nc.code} — ${input.action.toUpperCase()} qty=${result.qty}${sideEffect}`,
        refId: nc.code,
      },
      companyId,
      user,
    );
    // A card raised inside the cascade gets its own CREATE row keyed by its
    // code, so the JC filter shows the creation event instead of starting
    // empty. NC_DISPOSE above already mentions the code in passing.
    if (result.childJcCode) {
      const label = input.action === 'repair' ? 'Repair' : 'Rework';
      await emitActivityLog(
        tx,
        {
          action: 'CREATE',
          entity: 'JobCard',
          detail: `${result.childJcCode} — ${label} for ${nc.code} (${result.qty} pcs)`,
          refId: result.childJcCode,
        },
        companyId,
        user,
      );
    }
    if (input.action === 'make_fresh' && result.newJcCode) {
      await emitActivityLog(
        tx,
        {
          action: 'CREATE',
          entity: 'JobCard',
          detail: `${result.newJcCode} — Supplementary for ${nc.code} (${result.qty} pcs)`,
          refId: result.newJcCode,
        },
        companyId,
        user,
      );
    }
    const remainderNc = result.remainderNcId
      ? await readNc(tx, result.remainderNcId, companyId)
      : null;
    return {
      nc,
      remainderNc,
      childJobCardId: result.childJcId ?? null,
      childJobCardCode: result.childJcCode ?? null,
    };
  });
}

// ─── Close (design §3 closure gate, Flow 9) ───────────────────────────────

/**
 * The one way an NC reaches `closed` by hand. Refuses with the gate's exact
 * shortfall as a ConflictError; otherwise stamps closed_at/by and audits
 * NC_CLOSE. The automatic closes (recovery.ts, from a QC write) bypass this
 * because they have just made the gate true themselves.
 *
 * `reworkDoneQty` is the legacy in-route rework figure (closeNcRework); it is
 * recorded when supplied and ignored otherwise.
 */
export async function closeNc(
  id: string,
  user: AuthContext,
  opts: { reworkDoneQty?: number | undefined; via?: string | undefined } = {},
): Promise<NcRegister> {
  requireOpEntryRole(user);
  // Closing changes an already-disposed NC — `edit`.
  await requireFormAccess(user, 'nc_dispose', 'edit');
  const companyId = requireCompany(user);

  return withUserContext(user, async (tx) => {
    const before = await readNc(tx, id, companyId);
    if (before.status === 'closed') {
      throw new ConflictError(`NC ${before.code} is already closed`);
    }
    const reason = ncCloseBlockedReason(before);
    if (reason) throw new ConflictError(reason);

    const extra: Record<string, unknown> = {};
    const done = opts.reworkDoneQty;
    if (done != null && Number.isFinite(done) && done >= 0) {
      extra['reworkDoneQty'] = done.toFixed(2);
    }
    await markNcClosed(tx, id, user, extra);
    const after = await readNc(tx, id, companyId);
    await emitActivityLog(
      tx,
      {
        action: 'NC_CLOSE',
        entity: 'NonConformance',
        detail:
          `${after.code} — CLOSED${opts.via ? ` (${opts.via})` : ''} ` +
          `qty=${after.rejectedQty} cleared=${after.clearedQty} failed=${after.failedQty}` +
          (done != null ? ` reworkDone=${done}` : ''),
        refId: after.code,
      },
      companyId,
      user,
    );
    return after;
  });
}

/** Legacy route: POST /nc-register/:id/close-rework. Same gate as closeNc;
 *  the only thing it adds is the rework_done_qty figure for the audit record.
 *  Still refuses an NC that is not on a rework path, as it always has. */
export async function closeNcRework(
  id: string,
  input: CloseNcReworkInput,
  user: AuthContext,
): Promise<NcRegister> {
  const companyId = requireCompany(user);
  const nc = await withUserContext(user, (tx) => readNc(tx, id, companyId));
  if (nc.disposition !== 'rework' && nc.disposition !== 'repair') {
    throw new ConflictError(
      `NC ${nc.code} is not on a rework path (disposition=${nc.disposition ?? 'null'})`,
    );
  }
  return closeNc(id, user, { reworkDoneQty: input.reworkDoneQty, via: 'rework' });
}

/** Legacy route: POST /nc-register/:id/close-return. Same gate as closeNc —
 *  which for a return-to-vendor NC means the challan has been issued, every
 *  piece has come back and Incoming QC has passed judgement on all of them. */
export async function closeNcReturnToVendor(id: string, user: AuthContext): Promise<NcRegister> {
  const companyId = requireCompany(user);
  const nc = await withUserContext(user, (tx) => readNc(tx, id, companyId));
  if (nc.disposition !== 'return_to_vendor') {
    throw new ConflictError(
      `NC ${nc.code} is not on a return-to-vendor path (disposition=${nc.disposition ?? 'null'})`,
    );
  }
  return closeNc(id, user, { via: 'return to vendor' });
}

// ─── Create the return-to-vendor challan (design §5) ──────────────────────

/** The PO line's received figure, for the before/after audit around a recalc. */
async function readPoLineReceived(
  tx: DbTransaction,
  poLineId: string,
): Promise<{ receivedQty: number; lineNo: number } | undefined> {
  const rows = await tx
    .select({ receivedQty: purchaseOrderLines.receivedQty, lineNo: purchaseOrderLines.lineNo })
    .from(purchaseOrderLines)
    .where(eq(purchaseOrderLines.id, poLineId))
    .limit(1);
  return rows[0];
}

/** Next IN-DC-NNNNN/R1 for the company. A local copy of
 *  delivery-challans/service.ts nextDcCode, which is not exported: highest
 *  numeric suffix + 1, five digits, tolerating and ignoring a `/R<n>` tail so
 *  a revised challan keeps its running number. Kept identical on purpose —
 *  an NC challan and a PO challan share one number series. */
async function nextNcDcCode(tx: DbTransaction, companyId: string): Promise<string> {
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

/**
 * Issue the challan that sends a return-to-vendor NC's pieces back. One
 * transaction: DC header + one line, the NC's rtv ledger, and — when the
 * origin op was an outsource op with a PO line — the §12.2 PO received-qty
 * adjustment, so the PO no longer counts pieces that have left the shop.
 *
 * There is no purchase order behind this challan: po_code_text carries the NC
 * code, and the existing PO-line cumulative-sent guard is not applied.
 */
export async function createNcDc(
  id: string,
  input: CreateNcDcInput,
  user: AuthContext,
): Promise<CreateNcDcResult> {
  requireOpEntryRole(user);
  // Two gates: it rewrites the NC (edit on NC Register) AND it raises an
  // outward challan (entry on OSP DC & Outward).
  await requireFormAccess(user, 'nc_dispose', 'edit');
  await requireFormAccess(user, 'ospdc_create', 'entry');
  const companyId = requireCompany(user);

  return withUserContext(user, async (tx) => {
    const ncRows = await tx
      .select()
      .from(ncRegister)
      .where(
        and(
          eq(ncRegister.id, id),
          eq(ncRegister.companyId, companyId),
          isNull(ncRegister.deletedAt),
        ),
      )
      .limit(1);
    const nc = ncRows[0];
    if (!nc) throw new NotFoundError(`NC ${id} not found`);
    if (nc.disposition !== 'return_to_vendor') {
      throw new ConflictError(
        `NC ${nc.code} is not on a return-to-vendor path (disposition=${nc.disposition ?? 'null'})`,
      );
    }
    if (nc.status !== 'disposed') {
      throw new ConflictError(
        `NC ${nc.code} is ${nc.status} — a challan can only be raised while it is disposed`,
      );
    }
    if (nc.deliveryChallanId) {
      throw new ConflictError(`NC ${nc.code} already has a return-to-vendor challan`);
    }

    if (input.vendorId) {
      const v = await tx
        .select({ id: vendors.id })
        .from(vendors)
        .where(
          and(
            eq(vendors.id, input.vendorId),
            eq(vendors.companyId, companyId),
            isNull(vendors.deletedAt),
          ),
        )
        .limit(1);
      if (v.length === 0) throw new ValidationError(`Vendor ${input.vendorId} not found`);
    }

    // The parent card supplies the SO line; the item master the uom the line
    // needs; the origin op tells us whether a PO line is involved.
    const jcRows = await tx
      .select({ sourceSoLineId: jobCards.sourceSoLineId })
      .from(jobCards)
      .where(and(eq(jobCards.id, nc.jobCardId), eq(jobCards.companyId, companyId)))
      .limit(1);
    const itemRows = await tx
      .select({ code: items.code, name: items.name, uom: items.uom })
      .from(items)
      .where(and(eq(items.id, nc.itemId), eq(items.companyId, companyId)))
      .limit(1);
    const item = itemRows[0];
    const originRows = nc.jcOpId
      ? await tx
          .select({ opType: jcOps.opType, outsourcePoLineId: jcOps.outsourcePoLineId })
          .from(jcOps)
          .where(and(eq(jcOps.id, nc.jcOpId), eq(jcOps.companyId, companyId)))
          .limit(1)
      : [];
    const origin = originRows[0];
    const poLineId =
      origin && (origin.opType === 'outsource' || origin.outsourcePoLineId)
        ? (origin.outsourcePoLineId ?? null)
        : null;

    const qty = Math.round(Number(nc.rejectedQty));
    const code = await nextNcDcCode(tx, companyId);
    const reason = `Return to vendor — ${nc.dispositionRemarks ?? 'rework'}`;

    const insertedDc = await tx
      .insert(deliveryChallans)
      .values({
        companyId,
        code,
        dcDate: input.dcDate,
        purchaseOrderId: null,
        poCodeText: nc.code,
        vendorId: input.vendorId ?? null,
        vendorCodeText: input.vendorCodeText,
        salesOrderLineId: jcRows[0]?.sourceSoLineId ?? null,
        soRefText: nc.soCodeText,
        transport: input.transport ?? null,
        vehicleNo: input.vehicleNo ?? null,
        status: 'issued',
        ncId: nc.id,
        jobCardId: nc.jobCardId,
        reason,
        createdBy: user.id,
        updatedBy: user.id,
      })
      .returning({ id: deliveryChallans.id, code: deliveryChallans.code });
    const dc = insertedDc[0];
    if (!dc) throw new ValidationError('Failed to create the return-to-vendor challan');

    await tx.insert(deliveryChallanLines).values({
      companyId,
      deliveryChallanId: dc.id,
      lineNo: 1,
      itemId: nc.itemId,
      itemCodeText: item?.code ?? nc.itemCodeText,
      itemNameText: item?.name ?? nc.itemNameText,
      qty: qty.toFixed(2),
      uom: item?.uom ?? 'NOS',
      materialText: null,
      // The NC code is always the line remark so the challan print names the
      // rejection it serves; a note typed on the form is appended, not substituted.
      dcRemarks: input.remarks ? `${nc.code} — ${input.remarks}` : nc.code,
      purchaseOrderLineId: poLineId,
      createdBy: user.id,
      updatedBy: user.id,
    });

    await tx
      .update(ncRegister)
      .set({
        rtvSentQty: qty.toFixed(2),
        deliveryChallanId: dc.id,
        status: 'sent_to_vendor',
        updatedBy: user.id,
      })
      .where(eq(ncRegister.id, nc.id));

    // §12.2 — the pieces are leaving, so the PO line no longer counts them as
    // received. NOT an in-place "-= qty": purchase_order_lines.received_qty is
    // recomputed from scratch by recalcPoLineReceivedQty every time any GRN on
    // the line moves, so an adjustment written here would be overwritten by
    // the very next receipt. The return-to-vendor term lives inside that
    // formula instead (goods-receipt-notes/cascades.ts) and reads this NC's
    // delivery_challan_id, which was set just above -- so recomputing now is
    // what applies the subtraction. The audit row records the before/after.
    if (poLineId) {
      const before = await readPoLineReceived(tx, poLineId);
      await recalcPoLineReceivedQty(tx, poLineId, user.id);
      const after = await readPoLineReceived(tx, poLineId);
      if (before && after) {
        await emitActivityLog(
          tx,
          {
            action: 'PO_RECEIVED_ADJUST',
            entity: 'PurchaseOrderLine',
            detail:
              `PO line ${before.lineNo} received_qty ${before.receivedQty} → ${after.receivedQty} ` +
              `(${qty} returned to vendor on ${dc.code} for ${nc.code})`,
            refId: nc.code,
          },
          companyId,
          user,
        );
      }
    }

    await emitActivityLog(
      tx,
      {
        action: 'NC_CREATE_DC',
        entity: 'NonConformance',
        detail: `${nc.code} — ${dc.code} issued to ${input.vendorCodeText}, ${qty} pcs`,
        refId: nc.code,
      },
      companyId,
      user,
    );

    return {
      nc: await readNc(tx, nc.id, companyId),
      deliveryChallanId: dc.id,
      deliveryChallanCode: dc.code,
    };
  });
}

export async function softDeleteNcRegister(id: string, user: AuthContext): Promise<{ ok: true }> {
  requireOpEntryRole(user);
  // Delete is not one of the four tier actions, so it is expressed as the pair
  // that only L5 Department Admin and above hold: edit AND approve. L3 Editor
  // has edit but not approve; L4 Approver has approve but not edit.
  await requireFormAccess(user, 'nc_dispose', 'edit');
  await requireFormAccess(user, 'nc_dispose', 'approve');
  const companyId = requireCompany(user);

  return withUserContext(user, async (tx) => {
    const existing = await tx
      .select({
        id: ncRegister.id,
        code: ncRegister.code,
        itemCodeText: ncRegister.itemCodeText,
        rejectedQty: ncRegister.rejectedQty,
        status: ncRegister.status,
      })
      .from(ncRegister)
      .where(
        and(
          eq(ncRegister.id, id),
          eq(ncRegister.companyId, companyId),
          isNull(ncRegister.deletedAt),
        ),
      )
      .limit(1);
    const row = existing[0];
    if (!row) {
      throw new NotFoundError(`NC ${id} not found`);
    }
    if (row.status !== 'pending') {
      throw new ConflictError(
        `NC ${id} is ${row.status} — disposed/closed NCs are permanent records and cannot be deleted`,
      );
    }
    await tx
      .update(ncRegister)
      .set({ deletedAt: new Date(), updatedBy: user.id })
      .where(eq(ncRegister.id, id));
    await emitActivityLog(
      tx,
      {
        action: 'DELETE',
        entity: 'NonConformance',
        detail: ncDetail(row.code, row.itemCodeText, row.rejectedQty),
        refId: row.code,
      },
      companyId,
      user,
    );
    return { ok: true };
  });
}
