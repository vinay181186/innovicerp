// Material requirement — ADR-193 phase 3b (spec §11 "Read model").
//
// The ONE place the Job Card / Assembly SO material numbers are computed, so
// the Item Issue guard (store-issues/service.ts) and the Material view
// (modules/material) can never disagree. Derived on every read — never stored.
//
//   Job Card     planned when the card has an RM item + qty per piece:
//                Required = rm_qty_per_piece × order_qty
//                Balance  = Required − Issued + Returned
//   Assembly SO  per BOM part: Required = qty_per_set × units (Σ SO line qty)
//                Balance to issue = Required − Issued + Returned
//
// Issued / Returned count only slips that are NOT reversed (a reversal puts
// the whole slip back, so it no longer counts as issued).

import { sql } from 'drizzle-orm';
import type { DbTransaction } from '../db/with-user-context';
import { roundQty } from './stock-ledger';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function num(v: unknown): number {
  return Number(v ?? 0);
}

// ─── Items ────────────────────────────────────────────────────────────────

export interface ItemInfo {
  id: string;
  code: string;
  name: string | null;
  uom: string | null;
}

export async function readItemInfo(
  tx: DbTransaction,
  companyId: string,
  itemIds: readonly string[],
): Promise<Map<string, ItemInfo>> {
  const out = new Map<string, ItemInfo>();
  if (itemIds.length === 0) return out;
  const rows = (await tx.execute(sql`
    SELECT id, code, name, uom::text AS uom
    FROM public.items
    WHERE company_id = ${companyId}::uuid
      AND id = ANY(${sql.param(itemIds as string[])}::uuid[])
  `)) as unknown as Array<{ id: string; code: string; name: string | null; uom: string | null }>;
  for (const r of rows) out.set(r.id, { id: r.id, code: r.code, name: r.name, uom: r.uom });
  return out;
}

// ─── Issued / Returned per item ─────────────────────────────────────────────

export interface IssuedReturned {
  issued: number;
  returned: number;
}

export type IssueScope = { jobCardId: string } | { salesOrderId: string };

function scopeFrag(scope: IssueScope) {
  return 'jobCardId' in scope
    ? sql`si.job_card_id = ${scope.jobCardId}::uuid`
    : sql`si.sales_order_id = ${scope.salesOrderId}::uuid`;
}

/** Σ issued and Σ returned per item over the non-reversed slips of one JC / SO. */
export async function readIssuedReturned(
  tx: DbTransaction,
  companyId: string,
  scope: IssueScope,
): Promise<Map<string, IssuedReturned>> {
  const rows = (await tx.execute(sql`
    SELECT l.item_id,
           COALESCE(SUM(l.qty), 0) AS issued,
           COALESCE(SUM(r.ret), 0) AS returned
    FROM public.store_issue_lines l
    JOIN public.store_issues si ON si.id = l.issue_id
    LEFT JOIN LATERAL (
      SELECT SUM(x.qty) AS ret
      FROM public.store_issue_returns x
      WHERE x.issue_line_id = l.id AND x.deleted_at IS NULL
    ) r ON true
    WHERE si.company_id = ${companyId}::uuid
      AND si.deleted_at IS NULL
      AND si.reversed_at IS NULL
      AND l.deleted_at IS NULL
      AND ${scopeFrag(scope)}
    GROUP BY l.item_id
  `)) as unknown as Array<{ item_id: string; issued: unknown; returned: unknown }>;
  const out = new Map<string, IssuedReturned>();
  for (const r of rows) {
    out.set(r.item_id, { issued: roundQty(num(r.issued)), returned: roundQty(num(r.returned)) });
  }
  return out;
}

// ─── Slip summaries (register row + material view) ──────────────────────────

/** LEFT JOIN LATERAL `ls` (line_count, first_line) for a header aliased `si`. */
export const slipSummaryLateral = sql`
  LEFT JOIN LATERAL (
    SELECT COUNT(*)::int AS line_count,
           (array_agg(
              COALESCE(li.code, l.item_code_text) || ' × ' || trim_scale(l.qty)::text
              ORDER BY l.line_no
           ))[1] AS first_line
    FROM public.store_issue_lines l
    LEFT JOIN public.items li ON li.id = l.item_id
    WHERE l.issue_id = si.id AND l.deleted_at IS NULL
  ) ls ON true`;

/** "ITEM-A × 12.5" or "ITEM-A × 12 +2 more"; a pre-slip row with no line falls
 *  back to its own old single-item columns. */
export function itemsSummaryOf(r: {
  first_line?: unknown;
  line_count?: unknown;
  legacy_code?: unknown;
  legacy_qty?: unknown;
}): string {
  const count = num(r.line_count);
  if (r.first_line) {
    return count > 1 ? `${String(r.first_line)} +${count - 1} more` : String(r.first_line);
  }
  if (r.legacy_code) {
    return r.legacy_qty != null
      ? `${String(r.legacy_code)} × ${num(r.legacy_qty)}`
      : String(r.legacy_code);
  }
  return '';
}

