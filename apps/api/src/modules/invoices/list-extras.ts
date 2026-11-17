// ADR-303 — the per-INVOICE list's extra facts (GET /invoices), read in ONE
// query for the page's invoices: Lines (live lines), Created By (the shared
// createdByNameSql rule) and how many OTHER SOs the lines come from (the grey
// "+n" beside SO No.).

import { sql } from 'drizzle-orm';

import type { DbTransaction } from '../../db/with-user-context';
import { createdByNameSql } from '../../lib/created-by-sql';

export interface InvoiceListExtras {
  lineCount: number;
  createdByName: string | null;
  extraSoCount: number;
}

export async function readInvoiceListExtras(
  tx: DbTransaction,
  invoiceIds: string[],
): Promise<Map<string, InvoiceListExtras>> {
  const out = new Map<string, InvoiceListExtras>();
  if (invoiceIds.length === 0) return out;
  const rows = (await tx.execute(sql`
    SELECT inv.id::text AS id,
      (SELECT COUNT(*)::int FROM public.invoice_lines il
        WHERE il.invoice_id = inv.id AND il.deleted_at IS NULL) AS line_count,
      ${createdByNameSql(sql`inv.created_by`)} AS created_by_name,
      (SELECT COUNT(DISTINCT sol.sales_order_id)::int
         FROM public.invoice_lines il
         JOIN public.sales_order_lines sol ON sol.id = il.sales_order_line_id
        WHERE il.invoice_id = inv.id AND il.deleted_at IS NULL
          AND sol.sales_order_id <> inv.sales_order_id) AS extra_so_count
    FROM public.invoices inv
    WHERE inv.id IN (${sql.join(
      invoiceIds.map((id) => sql`${id}::uuid`),
      sql`, `,
    )})
  `)) as unknown as Array<{
    id: string;
    line_count: number;
    created_by_name: string | null;
    extra_so_count: number;
  }>;
  for (const r of rows) {
    out.set(r.id, {
      lineCount: Number(r.line_count ?? 0),
      createdByName: r.created_by_name ?? null,
      extraSoCount: Number(r.extra_so_count ?? 0),
    });
  }
  return out;
}
