// Below Reorder — the ONE rule (ADR-193 phase 5, spec §15, P19).
//
//   An item is Below Reorder when its type is reorderable
//   (ITEM_TYPE_RULES.reorderable), its Reorder Level (items.min_stock_qty) is
//   more than 0, and Available + On PO < Reorder Level.
//
//   Available = v_item_stock_availability.available_qty (In Stock less what
//               is reserved for orders — sales and assembly, ADR-180 / 3c).
//   On PO     = lib/po-pending.ts onPoByItemSql (ADR-189 #6).
//
// The Store Inventory list, the Reorder List, the one-click PR re-check and
// alert AL-019 all read these helpers, so the four can never disagree.

import { ITEM_TYPE_RULES, type ItemType } from '@innovic/shared';
import { type SQL, sql } from 'drizzle-orm';
import type { DbTransaction } from '../../db/with-user-context';
import { onPoByItemSql } from '../../lib/po-pending';
import { roundQty, WHOLE_NUMBER_UOMS } from '../../lib/stock-ledger';
import { orderedQtySql } from '../purchase-requests/service';

/** Item types kept in stock by Reorder Level (Assembly is built, not bought). */
export const REORDERABLE_TYPES: readonly string[] = (
  Object.keys(ITEM_TYPE_RULES) as ItemType[]
).filter((t) => ITEM_TYPE_RULES[t].reorderable);

export function isReorderableType(itemType: string): boolean {
  return REORDERABLE_TYPES.includes(itemType);
}

/** Pure form of the rule, for code that already holds the numbers. */
export function isBelowReorder(r: {
  itemType: string;
  reorderLevel: number;
  availableQty: number;
  onPoQty: number;
}): boolean {
  return (
    isReorderableType(r.itemType) &&
    r.reorderLevel > 0 &&
    roundQty(r.availableQty + r.onPoQty) < roundQty(r.reorderLevel)
  );
}

export interface BelowReorderRow {
  itemId: string;
  itemCode: string;
  itemName: string | null;
  uom: string;
  itemType: string;
  reorderLevel: number;
  reorderQty: number;
  /** In Stock (physical, reserved or not). */
  physicalQty: number;
  availableQty: number;
  onPoQty: number;
}

/** Every Below Reorder item (optionally only the given ids), by item code. */
export async function readBelowReorder(
  tx: DbTransaction,
  companyId: string,
  itemIds?: readonly string[],
): Promise<BelowReorderRow[]> {
  if (itemIds && itemIds.length === 0) return [];
  const idFrag: SQL = itemIds
    ? sql`AND i.id = ANY(${sql.param(itemIds as string[])}::uuid[])`
    : sql``;
  const rows = (await tx.execute(sql`
    ${belowReorderSql(companyId, idFrag)}
    ORDER BY i.code
  `)) as unknown as Array<Record<string, unknown>>;
  return rows.map(toBelowReorderRow);
}

/** The Below Reorder SELECT (no ORDER BY) — ONE place, read by the full list
 *  above and the paged Reorder List below. */
function belowReorderSql(companyId: string, idFrag: SQL): SQL {
  return sql`
    WITH po_pending AS (${onPoByItemSql(companyId)})
    SELECT
      i.id                                   AS item_id,
      i.code                                 AS item_code,
      i.name                                 AS item_name,
      i.uom::text                            AS uom,
      i.item_type::text                      AS item_type,
      i.min_stock_qty::float8                AS reorder_level,
      i.reorder_qty::float8                  AS reorder_qty,
      COALESCE(a.physical_qty, 0)::float8    AS physical_qty,
      COALESCE(a.available_qty, 0)::float8   AS available_qty,
      COALESCE(p.qty, 0)::float8             AS on_po_qty
    FROM public.items i
    LEFT JOIN public.v_item_stock_availability a
      ON a.item_id = i.id AND a.company_id = i.company_id
    LEFT JOIN po_pending p ON p.item_id = i.id
    WHERE i.company_id = ${companyId}::uuid
      AND i.deleted_at IS NULL
      AND i.item_type::text = ANY(${sql.param(REORDERABLE_TYPES as string[])}::text[])
      AND i.min_stock_qty > 0
      AND COALESCE(a.available_qty, 0) + COALESCE(p.qty, 0) < i.min_stock_qty
      ${idFrag}
  `;
}

