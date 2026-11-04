// One order picker: the SO / JWSO options behind the list-header dropdown and
// the QC Documents pickers. Any login of the company may read it — it returns
// only the numbers and the party (owner 2026-11-04; ADR-237).

import type { OrderOptionsQuery, OrderOptionsResponse } from '@innovic/shared';
import { sql, type SQL } from 'drizzle-orm';
import { type AuthContext, withUserContext } from '../../db/with-user-context';
import { AuthorizationError } from '../../lib/errors';
import { likeEscape } from '../../lib/list-query';

function requireCompany(user: AuthContext): string {
  if (!user.companyId) throw new AuthorizationError('User is not assigned to a company');
  return user.companyId;
}

/** Newest first. The term matches SO / JWSO No., Internal SO No., Client PO No.,
 *  customer (the master's name or the one kept on the order), or the "IN-SO-00009 · SO-100" label the dropdown re-sends from its
 *  box when reopened. */
export async function listOrderOptions(
  input: OrderOptionsQuery,
  user: AuthContext,
): Promise<OrderOptionsResponse> {
  const cid = requireCompany(user);
  return withUserContext(user, async (tx) => {
    const term = input.search ? `%${likeEscape(input.search)}%` : null;
    const customer = sql`COALESCE(c.name, o.customer_name)`;
    const clientJoin = sql`LEFT JOIN public.clients c
          ON c.id = o.client_id AND c.company_id = ${cid}::uuid AND c.deleted_at IS NULL`;
    const statusFrag = input.cancelled === 'exclude' ? sql`AND o.status <> 'cancelled'` : sql``;

    const arms: SQL[] = [];
    if (input.kind !== 'jwso') {
      const soMatch = term
        ? sql`AND (o.code ILIKE ${term} ESCAPE '\\' OR o.internal_so_no ILIKE ${term} ESCAPE '\\'
                   OR (o.code || ' · ' || o.internal_so_no) ILIKE ${term} ESCAPE '\\'
                   OR o.client_po_no ILIKE ${term} ESCAPE '\\' OR c.name ILIKE ${term} ESCAPE '\\' OR o.customer_name ILIKE ${term} ESCAPE '\\')`
        : sql``;
      arms.push(sql`
        SELECT 'so' AS kind, o.id, o.code, o.internal_so_no, o.client_po_no,
               ${customer} AS customer_name, o.so_date AS order_date, o.created_at
        FROM public.sales_orders o
        ${clientJoin}
        WHERE o.company_id = ${cid}::uuid AND o.deleted_at IS NULL
          ${statusFrag}
          ${soMatch}`);
    }
    if (input.kind !== 'so') {
      const jwMatch = term
        ? sql`AND (o.code ILIKE ${term} ESCAPE '\\' OR o.client_po_no ILIKE ${term} ESCAPE '\\'
                   OR c.name ILIKE ${term} ESCAPE '\\' OR o.customer_name ILIKE ${term} ESCAPE '\\')`
        : sql``;
      // Every column is named: with kind=jwso this arm runs alone.
      arms.push(sql`
        SELECT 'jwso' AS kind, o.id, o.code, NULL::text AS internal_so_no, o.client_po_no,
               ${customer} AS customer_name, o.jw_date AS order_date, o.created_at
        FROM public.job_work_orders o
        ${clientJoin}
        WHERE o.company_id = ${cid}::uuid AND o.deleted_at IS NULL
          ${statusFrag}
          ${jwMatch}`);
    }

    const rs = (await tx.execute(sql`
      SELECT x.kind, x.id, x.code, x.internal_so_no, x.client_po_no, x.customer_name FROM (
        ${sql.join(arms, sql` UNION ALL `)}
      ) x
      ORDER BY x.order_date DESC NULLS LAST, x.created_at DESC, x.code DESC
      LIMIT ${input.limit}
    `)) as unknown as Array<Record<string, unknown>>;
    return {
      orders: rs.map((r) => ({
        kind: r['kind'] === 'jwso' ? ('jwso' as const) : ('so' as const),
        id: String(r['id']),
        code: String(r['code']),
        internalSoNo: (r['internal_so_no'] as string | null) ?? null,
        clientPoNo: (r['client_po_no'] as string | null) ?? null,
        customerName: (r['customer_name'] as string | null) ?? null,
      })),
    };
  });
}
