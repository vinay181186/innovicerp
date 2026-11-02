// SO invoice "overdue" and "balance" — the ONE SQL definition (GET /invoices'
// strip, the invoice-lines list and the home's Finance check
// fin_invoice_overdue all read these, so the figures agree).
//
//   overdue = not paid, not cancelled, has a Due Date, Due Date before `today`
//   balance = Grand Total − received − TDS / short (Outstanding)

import { sql, type SQL } from 'drizzle-orm';

/** Parenthesised boolean for the invoices row `alias`. `today` is the caller's
 *  India-time day (a param or an SQL expression). */
export function invoiceOverdueSql(today: SQL, alias = 'invoices'): SQL {
  const t = sql.identifier(alias);
  return sql`(${t}.status <> 'paid' AND ${t}.status <> 'cancelled'
    AND ${t}.due_date IS NOT NULL AND ${t}.due_date < ${today})`;
}

/** What the customer still owes on the invoice. */
export function invoiceBalanceSql(alias = 'invoices'): SQL {
  const t = sql.identifier(alias);
  return sql`(${t}.grand_total - ${t}.total_paid - ${t}.total_tds)`;
}
