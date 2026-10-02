// GET /store-inventory — per-item rollup of current stock + reserved + open
// PO pending + at vendor + open JC pending (PL-SI-1, legacy renderStore HTML
// L24803). Split out of service.ts for ADR-201.
//
// 25 rows a page (ADR-201): the screen sends limit / offset; search, the
// All / Below Reorder / Zero Stock filter and Sort & Filter (ADR-200) all run
// in SQL over every item, and the summary tiles are SQL sums over every item
// matching search + Sort & Filter (not the tile filter — picking a filter must
// not change its own count). With no `limit` every matching row comes back,
// as before (the Manual Receipt modal reads one item that way).

import { sql } from 'drizzle-orm';
import type {
  ListStoreInventoryQuery,
  ListStoreInventoryResponse,
  StoreInventoryRow,
} from '@innovic/shared';
import { type AuthContext, withUserContext } from '../../db/with-user-context';
import { requireAnyFormAccess, STORE_VIEW_FORMS } from '../../lib/access';
import { AuthorizationError } from '../../lib/errors';
import { likeEscape, readSf, sfOrderBy, sfWhere } from '../../lib/list-query';
import { onPoByItemSql } from '../../lib/po-pending';
import { REORDERABLE_TYPES } from './reorder-rule';
import { STORE_INV_SF_COLUMNS } from './sf-columns';

function requireCompany(user: AuthContext): string {
  if (!user.companyId) throw new AuthorizationError('User is not assigned to a company');
  return user.companyId;
}

interface InvRaw {
  item_id: string;
  item_code: string;
  item_name: string;
  material: string | null;
  uom: string;
  in_stock: number;
  reserved_qty: number;
  available_qty: number;
  reorder_level: number;
  reorder_qty: number;
  on_po_qty: number;
  at_vendor_qty: number;
  mfg_pending_qty: number;
  below_reorder: boolean;
}

interface SummaryRaw {
  total_items: number;
  total_stock: number;
  total_reserved: number;
  in_stock_count: number;
  below_count: number;
  zero_count: number;
  total: number;
}

