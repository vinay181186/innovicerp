// ADR-261 — Customer Dispatch, ONE ROW PER DISPATCH LINE
// (GET /customer-dispatches/lines).
//
// The register (GET /customer-dispatches/register, unchanged — Excel / Print
// read it) pages by DISPATCH. This list pages on LINES: same query params,
// same company scope, same search (a line is kept when it matches), same
// envelope — rows + total + the KPI strip, item-wise summary and SO options,
// which come from the register's own registerExtras (document counts). Each
// row is a register row plus its line id and Created On.

import type { CustomerDispatchLinesResponse, CustomerDispatchRegisterQuery } from '@innovic/shared';
import { sql } from 'drizzle-orm';

import { type AuthContext, withUserContext } from '../../db/with-user-context';
import { AuthorizationError } from '../../lib/errors';
import { readSf, sfOrderBy, sfWhere } from '../../lib/list-query';
import { billedStatusOf, loadBilledQtyByDispatch } from './billed';
import {
  HEADER_JOINS,
  LINE_JOINS,
  REGISTER_LINE_FROM,
  type RegisterRow,
  lineMatch,
  registerExtras,
  toRegisterRow,
} from './register';
import { DISPATCH_LINE_SF_COLUMNS } from './sf-columns';

export async function listDispatchLines(
  input: CustomerDispatchRegisterQuery,
  user: AuthContext,
): Promise<CustomerDispatchLinesResponse> {
  if (!user.companyId) throw new AuthorizationError('User is not assigned to a company');
  const companyId = user.companyId;
  const sfq = readSf(input.sf);
  const match = lineMatch(input.search);
  const soNo = input.soNo?.trim() || undefined;
  const soFrag = soNo ? sql`AND h.so_code_text = ${soNo}` : sql``;
  // Dispatch-side scope + Sort & Filter. Valid wherever h, cli, cso, u, l, i
  // and sol are joined: the page, the count and registerExtras' line queries.
  const scope = sql`
    h.company_id = ${companyId}::uuid AND h.deleted_at IS NULL ${soFrag}
    ${sfWhere(DISPATCH_LINE_SF_COLUMNS, sfq)}`;
  // Newest dispatch first (as the register), lines in line order, line id last.
  const order = sfOrderBy(
    DISPATCH_LINE_SF_COLUMNS,
    sfq,
    sql`h.dispatch_date DESC, h.created_at DESC, h.id DESC, l.line_no ASC, l.id ASC`,
  );
  const limitFrag = input.limit !== undefined ? sql`LIMIT ${input.limit}` : sql``;

  return withUserContext(user, async (tx) => {
    const lineRes = (await tx.execute(sql`
      ${REGISTER_LINE_FROM}
      WHERE ${scope} AND l.deleted_at IS NULL AND ${match}
      ORDER BY ${order}
      ${limitFrag} OFFSET ${input.offset ?? 0}
    `)) as unknown as RegisterRow[];

    const [cnt] = (await tx.execute(sql`
      SELECT COUNT(*)::int AS total
      FROM public.customer_dispatch_lines l
      JOIN public.customer_dispatches h ON h.id = l.customer_dispatch_id
      ${HEADER_JOINS}
      ${LINE_JOINS}
      WHERE ${scope} AND l.deleted_at IS NULL AND ${match}
    `)) as unknown as Array<{ total: number }>;

    const extras = await registerExtras(tx, companyId, scope, match);

    // ADR-190 — Billed Status is the DISPATCH's (against ALL its lines), the
    // same figure the register shows on each of its lines.
    const ids = [...new Set(lineRes.map((r) => r.dispatch_id))];
    const allQtyRows = ids.length
      ? ((await tx.execute(sql`
          SELECT al.customer_dispatch_id::text AS id, COALESCE(SUM(al.qty), 0)::int AS all_qty
          FROM public.customer_dispatch_lines al
          WHERE al.deleted_at IS NULL
            AND al.customer_dispatch_id IN (${sql.join(
              ids.map((id) => sql`${id}::uuid`),
              sql`, `,
            )})
          GROUP BY al.customer_dispatch_id
        `)) as unknown as Array<{ id: string; all_qty: number }>)
      : [];
    const allQty = new Map(allQtyRows.map((p) => [p.id, Number(p.all_qty)]));
    const billed = ids.length
      ? await loadBilledQtyByDispatch(tx, companyId)
      : new Map<string, number>();

    return {
      rows: lineRes.map((r) => ({
        ...toRegisterRow(
          r,
          billedStatusOf(billed.get(r.dispatch_id) ?? 0, allQty.get(r.dispatch_id) ?? 0),
        ),
        lineId: r.line_id,
        createdAt:
          r.line_created_at instanceof Date
            ? r.line_created_at.toISOString()
            : String(r.line_created_at),
      })),
      total: Number(cnt?.total ?? 0),
      summary: extras.summary,
      itemSummary: extras.itemSummary,
      soOptions: extras.soOptions,
    };
  });
}
