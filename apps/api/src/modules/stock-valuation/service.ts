// Stock Valuation service. Mirror of legacy renderStockValuation (L20927).
// Stock value = on-hand qty (item_stock_balances) × rate, where rate = the PO
// rate behind the latest GRN for the item → latest PO line rate → none.
// Grouped by item type (component/assembly). Read-only.

import type { StockValuationResponse, StockValuationRow } from '@innovic/shared';
import { sql } from 'drizzle-orm';
import { type AuthContext, withUserContext } from '../../db/with-user-context';
import { AuthorizationError } from '../../lib/errors';

const requireCompany = (user: AuthContext): string => {
  if (!user.companyId) throw new AuthorizationError('User is not assigned to a company');
  return user.companyId;
};

type Row = {
  item_id: string;
  code: string;
  name: string;
  uom: string;
  category: string;
  stock_qty: string | number;
  rate: string | number;
  has_rate: boolean;
  last_grn_date: string | null;
  min_stock: string | number;
};

export async function getStockValuation(user: AuthContext): Promise<StockValuationResponse> {
  const companyId = requireCompany(user);
  const cid = `'${companyId}'::uuid`;

  return withUserContext(user, async (tx) => {
    const res = await tx.execute(
      sql.raw(`
        WITH last_grn_rate AS (
          SELECT DISTINCT ON (gl.item_id)
            gl.item_id, pol.rate, g.grn_date
          FROM goods_receipt_note_lines gl
          JOIN goods_receipt_notes g ON g.id = gl.goods_receipt_note_id
          JOIN purchase_order_lines pol ON pol.id = gl.purchase_order_line_id
          WHERE g.company_id = ${cid} AND g.deleted_at IS NULL AND gl.deleted_at IS NULL
            AND gl.item_id IS NOT NULL AND pol.rate > 0
          ORDER BY gl.item_id, g.grn_date DESC, g.created_at DESC
        ),
        last_po_rate AS (
          SELECT DISTINCT ON (pol.item_id) pol.item_id, pol.rate
          FROM purchase_order_lines pol
          JOIN purchase_orders po ON po.id = pol.purchase_order_id
          WHERE po.company_id = ${cid} AND po.deleted_at IS NULL
            AND pol.item_id IS NOT NULL AND pol.rate > 0
          ORDER BY pol.item_id, po.po_date DESC
        )
        SELECT
          i.id AS item_id, i.code, i.name, i.uom::text AS uom,
          i.item_type::text AS category,
          COALESCE(sb.on_hand_qty, 0) AS stock_qty,
          COALESCE(lg.rate, lp.rate, 0) AS rate,
          (lg.rate IS NOT NULL OR lp.rate IS NOT NULL) AS has_rate,
          lg.grn_date::text AS last_grn_date,
          i.min_stock_qty AS min_stock
        FROM items i
        LEFT JOIN item_stock_balances sb ON sb.item_id = i.id
        LEFT JOIN last_grn_rate lg ON lg.item_id = i.id
        LEFT JOIN last_po_rate lp ON lp.item_id = i.id
        WHERE i.company_id = ${cid} AND i.deleted_at IS NULL
        ORDER BY i.code
      `),
    );

    const rows: StockValuationRow[] = (res as unknown as Row[]).map((r) => {
      const stockQty = Number(r.stock_qty) || 0;
      const rate = Number(r.rate) || 0;
      const minStock = Number(r.min_stock) || 0;
      return {
        itemId: r.item_id,
        code: r.code,
        name: r.name,
        uom: r.uom,
        category: r.category,
        stockQty,
        rate,
        hasRate: Boolean(r.has_rate),
        value: stockQty * rate,
        lastGrnDate: r.last_grn_date,
        minStock,
        lowStock: minStock > 0 && stockQty <= minStock,
      };
    });

    const catMap = new Map<string, { count: number; stockCount: number; value: number }>();
    let grandTotal = 0;
    let grandStockItems = 0;
    for (const r of rows) {
      const c = catMap.get(r.category) ?? { count: 0, stockCount: 0, value: 0 };
      c.count += 1;
      if (r.stockQty > 0) {
        c.stockCount += 1;
        grandStockItems += 1;
      }
      c.value += r.value;
      catMap.set(r.category, c);
      grandTotal += r.value;
    }

    return {
      rows,
      categories: [...catMap.entries()].map(([category, v]) => ({ category, ...v })),
      grandTotal,
      grandItems: rows.length,
      grandStockItems,
    };
  });
}
