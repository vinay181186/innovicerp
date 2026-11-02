// GET /store-inventory — current stock + reserved + open PO pending + at
// vendor + open JC pending (PL-SI-1, legacy renderStore HTML L24803). Split
// out of service.ts for ADR-201.
//
// Drawing Rev register (owner 2026-11-02): one row per Item + Drawing Rev
// bucket for MAKE items (items.procurement_type = 'make') — ABC/1, ABC/2 and
// "ABC · no Rev" for old stock — and one row per Buy item, exactly as before.
//
// 25 rows a page (ADR-201): the screen sends limit / offset; search, the
// All / Below Reorder / Zero Stock filter and Sort & Filter (ADR-200) all run
// in SQL over every row, and the summary tiles are SQL figures over every row
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
import { BLANK_REV_KEY } from '../../lib/stock-reservation';
import { REORDERABLE_TYPES } from './reorder-rule';
import { STORE_INV_SF_COLUMNS } from './sf-columns';

function requireCompany(user: AuthContext): string {
  if (!user.companyId) throw new AuthorizationError('User is not assigned to a company');
  return user.companyId;
}

interface InvRaw {
  row_key: string;
  item_id: string;
  item_revision_id: string | null;
  drawing_rev: string | null;
  item_label: string;
  reorder_row: boolean;
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
    // Every text column the Store Inventory row shows: Item Code (and the
    // row's Item + Rev label, so "ABC/1" hits only that row while "ABC" hits
    // all of ABC's rows), Name, Material and UOM. Quantities stay out: a
    // partial match on a number makes "5" hit almost every item.
    //
    // Two halves. `itemSearchFrag` runs inside item_base so the bucket CTEs are
    // only built for items that can match (code / name / material / uom, or a
    // "CODE/REV" / "CODE · no Rev" label of the item); it is a superset of the
    // row filter. `searchFrag` is the row filter on the final rows, so
    // "ABC/1" still returns only that row.
    const term = input.search ? `%${likeEscape(input.search)}%` : null;
    const itemSearchFrag = term
      ? sql`AND (
          i.code ILIKE ${term} ESCAPE '\\'
          OR i.name ILIKE ${term} ESCAPE '\\'
          OR i.material ILIKE ${term} ESCAPE '\\'
          OR i.uom::text ILIKE ${term} ESCAPE '\\'
          OR (i.procurement_type = 'make'
              AND (i.code || ' · no Rev') ILIKE ${term} ESCAPE '\\')
          OR (i.procurement_type = 'make' AND EXISTS (
                SELECT 1 FROM public.item_revisions ir
                 WHERE ir.company_id = i.company_id AND ir.item_id = i.id
                   AND (i.code || '/' || ir.rev) ILIKE ${term} ESCAPE '\\'))
        )`
      : sql``;
    const searchFrag = term
      ? sql`AND (
          b.item_label ILIKE ${term} ESCAPE '\\'
          OR b.item_code ILIKE ${term} ESCAPE '\\'
          OR b.item_name ILIKE ${term} ESCAPE '\\'
          OR b.material ILIKE ${term} ESCAPE '\\'
          OR b.uom ILIKE ${term} ESCAPE '\\'
        )`
      : sql``;
    const sf = readSf(input.sf);
    const sfFrag = sfWhere(STORE_INV_SF_COLUMNS, sf);
    // Zero Stock reads the ITEM total, so the list shows the same items the
    // Zero Stock tile counts (every row of each).
    const tileFrag =
      input.filter === 'below'
        ? sql`AND b.below_reorder`
        : input.filter === 'zero'
          ? sql`AND b.item_in_stock = 0`
          : sql``;

