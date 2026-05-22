// Store / Inventory service (PL-SI-1).
//
// GET /store-inventory — per-item rollup of current stock + open PO pending
// + open JC pending. Mirrors legacy renderStore (HTML L24803). Plus two
// write actions: adjust stock (manual + / − with reason) and set min qty.

import { and, eq, isNull, sql } from 'drizzle-orm';
import type {
  AdjustStockInput,
  ListStoreInventoryQuery,
  ListStoreInventoryResponse,
  SetMinStockInput,
  StoreInventoryRow,
} from '@innovic/shared';
import { items, storeTransactions } from '../../db/schema';
import { type AuthContext, withUserContext } from '../../db/with-user-context';
import {
  AuthorizationError,
  ConflictError,
  NotFoundError,
  ValidationError,
} from '../../lib/errors';

function requireCompany(user: AuthContext): string {
  if (!user.companyId) throw new AuthorizationError('User is not assigned to a company');
  return user.companyId;
}

export async function listStoreInventory(
  input: ListStoreInventoryQuery,
  user: AuthContext,
): Promise<ListStoreInventoryResponse> {
  const companyId = requireCompany(user);
  return withUserContext(user, async (tx) => {
    const term = input.search ? `%${input.search}%` : null;
    const searchFrag = term
      ? sql`AND (i.code ILIKE ${term} OR i.name ILIKE ${term} OR i.material ILIKE ${term})`
      : sql``;

    const result = await tx.execute(sql`
      WITH jc_open AS (
        SELECT
          jc.item_id,
          SUM(GREATEST(jc.order_qty - COALESCE(comp.completed, 0), 0))::int AS qty
        FROM public.job_cards jc
        LEFT JOIN public.v_jc_status v ON v.job_card_id = jc.id
        LEFT JOIN LATERAL (
          SELECT SUM(qty)::int AS completed
          FROM public.op_log ol
          JOIN public.jc_ops jo ON jo.id = ol.jc_op_id
          WHERE jo.job_card_id = jc.id
        ) comp ON TRUE
        WHERE jc.company_id = ${companyId}::uuid
          AND jc.deleted_at IS NULL
          AND (v.computed_status IS NULL OR v.computed_status NOT IN ('complete', 'closed'))
        GROUP BY jc.item_id
      ),
      po_pending AS (
        SELECT
          pol.item_id,
          SUM(GREATEST(0, pol.qty - COALESCE(grn_agg.received, 0)))::int AS qty
        FROM public.purchase_order_lines pol
        JOIN public.purchase_orders po ON po.id = pol.purchase_order_id
        LEFT JOIN (
          SELECT
            grnl.purchase_order_line_id AS po_line_id,
            SUM(grnl.received_qty) AS received
          FROM public.goods_receipt_note_lines grnl
          JOIN public.goods_receipt_notes grn ON grn.id = grnl.goods_receipt_note_id
          WHERE grn.company_id = ${companyId}::uuid
            AND grn.deleted_at IS NULL
            AND grnl.deleted_at IS NULL
          GROUP BY grnl.purchase_order_line_id
        ) grn_agg ON grn_agg.po_line_id = pol.id
        WHERE pol.company_id = ${companyId}::uuid
          AND po.company_id = ${companyId}::uuid
          AND pol.deleted_at IS NULL
          AND po.deleted_at IS NULL
          AND po.status <> 'closed'
          AND pol.item_id IS NOT NULL
        GROUP BY pol.item_id
      )
      SELECT
        i.id                                       AS item_id,
        i.code                                     AS item_code,
        i.name                                     AS item_name,
        i.material                                 AS material,
        i.uom::text                                AS uom,
        COALESCE(s.on_hand_qty, 0)::int            AS in_stock,
        i.min_stock_qty                            AS min_qty,
        COALESCE(po_pending.qty, 0)::int           AS on_po_qty,
        COALESCE(jc_open.qty, 0)::int              AS mfg_pending_qty
      FROM public.items i
      LEFT JOIN public.v_item_stock s
        ON s.item_id = i.id AND s.company_id = i.company_id
      LEFT JOIN jc_open ON jc_open.item_id = i.id
      LEFT JOIN po_pending ON po_pending.item_id = i.id
      WHERE i.company_id = ${companyId}::uuid
        AND i.deleted_at IS NULL
        ${searchFrag}
      ORDER BY i.code ASC
    `);

    type R = {
      item_id: string;
      item_code: string;
      item_name: string;
      material: string | null;
      uom: string;
      in_stock: number;
      min_qty: number;
      on_po_qty: number;
      mfg_pending_qty: number;
    };
    const typed = result as unknown as R[];

    const rows: StoreInventoryRow[] = typed.map((r) => {
      const inStock = Number(r.in_stock);
      const minQty = Number(r.min_qty);
      return {
        itemId: r.item_id,
        itemCode: r.item_code,
        itemName: r.item_name,
        material: r.material,
        uom: r.uom,
        inStock,
        minQty,
        onPoQty: Number(r.on_po_qty),
        mfgPendingQty: Number(r.mfg_pending_qty),
        lowStock: minQty > 0 && inStock <= minQty,
      };
    });

    const filteredRows =
      input.filter === 'low'
        ? rows.filter((r) => r.lowStock)
        : input.filter === 'zero'
          ? rows.filter((r) => r.inStock === 0)
          : rows;

    // Summary always reflects ALL items (legacy stat tiles show whole-master
    // counts regardless of active filter — clicking a tile sets the filter).
    const summary = {
      totalItems: rows.length,
      totalStockPieces: rows.reduce((s, r) => s + r.inStock, 0),
      itemsInStockCount: rows.filter((r) => r.inStock > 0).length,
      lowStockCount: rows.filter((r) => r.lowStock).length,
      zeroStockCount: rows.filter((r) => r.inStock === 0).length,
    };

    return {
      generatedAt: new Date().toISOString(),
      filter: input.filter,
      rows: filteredRows,
      summary,
    };
  });
}

