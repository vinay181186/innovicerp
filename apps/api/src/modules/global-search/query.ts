// Global Search — the SQL builder. NO database imports here on purpose: it is
// a pure function from (kinds, company, term, limit) to a drizzle `sql`
// fragment, so it can be rendered and inspected without a connection.
//
// One SELECT per kind, all shaped to the same 7 columns and joined with
// UNION ALL. Company id, search patterns and the limit are bound parameters
// (drizzle `sql` template), never string-concatenated.

import { sql, type SQL } from 'drizzle-orm';
import type { GlobalSearchKind } from './schema';

/** Escape the ILIKE metacharacters in a user's search term so "%" or "_" is a
 *  literal search, not a wildcard. Local copy of the items/sales-orders helper
 *  by convention (each module owns its own search behaviour). The queries
 *  below say `ESCAPE '\'` explicitly so the escaping is not dependent on the
 *  server default. */
function escapeLikeTerm(raw: string): string {
  return raw.replace(/[\\%_]/g, (ch) => `\\${ch}`);
}

// Per-kind registry. Every column name below was checked against
// apps/api/src/db/schema.ts (physical snake_case names). `pieces` are the
// particulars fragments, joined with ' · ' skipping NULL/empty; the same
// fragments (plus docNo) are what the search term is matched against.
interface KindMeta {
  kind: GlobalSearchKind;
  /** FROM clause incl. alias and any LEFT JOINs (static SQL, no params). */
  from: SQL;
  /** Alias of the main table, used for company_id / deleted_at filters. */
  alias: string;
  docNo: SQL;
  /** Expression yielding a `date` (already cast). */
  date: SQL;
  pieces: SQL[];
  /** Text expression or NULL. */
  status: SQL;
}

const KINDS: readonly KindMeta[] = [
  {
    kind: 'sales-order',
    from: sql`public.sales_orders t LEFT JOIN public.clients c ON c.id = t.client_id`,
    alias: 't',
    docNo: sql`t.code`,
    date: sql`t.so_date::date`,
    pieces: [sql`COALESCE(c.name, t.customer_name)`, sql`t.client_po_no`],
    status: sql`t.status::text`,
  },
  {
    kind: 'job-work-order',
    from: sql`public.job_work_orders t LEFT JOIN public.clients c ON c.id = t.client_id`,
    alias: 't',
    docNo: sql`t.code`,
    date: sql`t.jw_date::date`,
    pieces: [sql`COALESCE(c.name, t.customer_name)`, sql`t.client_po_no`],
    status: sql`t.status::text`,
  },
  {
    kind: 'purchase-request',
    from: sql`public.purchase_requests t
      LEFT JOIN public.vendors v ON v.id = t.vendor_id
      LEFT JOIN public.items i ON i.id = t.item_id`,
    alias: 't',
    docNo: sql`t.code`,
    date: sql`t.pr_date::date`,
    pieces: [sql`COALESCE(v.name, t.vendor_code_text)`, sql`COALESCE(i.name, t.item_name)`],
    status: sql`t.status::text`,
  },
  {
    kind: 'purchase-order',
    from: sql`public.purchase_orders t LEFT JOIN public.vendors v ON v.id = t.vendor_id`,
    alias: 't',
    docNo: sql`t.code`,
    date: sql`t.po_date::date`,
    pieces: [sql`COALESCE(v.name, t.vendor_code_text)`, sql`t.pr_code_text`],
    status: sql`t.status::text`,
  },
  {
    kind: 'grn',
    from: sql`public.goods_receipt_notes t LEFT JOIN public.vendors v ON v.id = t.vendor_id`,
    alias: 't',
    docNo: sql`t.code`,
    date: sql`t.grn_date::date`,
    pieces: [sql`COALESCE(v.name, t.vendor_code_text)`, sql`t.po_code_text`, sql`t.dc_no`],
    status: sql`NULL::text`,
  },
  {
    kind: 'delivery-challan',
    from: sql`public.delivery_challans t LEFT JOIN public.vendors v ON v.id = t.vendor_id`,
    alias: 't',
    docNo: sql`t.code`,
    date: sql`t.dc_date::date`,
    pieces: [sql`COALESCE(v.name, t.vendor_code_text)`, sql`t.po_code_text`, sql`t.so_ref_text`],
    status: sql`t.status::text`,
  },
  {
    kind: 'job-card',
    from: sql`public.job_cards t LEFT JOIN public.items i ON i.id = t.item_id`,
    alias: 't',
    docNo: sql`t.code`,
    date: sql`t.jc_date::date`,
    pieces: [sql`i.code`, sql`i.name`],
    status: sql`CASE WHEN t.closed_at IS NULL THEN 'open' ELSE 'closed' END`,
  },
  {
    kind: 'nc',
    from: sql`public.nc_register t`,
    alias: 't',
    docNo: sql`t.code`,
    date: sql`t.nc_date::date`,
    pieces: [sql`t.item_code_text`, sql`t.item_name_text`, sql`t.so_code_text`],
    status: sql`t.status::text`,
  },
  {
    kind: 'invoice',
    from: sql`public.invoices t LEFT JOIN public.clients c ON c.id = t.client_id`,
    alias: 't',
    docNo: sql`t.code`,
    date: sql`t.invoice_date::date`,
    pieces: [sql`COALESCE(c.name, t.client_name_text)`, sql`t.so_code_text`],
    status: sql`t.status::text`,
  },
  {
    kind: 'plan',
    from: sql`public.plans t`,
    alias: 't',
    docNo: sql`t.code`,
    date: sql`t.plan_date::date`,
    pieces: [sql`t.so_code_text`, sql`t.item_code_text`, sql`t.item_name_text`],
    status: sql`t.plan_status::text`,
  },
  {
    kind: 'bom-master',
    from: sql`public.bom_masters t LEFT JOIN public.items i ON i.id = t.parent_item_id`,
    alias: 't',
    docNo: sql`t.bom_no`,
    date: sql`COALESCE(t.revision_date::date, t.created_at::date)`,
    pieces: [sql`t.bom_name`, sql`i.code`],
    status: sql`t.status::text`,
  },
  {
    kind: 'route-card',
    from: sql`public.route_cards t LEFT JOIN public.items i ON i.id = t.item_id`,
    alias: 't',
    docNo: sql`t.code`,
    date: sql`t.created_at::date`,
    pieces: [sql`i.code`, sql`i.name`],
    status: sql`NULL::text`,
  },
  {
    kind: 'design-project',
    from: sql`public.design_projects t LEFT JOIN public.clients c ON c.id = t.client_id`,
    alias: 't',
    docNo: sql`t.code`,
    date: sql`t.start_date::date`,
    pieces: [sql`t.project_name`, sql`COALESCE(c.name, t.client_text)`, sql`t.so_code_text`],
    status: sql`t.status::text`,
  },
  {
    kind: 'client',
    from: sql`public.clients t`,
    alias: 't',
    docNo: sql`t.code`,
    date: sql`t.created_at::date`,
    pieces: [sql`t.name`, sql`t.city`],
    status: sql`CASE WHEN t.is_active THEN 'active' ELSE 'inactive' END`,
  },
  {
    kind: 'vendor',
    from: sql`public.vendors t`,
    alias: 't',
    docNo: sql`t.code`,
    date: sql`t.created_at::date`,
    pieces: [sql`t.name`, sql`t.city`],
    status: sql`CASE WHEN t.is_active THEN 'active' ELSE 'inactive' END`,
  },
  {
    kind: 'item',
    from: sql`public.items t`,
    alias: 't',
    docNo: sql`t.code`,
    date: sql`t.created_at::date`,
    pieces: [sql`t.name`, sql`t.drawing_no`],
    status: sql`NULL::text`,
  },
];

