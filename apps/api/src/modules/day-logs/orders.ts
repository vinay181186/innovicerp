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
import { db } from '../../db/client';
import type { AuthContext } from '../../db/with-user-context';
import { ConflictError } from '../../lib/errors';
import { likeEscape } from '../../lib/list-query';
import { accessJson, assertCanWrite, resolveAccess } from './access';
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
  const companyId = requireCompany(user);
  const term = query.search?.trim() ?? '';
  const pat = `%${likeEscape(term)}%`;
  // ONE statement: the caller's access and both lists (owner 2026-10-27).
  const [r] = (await db.execute(sql`
    SELECT ${accessJson(user.id, companyId)} AS access,
      (SELECT COALESCE(json_agg(x ORDER BY x.created_at DESC), '[]'::json) FROM (
        SELECT s.id::text AS id, s.code, s.internal_so_no AS ref,
               COALESCE(c.name, s.customer_name) AS party, s.created_at
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
        LIMIT ${OPTIONS_PER_TYPE}) x) AS so,
      (SELECT COALESCE(json_agg(x ORDER BY x.created_at DESC), '[]'::json) FROM (
        SELECT j.id::text AS id, j.code, COALESCE(c.name, j.customer_name) AS party, j.created_at
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
        LIMIT ${OPTIONS_PER_TYPE}) x) AS jw
  `)) as unknown as Array<{ access: unknown; so: unknown; jw: unknown }>;
  // requireCanWrite, on the access read above — refused before anything is returned.
  assertCanWrite(await resolveAccess(user, r?.access));
  const so = (r?.so ?? []) as Array<{
    id: string;
    code: string;
    ref: string | null;
    party: string | null;
  }>;
  const jw = (r?.jw ?? []) as Array<{ id: string; code: string; party: string | null }>;
  return [
    ...so.map((o) => ({
      type: 'so' as const,
      id: o.id,
      code: o.code,
      ref: o.ref,
      party: o.party,
    })),
    // A JWSO has no typed office number.
    ...jw.map((o) => ({
      type: 'jwso' as const,
      id: o.id,
      code: o.code,
      ref: null,
      party: o.party,
    })),
  ];
}

/** The order a work entry is for — 409 unless it is an open order of the
 *  company (`open` = the snapshot's open orders, read under the day lock). */
export function requireOpenOrder(
  open: ReadonlyMap<string, string>,
  type: DayLogOrderType,
  id: string,
): DayLogOrder {
  const code = open.get(`${type}:${id}`);
  if (code === undefined) {
    throw new ConflictError(
      `That ${type === 'so' ? 'Sales Order' : 'JWSO'} is not open any more — pick the SO / JWSO again`,
    );
  }
  return { type, id, code };
}