export async function adjustStock(
  input: AdjustStockInput,
  user: AuthContext,
): Promise<{ ok: true; stockAfter: number }> {
  const companyId = requireCompany(user);
  return withUserContext(user, async (tx) => {
    const itemRows = await tx
      .select({ id: items.id, code: items.code })
      .from(items)
      .where(and(eq(items.id, input.itemId), eq(items.companyId, companyId), isNull(items.deletedAt)))
      .limit(1);
    const itm = itemRows[0];
    if (!itm) throw new NotFoundError(`Item ${input.itemId} not found`);

    await tx.execute(sql`SELECT 1 FROM public.items WHERE id = ${itm.id}::uuid FOR UPDATE`);

    const balRows = (await tx.execute(sql`
      SELECT COALESCE(on_hand_qty, 0)::int AS on_hand
      FROM public.v_item_stock
      WHERE company_id = ${companyId}::uuid AND item_id = ${itm.id}::uuid
    `)) as unknown as Array<{ on_hand: number }>;
    const stockBefore = Number(balRows[0]?.on_hand ?? 0);
    const stockAfter =
      input.direction === 'add' ? stockBefore + input.qty : stockBefore - input.qty;
    if (stockAfter < 0) {
      throw new ConflictError(
        `Cannot remove ${input.qty} — only ${stockBefore} available for ${itm.code}`,
      );
    }

    await tx.insert(storeTransactions).values({
      companyId,
      txnDate: new Date().toISOString().slice(0, 10),
      itemId: itm.id,
      itemCodeText: itm.code,
      txnType: input.direction === 'add' ? 'in' : 'out',
      qty: input.qty,
      sourceType: 'manual_adjust',
      sourceRef: `ADJ · ${itm.code}`,
      stockBefore,
      stockAfter,
      remarks: `Manual adjust: ${input.remarks}`,
      createdBy: user.id,
    });

    return { ok: true as const, stockAfter };
  });
}

export async function setMinStock(
  input: SetMinStockInput,
  user: AuthContext,
): Promise<{ ok: true; minQty: number }> {
  const companyId = requireCompany(user);
  return withUserContext(user, async (tx) => {
    const result = await tx
      .update(items)
      .set({ minStockQty: input.minQty, updatedAt: new Date(), updatedBy: user.id })
      .where(
        and(eq(items.id, input.itemId), eq(items.companyId, companyId), isNull(items.deletedAt)),
      )
      .returning({ minStockQty: items.minStockQty });
    if (result.length === 0) throw new NotFoundError(`Item ${input.itemId} not found`);
    return { ok: true as const, minQty: result[0]!.minStockQty };
  });
}

void ValidationError;
