// Sort & Filter (ADR-200) — the Pending SO Value list's sortable / filterable
// fields. Each expression reads the `psv` CTE column the row shows (service.ts),
// valid in both the page query and the totals query. Money columns are
// `price: true`: only a user who may see Sales prices can sort / filter them.

import { sql } from 'drizzle-orm';

import type { SfColumnMap } from '../../lib/list-query';

export const PSV_SF_COLUMNS: SfColumnMap = {
  soCode: { sql: sql`psv.so_code`, type: 'text' },
  // ADR-207 — the Internal SO No., the psv CTE column the row already shows.
  soInternalNo: { sql: sql`psv.internal_so_no`, type: 'text' },
  customerName: { sql: sql`psv.customer_name`, type: 'text' },
  dueDate: { sql: sql`psv.due_date`, type: 'date' },
  soDate: { sql: sql`psv.so_date`, type: 'date' },
  status: { sql: sql`psv.status`, type: 'list' },
  orderValue: { sql: sql`psv.order_value`, type: 'num', price: true },
  dispatchedValue: { sql: sql`psv.dispatched_value`, type: 'num', price: true },
  pendingValue: { sql: sql`psv.pending_value`, type: 'num', price: true },
  invoicedValue: { sql: sql`psv.invoiced_value`, type: 'num', price: true },
  receivedValue: { sql: sql`psv.received_value`, type: 'num', price: true },
  outstandingValue: { sql: sql`psv.outstanding_value`, type: 'num', price: true },
};