export interface SlipBrief {
  id: string;
  code: string;
  issueDate: string;
  itemsSummary: string;
  issuedTo: string;
  reversedAt: string | null;
}

/** Every slip of one JC / SO, reversed ones included, newest first. */
export async function readSlipsFor(
  tx: DbTransaction,
  companyId: string,
  scope: IssueScope,
): Promise<SlipBrief[]> {
  const rows = (await tx.execute(sql`
    SELECT si.id, si.code, si.issue_date::text AS issue_date, si.issued_to, si.reversed_at,
           si.item_code_text AS legacy_code, si.qty AS legacy_qty,
           ls.line_count, ls.first_line
    FROM public.store_issues si
    ${slipSummaryLateral}
    WHERE si.company_id = ${companyId}::uuid
      AND si.deleted_at IS NULL
      AND ${scopeFrag(scope)}
    ORDER BY si.issue_date DESC, si.code DESC
  `)) as unknown as Array<Record<string, unknown>>;
  return rows.map((r) => ({
    id: String(r['id']),
    code: String(r['code']),
    issueDate: String(r['issue_date']),
    itemsSummary: itemsSummaryOf(r),
    issuedTo: String(r['issued_to'] ?? ''),
    reversedAt: r['reversed_at'] ? new Date(String(r['reversed_at'])).toISOString() : null,
  }));
}

// ─── Job Card ─────────────────────────────────────────────────────────────

export interface JcHead {
  id: string;
  code: string;
  orderQty: number;
  productionOrderId: string | null;
  rmItemId: string | null;
  rmQtyPerPiece: number | null;
  /** The card is closed (job_cards.closed_at) — no new issues. */
  closed: boolean;
}

export async function readJcHead(
  tx: DbTransaction,
  companyId: string,
  jobCardId: string,
): Promise<JcHead | null> {
  const rows = (await tx.execute(sql`
    SELECT id, code, order_qty, production_order_id,
           raw_material_item_id, rm_qty_per_piece, closed_at
    FROM public.job_cards
    WHERE id = ${jobCardId}::uuid AND company_id = ${companyId}::uuid AND deleted_at IS NULL
  `)) as unknown as Array<Record<string, unknown>>;
  const r = rows[0];
  if (!r) return null;
  return {
    id: String(r['id']),
    code: String(r['code']),
    orderQty: num(r['order_qty']),
    productionOrderId: (r['production_order_id'] as string | null) ?? null,
    rmItemId: (r['raw_material_item_id'] as string | null) ?? null,
    rmQtyPerPiece: r['rm_qty_per_piece'] != null ? num(r['rm_qty_per_piece']) : null,
    closed: r['closed_at'] != null,
  };
}

/** The card's RM requirement, or null when it has none (issues are not capped). */
export function jcRequirement(jc: JcHead): { itemId: string; required: number } | null {
  if (!jc.rmItemId || jc.rmQtyPerPiece == null) return null;
  return { itemId: jc.rmItemId, required: roundQty(jc.rmQtyPerPiece * jc.orderQty) };
}

export function balanceOf(required: number, got: IssuedReturned | undefined): number {
  return roundQty(required - (got?.issued ?? 0) + (got?.returned ?? 0));
}

// ─── Assembly (Equipment) SO ────────────────────────────────────────────────

export interface SoHead {
  id: string;
  code: string;
  /** ADR-207 — the SO's Internal SO No. (null on an old SO). */
  internalSoNo: string | null;
  isEquipment: boolean;
  /** The SO's BOM when it is a valid uuid of a live BOM in this company. */
  bomId: string | null;
  units: number;
  /** so_status — a cancelled / closed SO takes no more issues. */
  status: string;
}