    // A MAKE item's rows add up EXACTLY to its item-level figures (the ones
    // Below Reorder reads):
    //   • In Stock per bucket from v_item_rev_stock_availability (0233/0234).
    //     Item In Stock stays v_item_stock (item_stock_balances); any gap
    //     between the two ledgers (should be 0 — the same trigger writes
    //     both) is put on the blank "no Rev" bucket, so the rows still add up.
    //   • Reserved: the item figure is v_item_stock_availability floored ONCE
    //     at 0, as before. Buckets take their own booked qty (a negative
    //     bucket counts as 0) and that item figure is handed out in Rev order
    //     — each bucket gets min(its booking, what is left of the item
    //     figure). Normally that is each bucket's own booking; it only bites
    //     on a data fault (negative booking, or bookings on an item with no
    //     balance row, which the item view reads as 0).
    //   • Mfg Pending per bucket from the open Job Card's item_revision_id,
    //     kept numeric (no per-bucket rounding), so buckets sum to the item.
    //   • At Vendor per bucket from the Job Card behind the v_osp_wip row.
    //   • On PO is an ITEM fact (a PO line has no Rev): every row of the item
    //     shows the item's On PO, like Reorder Level / Qty / Below Reorder.
    // A bucket with nothing in any column is dropped (same rule as the Rev
    // breakdown, rev-stock.ts); an item with no bucket left shows one blank
    // row of zeros so it still appears. Below Reorder is the ONE rule in
    // reorder-rule.ts on item totals (reorderable type, level > 0, Available +
    // On PO < level, both rounded to 3 places). reorderRow marks the item's
    // first row (Rev order, blank bucket last) — the one row that carries the
    // item-level figures for anything that totals them.
    //
    // Rev order mirrors compareRevision (packages/shared lib/revision.ts):
    // all-digit Revs as numbers (2 before 10), all-letter Revs by length then
    // text (Z before AA), anything else as text; digits, then letters, then
    // the rest; the blank bucket last.
    const blank = sql.raw(`'${BLANK_REV_KEY}'::uuid`);
    const baseCte = sql`
      WITH
      -- ADR-189 — the one On PO rule (lib/po-pending.ts).
      po_pending AS (${onPoByItemSql(companyId)}),
      -- Item-level figures (unchanged): totals, reorder, Below Reorder.
      -- Reserved = v_item_stock_availability (sales + assembly bookings,
      -- ADR-180 / 3c), floored at 0.
      item_base AS (
        SELECT
          i.id                                              AS item_id,
          i.code                                            AS item_code,
          i.name                                            AS item_name,
          i.material                                        AS material,
          i.uom::text                                       AS uom,
          (i.procurement_type = 'make')                     AS is_make,
          COALESCE(s.on_hand_qty, 0)::numeric               AS in_stock,
          GREATEST(COALESCE(a.reserved_qty, 0), 0)::numeric AS reserved_qty,
          i.min_stock_qty::numeric                          AS reorder_level,
          i.reorder_qty::numeric                            AS reorder_qty,
          COALESCE(po_pending.qty, 0)::numeric              AS on_po_qty,
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
        LEFT JOIN po_pending ON po_pending.item_id = i.id
        WHERE i.company_id = ${companyId}::uuid
          AND i.deleted_at IS NULL
          ${itemSearchFrag}
      ),
      jc_open AS (
        SELECT
          jc.item_id,
          COALESCE(jc.item_revision_id, ${blank}) AS rev_key,
          SUM(GREATEST(jc.order_qty - COALESCE(comp.completed, 0), 0))::numeric AS qty
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
          AND jc.item_id IN (SELECT item_id FROM item_base)
          AND (v.computed_status IS NULL OR v.computed_status NOT IN ('complete', 'closed'))
        GROUP BY jc.item_id, COALESCE(jc.item_revision_id, ${blank})
      ),
      jc_open_item AS (
        SELECT item_id, SUM(qty)::numeric AS qty FROM jc_open GROUP BY item_id
      ),
      -- Pieces physically at an OSP vendor: sent on an outward DC, not yet
      -- returned. Document-derived via v_osp_wip (ADR-066); deliberately NOT
      -- in the stock ledger (ADR-067), so it must be surfaced as its own
      -- column or the row silently understates where the material is.
      -- Bucket = the Drawing Rev of the Job Card the op belongs to.
      at_vendor AS (
        SELECT w.item_id, COALESCE(jc.item_revision_id, ${blank}) AS rev_key,
               SUM(w.at_vendor_qty)::numeric AS qty
        FROM public.v_osp_wip w
        LEFT JOIN public.job_cards jc ON jc.id = w.job_card_id
        WHERE w.company_id = ${companyId}::uuid
          AND w.item_id IN (SELECT item_id FROM item_base)
        GROUP BY w.item_id, COALESCE(jc.item_revision_id, ${blank})
      ),
      at_vendor_item AS (
        SELECT item_id, SUM(qty)::numeric AS qty FROM at_vendor GROUP BY item_id
      ),
      rev_avail AS (
        SELECT ra.item_id, ra.rev_key, ra.on_hand_qty, ra.reserved_qty
        FROM public.v_item_rev_stock_availability ra
        WHERE ra.company_id = ${companyId}::uuid
          AND ra.item_id IN (SELECT item_id FROM item_base WHERE is_make)
      ),
      rev_item AS (
        SELECT item_id, SUM(on_hand_qty)::numeric AS on_hand_qty
        FROM rev_avail GROUP BY item_id
      ),
      -- In Stock the Rev ledger does not account for (normally none) → blank bucket.
      stock_gap AS (
        SELECT ib.item_id, (ib.in_stock - COALESCE(ri.on_hand_qty, 0))::numeric AS qty
        FROM item_base ib
        LEFT JOIN rev_item ri ON ri.item_id = ib.item_id
        WHERE ib.is_make AND ib.in_stock <> COALESCE(ri.on_hand_qty, 0)
      ),
      bucket_keys AS (
        SELECT item_id, rev_key FROM rev_avail
        UNION SELECT item_id, rev_key FROM jc_open
        UNION SELECT item_id, rev_key FROM at_vendor
        UNION SELECT item_id, ${blank} FROM stock_gap
      ),
      make_raw AS (
        SELECT
          ib.item_id,
          NULLIF(k.rev_key, ${blank})                        AS item_revision_id,
          r.rev                                              AS drawing_rev,
          (COALESCE(ra.on_hand_qty, 0)
            + CASE WHEN k.rev_key = ${blank} THEN COALESCE(sg.qty, 0) ELSE 0 END)::numeric
                                                             AS in_stock,
          GREATEST(COALESCE(ra.reserved_qty, 0), 0)::numeric AS booked_qty,
          ib.reserved_qty                                    AS item_reserved_qty,
          COALESCE(jo.qty, 0)::numeric                       AS mfg_pending_qty,
          COALESCE(av.qty, 0)::numeric                       AS at_vendor_qty,
          ROW_NUMBER() OVER (
            PARTITION BY ib.item_id
            ORDER BY
              (k.rev_key = ${blank}),
              CASE WHEN r.rev ~ '^[0-9]+$' THEN 0 WHEN r.rev ~ '^[A-Z]+$' THEN 1 ELSE 2 END,
              CASE WHEN r.rev ~ '^[0-9]+$' THEN r.rev::numeric END,
              CASE WHEN r.rev ~ '^[A-Z]+$' THEN length(r.rev) END,
              r.rev,
              k.rev_key
          )                                                  AS ord
        FROM item_base ib
        JOIN bucket_keys k ON k.item_id = ib.item_id
        LEFT JOIN public.item_revisions r
          ON r.id = NULLIF(k.rev_key, ${blank}) AND r.company_id = ${companyId}::uuid
        LEFT JOIN rev_avail ra ON ra.item_id = k.item_id AND ra.rev_key = k.rev_key
        LEFT JOIN jc_open jo ON jo.item_id = k.item_id AND jo.rev_key = k.rev_key
        LEFT JOIN at_vendor av ON av.item_id = k.item_id AND av.rev_key = k.rev_key
        LEFT JOIN stock_gap sg ON sg.item_id = k.item_id
        WHERE ib.is_make
      ),
      -- Hand the item's (floored-once) Reserved out over its buckets in Rev
      -- order: each takes min(its booking, item Reserved − bookings before it).
      make_buckets AS (
        SELECT
          mr.item_id, mr.item_revision_id, mr.drawing_rev, mr.ord,
          mr.in_stock,
          LEAST(
            mr.booked_qty,
            GREATEST(
              mr.item_reserved_qty - COALESCE(SUM(mr.booked_qty) OVER (
                PARTITION BY mr.item_id ORDER BY mr.ord
                ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING), 0),
              0)
          )::numeric AS reserved_qty,
          mr.mfg_pending_qty,
          mr.at_vendor_qty
        FROM make_raw mr
      ),
      make_kept AS (
        SELECT * FROM make_buckets mb
        WHERE mb.in_stock <> 0 OR mb.reserved_qty <> 0
           OR mb.mfg_pending_qty <> 0 OR mb.at_vendor_qty <> 0
      ),
      bucket_rows AS (
        SELECT item_id, item_revision_id, drawing_rev, ord,
               in_stock, reserved_qty, mfg_pending_qty, at_vendor_qty
        FROM make_kept
        UNION ALL
        -- MAKE item with no live bucket: one blank row so it still appears.
        SELECT ib.item_id, NULL::uuid, NULL::text, 1::bigint,
               0::numeric, 0::numeric, 0::numeric, 0::numeric
        FROM item_base ib
        WHERE ib.is_make
          AND NOT EXISTS (SELECT 1 FROM make_kept mk WHERE mk.item_id = ib.item_id)
        UNION ALL
        -- Buy item: one row, the item totals (as before).
        SELECT ib.item_id, NULL::uuid, NULL::text, 1::bigint,
               ib.in_stock, ib.reserved_qty,
               COALESCE(joi.qty, 0)::numeric, COALESCE(avi.qty, 0)::numeric
        FROM item_base ib
        LEFT JOIN jc_open_item joi ON joi.item_id = ib.item_id
        LEFT JOIN at_vendor_item avi ON avi.item_id = ib.item_id
        WHERE NOT ib.is_make
      ),
      rows_ranked AS (
        SELECT
          br.*,
          ROW_NUMBER() OVER (PARTITION BY br.item_id ORDER BY br.ord) AS bucket_ord
        FROM bucket_rows br
      ),
      base AS (
        SELECT
          rr.item_id::text || '|' || COALESCE(rr.item_revision_id::text, 'none') AS row_key,
          ib.item_id,
          rr.item_revision_id,
          rr.drawing_rev,
          CASE
            WHEN rr.drawing_rev IS NOT NULL THEN ib.item_code || '/' || rr.drawing_rev
            WHEN ib.is_make THEN ib.item_code || ' · no Rev'
            ELSE ib.item_code
          END                                               AS item_label,
          (rr.bucket_ord = 1)                               AS reorder_row,
          rr.bucket_ord,
          ib.item_code,
          ib.item_name,
          ib.material,
          ib.uom,
          rr.in_stock,
          rr.reserved_qty,
          (rr.in_stock - rr.reserved_qty)::numeric          AS available_qty,
          ib.reorder_level,
          ib.reorder_qty,
          ib.on_po_qty,
          rr.at_vendor_qty,
          rr.mfg_pending_qty,
          ib.below_reorder,
          ib.in_stock                                       AS item_in_stock
        FROM rows_ranked rr
        JOIN item_base ib ON ib.item_id = rr.item_id
      )`;

