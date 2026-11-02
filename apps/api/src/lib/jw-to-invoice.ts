// JWSO line "To Invoice" — what has been returned to the customer and not yet
// JW-invoiced. ONE rule, in its two forms side by side: the TypeScript one the
// JW Invoice create guard and the To-Invoice picker use, and the SQL one the
// "Dispatched not invoiced" report and the home's Finance check
// fin_jw_not_invoiced read. Change both together.

import { sql, type SQL } from 'drizzle-orm';

/** Returned − already invoiced (may be negative on bad data; callers clamp). */
export function jwToInvoiceQty(returnedQty: number, invoicedQty: number): number {
  return returnedQty - invoicedQty;
}

/** Same figure for the job_work_order_lines row `alias`. */
export function jwLineToInvoiceSql(alias = 'jwl'): SQL {
  const l = sql.identifier(alias);
  return sql`(${l}.returned_qty - ${l}.invoiced_qty)`;
}

/** The line's latest live JW return challan date (cancelled ones excluded). */
export function jwLineLastReturnDateSql(alias = 'jwl'): SQL {
  const l = sql.identifier(alias);
  return sql`(SELECT MAX(rc.return_date)
     FROM public.jw_return_challans rc
     WHERE rc.job_work_order_line_id = ${l}.id
       AND rc.deleted_at IS NULL
       AND rc.status <> 'cancelled')`;
}