export async function readSoHead(
  tx: DbTransaction,
  companyId: string,
  salesOrderId: string,
): Promise<SoHead | null> {
  const rows = (await tx.execute(sql`
    SELECT id, code, internal_so_no, type::text AS type, status::text AS status, bom_master_id
    FROM public.sales_orders
    WHERE id = ${salesOrderId}::uuid AND company_id = ${companyId}::uuid AND deleted_at IS NULL
  `)) as unknown as Array<{
    id: string;
    code: string;
    internal_so_no: string | null;
    type: string;
    status: string;
    bom_master_id: string | null;
  }>;
  const r = rows[0];
  if (!r) return null;
  let bomId: string | null = null;
  // bom_master_id is TEXT on sales_orders — guard before the ::uuid cast.
  if (r.bom_master_id && UUID_RE.test(r.bom_master_id)) {
    const bom = (await tx.execute(sql`
      SELECT id FROM public.bom_masters
      WHERE id = ${r.bom_master_id}::uuid AND company_id = ${companyId}::uuid
        AND deleted_at IS NULL
    `)) as unknown as Array<{ id: string }>;
    bomId = bom[0]?.id ?? null;
  }
  // Units = Σ order_qty of the SO's live lines (same as assembly sumEquipmentLineQty).
  const u = (await tx.execute(sql`
    SELECT COALESCE(SUM(order_qty), 0)::int AS q
    FROM public.sales_order_lines
    WHERE sales_order_id = ${r.id}::uuid AND deleted_at IS NULL
  `)) as unknown as Array<{ q: number }>;
  return {
    id: r.id,
    code: r.code,
    internalSoNo: r.internal_so_no ?? null,
    isEquipment: r.type === 'equipment',
    bomId,
    units: num(u[0]?.q),
    status: r.status,
  };
}

export interface BomPart {
  itemId: string;
  qtyPerSet: number;
  required: number;
}

/** One entry per BOM child item (qty_per_set summed if a child repeats). */
export async function readBomParts(
  tx: DbTransaction,
  companyId: string,
  bomId: string,
  units: number,
): Promise<Map<string, BomPart>> {
  const rows = (await tx.execute(sql`
    SELECT child_item_id, SUM(qty_per_set) AS qps, MIN(line_no) AS first_no
    FROM public.bom_master_lines
    WHERE bom_master_id = ${bomId}::uuid AND company_id = ${companyId}::uuid
      AND deleted_at IS NULL
    GROUP BY child_item_id
    ORDER BY MIN(line_no)
  `)) as unknown as Array<{ child_item_id: string; qps: unknown }>;
  const out = new Map<string, BomPart>();
  for (const r of rows) {
    const qtyPerSet = num(r.qps);
    out.set(r.child_item_id, {
      itemId: r.child_item_id,
      qtyPerSet,
      required: roundQty(qtyPerSet * units),
    });
  }
  return out;
}

/** Reservations on these items still held by OTHER SOs (remaining > 0), per
 *  SO code: sales reservations (so_stock_reservations) AND assembly part
 *  reservations (assembly_part_reservations, ADR-193 3c), summed per SO. */
export async function readBookedForOthers(
  tx: DbTransaction,
  companyId: string,
  itemIds: readonly string[],
  exceptSalesOrderId: string,
): Promise<Map<string, Array<{ soCode: string; soInternalNo: string | null; qty: number }>>> {
  const out = new Map<
    string,
    Array<{ soCode: string; soInternalNo: string | null; qty: number }>
  >();
  if (itemIds.length === 0) return out;
  const ids = sql.param(itemIds as string[]);
  const rows = (await tx.execute(sql`
    SELECT x.item_id, x.so_code_text, SUM(x.held) AS held,
           -- ADR-207 — the holder SO's Internal SO No., read live by its code.
           (SELECT so.internal_so_no FROM public.sales_orders so
             WHERE so.company_id = ${companyId}::uuid AND so.code = x.so_code_text
               AND so.deleted_at IS NULL
             LIMIT 1) AS so_internal_no
    FROM (
      SELECT r.item_id, r.so_code_text, (r.qty - r.consumed_qty - r.released_qty)::numeric AS held
      FROM public.so_stock_reservations r
      WHERE r.company_id = ${companyId}::uuid
        AND r.deleted_at IS NULL
        AND r.status IN ('active', 'partially_consumed')
        AND r.item_id = ANY(${ids}::uuid[])
        AND r.so_line_id NOT IN (
          SELECT sl.id FROM public.sales_order_lines sl
          WHERE sl.sales_order_id = ${exceptSalesOrderId}::uuid
        )
      UNION ALL
      SELECT a.item_id, a.so_code_text, (a.qty - a.consumed_qty - a.released_qty)::numeric AS held
      FROM public.assembly_part_reservations a
      WHERE a.company_id = ${companyId}::uuid
        AND a.deleted_at IS NULL
        AND a.status IN ('active', 'partially_consumed')
        AND a.item_id = ANY(${ids}::uuid[])
        AND a.sales_order_id <> ${exceptSalesOrderId}::uuid
    ) x
    GROUP BY x.item_id, x.so_code_text
    HAVING SUM(x.held) > 0
    ORDER BY x.so_code_text
  `)) as unknown as Array<{
    item_id: string;
    so_code_text: string;
    held: unknown;
    so_internal_no: string | null;
  }>;
  for (const r of rows) {
    const list = out.get(r.item_id) ?? [];
    list.push({
      soCode: r.so_code_text,
      soInternalNo: r.so_internal_no ?? null,
      qty: roundQty(num(r.held)),
    });
    out.set(r.item_id, list);
  }
  return out;
}
