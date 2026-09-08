// Purchase Requests service (T-036a).
//
// Single-table per ADR-015 #2. Mirrors the legacy `addPR` / approval flow but
// keeps approvals + PO-creation as separate service-layer actions (not in the
// generic update path). Status flow: open → approved → po_created (or
// cancelled). Only the basic field updates land here in T-036a; the approve
// + create-PO actions ship in T-036b alongside the PO module.

import { type SQL, type SQLWrapper, and, eq, inArray, isNull, or, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import type { DocumentTraceability, RelatedDoc } from '@innovic/shared';
import {
  items,
  jcOps,
  jobCards,
  planOps,
  plans,
  purchaseOrders,
  purchaseRequests,
  salesOrderLines,
  salesOrders,
  vendors,
} from '../../db/schema';
import { type AuthContext, type DbTransaction, withUserContext } from '../../db/with-user-context';
import { assertNotSelfApproval, canSeeFormPrice, requireFormAccess } from '../../lib/access';
import {
  AuthorizationError,
  ConflictError,
  NotFoundError,
  ValidationError,
} from '../../lib/errors';
import { buildTimeline, section, toIsoDate } from '../../lib/traceability';
import { emitActivityLog } from '../activity-log/service';
import { nextSeriesCode } from '../op-entry/osp-cascade';
import type {
  ClosePurchaseRequestBalanceInput,
  CreatePurchaseRequestInput,
  ListPurchaseRequestsQuery,
  ListPurchaseRequestsResponse,
  PurchaseRequest,
  PurchaseRequestDetail,
  PurchaseRequestListItem,
  UpdatePurchaseRequestInput,
} from './schema';

const requireCompany = (user: AuthContext): string => {
  if (!user.companyId) throw new AuthorizationError('User is not assigned to a company');
  return user.companyId;
};

function prDetail(
  code: string,
  itemName: string | null | undefined,
  itemCodeText: string | null | undefined,
  qty: number,
): string {
  const label = itemName ?? itemCodeText ?? '—';
  return `${code} — ${label} x ${qty}`;
}

// ─── FK validation helpers ────────────────────────────────────────────────

async function assertVendorExists(
  tx: DbTransaction,
  vendorId: string,
  companyId: string,
): Promise<void> {
  const rows = await tx
    .select({ id: vendors.id })
    .from(vendors)
    .where(
      and(eq(vendors.id, vendorId), eq(vendors.companyId, companyId), isNull(vendors.deletedAt)),
    )
    .limit(1);
  if (rows.length === 0) {
    throw new ValidationError(`Vendor ${vendorId} not found in this company`);
  }
}

/**
 * Resolve a vendor id to its master `code`, upper-cased and trimmed.
 *
 * ADR-015 vendor is FK-or-text: a PR carries EITHER `vendor_id` OR the vendor's
 * code as free text in `vendor_code_text`. Every PR in production today is the
 * text half (vendor_id NULL, vendor_code_text 'VND-...'), so a list filter on
 * the FK alone matched nothing. Resolved ONCE per list call so the where-clause
 * stays a plain column comparison instead of a per-row join.
 *
 * A miss returns null and the caller keeps FK-only behaviour — a list filter
 * must not throw on an unknown id.
 */
async function resolveVendorCode(
  tx: DbTransaction,
  vendorId: string,
  companyId: string,
): Promise<string | null> {
  const rows = await tx
    .select({ code: vendors.code })
    .from(vendors)
    .where(
      and(eq(vendors.id, vendorId), eq(vendors.companyId, companyId), isNull(vendors.deletedAt)),
    )
    .limit(1);
  const code = rows[0]?.code?.trim();
  return code ? code.toUpperCase() : null;
}

async function assertItemExists(
  tx: DbTransaction,
  itemId: string,
  companyId: string,
): Promise<void> {
  const rows = await tx
    .select({ id: items.id })
    .from(items)
    .where(and(eq(items.id, itemId), eq(items.companyId, companyId), isNull(items.deletedAt)))
    .limit(1);
  if (rows.length === 0) {
    throw new ValidationError(`Item ${itemId} not found in this company`);
  }
}

/**
 * Resolve a free-text item code to its Item Master row.
 *
 * A PR may legitimately be raised for something the master has never heard of
 * (the DB CHECK accepts a bare code), so a miss is NOT an error — it just
 * leaves item_id null. But when the code DOES match a master item, the link
 * must be stamped: item_id is what the whole downstream chain keys on, and a
 * GRN line without it can never credit stock (creditGrnQcStock returns early
 * on `!itemId`). Server-side so every caller is covered, not just the PR form.
 */
async function resolveItemIdByCode(
  tx: DbTransaction,
  code: string,
  companyId: string,
): Promise<string | null> {
  const trimmed = code.trim();
  if (!trimmed) return null;
  const rows = await tx
    .select({ id: items.id })
    .from(items)
    .where(and(eq(items.code, trimmed), eq(items.companyId, companyId), isNull(items.deletedAt)))
    .limit(1);
  return rows[0]?.id ?? null;
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

async function assertSoLineExists(
  tx: DbTransaction,
  soLineId: string,
  companyId: string,
): Promise<void> {
  const rows = await tx
    .select({ id: salesOrderLines.id })
    .from(salesOrderLines)
    .where(
      and(
        eq(salesOrderLines.id, soLineId),
        eq(salesOrderLines.companyId, companyId),
        isNull(salesOrderLines.deletedAt),
      ),
    )
    .limit(1);
  if (rows.length === 0) {
    throw new ValidationError(`SO line ${soLineId} not found in this company`);
  }
}

function estCostToString(input: number | undefined): string {
  return (input ?? 0).toFixed(2);
}

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

function toPurchaseRequest(
  row: typeof purchaseRequests.$inferSelect,
  orderedQty: number,
): PurchaseRequest {
  return {
    id: row.id,
    companyId: row.companyId,
    code: row.code,
    prDate: row.prDate,
    status: row.status,
    prType: row.prType,
    vendorId: row.vendorId,
    vendorCodeText: row.vendorCodeText,
    itemId: row.itemId,
    itemCodeText: row.itemCodeText,
    itemName: row.itemName,
    qty: row.qty,
    estCost: row.estCost,
    requiredDate: row.requiredDate,
    sourceJcOpId: row.sourceJcOpId,
    sourceSoLineId: row.sourceSoLineId,
    operation: row.operation,
    remarks: row.remarks,
    approvedBy: row.approvedBy,
    approvedAt: maybeTsLike(row.approvedAt),
    poId: row.poId,
    poCreatedAt: maybeTsLike(row.poCreatedAt),
    orderedQty,
    balanceQty: deriveBalanceQty({
      qty: row.qty,
      orderedQty,
      balanceClosed: row.balanceClosedAt != null,
    }),
    balanceClosedAt: maybeTsLike(row.balanceClosedAt),
    balanceClosedBy: row.balanceClosedBy,
    balanceClosedReason: row.balanceClosedReason,
    createdAt: tsLike(row.createdAt),
    createdBy: row.createdBy,
    updatedAt: tsLike(row.updatedAt),
    updatedBy: row.updatedBy,
    deletedAt: maybeTsLike(row.deletedAt),
  };
}

// ─── Ordered / balance quantity (ADR-152, phase 1) ────────────────────────
//
// "Does this PR have a PO?" used to be a BOOLEAN — `purchase_requests.po_id`
// plus `status = 'po_created'`. A PR for 100 covered by a PO for 10 therefore
// counted as finished, the remaining 90 became unorderable, and cancelling
// that PO released nothing because no code path ever wrote the status back.
//
// The quantity is now DERIVED on every read from the PO lines themselves, so
// there is no stored figure to keep in sync: cancel the PO and its quantity
// returns to the balance on its own.
//
// Tenancy: both subqueries are correlated to a `purchase_requests` row that the
// caller's own WHERE clause has already scoped to the company, and
// `purchase_order_lines.source_pr_id` is a foreign key to that same row — so no
// other company's rows are reachable through them.

/** Quantity of this PR that sits on a LIVE purchase order: the sum of the PO
 *  lines raised from it, ignoring deleted lines, deleted POs and CANCELLED POs.
 *  Excluding cancelled POs is what makes a cancelled PO give its quantity back. */
function liveOrderedQtySql(prIdRef: SQLWrapper): SQL<number> {
  return sql<number>`(
    SELECT COALESCE(SUM(pol.qty), 0)::int
    FROM public.purchase_order_lines pol
    JOIN public.purchase_orders p2 ON p2.id = pol.purchase_order_id
    WHERE pol.source_pr_id = ${prIdRef}
      AND pol.deleted_at IS NULL
      AND p2.deleted_at IS NULL
      AND p2.status <> 'cancelled'
  )`;
}

/** How many PO lines point at this PR AT ALL — no PO-status condition. Used
 *  only to tell "never ordered" apart from "ordered, then cancelled". */
function linkedLineCountSql(prIdRef: SQLWrapper): SQL<number> {
  return sql<number>`(
    SELECT COUNT(*)::int
    FROM public.purchase_order_lines pol
    WHERE pol.source_pr_id = ${prIdRef}
      AND pol.deleted_at IS NULL
  )`;
}

/**
 * The one place the ordered quantity is decided. Used by the list, the detail
 * read and the edit/reject guards so all four can never disagree.
 */
function deriveOrderedQty(input: {
  qty: number;
  poId: string | null;
  liveOrderedQty: number;
  linkedLineCount: number;
}): number {
  // LEGACY RULE — do not remove.
  //
  // Three production PRs (IN-JWPR-00001 / 00002 / 00003) carry a header `po_id`
  // but have ZERO linked PO lines, because migration 0103 added
  // `purchase_order_lines.source_pr_id` and deliberately did NOT backfill it.
  // Counting lines alone would report those three as 0 ordered, put them back in
  // the PO form's PR picker as if nothing had ever been bought, and invite a
  // duplicate PO for material that is already on order. So a PR that has a
  // header PO but no lines is treated as FULLY ordered: it stays closed, exactly
  // as the user asked, and is never offered again.
  if (input.poId !== null && input.linkedLineCount === 0) return input.qty;
  return input.liveOrderedQty;
}

/** Same rule as `deriveOrderedQty`, expressed in SQL so a list can filter on the
 *  balance BEFORE paging — a post-filter would make the page counts and `total`
 *  lie. `prRef` is the alias the caller gave `purchase_requests` (e.g. `pr`). */
function orderedQtySql(prRef: { id: SQLWrapper; poId: SQLWrapper; qty: SQLWrapper }): SQL<number> {
  return sql<number>`(CASE
    WHEN ${prRef.poId} IS NOT NULL AND ${linkedLineCountSql(prRef.id)} = 0 THEN ${prRef.qty}
    ELSE ${liveOrderedQtySql(prRef.id)}
  END)`;
}

/**
 * The one place the BALANCE is decided — `qty` minus what is on order, unless
 * the buyer short-closed the remainder, in which case it is 0.
 *
 * A short-closed PR keeps its real `orderedQty`: it still reports what was
 * actually bought. The two therefore stop adding up to `qty`, and that is the
 * whole point — the difference is the quantity that was abandoned (0117).
 *
 * Not clamped at 0 otherwise: an over-ordered PR shows a negative balance so the
 * screen says so, rather than hiding it (see the contract note on balanceQty).
 */
export function deriveBalanceQty(input: {
  qty: number;
  orderedQty: number;
  balanceClosed: boolean;
}): number {
  if (input.balanceClosed) return 0;
  return input.qty - input.orderedQty;
}

/**
 * Ordered quantity for ONE purchase request, for the write paths (edit / reject
 * guards and the shape they return). One indexed round-trip, no N+1: the write
 * paths handle a single PR by id.
 */
async function loadOrderedQty(
  tx: DbTransaction,
  pr: { id: string; qty: number; poId: string | null },
): Promise<number> {
  const rows = (await tx.execute(sql`
    SELECT
      ${liveOrderedQtySql(sql`${pr.id}::uuid`)} AS "liveOrderedQty",
      ${linkedLineCountSql(sql`${pr.id}::uuid`)} AS "linkedLineCount"
  `)) as unknown as Array<Record<string, unknown>>;
  const row = rows[0];
  return deriveOrderedQty({
    qty: pr.qty,
    poId: pr.poId,
    liveOrderedQty: Number(row?.['liveOrderedQty'] ?? 0),
    linkedLineCount: Number(row?.['linkedLineCount'] ?? 0),
  });
}

/** What one PR has on order and what is left to order. */
export interface PrBalance {
  orderedQty: number;
  balanceQty: number;
  balanceClosed: boolean;
}

/**
 * Ordered / balance quantity for MANY purchase requests in ONE round trip.
 *
 * Exported because the purchase-orders module must ask the same question before
 * it lets a line be raised against a PR, and the arithmetic must have exactly
 * one home (ADR-152): a second copy over there would drift from the legacy rule
 * and quietly re-open the three pre-0103 PRs.
 *
 * Batched deliberately — the batch-convert path handles N PRs at once, and a
 * per-PR lookup inside that loop is the N+1 CLAUDE.md §6 forbids. Missing ids
 * simply do not appear in the map; the caller has already proved they exist.
 */
export async function loadPrBalances(
  tx: DbTransaction,
  prs: Array<{
    id: string;
    qty: number;
    poId: string | null;
    balanceClosedAt: Date | string | null;
  }>,
): Promise<Map<string, PrBalance>> {
  const out = new Map<string, PrBalance>();
  if (prs.length === 0) return out;
  // Same two subqueries the list and the detail read use, correlated to the PR
  // rows themselves — so this cannot disagree with what the screens show.
  const rows = (await tx.execute(sql`
    SELECT
      p.id AS "prId",
      ${liveOrderedQtySql(sql`p.id`)} AS "liveOrderedQty",
      ${linkedLineCountSql(sql`p.id`)} AS "linkedLineCount"
    FROM public.purchase_requests p
    WHERE p.id IN (${sql.join(
      prs.map((p) => sql`${p.id}::uuid`),
      sql`, `,
    )})
  `)) as unknown as Array<Record<string, unknown>>;
  const byId = new Map(rows.map((r) => [String(r['prId']), r]));
  for (const pr of prs) {
    const r = byId.get(pr.id);
    const orderedQty = deriveOrderedQty({
      qty: pr.qty,
      poId: pr.poId,
      liveOrderedQty: Number(r?.['liveOrderedQty'] ?? 0),
      linkedLineCount: Number(r?.['linkedLineCount'] ?? 0),
    });
    const balanceClosed = pr.balanceClosedAt != null;
    out.set(pr.id, {
      orderedQty,
      balanceQty: deriveBalanceQty({ qty: pr.qty, orderedQty, balanceClosed }),
      balanceClosed,
    });
  }
  return out;
}

// ─── Reads ────────────────────────────────────────────────────────────────

// Money-hiding for L1 Viewers ("Can See Price"). A PR's only money is its
// estimated cost; it is nulled for price-restricted viewers on both list and
// detail.
function hidePrMoney<T extends { estCost: string | null }>(r: T): T {
  // Also STATE it: the reader must not have to infer 'hidden' from the null.
  return { ...r, estCost: null, priceVisible: false };
}

/** Escape the ILIKE metacharacters in a user's search term. Without this a
 *  user typing "50%" or "a_b" in the PR search box gets a wildcard pattern
 *  instead of a literal search — and a bare "%" returns every row. The SQL side
 *  must pair it with an ESCAPE '\' clause on every ILIKE, or the escapes match
 *  literally.
 *  Deliberately a local copy of the sales-orders / purchase-orders helper rather
 *  than an export across modules: it is three lines, and each list must be free
 *  to change its own search behaviour without dragging the others with it. */
function escapeLikeTerm(raw: string): string {
  return raw.replace(/[\\%_]/g, (ch) => `\\${ch}`);
}

export async function listPurchaseRequests(
  input: ListPurchaseRequestsQuery,
  user: AuthContext,
): Promise<ListPurchaseRequestsResponse> {
  const companyId = requireCompany(user);
  const showMoney = await canSeeFormPrice(user, 'pr_create');
  return withUserContext(user, async (tx) => {
    // Search covers every field the PR card (purchase-requests/components/
    // pr-card.tsx) actually shows: the identity band (PR code, item code and
    // name, the resolved vendor name the card falls back from, the status badge
    // and the PO code shown once a PO exists) and the meta line (PR date, the
    // source SO / JC code, operation, required date, and the approved /
    // PO-created stamps).
    // Deliberately NOT searched:
    //  - qty — a number; searching "5" would hit almost every PR.
    //  - est_cost and every other money value: this module hides money behind
    //    `canSeeFormPrice`, so a search that matched an amount would let a user
    //    who may NOT see prices confirm a value by guessing it. Money must
    //    never be searchable here.
    //  - remarks — not on the card.
    //  - the SO line no / JC op seq numbers on the source ref — numbers again.
    //  - pr_type: the SVC / OSP badge cannot render on this list at all,
    //    because the SELECT below never returns pr_type (toListItem falls back
    //    to 'standard'). Nothing on screen to match, so nothing searched.
    const term = input.search ? `%${escapeLikeTerm(input.search)}%` : null;
    const searchFrag = term
      ? sql`AND (
          pr.code ILIKE ${term} ESCAPE '\\'
          -- Item code is matched on BOTH the text the PR stored and the live
          -- master row: the card renders itemCode ?? itemCodeText, and an item
          -- renamed after the PR was raised keeps the old text on the PR.
          OR pr.item_code_text ILIKE ${term} ESCAPE '\\'
          OR i.code ILIKE ${term} ESCAPE '\\'
          OR pr.item_name ILIKE ${term} ESCAPE '\\'
          -- The card renders vendorName ?? vendorCodeText, and vendorName is
          -- COALESCE(v.name, vt.name) — both vendor joins below are matched.
          OR pr.vendor_code_text ILIKE ${term} ESCAPE '\\'
          OR v.name ILIKE ${term} ESCAPE '\\'
          OR vt.name ILIKE ${term} ESCAPE '\\'
          OR pr.status::text ILIKE ${term} ESCAPE '\\'
          OR pr.operation ILIKE ${term} ESCAPE '\\'
          OR pr.pr_date::text ILIKE ${term} ESCAPE '\\'
          OR pr.required_date::text ILIKE ${term} ESCAPE '\\'
          -- The two stamps the meta line prints as a date (✔ approved,
          -- 📝 PO created). Cast to text so a "2026-08" style search hits.
          OR pr.approved_at::text ILIKE ${term} ESCAPE '\\'
          OR pr.po_created_at::text ILIKE ${term} ESCAPE '\\'
          -- Source ref + the PO link on the card, both already joined below.
          OR so.code ILIKE ${term} ESCAPE '\\'
          OR jc.code ILIKE ${term} ESCAPE '\\'
          OR po.code ILIKE ${term} ESCAPE '\\'
        )`
      : sql``;
    const statusFrag = input.status ? sql`AND pr.status = ${input.status}::pr_status` : sql``;
    // ADR-015 FK-or-text vendor: match the FK OR the free-text vendor code.
    // Every live PR stores the vendor as text, so FK-only matched nothing and
    // the PO form's per-line PR dropdown looked like it ignored the vendor.
    // Compared upper-cased + trimmed — a text column carries no guarantee.
    const vendorCode = input.vendorId
      ? await resolveVendorCode(tx, input.vendorId, companyId)
      : null;
    const vendorFrag = input.vendorId
      ? vendorCode
        ? sql`AND (pr.vendor_id = ${input.vendorId}::uuid OR upper(btrim(pr.vendor_code_text)) = ${vendorCode})`
        : sql`AND pr.vendor_id = ${input.vendorId}::uuid`
      : sql``;
    const jcOpFrag = input.sourceJcOpId
      ? sql`AND pr.source_jc_op_id = ${input.sourceJcOpId}::uuid`
      : sql``;
    const fromFrag = input.fromDate ? sql`AND pr.pr_date >= ${input.fromDate}::date` : sql``;
    const toFrag = input.toDate ? sql`AND pr.pr_date <= ${input.toDate}::date` : sql``;
    // convertibleOnly — "still has quantity left to order" (ADR-152). Applied in
    // SQL, on the same expression the rows report, so paging and `total` agree
    // with what the caller sees; a post-filter after LIMIT would show 3 rows and
    // claim 40. A cancelled PR is excluded outright: its balance is untouched
    // (nothing was ever ordered) but it is dead paperwork, and the PO form's PR
    // picker has never offered one.
    // A SHORT-CLOSED PR is excluded too (0117): its arithmetic balance is still
    // positive — that is exactly what short-closing records — but the buyer has
    // said the remainder is not coming, so it must not be offered again.
    const convertibleFrag = input.convertibleOnly
      ? sql`AND pr.status <> 'cancelled'
        AND pr.balance_closed_at IS NULL
        AND pr.qty > ${orderedQtySql({ id: sql`pr.id`, poId: sql`pr.po_id`, qty: sql`pr.qty` })}`
      : sql``;

    const result = await tx.execute(sql`
      SELECT
        pr.id, pr.company_id AS "companyId", pr.code,
        pr.pr_date AS "prDate", pr.status,
        pr.vendor_id AS "vendorId", pr.vendor_code_text AS "vendorCodeText",
        pr.item_id AS "itemId", pr.item_code_text AS "itemCodeText",
        pr.item_name AS "itemName",
        pr.qty, pr.est_cost::text AS "estCost", pr.required_date AS "requiredDate",
        pr.source_jc_op_id AS "sourceJcOpId",
        pr.source_so_line_id AS "sourceSoLineId",
        pr.operation, pr.remarks,
        pr.approved_by AS "approvedBy", pr.approved_at AS "approvedAt",
        pr.po_id AS "poId", pr.po_created_at AS "poCreatedAt",
        pr.balance_closed_at AS "balanceClosedAt",
        pr.balance_closed_by AS "balanceClosedBy",
        pr.balance_closed_reason AS "balanceClosedReason",
        pr.created_at AS "createdAt", pr.created_by AS "createdBy",
        pr.updated_at AS "updatedAt", pr.updated_by AS "updatedBy",
        pr.deleted_at AS "deletedAt",
        COALESCE(v.name, vt.name) AS "vendorName",
        i.code AS "itemCode",
        jc.code AS "sourceJcCode",
        jo.op_seq AS "sourceJcOpSeq",
        po.code AS "poCode",
        so.code AS "soCode",
        sol.line_no AS "soLineNo",
        -- Ordered / balance quantity (ADR-152). Two scalar subqueries per row,
        -- both hitting the purchase_order_lines_source_pr_idx index; combined
        -- into orderedQty by deriveOrderedQty in toListItem below.
        ${liveOrderedQtySql(sql`pr.id`)} AS "liveOrderedQty",
        ${linkedLineCountSql(sql`pr.id`)} AS "linkedLineCount"
      FROM public.purchase_requests pr
      LEFT JOIN public.vendors v
        ON v.id = pr.vendor_id AND v.deleted_at IS NULL
      LEFT JOIN public.vendors vt
        ON vt.code = pr.vendor_code_text AND vt.company_id = pr.company_id AND vt.deleted_at IS NULL
      LEFT JOIN public.items i
        ON i.id = pr.item_id AND i.deleted_at IS NULL
      LEFT JOIN public.jc_ops jo
        ON jo.id = pr.source_jc_op_id AND jo.deleted_at IS NULL
      LEFT JOIN public.job_cards jc
        ON jc.id = jo.job_card_id AND jc.deleted_at IS NULL
      LEFT JOIN public.purchase_orders po
        ON po.id = pr.po_id AND po.deleted_at IS NULL
      LEFT JOIN public.sales_order_lines sol
        ON sol.id = pr.source_so_line_id AND sol.deleted_at IS NULL
      LEFT JOIN public.sales_orders so
        ON so.id = sol.sales_order_id AND so.deleted_at IS NULL
      WHERE pr.company_id = ${companyId}::uuid
        AND pr.deleted_at IS NULL
        ${searchFrag}
        ${statusFrag}
        ${vendorFrag}
        ${jcOpFrag}
        ${fromFrag}
        ${toFrag}
        ${convertibleFrag}
      -- Newest first, matching the SO list (sales-orders/service.ts). This was
      -- pr.code ASC, which sank every new PR to the last page.
      ORDER BY pr.pr_date DESC, pr.code DESC
      LIMIT ${input.limit} OFFSET ${input.offset}
    `);

    // Total = exactly the rows the query above returns without its LIMIT: same
    // FROM, same joins, the SAME fragment objects — including the FK-or-text
    // vendor rule, which is now shared rather than restated. It used to be a
    // Drizzle count() that skipped the search and the dates, so the header
    // counted every PR in the company while the list showed the one that
    // matched. A Drizzle count on purchase_requests alone cannot express the
    // search (it reads the item, both vendor joins and the SO / JC / PO codes),
    // so the count is raw SQL too and the predicate stays defined once.
    // NOTE: the old count also applied `input.prType`, which the page query
    // above has never applied. Counting a filter the rows ignore is what made
    // the two disagree, so the count now mirrors the rows exactly. That the
    // page query ignores prType at all is a separate, pre-existing bug (it
    // also never SELECTs pr_type) — reported, not fixed here.
    const totalRows = await tx.execute(sql`
      SELECT COUNT(*)::int AS total
      FROM public.purchase_requests pr
      LEFT JOIN public.vendors v
        ON v.id = pr.vendor_id AND v.deleted_at IS NULL
      LEFT JOIN public.vendors vt
        ON vt.code = pr.vendor_code_text AND vt.company_id = pr.company_id AND vt.deleted_at IS NULL
      LEFT JOIN public.items i
        ON i.id = pr.item_id AND i.deleted_at IS NULL
      LEFT JOIN public.jc_ops jo
        ON jo.id = pr.source_jc_op_id AND jo.deleted_at IS NULL
      LEFT JOIN public.job_cards jc
        ON jc.id = jo.job_card_id AND jc.deleted_at IS NULL
      LEFT JOIN public.purchase_orders po
        ON po.id = pr.po_id AND po.deleted_at IS NULL
      LEFT JOIN public.sales_order_lines sol
        ON sol.id = pr.source_so_line_id AND sol.deleted_at IS NULL
      LEFT JOIN public.sales_orders so
        ON so.id = sol.sales_order_id AND so.deleted_at IS NULL
      WHERE pr.company_id = ${companyId}::uuid
        AND pr.deleted_at IS NULL
        ${searchFrag}
        ${statusFrag}
        ${vendorFrag}
        ${jcOpFrag}
        ${fromFrag}
        ${toFrag}
        ${convertibleFrag}
    `);
    const total = Number(
      (totalRows as unknown as Array<Record<string, unknown>>)[0]?.['total'] ?? 0,
    );

    const mapped = (result as unknown as Array<Record<string, unknown>>).map(toListItem);
    const rowsList = showMoney ? mapped : mapped.map(hidePrMoney);
    return { items: rowsList, total, limit: input.limit, offset: input.offset };
  });
}

function toListItem(r: Record<string, unknown>): PurchaseRequestListItem {
  const qty = Number(r['qty'] ?? 0);
  const orderedQty = deriveOrderedQty({
    qty,
    poId: (r['poId'] as string | null) ?? null,
    liveOrderedQty: Number(r['liveOrderedQty'] ?? 0),
    linkedLineCount: Number(r['linkedLineCount'] ?? 0),
  });
  return {
    id: r['id'] as string,
    companyId: r['companyId'] as string,
    code: r['code'] as string,
    prDate: dateLike(r['prDate']),
    status: r['status'] as PurchaseRequest['status'],
    prType: (r['prType'] as PurchaseRequest['prType'] | null) ?? 'standard',
    vendorId: (r['vendorId'] as string | null) ?? null,
    vendorCodeText: (r['vendorCodeText'] as string | null) ?? null,
    itemId: (r['itemId'] as string | null) ?? null,
    itemCodeText: (r['itemCodeText'] as string | null) ?? null,
    itemName: (r['itemName'] as string | null) ?? null,
    qty,
    estCost: r['estCost'] as string,
    requiredDate: maybeDateLike(r['requiredDate']),
    sourceJcOpId: (r['sourceJcOpId'] as string | null) ?? null,
    sourceSoLineId: (r['sourceSoLineId'] as string | null) ?? null,
    operation: (r['operation'] as string | null) ?? null,
    remarks: (r['remarks'] as string | null) ?? null,
    approvedBy: (r['approvedBy'] as string | null) ?? null,
    approvedAt: maybeTsLike(r['approvedAt']),
    poId: (r['poId'] as string | null) ?? null,
    poCreatedAt: maybeTsLike(r['poCreatedAt']),
    orderedQty,
    balanceQty: deriveBalanceQty({
      qty,
      orderedQty,
      balanceClosed: r['balanceClosedAt'] != null,
    }),
    balanceClosedAt: maybeTsLike(r['balanceClosedAt']),
    balanceClosedBy: (r['balanceClosedBy'] as string | null) ?? null,
    balanceClosedReason: (r['balanceClosedReason'] as string | null) ?? null,
    createdAt: tsLike(r['createdAt']),
    createdBy: r['createdBy'] as string,
    updatedAt: tsLike(r['updatedAt']),
    updatedBy: r['updatedBy'] as string,
    deletedAt: maybeTsLike(r['deletedAt']),
    vendorName: (r['vendorName'] as string | null) ?? null,
    itemCode: (r['itemCode'] as string | null) ?? null,
    sourceJcCode: (r['sourceJcCode'] as string | null) ?? null,
    sourceJcOpSeq: r['sourceJcOpSeq'] != null ? Number(r['sourceJcOpSeq']) : null,
    poCode: (r['poCode'] as string | null) ?? null,
    soCode: (r['soCode'] as string | null) ?? null,
    soLineNo: r['soLineNo'] != null ? Number(r['soLineNo']) : null,
  };
}

export async function getPurchaseRequest(
  id: string,
  user: AuthContext,
): Promise<PurchaseRequestDetail> {
  const companyId = requireCompany(user);
  const vendorByCode = alias(vendors, 'vendor_by_code');
  const showMoney = await canSeeFormPrice(user, 'pr_create');
  return withUserContext(user, async (tx) => {
    // Resolve the vendor/item display joins the list already carries (per
    // docs/PARITY/linked-display-audit). Consumers previously had only
    // vendorCodeText to fall back on, which on an OSP-generated PR is the
    // '(vendor TBD)' sentinel — so a vendor picked later never showed.
    const rows = await tx
      .select({
        row: purchaseRequests,
        // Resolve the vendor name via the FK, else by matching the free-text
        // vendor_code_text to a vendor's code (ADR-015 free-text fallback) — so an
        // OSP/planning PR that stored the vendor code still shows the real name.
        vendorName: sql<string | null>`coalesce(${vendors.name}, ${vendorByCode.name})`,
        vendorCode: sql<string | null>`coalesce(${vendors.code}, ${vendorByCode.code})`,
        // Postal address for the PR detail header. concat_ws skips NULLs; the
        // inner NULLIFs make empty strings behave the same way, and the outer
        // one turns a vendor with no address at all into NULL rather than ''.
        // Same coalesce pattern as name/code above — the two joins are mutually
        // exclusive in practice (a PR carries either vendor_id or the code text).
        //
        // btrim strips stray spaces AND commas off each part before joining:
        // the migrated master has values like 'adjacent villages,' and
        // 'Dist-Godda,', which would otherwise render as ',, ' runs and a
        // trailing comma on screen.
        // The outer regexp_replace collapses repeated comma runs — the migrated
        // master also carries them INSIDE a single field ('PANCHVATI,, VALLABH'),
        // which btrim cannot reach. Display-only tidy-up; the master is untouched.
        vendorAddress: sql<string | null>`NULLIF(regexp_replace(concat_ws(', ',
          NULLIF(btrim(coalesce(${vendors.addressLine1}, ${vendorByCode.addressLine1}), ' ,'), ''),
          NULLIF(btrim(coalesce(${vendors.city}, ${vendorByCode.city}), ' ,'), ''),
          NULLIF(btrim(coalesce(${vendors.state}, ${vendorByCode.state}), ' ,'), ''),
          NULLIF(btrim(coalesce(${vendors.pincode}, ${vendorByCode.pincode}), ' ,'), '')
        ), '(,\s*){2,}', ', ', 'g'), '')`,
        itemCode: items.code,
        // Resolve the source/linked document codes so the detail page shows real
        // values instead of a '— linked —' placeholder.
        poCode: purchaseOrders.code,
        sourceJcCode: jobCards.code,
        sourceJcOpSeq: jcOps.opSeq,
        soCode: salesOrders.code,
        soLineNo: salesOrderLines.lineNo,
        // Ordered / balance quantity (ADR-152) — same two subqueries the list
        // uses, combined by deriveOrderedQty below.
        liveOrderedQty: liveOrderedQtySql(purchaseRequests.id),
        linkedLineCount: linkedLineCountSql(purchaseRequests.id),
      })
      .from(purchaseRequests)
      .leftJoin(vendors, and(eq(vendors.id, purchaseRequests.vendorId), isNull(vendors.deletedAt)))
      .leftJoin(
        vendorByCode,
        and(
          eq(vendorByCode.code, purchaseRequests.vendorCodeText),
          eq(vendorByCode.companyId, purchaseRequests.companyId),
          isNull(vendorByCode.deletedAt),
        ),
      )
      .leftJoin(items, and(eq(items.id, purchaseRequests.itemId), isNull(items.deletedAt)))
      .leftJoin(
        purchaseOrders,
        and(eq(purchaseOrders.id, purchaseRequests.poId), isNull(purchaseOrders.deletedAt)),
      )
      .leftJoin(jcOps, and(eq(jcOps.id, purchaseRequests.sourceJcOpId), isNull(jcOps.deletedAt)))
      .leftJoin(jobCards, and(eq(jobCards.id, jcOps.jobCardId), isNull(jobCards.deletedAt)))
      .leftJoin(
        salesOrderLines,
        and(
          eq(salesOrderLines.id, purchaseRequests.sourceSoLineId),
          isNull(salesOrderLines.deletedAt),
        ),
      )
      .leftJoin(
        salesOrders,
        and(eq(salesOrders.id, salesOrderLines.salesOrderId), isNull(salesOrders.deletedAt)),
      )
      .where(
        and(
          eq(purchaseRequests.id, id),
          eq(purchaseRequests.companyId, companyId),
          isNull(purchaseRequests.deletedAt),
        ),
      )
      .limit(1);
    const found = rows[0];
    if (!found) throw new NotFoundError(`Purchase request ${id} not found`);
    const orderedQty = deriveOrderedQty({
      qty: found.row.qty,
      poId: found.row.poId,
      liveOrderedQty: Number(found.liveOrderedQty ?? 0),
      linkedLineCount: Number(found.linkedLineCount ?? 0),
    });
    const prOut = toPurchaseRequest(found.row, orderedQty);
    return {
      ...(showMoney ? prOut : hidePrMoney(prOut)),
      vendorName: found.vendorName,
      vendorCode: found.vendorCode,
      vendorAddress: found.vendorAddress,
      itemCode: found.itemCode,
      poCode: found.poCode,
      sourceJcCode: found.sourceJcCode,
      sourceJcOpSeq: found.sourceJcOpSeq,
      soCode: found.soCode,
      soLineNo: found.soLineNo,
    };
  });
}

// ─── Writes ───────────────────────────────────────────────────────────────

export async function createPurchaseRequest(
  input: CreatePurchaseRequestInput,
  user: AuthContext,
): Promise<PurchaseRequest> {
  // Raising a PR is an entry right — L2 Data Entry and above.
  await requireFormAccess(user, 'pr_create', 'entry');
  const companyId = requireCompany(user);

  return withUserContext(user, async (tx) => {
    // T23: blank code → auto-generate the next IN-PR-#####. OSP callers pass an
    // explicit IN-JWPR- code, which is honoured; only the standalone PR form
    // leaves it blank. nextSeriesCode is prefix-scoped so the series don't mix.
    const code = input.code?.trim() || (await nextSeriesCode(tx, 'pr', companyId, 'IN-PR-'));
    // Code uniqueness within company
    const dup = await tx
      .select({ id: purchaseRequests.id })
      .from(purchaseRequests)
      .where(
        and(
          eq(purchaseRequests.companyId, companyId),
          eq(purchaseRequests.code, code),
          isNull(purchaseRequests.deletedAt),
        ),
      )
      .limit(1);
    if (dup.length > 0) {
      throw new ConflictError(`Purchase request code "${code}" already exists`);
    }

    if (input.vendorId) await assertVendorExists(tx, input.vendorId, companyId);
    if (input.itemId) await assertItemExists(tx, input.itemId, companyId);
    if (input.sourceJcOpId) await assertJcOpExists(tx, input.sourceJcOpId, companyId);
    if (input.sourceSoLineId) await assertSoLineExists(tx, input.sourceSoLineId, companyId);

    // Back-stop for a caller that sends only the typed code: if it names a real
    // master item, stamp the link. An off-master code still saves as free text.
    const resolvedItemId =
      input.itemId ??
      (input.itemCodeText ? await resolveItemIdByCode(tx, input.itemCodeText, companyId) : null);

    const inserted = await tx
      .insert(purchaseRequests)
      .values({
        companyId,
        code,
        prDate: input.prDate,
        // A new PR is ALWAYS born 'open'. Any status on the payload is
        // ignored, matching updatePurchaseRequest (which omits status
        // entirely): it advances only through approve / reject / create-PO.
        // Picking it at creation let a PR be born 'approved' with no
        // approvedBy/approvedAt behind it, or born 'po_created' and never
        // convertible. The create form no longer offers the field.
        status: 'open',
        prType: input.prType ?? (input.sourceJcOpId ? 'jw_osp' : 'standard'),
        vendorId: input.vendorId ?? null,
        vendorCodeText: input.vendorCodeText ?? null,
        itemId: resolvedItemId,
        itemCodeText: input.itemCodeText ?? null,
        itemName: input.itemName ?? null,
        qty: input.qty,
        estCost: estCostToString(input.estCost),
        requiredDate: input.requiredDate ?? null,
        sourceJcOpId: input.sourceJcOpId ?? null,
        sourceSoLineId: input.sourceSoLineId ?? null,
        operation: input.operation ?? null,
        remarks: input.remarks ?? null,
        createdBy: user.id,
        updatedBy: user.id,
      })
      .returning();
    const row = inserted[0]!;

    // Legacy createPR write-back — HTML L6207-08:
    //   op.outsourceStatus='PR Raised'; op.outsourcePRNo=prNo;
    // When a PR is raised from an outsource JC op, stamp the source op so the
    // JC Ops board (jc-ops/service.ts joins pr ON pr.id = op.outsource_pr_id)
    // surfaces the raised PR. This is ATOMIC with the insert above — same tx —
    // so a committed PR is never left without its op stamped (the parity bug
    // this fixes). 'PR Raised' maps to the 'pr_raised' OUTSOURCE_STATUSES
    // member; legacy `op.outsourcePRNo` maps to our outsource_pr_id FK.
    // The op's existence/company was already asserted above (assertJcOpExists).
    if (input.sourceJcOpId) {
      await tx
        .update(jcOps)
        .set({
          outsourcePrId: row.id,
          outsourceStatus: 'pr_raised',
          updatedAt: new Date(),
          updatedBy: user.id,
        })
        .where(
          and(
            eq(jcOps.id, input.sourceJcOpId),
            eq(jcOps.companyId, companyId),
            isNull(jcOps.deletedAt),
          ),
        );
    }

    await emitActivityLog(
      tx,
      {
        action: 'CREATE',
        entity: 'PurchaseRequest',
        detail: prDetail(row.code, row.itemName, row.itemCodeText, row.qty),
        refId: row.code,
      },
      companyId,
      user,
    );
    // A PR born a moment ago has no PO line pointing at it and no header po_id,
    // so its ordered quantity is 0 by construction — no query needed.
    return toPurchaseRequest(row, 0);
  });
}

export async function updatePurchaseRequest(
  id: string,
  input: UpdatePurchaseRequestInput,
  user: AuthContext,
): Promise<PurchaseRequest> {
  // Changing a SAVED PR is an edit right — L3 Editor and above. An L2 Data
  // Entry can create one but deliberately cannot alter it afterwards.
  await requireFormAccess(user, 'pr_create', 'edit');
  const companyId = requireCompany(user);

  return withUserContext(user, async (tx) => {
    const existing = await tx
      .select()
      .from(purchaseRequests)
      .where(
        and(
          eq(purchaseRequests.id, id),
          eq(purchaseRequests.companyId, companyId),
          isNull(purchaseRequests.deletedAt),
        ),
      )
      .limit(1);
    if (existing.length === 0) {
      throw new NotFoundError(`Purchase request ${id} not found`);
    }
    // A PR with quantity on a LIVE purchase order is locked — no further edits.
    //
    // This used to test the boolean (`po_id IS NOT NULL OR status='po_created'`),
    // which left a PR dead forever once its only PO was cancelled: nothing ever
    // wrote the flag back. It now asks how much is actually on order, so a PR
    // whose PO was cancelled becomes editable again on its own, while one with
    // any live quantity stays locked exactly as before.
    const orderedQty = await loadOrderedQty(tx, existing[0]!);
    if (orderedQty > 0) {
      throw new ConflictError(
        `Purchase request ${existing[0]!.code} is linked to a PO and cannot be edited`,
      );
    }

    if (input.vendorId !== undefined && input.vendorId !== null) {
      await assertVendorExists(tx, input.vendorId, companyId);
    }
    if (input.itemId !== undefined && input.itemId !== null) {
      await assertItemExists(tx, input.itemId, companyId);
    }
    if (input.sourceJcOpId !== undefined && input.sourceJcOpId !== null) {
      await assertJcOpExists(tx, input.sourceJcOpId, companyId);
    }
    if (input.sourceSoLineId !== undefined && input.sourceSoLineId !== null) {
      await assertSoLineExists(tx, input.sourceSoLineId, companyId);
    }

    const updates: Record<string, unknown> = { updatedBy: user.id };
    if (input.prDate !== undefined) updates['prDate'] = input.prDate;
    // Status is IMMUTABLE on a raw edit — it only advances through the
    // approve / reject / create-PO service actions (mirrors updateJobCard /
    // updatePurchaseOrder). Any `status` in the payload is ignored so the edit
    // form can never skip the approvedBy/approvedAt stamp (ISSUE-025).
    if (input.vendorId !== undefined) updates['vendorId'] = input.vendorId ?? null;
    if (input.vendorCodeText !== undefined)
      updates['vendorCodeText'] = input.vendorCodeText ?? null;
    // Same back-stop on edit: a changed code that names a real master item
    // re-links the PR instead of leaving it as bare text.
    if (input.itemId !== undefined) {
      updates['itemId'] = input.itemId ?? null;
    } else if (input.itemCodeText !== undefined && input.itemCodeText !== null) {
      const reResolved = await resolveItemIdByCode(tx, input.itemCodeText, companyId);
      if (reResolved) updates['itemId'] = reResolved;
    }
    if (input.itemCodeText !== undefined) updates['itemCodeText'] = input.itemCodeText ?? null;
    if (input.itemName !== undefined) updates['itemName'] = input.itemName ?? null;
    if (input.qty !== undefined) updates['qty'] = input.qty;
    // Money in, same rule as money out: a caller who cannot SEE the estimated
    // cost cannot SET it either — their payload's estCost is ignored and the
    // stored figure stands. `priceOff` makes "can do the job but must not see
    // the number" a supported setup, so an editor with prices hidden is real.
    if (input.estCost !== undefined && (await canSeeFormPrice(user, 'pr_create'))) {
      updates['estCost'] = estCostToString(input.estCost);
    }
    if (input.requiredDate !== undefined) updates['requiredDate'] = input.requiredDate ?? null;
    if (input.sourceJcOpId !== undefined) updates['sourceJcOpId'] = input.sourceJcOpId ?? null;
    if (input.sourceSoLineId !== undefined)
      updates['sourceSoLineId'] = input.sourceSoLineId ?? null;
    if (input.operation !== undefined) updates['operation'] = input.operation ?? null;
    if (input.remarks !== undefined) updates['remarks'] = input.remarks ?? null;

    await tx.update(purchaseRequests).set(updates).where(eq(purchaseRequests.id, id));

    const reread = await tx
      .select()
      .from(purchaseRequests)
      .where(eq(purchaseRequests.id, id))
      .limit(1);
    const row = reread[0]!;
    await emitActivityLog(
      tx,
      {
        action: 'EDIT',
        entity: 'PurchaseRequest',
        detail: prDetail(row.code, row.itemName, row.itemCodeText, row.qty),
        refId: row.code,
      },
      companyId,
      user,
    );
    // The guard above proved this PR has nothing on a live PO, and this
    // transaction has not created one.
    return toPurchaseRequest(row, orderedQty);
  });
}

// ─── Approval actions (mirror approvePurchaseOrder / rejectPurchaseOrder) ────
//
// The ONLY path that advances a PR out of its pre-approval state. Stamps the
// approvedBy/approvedAt columns the generic update path deliberately never
// writes (status is immutable there). Legacy `approvePR` (HTML) set
// op.approvedBy/approvedDate on the same click.

export async function approvePurchaseRequest(
  id: string,
  user: AuthContext,
): Promise<PurchaseRequest> {
  // Approving a PR is now a distinct permission, not a side effect of being
  // a manager (0100). An L3 Editor raises PRs; an L4/L5 signs them off.
  await requireFormAccess(user, 'pr_create', 'approve');
  const companyId = requireCompany(user);

  return withUserContext(user, async (tx) => {
    const existing = await tx
      .select()
      .from(purchaseRequests)
      .where(
        and(
          eq(purchaseRequests.id, id),
          eq(purchaseRequests.companyId, companyId),
          isNull(purchaseRequests.deletedAt),
        ),
      )
      .limit(1);
    const pr = existing[0];
    if (!pr) throw new NotFoundError(`Purchase request ${id} not found`);
    // Only a pre-approval PR ('open') can be approved.
    if (pr.status !== 'open') {
      throw new ValidationError(
        `PR ${pr.code} is ${pr.status}; only open purchase requests can be approved`,
      );
    }

    // Segregation of duty (0100): the raiser cannot sign off their own PR.
    assertNotSelfApproval(user, pr.createdBy, `PR ${pr.code}`);

    const now = new Date();
    await tx
      .update(purchaseRequests)
      .set({
        status: 'approved',
        approvedBy: user.id,
        approvedAt: now,
        updatedBy: user.id,
        updatedAt: now,
      })
      .where(eq(purchaseRequests.id, id));

    const reread = await tx
      .select()
      .from(purchaseRequests)
      .where(eq(purchaseRequests.id, id))
      .limit(1);
    const row = reread[0]!;
    await emitActivityLog(
      tx,
      {
        action: 'APPROVE',
        entity: 'PurchaseRequest',
        detail: `${row.code} approved by ${user.email ?? user.id}`,
        refId: row.code,
      },
      companyId,
      user,
    );
    return toPurchaseRequest(row, await loadOrderedQty(tx, row));
  });
}

export async function rejectPurchaseRequest(
  id: string,
  reason: string,
  user: AuthContext,
): Promise<PurchaseRequest> {
  // Rejecting is the other half of approving — same permission (0100).
  await requireFormAccess(user, 'pr_create', 'approve');
  const companyId = requireCompany(user);

  if (!reason || !reason.trim()) {
    throw new ValidationError('Rejection reason is required');
  }
  const trimmedReason = reason.trim();

  return withUserContext(user, async (tx) => {
    const existing = await tx
      .select()
      .from(purchaseRequests)
      .where(
        and(
          eq(purchaseRequests.id, id),
          eq(purchaseRequests.companyId, companyId),
          isNull(purchaseRequests.deletedAt),
        ),
      )
      .limit(1);
    const pr = existing[0];
    if (!pr) throw new NotFoundError(`Purchase request ${id} not found`);
    // Quantity already on a LIVE purchase order carries the procurement
    // obligation on that PO; a cancelled PR is terminal. Same change as the edit
    // guard: this asks how much is actually on order instead of reading the
    // boolean po_id / 'po_created' flag, so a PR whose only PO was cancelled can
    // be rejected (and edited) again rather than being stuck forever.
    const orderedQty = await loadOrderedQty(tx, pr);
    if (orderedQty > 0 || pr.status === 'cancelled') {
      throw new ValidationError(
        `PR ${pr.code} is ${pr.status}; only open or approved purchase requests can be rejected`,
      );
    }

    // Segregation of duty (0100): rejecting is the other half of approving, so
    // the raiser cannot kill their own PR either — approve had this guard and
    // reject did not.
    assertNotSelfApproval(user, pr.createdBy, `PR ${pr.code}`);

    // PR has no dedicated rejection columns (unlike PO) — record the reason in
    // remarks so it survives on the cancelled row.
    const stampedRemarks = pr.remarks
      ? `${pr.remarks}\n[Rejected] ${trimmedReason}`
      : `[Rejected] ${trimmedReason}`;

    const now = new Date();
    await tx
      .update(purchaseRequests)
      .set({
        status: 'cancelled',
        remarks: stampedRemarks,
        updatedBy: user.id,
        updatedAt: now,
      })
      .where(eq(purchaseRequests.id, id));

    const released = await releaseSourceJcOps(tx, id, user);

    const reread = await tx
      .select()
      .from(purchaseRequests)
      .where(eq(purchaseRequests.id, id))
      .limit(1);
    const row = reread[0]!;
    await emitActivityLog(
      tx,
      {
        action: 'REJECT',
        entity: 'PurchaseRequest',
        detail:
          `${row.code} rejected: ${trimmedReason}` +
          (released > 0 ? ` — JC operation released (retype/remove now allowed)` : ''),
        refId: row.code,
      },
      companyId,
      user,
    );
    // The guard above proved nothing is on a live PO for this PR.
    return toPurchaseRequest(row, orderedQty);
  });
}

// ─── Short-close the balance (0117, ADR-152 gap 6) ────────────────────────
//
// "We ordered 10 of 100 and the rest is not coming."
//
// Without this a partly-ordered PR is immortal: it cannot be edited (quantity
// is already committed to a vendor) and cannot be rejected (that guard refuses
// once anything is on order), so the unordered 90 sits in the "still to buy"
// list forever until somebody buys it by mistake.
//
// Deliberately NOT the same as editing the qty down. The PR still says 100 was
// asked for, because that is what happened; it records separately that the rest
// was abandoned, by whom and why. Rewriting the original request to match what
// was bought would destroy the audit trail the PR exists to keep.

export async function closePurchaseRequestBalance(
  id: string,
  input: ClosePurchaseRequestBalanceInput,
  user: AuthContext,
): Promise<PurchaseRequest> {
  // Same gate as approve / reject (`pr_create` + `approve`): abandoning
  // quantity that was formally requested is a sign-off decision, not data
  // entry. An L3 Editor raises PRs; an L4/L5 decides the rest is not coming.
  await requireFormAccess(user, 'pr_create', 'approve');
  const companyId = requireCompany(user);

  const trimmedReason = input.reason.trim();
  if (!trimmedReason) {
    throw new ValidationError('A reason is required to close the balance');
  }

  return withUserContext(user, async (tx) => {
    // Loaded WITHOUT the soft-delete filter on purpose: a deleted PR should be
    // told apart from one that never existed, so the user gets "it was deleted"
    // instead of a bare not-found.
    const existing = await tx
      .select()
      .from(purchaseRequests)
      .where(and(eq(purchaseRequests.id, id), eq(purchaseRequests.companyId, companyId)))
      .limit(1);
    const pr = existing[0];
    if (!pr) throw new NotFoundError(`Purchase request ${id} not found`);
    if (pr.deletedAt !== null) {
      throw new ValidationError(`PR ${pr.code} has been deleted; its balance cannot be closed`);
    }
    if (pr.status === 'cancelled') {
      throw new ValidationError(`PR ${pr.code} is cancelled; it has no balance to close`);
    }
    if (pr.balanceClosedAt !== null) {
      throw new ValidationError(`PR ${pr.code} already has its balance closed`);
    }

    const orderedQty = await loadOrderedQty(tx, pr);
    const balanceQty = deriveBalanceQty({ qty: pr.qty, orderedQty, balanceClosed: false });
    // Two different mistakes, two different answers — and neither is "no".
    //
    // Nothing bought at all is not a short-close, it is a rejection: there is
    // no partial order to preserve, so the PR should be killed outright and the
    // JC op it was raised against released (which Reject does and this does
    // not). The user is sent to that button by name.
    if (orderedQty <= 0) {
      throw new ValidationError(
        `PR ${pr.code} has nothing on order — use Reject to cancel the whole request, not Close Balance`,
      );
    }
    // Fully ordered (or over-ordered): closing would change nothing.
    if (balanceQty <= 0) {
      throw new ValidationError(
        `PR ${pr.code} has nothing left to order (${orderedQty} of ${pr.qty} already ordered); there is no balance to close`,
      );
    }

    const now = new Date();
    await tx
      .update(purchaseRequests)
      .set({
        balanceClosedAt: now,
        balanceClosedBy: user.id,
        balanceClosedReason: trimmedReason,
        updatedBy: user.id,
        updatedAt: now,
      })
      .where(eq(purchaseRequests.id, id));

    const reread = await tx
      .select()
      .from(purchaseRequests)
      .where(eq(purchaseRequests.id, id))
      .limit(1);
    const row = reread[0]!;
    await emitActivityLog(
      tx,
      {
        action: 'BALANCE_CLOSE',
        entity: 'PurchaseRequest',
        detail: `${row.code} balance closed — ${balanceQty} of ${row.qty} abandoned: ${trimmedReason}`,
        refId: row.code,
      },
      companyId,
      user,
    );
    // orderedQty is unchanged by closing — what was bought is still bought.
    // Only the balance the row reports drops to 0.
    return toPurchaseRequest(row, orderedQty);
  });
}

// ADR-101 — un-stamp the JC op(s) a dead PR was raised against.
//
// `jc_ops.outsource_pr_id` + `outsource_status` are what the JC-edit lock guard
// (job-cards/service.ts) reads to decide "this op is committed to procurement".
// Cancelling or deleting the PR used to leave that stamp behind, so the op was
// frozen forever — no retype to in-house, no removal — even though the user had
// done exactly what the error message told them to do. Clearing it here also
// makes the op eligible for a fresh PR again, which is the correct next state
// for an outsource op with no live paperwork.
//
// Ops that carry a PO line, or whose status is past PO issue, are left alone:
// those are real commitments and are not reachable from a pre-PO PR anyway.
async function releaseSourceJcOps(
  tx: DbTransaction,
  prId: string,
  user: AuthContext,
): Promise<number> {
  const rows = await tx
    .update(jcOps)
    .set({ outsourcePrId: null, outsourceStatus: null, updatedBy: user.id, updatedAt: new Date() })
    .where(
      and(
        eq(jcOps.outsourcePrId, prId),
        isNull(jcOps.outsourcePoLineId),
        isNull(jcOps.deletedAt),
        inArray(jcOps.outsourceStatus, ['pending', 'pr_raised']),
      ),
    )
    .returning({ id: jcOps.id });
  return rows.length;
}

export async function softDeletePurchaseRequest(
  id: string,
  user: AuthContext,
): Promise<{ ok: true }> {
  // Delete is not one of the four tier actions, so it is expressed as the pair
  // only L5 Department Admin and above hold: edit AND approve. L3 has edit
  // without approve; L4 has approve without edit.
  await requireFormAccess(user, 'pr_create', 'edit');
  await requireFormAccess(user, 'pr_create', 'approve');
  const companyId = requireCompany(user);

  return withUserContext(user, async (tx) => {
    const existing = await tx
      .select({
        id: purchaseRequests.id,
        code: purchaseRequests.code,
        itemName: purchaseRequests.itemName,
        itemCodeText: purchaseRequests.itemCodeText,
        qty: purchaseRequests.qty,
        status: purchaseRequests.status,
        poId: purchaseRequests.poId,
      })
      .from(purchaseRequests)
      .where(
        and(
          eq(purchaseRequests.id, id),
          eq(purchaseRequests.companyId, companyId),
          isNull(purchaseRequests.deletedAt),
        ),
      )
      .limit(1);
    const row = existing[0];
    if (!row) {
      throw new NotFoundError(`Purchase request ${id} not found`);
    }
    // Block deletion when a PO has been generated — that PO carries the
    // procurement obligation. Cancel the PR instead (status='cancelled') if
    // needed; deletion is for mistakes pre-PO only.
    if (row.poId !== null) {
      throw new ConflictError(
        `Purchase request ${id} has a linked purchase order — cancel instead of delete`,
      );
    }
    await tx
      .update(purchaseRequests)
      .set({ deletedAt: new Date(), updatedBy: user.id })
      .where(eq(purchaseRequests.id, id));
    // ADR-101 — a deleted PR commits nothing; free its source op too.
    await releaseSourceJcOps(tx, id, user);
    await emitActivityLog(
      tx,
      {
        action: 'DELETE',
        entity: 'PurchaseRequest',
        detail: prDetail(row.code, row.itemName, row.itemCodeText, row.qty),
        refId: row.code,
      },
      companyId,
      user,
    );
    return { ok: true };
  });
}

// ─── Traceability (read-only related-documents graph) ──────────────────────
//
// New-ERP navigation enhancement (not in legacy). Mirrors
// getSalesOrderRelated: anchor existence check → company-scoped, soft-delete
// filtered FK subqueries → DocumentTraceability. Changes no business rule.
//
// Edges (verified FKs only):
//   Upstream (source):
//     - purchase_requests.vendor_id        → vendors        (nullable)
//     - purchase_requests.item_id          → items          (nullable)
//     - purchase_requests.source_so_line_id → sales_order_lines → sales_orders (nullable)
//     - purchase_requests.source_jc_op_id  → jc_ops → job_cards (nullable)
//   Downstream (generated):
//     - purchase_requests.po_id            → purchase_orders (nullable)
//     - plans linked via dp_pr_id / fo_pr_id / fo_mat_pr_id / material_pr_id
//       UNION plan_ops.outsource_pr_id (resolved to plan_id)
export async function getPurchaseRequestRelated(
  id: string,
  user: AuthContext,
): Promise<DocumentTraceability> {
  const companyId = requireCompany(user);
  return withUserContext(user, async (tx) => {
    // Confirm the PR is visible before gathering related docs; grab the source
    // FKs the upstream links resolve from.
    const headers = await tx
      .select({
        id: purchaseRequests.id,
        code: purchaseRequests.code,
        prDate: purchaseRequests.prDate,
        status: purchaseRequests.status,
        vendorId: purchaseRequests.vendorId,
        itemId: purchaseRequests.itemId,
        sourceSoLineId: purchaseRequests.sourceSoLineId,
        sourceJcOpId: purchaseRequests.sourceJcOpId,
        poId: purchaseRequests.poId,
      })
      .from(purchaseRequests)
      .where(
        and(
          eq(purchaseRequests.id, id),
          eq(purchaseRequests.companyId, companyId),
          isNull(purchaseRequests.deletedAt),
        ),
      )
      .limit(1);
    const header = headers[0];
    if (!header) throw new NotFoundError(`Purchase request ${id} not found`);

    // ── Upstream: vendor (source supplier) ─────────────────────────────────
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
    const vendor = vendorRows[0] ?? null;

    // ── Upstream: item ─────────────────────────────────────────────────────
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

    // ── Upstream: source Sales Order (via SO line → header) ────────────────
    const soRows = header.sourceSoLineId
      ? await tx
          .select({
            id: salesOrders.id,
            code: salesOrders.code,
            status: salesOrders.status,
            date: salesOrders.soDate,
          })
          .from(salesOrderLines)
          .innerJoin(salesOrders, eq(salesOrders.id, salesOrderLines.salesOrderId))
          .where(
            and(
              eq(salesOrderLines.id, header.sourceSoLineId),
              eq(salesOrders.companyId, companyId),
              isNull(salesOrders.deletedAt),
              isNull(salesOrderLines.deletedAt),
            ),
          )
          .limit(1)
      : [];
    const so = soRows[0] ?? null;

    // ── Upstream: source Job Card (OSP) (via JC op → header) ───────────────
    const jcRows = header.sourceJcOpId
      ? await tx
          .select({ id: jobCards.id, code: jobCards.code, date: jobCards.jcDate })
          .from(jcOps)
          .innerJoin(jobCards, eq(jobCards.id, jcOps.jobCardId))
          .where(
            and(
              eq(jcOps.id, header.sourceJcOpId),
              eq(jobCards.companyId, companyId),
              isNull(jobCards.deletedAt),
              isNull(jcOps.deletedAt),
            ),
          )
          .limit(1)
      : [];
    const jc = jcRows[0] ?? null;

    // ── Downstream: generated Purchase Order ───────────────────────────────
    const poRows = header.poId
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
              eq(purchaseOrders.id, header.poId),
              eq(purchaseOrders.companyId, companyId),
              isNull(purchaseOrders.deletedAt),
            ),
          )
          .limit(1)
      : [];
    const po = poRows[0] ?? null;

    // ── Downstream: plans linked to this PR ────────────────────────────────
    // Header-level PR links (design-provisioned / fabrication-order / material).
    const directPlanRows = await tx
      .select({
        id: plans.id,
        code: plans.code,
        status: plans.planStatus,
        date: plans.planDate,
      })
      .from(plans)
      .where(
        and(
          eq(plans.companyId, companyId),
          isNull(plans.deletedAt),
          or(
            eq(plans.dpPrId, id),
            eq(plans.foPrId, id),
            eq(plans.foMatPrId, id),
            eq(plans.materialPrId, id),
          ),
        ),
      );
    // Plans whose outsource op raised this PR (plan_ops.outsource_pr_id).
    const opPlanRows = await tx
      .selectDistinct({
        id: plans.id,
        code: plans.code,
        status: plans.planStatus,
        date: plans.planDate,
      })
      .from(plans)
      .innerJoin(planOps, eq(planOps.planId, plans.id))
      .where(
        and(
          eq(plans.companyId, companyId),
          isNull(plans.deletedAt),
          eq(planOps.outsourcePrId, id),
          isNull(planOps.deletedAt),
        ),
      );
    const planById = new Map<string, (typeof directPlanRows)[number]>();
    for (const p of [...directPlanRows, ...opPlanRows]) planById.set(p.id, p);
    const planRows = Array.from(planById.values());

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

    // ── Upstream sections (what this PR was raised FROM) ───────────────────
    const vendorSection = section(
      'vendor',
      'Vendor',
      '🏭',
      'vendor',
      vendor ? [row(vendor.id, vendor.code, null, null, { label: vendor.name })] : [],
    );
    const itemSection = section(
      'item',
      'Item',
      '📦',
      'item',
      item ? [row(item.id, item.code, null, null, { label: item.name })] : [],
    );
    const soSection = section(
      'sales-order',
      'Source Sales Order',
      '📄',
      'sales-order',
      so ? [row(so.id, so.code, so.status, so.date)] : [],
    );
    const jcSection = section(
      'job-card',
      'Source Job Card (OSP)',
      '📋',
      'job-card',
      jc ? [row(jc.id, jc.code, null, jc.date)] : [],
    );

    // ── Downstream sections (generated from this PR) ───────────────────────
    const poSection = section(
      'purchase-order',
      'Purchase Order',
      '🧾',
      'purchase-order',
      po ? [row(po.id, po.code, po.status, po.date)] : [],
    );
    const plansSection = section(
      'plans',
      'Planning',
      '🗂',
      'plan',
      planRows.map((p) => row(p.id, p.code, p.status, p.date)),
    );

    const upstream = [vendorSection, itemSection, soSection, jcSection];
    const downstream = [poSection, plansSection];
    return {
      self: { module: 'purchase-requests', code: header.code },
      upstream,
      downstream,
      related: [],
      timeline: buildTimeline(
        {
          ts: toIsoDate(header.prDate),
          label: 'Purchase Request created',
          code: header.code,
          routeKind: 'purchase-request',
          linkId: id,
        },
        [...upstream, ...downstream],
      ),
    };
  });
}

// Silence unused-import — purchaseOrders is referenced via the JOIN in raw SQL.
void purchaseOrders;
void jobCards;