function toBelowReorderRow(r: Record<string, unknown>): BelowReorderRow {
  return {
    itemId: String(r['item_id']),
    itemCode: String(r['item_code']),
    itemName: (r['item_name'] as string | null) ?? null,
    uom: String(r['uom']),
    itemType: String(r['item_type']),
    reorderLevel: Number(r['reorder_level'] ?? 0),
    reorderQty: Number(r['reorder_qty'] ?? 0),
    physicalQty: Number(r['physical_qty'] ?? 0),
    availableQty: Number(r['available_qty'] ?? 0),
    onPoQty: Number(r['on_po_qty'] ?? 0),
  };
}

/**
 * One page of the Below Reorder items (Reorder List, ADR-201) + how many there
 * are in all. `b` is the Below Reorder SELECT above; `where` / `orderBy` are
 * the caller's Sort & Filter fragments over `b` (orderBy must end on a unique
 * key). `total` uses the same where as the page.
 */
export async function readBelowReorderPage(
  tx: DbTransaction,
  companyId: string,
  page: { where: SQL; orderBy: SQL; limit: number; offset: number },
): Promise<{ rows: BelowReorderRow[]; total: number }> {
  const base = sql`(${belowReorderSql(companyId, sql``)}) b`;
  const rows = (await tx.execute(sql`
    SELECT b.* FROM ${base}
    WHERE true ${page.where}
    ORDER BY ${page.orderBy}
    LIMIT ${page.limit} OFFSET ${page.offset}
  `)) as unknown as Array<Record<string, unknown>>;
  const cnt = (await tx.execute(sql`
    SELECT COUNT(*)::int AS total FROM ${base} WHERE true ${page.where}
  `)) as unknown as Array<{ total: number }>;
  return { rows: rows.map(toBelowReorderRow), total: Number(cnt[0]?.total ?? 0) };
}

/** Suggested PR qty: max(Reorder Qty, Reorder Level − (Available + On PO)) to
 *  3 places (P44); rounded UP to a whole number for NOS / SET (P45). */
export function suggestedReorderQty(r: BelowReorderRow): number {
  const shortfall = r.reorderLevel - (r.availableQty + r.onPoQty);
  const q = roundQty(Math.max(r.reorderQty, shortfall));
  return WHOLE_NUMBER_UOMS.includes(r.uom) ? Math.ceil(q) : q;
}

export interface OpenPr {
  id: string;
  code: string;
  qty: number;
}

/**
 * The ONE open-PR set (P18), as `FROM ( … ) x WHERE …` over alias `x`
 * (item_id, id, code, qty, ordered): a standard PR, not cancelled, not
 * deleted, balance not short-closed, qty still more than what is on live
 * POs. Read by readOpenPrsByItem below AND by callers that must narrow it
 * (ml-plan's free-supply pool) via `extraWhere` — a fragment starting with
 * AND, over alias `pr` — so a rule change here reaches every reader.
 */
export function openPrBalancesFromSql(
  companyId: string,
  itemIds: readonly string[],
  extraWhere: SQL = sql``,
): SQL {
  const ordered = orderedQtySql({ id: sql`pr.id`, poId: sql`pr.po_id`, qty: sql`pr.qty` });
  return sql`
    FROM (
      SELECT pr.item_id, pr.id, pr.code, pr.qty, ${ordered} AS ordered
      FROM public.purchase_requests pr
      WHERE pr.company_id = ${companyId}::uuid
        AND pr.deleted_at IS NULL
        AND pr.item_id = ANY(${sql.param(itemIds as string[])}::uuid[])
        AND pr.pr_type = 'standard'
        AND pr.status <> 'cancelled'
        AND pr.balance_closed_at IS NULL${extraWhere}
    ) x
    WHERE x.qty > x.ordered`;
}

