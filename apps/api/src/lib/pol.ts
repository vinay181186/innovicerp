import { sql, type SQL } from 'drizzle-orm';

// ADR-236 — POL, the customer's PO line number, on every document downstream of
// an order line. Two sources, one rule:
//
//   the SALES ORDER line's POL (sales_order_lines.client_po_line_no), else
//   the JOB WORK SALES ORDER line's POL (job_work_order_lines.client_po_line_no).
//
// A row traces to at most one of the two (a Job Card has source_so_line_id OR
// source_jw_line_id), so the order only matters for the impossible case of
// both — and then the SO wins, which keeps every SO-sourced figure exactly as
// it was before ADR-236. Callers pass the ALIASES their query already joins
// (`sol`, `jwl`, `rev_jwl`, …); this never adds a join of its own.
//
// Use this, never a hand-written COALESCE: one place to change the rule.

const ALIAS = /^[a-z_][a-z0-9_]*$/;

/** `COALESCE(<sol>.client_po_line_no, <jwl>.client_po_line_no)` for raw-SQL
 *  queries. Aliases are SQL identifiers from the caller's own FROM clause. */
export function polSql(solAlias: string, jwlAlias: string): SQL {
  if (!ALIAS.test(solAlias) || !ALIAS.test(jwlAlias)) {
    throw new Error(`polSql: bad alias "${solAlias}" / "${jwlAlias}"`);
  }
  return sql.raw(`COALESCE(${solAlias}.client_po_line_no, ${jwlAlias}.client_po_line_no)`);
}

/** Same rule for Drizzle query-builder selects: pass the two column refs,
 *  e.g. `polOf(salesOrderLines.clientPoLineNo, jobWorkOrderLines.clientPoLineNo)`. */
export function polOf(soLinePol: unknown, jwLinePol: unknown): SQL<string | null> {
  return sql<string | null>`COALESCE(${soLinePol}, ${jwLinePol})`;
}