    // Ends on the row key so paging never skips or repeats a row; an item's
    // rows stay together, Rev buckets in Rev order, the blank bucket last.
    const orderBy = sfOrderBy(
      STORE_INV_SF_COLUMNS,
      sf,
      sql`b.item_code ASC, b.item_id ASC, b.bucket_ord ASC, b.row_key ASC`,
    );
    const pageFrag =
      input.limit !== undefined ? sql`LIMIT ${input.limit} OFFSET ${input.offset}` : sql``;

    const typed = (await tx.execute(sql`
      ${baseCte}
      SELECT
        b.row_key, b.item_id, b.item_revision_id, b.drawing_rev, b.item_label, b.reorder_row,
        b.item_code, b.item_name, b.material, b.uom,
        b.in_stock::float8 AS in_stock, b.reserved_qty::float8 AS reserved_qty,
        b.available_qty::float8 AS available_qty, b.reorder_level::float8 AS reorder_level,
        b.reorder_qty::float8 AS reorder_qty, b.on_po_qty::float8 AS on_po_qty,
        b.at_vendor_qty::float8 AS at_vendor_qty,
        b.mfg_pending_qty::float8 AS mfg_pending_qty, b.below_reorder
      FROM base b
      WHERE TRUE ${searchFrag} ${sfFrag} ${tileFrag}
      ORDER BY ${orderBy}
      ${pageFrag}
    `)) as unknown as InvRaw[];

