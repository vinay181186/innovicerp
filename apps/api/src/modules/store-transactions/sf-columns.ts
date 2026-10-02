// Sort & Filter (ADR-200) — the Stock Ledger list's sortable / filterable
// fields. Each expression is the SAME one listStoreTransactions SELECTs for
// that column (aliases `st` = store_transactions, `i` = items), valid in its
// rows, count and KPI summary queries alike — all three LEFT JOIN items i.

import { sql } from 'drizzle-orm';

import type { SfColumnMap } from '../../lib/list-query';

export const STOCK_LEDGER_SF_COLUMNS: SfColumnMap = {
  txnDate: { sql: sql`st.txn_date`, type: 'date' },
  sourceRef: { sql: sql`st.source_ref`, type: 'text' },
  // The Item Code cell: the item master's code, else the free-text code the
  // row was written with.
  itemCode: { sql: sql`COALESCE(i.code, st.item_code_text)`, type: 'text' },
  itemName: { sql: sql`i.name`, type: 'text' },
  txnType: { sql: sql`st.txn_type`, type: 'list' },
  qty: { sql: sql`st.qty`, type: 'num' },
  sourceType: { sql: sql`st.source_type`, type: 'list' },
  stockBefore: { sql: sql`st.stock_before`, type: 'num' },
  stockAfter: { sql: sql`st.stock_after`, type: 'num' },
  remarks: { sql: sql`st.remarks`, type: 'text' },
  createdOn: { sql: sql`(st.created_at AT TIME ZONE 'Asia/Kolkata')::date`, type: 'date' },
};