/**
 * Open PRs per item (P18): a standard (not Job Work OSP) PR, not cancelled,
 * not deleted, balance not short-closed, and qty still more than what is on
 * live POs — exactly the PR list's "convertible" filter
 * (purchase-requests/service.ts orderedQtySql), so a partly ordered PR
 * (status PO Created, balance left) still counts. `qty` is that BALANCE.
 */
export async function readOpenPrsByItem(
  tx: DbTransaction,
  companyId: string,
  itemIds: readonly string[],
): Promise<Map<string, OpenPr[]>> {
  const out = new Map<string, OpenPr[]>();
  if (itemIds.length === 0) return out;
  const rows = (await tx.execute(sql`
    SELECT x.item_id, x.id, x.code, (x.qty - x.ordered)::float8 AS qty${openPrBalancesFromSql(companyId, itemIds)}
    ORDER BY x.code
  `)) as unknown as Array<Record<string, unknown>>;
  for (const r of rows) {
    const key = String(r['item_id']);
    const list = out.get(key) ?? [];
    list.push({
      id: String(r['id']),
      code: String(r['code']),
      qty: roundQty(Number(r['qty'] ?? 0)),
    });
    out.set(key, list);
  }
  return out;
}

export interface SuggestedVendor {
  id: string;
  code: string;
  name: string;
}

/** Vendor of each item's latest purchase order line (by PO date, then created
 *  at): PO issued (not draft / cancelled), not deleted, not a service PO, not
 *  an outsourced job-card operation — the same OSP exclusion as
 *  onPoByItemSql (that vendor processed our pieces, it did not supply the
 *  item) — and the vendor still active. A PO that names its vendor only as
 *  text is matched to the master by code. */
export async function readSuggestedVendors(
  tx: DbTransaction,
  companyId: string,
  itemIds: readonly string[],
): Promise<Map<string, SuggestedVendor>> {
  const out = new Map<string, SuggestedVendor>();
  if (itemIds.length === 0) return out;
  const rows = (await tx.execute(sql`
    SELECT DISTINCT ON (pol.item_id)
      pol.item_id, v.id AS vendor_id, v.code AS vendor_code, v.name AS vendor_name
    FROM public.purchase_order_lines pol
    JOIN public.purchase_orders po ON po.id = pol.purchase_order_id
    JOIN public.vendors v
      ON v.company_id = po.company_id AND v.deleted_at IS NULL AND v.is_active
     AND (v.id = po.vendor_id
          OR (po.vendor_id IS NULL
              AND upper(btrim(v.code)) = upper(btrim(po.vendor_code_text))))
    WHERE po.company_id = ${companyId}::uuid
      AND pol.company_id = ${companyId}::uuid
      AND po.deleted_at IS NULL
      AND pol.deleted_at IS NULL
      AND po.status NOT IN ('draft', 'cancelled')
      AND po.po_type <> 'service'
      AND pol.source_jc_op_id IS NULL
      AND NOT EXISTS (SELECT 1 FROM public.jc_op_po_lines jl
                      WHERE jl.purchase_order_line_id = pol.id AND jl.deleted_at IS NULL)
      AND pol.item_id = ANY(${sql.param(itemIds as string[])}::uuid[])
    ORDER BY pol.item_id, po.po_date DESC, po.created_at DESC
  `)) as unknown as Array<Record<string, unknown>>;
  for (const r of rows) {
    out.set(String(r['item_id']), {
      id: String(r['vendor_id']),
      code: String(r['vendor_code']),
      name: String(r['vendor_name']),
    });
  }
  return out;
}