export async function listStoreInventory(
  input: ListStoreInventoryQuery,
  user: AuthContext,
): Promise<ListStoreInventoryResponse> {
  await requireAnyFormAccess(user, STORE_VIEW_FORMS);
  const companyId = requireCompany(user);
  return withUserContext(user, async (tx) => {
    // Every text column the Store Inventory row shows: Item Code, Name,
    // Material and UOM. The rest of the row is quantities, which stay out: a
    // partial match on a number makes "5" hit almost every item.
    // `uom` is a Postgres enum, so it needs the ::text cast the others do not.
    const term = input.search ? `%${likeEscape(input.search)}%` : null;
    const searchFrag = term
      ? sql`AND (
          i.code ILIKE ${term} ESCAPE '\\'
          OR i.name ILIKE ${term} ESCAPE '\\'
          OR i.material ILIKE ${term} ESCAPE '\\'
          OR i.uom::text ILIKE ${term} ESCAPE '\\'
        )`
      : sql``;
    const sf = readSf(input.sf);
    const sfFrag = sfWhere(STORE_INV_SF_COLUMNS, sf);
    const tileFrag =
      input.filter === 'below'
        ? sql`AND b.below_reorder`
        : input.filter === 'zero'
          ? sql`AND b.in_stock = 0`
          : sql``;

    // One row per item with every figure the screen shows, so the page, the
    // tile filter, Sort & Filter and the summary all read the same numbers.
    // Reserved = v_item_stock_availability (sales + assembly bookings,
    // ADR-180 / 3c), floored at 0; Available = In Stock − Reserved; Below
    // Reorder = the ONE rule in reorder-rule.ts (reorderable type, level > 0,
    // Available + On PO < level, both rounded to 3 places), in SQL.
    const baseCte = sql`
      WITH jc_open AS (
        SELECT
          jc.item_id,
          SUM(GREATEST(jc.order_qty - COALESCE(comp.completed, 0), 0))::int AS qty
        FROM public.job_cards jc
        LEFT JOIN public.v_jc_status v ON v.job_card_id = jc.id
        LEFT JOIN LATERAL (
          -- "Completed" for a job card = output of its LAST operation, NOT the sum
          -- across every op. A JC is the SAME pieces flowing op → op; summing each
          -- op's logged output multi-counts them and wildly understates (often to
          -- 0) Mfg Pending on multi-op routes. Mirror the canonical
          -- lastOpCompletedQty (job-cards/service.ts): a QC / qc-required
          -- final op credits accepted qty, else completed qty — from the highest
          -- op_seq.
          SELECT CASE WHEN vos.op_type = 'qc' OR vos.qc_required
                      THEN vos.qc_accepted_qty ELSE vos.completed_qty END AS completed
          FROM public.v_jc_op_status vos
          WHERE vos.job_card_id = jc.id
          ORDER BY vos.op_seq DESC LIMIT 1
        ) comp ON TRUE
        WHERE jc.company_id = ${companyId}::uuid
          AND jc.deleted_at IS NULL
          AND (v.computed_status IS NULL OR v.computed_status NOT IN ('complete', 'closed'))
        GROUP BY jc.item_id
      ),
      -- ADR-189 — the one On PO rule (lib/po-pending.ts).
      po_pending AS (${onPoByItemSql(companyId)}),
      -- Pieces physically at an OSP vendor: sent on an outward DC, not yet
      -- returned. Document-derived via v_osp_wip (ADR-066); deliberately NOT
      -- in the stock ledger (ADR-067), so it must be surfaced as its own
      -- column or the row silently understates where the material is.
      at_vendor AS (
        SELECT w.item_id, SUM(w.at_vendor_qty)::numeric AS qty
        FROM public.v_osp_wip w
        WHERE w.company_id = ${companyId}::uuid
          AND w.item_id IS NOT NULL
        GROUP BY w.item_id
      ),
      base AS (
        SELECT
          i.id                                              AS item_id,
          i.code                                            AS item_code,
          i.name                                            AS item_name,
          i.material                                        AS material,
          i.uom::text                                       AS uom,
          COALESCE(s.on_hand_qty, 0)::numeric               AS in_stock,
          GREATEST(COALESCE(a.reserved_qty, 0), 0)::numeric AS reserved_qty,
          (COALESCE(s.on_hand_qty, 0)
            - GREATEST(COALESCE(a.reserved_qty, 0), 0))::numeric AS available_qty,
          i.min_stock_qty::numeric                          AS reorder_level,
          i.reorder_qty::numeric                            AS reorder_qty,
          COALESCE(po_pending.qty, 0)::numeric              AS on_po_qty,
          COALESCE(at_vendor.qty, 0)::numeric               AS at_vendor_qty,
          COALESCE(jc_open.qty, 0)::int                     AS mfg_pending_qty,
          (
            i.item_type::text = ANY(${sql.param(REORDERABLE_TYPES as string[])}::text[])
            AND COALESCE(i.min_stock_qty, 0) > 0
            AND round(
              (COALESCE(s.on_hand_qty, 0) - GREATEST(COALESCE(a.reserved_qty, 0), 0)
                + COALESCE(po_pending.qty, 0))::numeric, 3)
              < round(i.min_stock_qty::numeric, 3)
          )                                                 AS below_reorder
        FROM public.items i
        LEFT JOIN public.v_item_stock s
          ON s.item_id = i.id AND s.company_id = i.company_id
        LEFT JOIN public.v_item_stock_availability a
          ON a.item_id = i.id AND a.company_id = i.company_id
        LEFT JOIN jc_open ON jc_open.item_id = i.id
        LEFT JOIN po_pending ON po_pending.item_id = i.id
        LEFT JOIN at_vendor ON at_vendor.item_id = i.id
        WHERE i.company_id = ${companyId}::uuid
          AND i.deleted_at IS NULL
          ${searchFrag}
      )`;

    // Ends on the item id so paging never skips or repeats a row.
    const orderBy = sfOrderBy(STORE_INV_SF_COLUMNS, sf, sql`b.item_code ASC, b.item_id ASC`);
    const pageFrag =
      input.limit !== undefined ? sql`LIMIT ${input.limit} OFFSET ${input.offset}` : sql``;

    const typed = (await tx.execute(sql`
      ${baseCte}
      SELECT
        b.item_id, b.item_code, b.item_name, b.material, b.uom,
        b.in_stock::float8 AS in_stock, b.reserved_qty::float8 AS reserved_qty,
        b.available_qty::float8 AS available_qty, b.reorder_level::float8 AS reorder_level,
        b.reorder_qty::float8 AS reorder_qty, b.on_po_qty::float8 AS on_po_qty,
        b.at_vendor_qty::float8 AS at_vendor_qty, b.mfg_pending_qty, b.below_reorder
      FROM base b
      WHERE TRUE ${sfFrag} ${tileFrag}
      ORDER BY ${orderBy}
      ${pageFrag}
    `)) as unknown as InvRaw[];

    const [agg] = (await tx.execute(sql`
      ${baseCte}
      SELECT
        count(*)::int                                 AS total_items,
        COALESCE(sum(b.in_stock), 0)::float8          AS total_stock,
        COALESCE(sum(b.reserved_qty), 0)::float8      AS total_reserved,
        count(*) FILTER (WHERE b.in_stock > 0)::int   AS in_stock_count,
        count(*) FILTER (WHERE b.below_reorder)::int  AS below_count,
        count(*) FILTER (WHERE b.in_stock = 0)::int   AS zero_count,
        count(*) FILTER (WHERE TRUE ${tileFrag})::int AS total
      FROM base b
      WHERE TRUE ${sfFrag}
    `)) as unknown as SummaryRaw[];

    const rows: StoreInventoryRow[] = typed.map((r) => ({
      itemId: r.item_id,
      itemCode: r.item_code,
      itemName: r.item_name,
      material: r.material,
      uom: r.uom,
      inStock: Number(r.in_stock),
      reservedQty: Number(r.reserved_qty),
      availableQty: Number(r.available_qty),
      reorderLevel: Number(r.reorder_level),
      reorderQty: Number(r.reorder_qty),
      onPoQty: Number(r.on_po_qty),
      atVendorQty: Number(r.at_vendor_qty),
      mfgPendingQty: Number(r.mfg_pending_qty),
      // ADR-193 phase 5 (P19) — the one rule, in SQL above.
      belowReorder: Boolean(r.below_reorder),
    }));

    const totalStockPieces = Number(agg?.total_stock ?? 0);
    const totalReservedPieces = Number(agg?.total_reserved ?? 0);
    return {
      generatedAt: new Date().toISOString(),
      filter: input.filter,
      rows,
      total: Number(agg?.total ?? 0),
      summary: {
        totalItems: Number(agg?.total_items ?? 0),
        totalStockPieces,
        totalReservedPieces,
        // Clamped at 0: a negative free-stock total would only ever be a data
        // fault, and showing it as a tile figure helps nobody.
        totalAvailablePieces: Math.max(0, totalStockPieces - totalReservedPieces),
        itemsInStockCount: Number(agg?.in_stock_count ?? 0),
        belowReorderCount: Number(agg?.below_count ?? 0),
        zeroStockCount: Number(agg?.zero_count ?? 0),
      },
    };
  });
}