// One SELECT per kind, all shaped to the same 7 columns so they UNION cleanly.
// `match_rank` is 0 when the doc no. starts with the term (exact-code hits
// float to the top), 1 otherwise.
function branchSql(m: KindMeta, companyId: string, anyPattern: string, prefixPattern: string): SQL {
  const t = sql.raw(m.alias);
  const like = (expr: SQL): SQL => sql`${expr} ILIKE ${anyPattern} ESCAPE '\\'`;
  const particulars = sql.join(
    m.pieces.map((p) => sql`NULLIF(${p}::text, '')`),
    sql`, `,
  );
  const matchAny = sql.join([like(m.docNo), ...m.pieces.map(like)], sql` OR `);
  return sql`SELECT ${m.kind}::text AS kind,
      ${t}.id::text AS id,
      ${m.docNo}::text AS doc_no,
      to_char(${m.date}, 'YYYY-MM-DD') AS doc_date,
      concat_ws(' · ', ${particulars}) AS particulars,
      ${m.status} AS status,
      CASE WHEN ${m.docNo} ILIKE ${prefixPattern} ESCAPE '\\' THEN 0 ELSE 1 END AS match_rank
    FROM ${m.from}
    WHERE ${t}.company_id = ${companyId}::uuid
      AND ${t}.deleted_at IS NULL
      AND (${matchAny})`;
}

/** Whole search statement for the given (already permission-filtered) kinds.
 *  Asks for `limit + 1` rows so the caller can say "there is more" without a
 *  second COUNT over the union. */
export function buildSearchSql(
  kinds: readonly GlobalSearchKind[],
  companyId: string,
  q: string,
  limit: number,
): SQL {
  const escaped = escapeLikeTerm(q);
  const anyPattern = `%${escaped}%`;
  const prefixPattern = `${escaped}%`;
  const allowed = new Set<GlobalSearchKind>(kinds);
  const branches = KINDS.filter((m) => allowed.has(m.kind)).map((m) =>
    branchSql(m, companyId, anyPattern, prefixPattern),
  );
  const limitPlusOne = limit + 1;
  return sql`
    SELECT u.kind, u.id, u.doc_no, u.doc_date, u.particulars, u.status
    FROM (${sql.join(branches, sql` UNION ALL `)}) u
    ORDER BY u.match_rank ASC, u.doc_date DESC NULLS LAST, u.doc_no DESC
    LIMIT ${limitPlusOne}
  `;
}
