// Stock balance (period) — per item: Opening before the From date, In and Out
// within the period, Closing at the To date, and today's On Hand. Signs follow
// the stock trigger (0020 apply_store_txn_to_balance): 'in' +qty, 'out' −qty,
// 'adjust' +qty. Modelled on ERPNext's "Stock Balance" report.

import { sql } from 'drizzle-orm';
import type { RegisteredReport } from '../registry';
import { enumFilter, isoDateFilter, likeFilter } from './report-helpers';

const ITEM_TYPES = ['component', 'assembly'];

export const stockBalanceReport: RegisteredReport = {
  definition: {
    slug: 'stock-balance',
    title: 'Stock balance (period)',
    description:
      'Per item: Opening, In, Out and Closing for the period (default: this month), plus On Hand now. Only items that moved in the period or opened with stock are listed.',
    group: 'Store',
    dept: 'store',
    filters: [
      { key: 'fromDate', label: 'Txn Date From', kind: 'date' },
      { key: 'toDate', label: 'Txn Date To', kind: 'date' },
      { key: 'item', label: 'Item', kind: 'text', placeholder: 'Item code or name' },
      { key: 'itemType', label: 'Item Type', kind: 'enum', options: ITEM_TYPES },
    ],
    columns: [
      { key: 'item_code', label: 'Item Code', type: 'text' },
      { key: 'item_name', label: 'Item Name', type: 'text' },
      { key: 'uom', label: 'UOM', type: 'text' },
      { key: 'opening_qty', label: 'Opening', type: 'number' },
      { key: 'in_qty', label: 'In', type: 'number' },
      { key: 'out_qty', label: 'Out', type: 'number' },
      { key: 'closing_qty', label: 'Closing', type: 'number' },
      { key: 'on_hand_qty', label: 'On Hand', type: 'number' },
    ],
  },
  async run({ tx, companyId, filters }) {
    const fromDate = isoDateFilter(filters['fromDate']);
    const toDate = isoDateFilter(filters['toDate']);
    const item = likeFilter(filters['item']);
    const itemType = enumFilter(filters['itemType'], ITEM_TYPES);

    const fromSql = fromDate
      ? sql`${fromDate}::date`
      : sql`date_trunc('month', CURRENT_DATE)::date`;
    const toSql = toDate ? sql`${toDate}::date` : sql`CURRENT_DATE`;
    const itemFrag = item ? sql`AND (i.code ILIKE ${item} OR i.name ILIKE ${item})` : sql``;
    const typeFrag = itemType ? sql`AND i.item_type = ${itemType}::item_type` : sql``;

    // store_transactions is append-only (no deleted_at); rows with no item_id
    // are free-text and not stock-tracked (same rule as the trigger).
    const result = await tx.execute(sql`
      WITH mv AS (
        SELECT
          st.item_id,
          SUM(CASE WHEN st.txn_date < ${fromSql}
                   THEN CASE WHEN st.txn_type = 'out' THEN -st.qty ELSE st.qty END
                   ELSE 0 END)                                             AS opening_qty,
          SUM(CASE WHEN st.txn_date >= ${fromSql} AND st.txn_date <= ${toSql}
                    AND st.txn_type <> 'out' THEN st.qty ELSE 0 END)       AS in_qty,
          SUM(CASE WHEN st.txn_date >= ${fromSql} AND st.txn_date <= ${toSql}
                    AND st.txn_type = 'out' THEN st.qty ELSE 0 END)        AS out_qty
        FROM public.store_transactions st
        WHERE st.company_id = ${companyId}::uuid
          AND st.item_id IS NOT NULL
          AND st.txn_date <= ${toSql}
        GROUP BY st.item_id
      )
      SELECT
        i.code                                          AS item_code,
        i.name                                          AS item_name,
        i.uom::text                                     AS uom,
        mv.opening_qty::int                             AS opening_qty,
        mv.in_qty::int                                  AS in_qty,
        mv.out_qty::int                                 AS out_qty,
        (mv.opening_qty + mv.in_qty - mv.out_qty)::int  AS closing_qty,
        COALESCE(s.on_hand_qty, 0)::int                 AS on_hand_qty
      FROM mv
      JOIN public.items i ON i.id = mv.item_id AND i.deleted_at IS NULL
      LEFT JOIN public.v_item_stock s ON s.item_id = i.id AND s.company_id = i.company_id
      WHERE i.company_id = ${companyId}::uuid
        AND (mv.opening_qty <> 0 OR mv.in_qty <> 0 OR mv.out_qty <> 0)
        ${itemFrag}
        ${typeFrag}
      ORDER BY i.code
      LIMIT 2000
    `);

    const rows = (result as unknown as Array<Record<string, unknown>>).map((r) => ({
      item_code: String(r['item_code'] ?? ''),
      item_name: String(r['item_name'] ?? ''),
      uom: String(r['uom'] ?? ''),
      opening_qty: Number(r['opening_qty'] ?? 0),
      in_qty: Number(r['in_qty'] ?? 0),
      out_qty: Number(r['out_qty'] ?? 0),
      closing_qty: Number(r['closing_qty'] ?? 0),
      on_hand_qty: Number(r['on_hand_qty'] ?? 0),
    }));

    return { columns: stockBalanceReport.definition.columns, rows };
  },
};
