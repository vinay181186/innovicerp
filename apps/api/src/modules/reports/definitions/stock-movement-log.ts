// Stock movement log — flat list of store_transactions with item join over
// a date range, optional source-type filter. Pattern: list with date-range
// + enum filter. Surfaces the append-only ledger that backs v_item_stock.

import { sql } from 'drizzle-orm';
import type { RegisteredReport } from '../registry';

export const stockMovementLogReport: RegisteredReport = {
  definition: {
    slug: 'stock-movement-log',
    title: 'Stock movement log',
    description:
      'Per-row ledger of store_transactions with item code + name + qty + stock-after over a date range. Filter by source type to scope to GRN-QC, dispatch, or manual adjustments.',
    group: 'Inventory',
    filters: [
      { key: 'fromDate', label: 'From date', kind: 'date' },
      { key: 'toDate', label: 'To date', kind: 'date' },
      {
        key: 'sourceType',
        label: 'Source',
        kind: 'enum',
        options: ['grn_qc', 'manual_adjust', 'dispatch', 'jw_in', 'jw_out', 'other'],
      },
      {
        key: 'txnType',
        label: 'Direction',
        kind: 'enum',
        options: ['in', 'out', 'adjust'],
      },
    ],
    columns: [
      { key: 'txn_date', label: 'Date', type: 'date' },
      { key: 'item_code', label: 'Item code', type: 'text' },
      { key: 'item_name', label: 'Item name', type: 'text' },
      { key: 'txn_type', label: 'Direction', type: 'text' },
      { key: 'qty', label: 'Qty', type: 'number' },
      { key: 'source_type', label: 'Source', type: 'text' },
      { key: 'source_ref', label: 'Source ref', type: 'text' },
      { key: 'stock_after', label: 'Stock after', type: 'number' },
      { key: 'remarks', label: 'Remarks', type: 'text' },
    ],
  },
  async run({ tx, companyId, filters }) {
    const fromDate = filters['fromDate'];
    const toDate = filters['toDate'];
    const sourceType = filters['sourceType'];
    const txnType = filters['txnType'];
    const validSources = ['grn_qc', 'manual_adjust', 'dispatch', 'jw_in', 'jw_out', 'other'];
    const validTxnTypes = ['in', 'out', 'adjust'];

    const fromFrag = fromDate ? sql`AND st.txn_date >= ${fromDate}::date` : sql``;
    const toFrag = toDate ? sql`AND st.txn_date <= ${toDate}::date` : sql``;
    const sourceFrag =
      sourceType && validSources.includes(sourceType)
        ? sql`AND st.source_type = ${sourceType}::store_txn_source_type`
        : sql``;
    const txnFrag =
      txnType && validTxnTypes.includes(txnType)
        ? sql`AND st.txn_type = ${txnType}::store_txn_type`
        : sql``;

    const result = await tx.execute(sql`
      SELECT
        st.txn_date                              AS txn_date,
        COALESCE(it.code, st.item_code_text, '—') AS item_code,
        it.name                                  AS item_name,
        st.txn_type::text                        AS txn_type,
        st.qty                                   AS qty,
        st.source_type::text                     AS source_type,
        st.source_ref                            AS source_ref,
        st.stock_after                           AS stock_after,
        st.remarks                               AS remarks
      FROM public.store_transactions st
      LEFT JOIN public.items it ON it.id = st.item_id AND it.deleted_at IS NULL
      WHERE st.company_id = ${companyId}::uuid
        ${fromFrag}
        ${toFrag}
        ${sourceFrag}
        ${txnFrag}
      ORDER BY st.txn_date DESC, st.created_at DESC
      LIMIT 1000
    `);

    const rows = (result as unknown as Array<Record<string, unknown>>).map((r) => ({
      txn_date:
        r['txn_date'] instanceof Date
          ? r['txn_date'].toISOString().slice(0, 10)
          : String(r['txn_date'] ?? ''),
      item_code: String(r['item_code'] ?? ''),
      item_name: (r['item_name'] as string | null) ?? null,
      txn_type: String(r['txn_type'] ?? ''),
      qty: Number(r['qty'] ?? 0),
      source_type: String(r['source_type'] ?? ''),
      source_ref: (r['source_ref'] as string | null) ?? null,
      stock_after: Number(r['stock_after'] ?? 0),
      remarks: (r['remarks'] as string | null) ?? null,
    }));

    return { columns: stockMovementLogReport.definition.columns, rows };
  },
};
