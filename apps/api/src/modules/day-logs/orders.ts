// Day Log — the SO / JWSO a work entry may be for. Only OPEN orders (live,
// not cancelled / closed) of the caller's company. The picker needs no SO /
// JWSO page right: it returns only the number, the typed number and the
// party — any user who may write a Day Log may search it.

import {
  type DayLogOrder,
  type DayLogOrderOption,
  type DayLogOrderOptionsQuery,
  type DayLogOrderType,
} from '@innovic/shared';
import { type SQL, sql } from 'drizzle-orm';
import { type AuthContext, type DbTransaction, withUserContext } from '../../db/with-user-context';
import { requireCanWrite } from '../../lib/access';
import { ConflictError } from '../../lib/errors';
import { likeEscape } from '../../lib/list-query';
import { requireCompany } from './writes';

/** How many SOs, then JWSOs, one search returns. */
const OPTIONS_PER_TYPE = 20;

/** An order work can still be logged against. */
const OPEN_SQL = (alias: string): SQL =>
  sql.raw(`${alias}.deleted_at IS NULL AND ${alias}.status = 'open'`);

export async function orderOptions(
  query: DayLogOrderOptionsQuery,
  user: AuthContext,
): Promise<DayLogOrderOption[]> {
  await requireCanWrite(user);
  const companyId = requireCompany(user);
  const term = query.search?.trim() ?? '';
  const pat = `%${likeEscape(term)}%`;
  return withUserContext(user, async (tx) => {
    const so = (await tx.execute(sql`
      SELECT s.id::text AS id, s.code, s.internal_so_no AS ref,
             COALESCE(c.name, s.customer_name) AS party
      FROM public.sales_orders s
      LEFT JOIN public.clients c ON c.id = s.client_id
      WHERE s.company_id = ${companyId}::uuid AND ${OPEN_SQL('s')}
        ${
          term
            ? sql`AND (s.code ILIKE ${pat} ESCAPE '\\' OR s.internal_so_no ILIKE ${pat} ESCAPE '\\'
                 OR COALESCE(c.name, s.customer_name) ILIKE ${pat} ESCAPE '\\')`
            : sql``
        }
      ORDER BY s.created_at DESC
      LIMIT ${OPTIONS_PER_TYPE}
    `)) as unknown as Array<{ id: string; code: string; ref: string | null; party: string | null }>;
    const jw = (await tx.execute(sql`
      SELECT j.id::text AS id, j.code, COALESCE(c.name, j.customer_name) AS party
      FROM public.job_work_orders j
      LEFT JOIN public.clients c ON c.id = j.client_id
      WHERE j.company_id = ${companyId}::uuid AND ${OPEN_SQL('j')}
        ${
          term
            ? sql`AND (j.code ILIKE ${pat} ESCAPE '\\'
                 OR COALESCE(c.name, j.customer_name) ILIKE ${pat} ESCAPE '\\')`
            : sql``
        }
      ORDER BY j.created_at DESC
      LIMIT ${OPTIONS_PER_TYPE}
    `)) as unknown as Array<{ id: string; code: string; party: string | null }>;
    return [
      ...so.map((r) => ({
        type: 'so' as const,
        id: r.id,
        code: r.code,
        ref: r.ref,
        party: r.party,
      })),
      // A JWSO has no typed office number.
      ...jw.map((r) => ({
        type: 'jwso' as const,
        id: r.id,
        code: r.code,
        ref: null,
        party: r.party,
      })),
    ];
  });
}

/** The order a work entry is for — 409 unless it is an open order of the company. */
export async function requireOpenOrder(
  tx: DbTransaction,
  companyId: string,
  type: DayLogOrderType,
  id: string,
): Promise<DayLogOrder> {
  const table = type === 'so' ? sql.raw('public.sales_orders') : sql.raw('public.job_work_orders');
  const rows = (await tx.execute(sql`
    SELECT o.code FROM ${table} o
    WHERE o.id = ${id}::uuid AND o.company_id = ${companyId}::uuid AND ${OPEN_SQL('o')}
  `)) as unknown as Array<{ code: string }>;
  const r = rows[0];
  if (!r) {
    throw new ConflictError(
      `That ${type === 'so' ? 'Sales Order' : 'JWSO'} is not open any more — pick the SO / JWSO again`,
    );
  }
  return { type, id, code: r.code };
}
