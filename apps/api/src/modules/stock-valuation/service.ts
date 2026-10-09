// Stock Valuation service. Mirror of legacy renderStockValuation (L20927).
// Stock value = on-hand qty (item_stock_balances) × rate, where rate = the PO
// rate behind the latest GRN for the item → latest PO line rate → none.
// Grouped by item type (component/assembly). Read-only.

import type {
  StockValuationResponse,
  StockValuationRow,
  stockValuationQuerySchema,
} from '@innovic/shared';
import { sql, type SQL } from 'drizzle-orm';
import type { z } from 'zod';
import { type AuthContext, withUserContext } from '../../db/with-user-context';
import { canSeeFormPrice } from '../../lib/access';
import { AuthorizationError } from '../../lib/errors';
import { likeEscape, readSf, sfOrderBy, sfWhere, type SfColumnMap } from '../../lib/list-query';
import { readBelowReorder } from '../store-inventory/reorder-rule';
import { itemRateCtes } from './rate-rule';

export type StockValuationQueryParsed = z.output<typeof stockValuationQuerySchema>;

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

type CatRow = { category: string; count: number; stock_count: number; value: string | number };

type PageResult = {
  total: number;
  filtered_value: string | number;
  rows: Row[] | null;
  cats: CatRow[] | null;
};

/** Sort & Filter (ADR-200) fields — each the SAME `b.` column the page shows. */
const SV_SF_COLUMNS: SfColumnMap = {
  code: { sql: sql`b.code`, type: 'text' },
  name: { sql: sql`b.name`, type: 'text' },
  category: { sql: sql`b.category`, type: 'list' },
  uom: { sql: sql`b.uom`, type: 'text' },
  stockQty: { sql: sql`b.stock_qty`, type: 'num' },
  rate: { sql: sql`b.rate`, type: 'num', price: true },
  value: { sql: sql`b.value`, type: 'num', price: true },
  lastGrnDate: { sql: sql`b.last_grn_date::date`, type: 'date' },
};

export async function getStockValuation(
  user: AuthContext,
  input: StockValuationQueryParsed = { offset: 0 },
): Promise<StockValuationResponse> {
  const companyId = requireCompany(user);
  const cid = sql.raw(`'${companyId}'::uuid`);
  // Money-hiding for L1 Viewers ("Can See Price"). Stock value rides the Store
  // price permission (item_create).
  const showMoney = await canSeeFormPrice(user, 'item_create');
  const sf = readSf(input.sf);
  const sfOpts = { canSeePrice: showMoney };

  // ADR-201: filters / search / Sort & Filter / page run here over EVERY item;
  // the item-type tiles are worked out over every item, the totals row over
  // every MATCHING item — never over the page the screen holds.
  const where: SQL[] = [];
  if (input.category) where.push(sql`AND b.category = ${input.category}`);
  // No `showZero` (an unpaged caller) = every item, as before.
  if (input.showZero === false) where.push(sql`AND b.stock_qty > 0`);
  const term = (input.search ?? '').trim();
  if (term) {
    const pat = `%${likeEscape(term)}%`;
    where.push(sql`AND (b.code || ' ' || b.name) ILIKE ${pat} ESCAPE '\\'`);
  }
  where.push(sfWhere(SV_SF_COLUMNS, sf, sfOpts));
  // Highest stock value first (as the screen sorted), item code then id last
  // so a page never skips or repeats a row.
  const order = sfOrderBy(SV_SF_COLUMNS, sf, sql`b.value DESC, b.code ASC, b.item_id ASC`, sfOpts);
  const limit = input.limit === undefined ? sql.raw('ALL') : sql`${input.limit}`;

  return withUserContext(user, async (tx) => {
    const res = (await tx.execute(sql`
        WITH ${itemRateCtes(cid)},
        base AS (
          SELECT
            i.id AS item_id, i.code, i.name, i.uom::text AS uom,
            i.item_type::text AS category,
            COALESCE(sb.on_hand_qty, 0) AS stock_qty,
            COALESCE(lg.rate, lp.rate, 0) AS rate,
            (lg.rate IS NOT NULL OR lp.rate IS NOT NULL) AS has_rate,
            lg.grn_date::text AS last_grn_date,
            i.min_stock_qty::float8 AS min_stock,
            COALESCE(sb.on_hand_qty, 0) * COALESCE(lg.rate, lp.rate, 0) AS value
          FROM items i
          LEFT JOIN item_stock_balances sb ON sb.item_id = i.id
          LEFT JOIN last_grn_rate lg ON lg.item_id = i.id
          LEFT JOIN last_po_rate lp ON lp.item_id = i.id
          WHERE i.company_id = ${cid} AND i.deleted_at IS NULL
        ),
        filt AS (SELECT b.* FROM base b WHERE TRUE ${sql.join(where, sql` `)})
        SELECT
          (SELECT COUNT(*)::int FROM filt) AS total,
          (SELECT COALESCE(SUM(value), 0) FROM filt) AS filtered_value,
          (SELECT json_agg(p ORDER BY p.rn) FROM (
             SELECT b.*, row_number() OVER (ORDER BY ${order}) AS rn
             FROM filt b ORDER BY ${order}
             LIMIT ${limit} OFFSET ${input.offset}
          ) p) AS rows,
          (SELECT json_agg(c ORDER BY c.category) FROM (
             SELECT category, COUNT(*)::int AS count,
                    COUNT(*) FILTER (WHERE stock_qty > 0)::int AS stock_count,
                    COALESCE(SUM(value), 0) AS value
             FROM base GROUP BY category
          ) c) AS cats
      `)) as unknown as PageResult[];
    const r0 = res[0] ?? { total: 0, filtered_value: 0, rows: null, cats: null };
    const pageRows = r0.rows ?? [];

    // lowStock = Below Reorder, the ONE rule (store-inventory/reorder-rule.ts,
    // ADR-193 phase 5) — so this screen flags exactly what Store flags.
    const pageIds = pageRows.map((r) => r.item_id);
    const below = new Set((await readBelowReorder(tx, companyId, pageIds)).map((b) => b.itemId));
    const rows: StockValuationRow[] = pageRows.map((r) => {
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
        lowStock: below.has(r.item_id),
      };
    });

    // The item-type tiles + the grand KPI: every item, whatever the filters.
    const categories = (r0.cats ?? []).map((c) => ({
      category: c.category,
      count: Number(c.count) || 0,
      stockCount: Number(c.stock_count) || 0,
      value: Number(c.value) || 0,
    }));
    const grandTotal = categories.reduce((s, c) => s + c.value, 0);
    const grandItems = categories.reduce((s, c) => s + c.count, 0);
    const grandStockItems = categories.reduce((s, c) => s + c.stockCount, 0);
    const total = Number(r0.total) || 0;

    if (!showMoney) {
      return {
        priceVisible: false,
        rows: rows.map((r) => ({ ...r, rate: null, value: null })),
        categories: categories.map((c) => ({ ...c, value: null })),
        grandTotal: null,
        grandItems,
        grandStockItems,
        total,
        filteredValue: null,
      };
    }

    return {
      priceVisible: true,
      rows,
      categories,
      grandTotal,
      grandItems,
      grandStockItems,
      total,
      filteredValue: Number(r0.filtered_value) || 0,
    };
  });
}