    // Tiles stay ITEM counts (count distinct items), so they mean what they
    // meant before a MAKE item could take several rows; In Stock / Zero Stock
    // read the item total. Pieces are sums over the matching rows (bucket
    // figures add up to the item's). No tile sums an item-level figure (On
    // PO, Reorder Level): those repeat on every row, so any future one must
    // read them once per item — FILTER (WHERE b.reorder_row). `total` counts
    // ROWS — it drives paging.
    const [agg] = (await tx.execute(sql`
      ${baseCte}
      SELECT
        count(DISTINCT b.item_id)::int                                    AS total_items,
        COALESCE(sum(b.in_stock), 0)::float8                              AS total_stock,
        COALESCE(sum(b.reserved_qty), 0)::float8                          AS total_reserved,
        count(DISTINCT b.item_id) FILTER (WHERE b.item_in_stock > 0)::int AS in_stock_count,
        count(DISTINCT b.item_id) FILTER (WHERE b.below_reorder)::int     AS below_count,
        count(DISTINCT b.item_id) FILTER (WHERE b.item_in_stock = 0)::int AS zero_count,
        count(*) FILTER (WHERE TRUE ${tileFrag})::int                     AS total
      FROM base b
      WHERE TRUE ${searchFrag} ${sfFrag}
    `)) as unknown as SummaryRaw[];

    const rows: StoreInventoryRow[] = typed.map((r) => ({
      rowKey: r.row_key,
      itemId: r.item_id,
      itemRevisionId: r.item_revision_id,
      drawingRev: r.drawing_rev,
      itemLabel: r.item_label,
      reorderRow: Boolean(r.reorder_row),
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
      // ADR-193 phase 5 (P19) — the one rule, in SQL above (item-level).
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
