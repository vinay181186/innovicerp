// Settings → Approvals → Op Entry, paged on the server (ADR-201). The screen
// asks for 25 requests at a time; search and Sort & Filter run here over ALL
// requests, and `total` is counted with the SAME joins + WHERE as the page.
// The plain list (badge count, log-history ⏳ marker) is unchanged.

import { sql } from 'drizzle-orm';
import type {
  ListOpLogTimeChangePageQuery,
  ListOpLogTimeChangePageResponse,
} from '@innovic/shared';
import { type AuthContext, withUserContext } from '../../db/with-user-context';
import { AuthorizationError } from '../../lib/errors';
import { likeEscape, readSf, sfOrderBy, sfWhere, type SfColumnMap } from '../../lib/list-query';
import { selectTimeChangeRequests, TIME_CHANGE_FROM } from './service';

/** Each expression is the one the list SELECT shows for that column. */
export const TIME_CHANGE_SF_COLUMNS: SfColumnMap = {
  jcCode: { sql: sql`jc.code`, type: 'text' },
  opSeq: { sql: sql`o.op_seq`, type: 'num' },
  itemCode: {
    sql: sql`(i.code || COALESCE('/' || NULLIF(btrim(COALESCE(sol.revision::text, rev_jwl.revision::text)), ''), ''))`,
    type: 'text',
  },
  operation: { sql: sql`o.operation`, type: 'text' },
  logType: { sql: sql`l.log_type`, type: 'list' },
  machine: { sql: sql`COALESCE(m.code, l.machine_code_text)`, type: 'text' },
  // Prev → Requested sorts / filters by the REQUESTED date.
  requestedLogDate: { sql: sql`r.requested_log_date`, type: 'date' },
  entryQty: { sql: sql`l.qty`, type: 'num' },
  askedBy: { sql: sql`COALESCE(ru.full_name, ru.email)`, type: 'text' },
  status: { sql: sql`r.status`, type: 'list' },
  clientPoLineNo: { sql: sql`sol.client_po_line_no`, type: 'text' },
  itemName: { sql: sql`i.name`, type: 'text' },
  reason: { sql: sql`r.reason`, type: 'text' },
  decidedBy: { sql: sql`COALESCE(du.full_name, du.email)`, type: 'text' },
};

export async function listOpLogTimeChangePage(
  input: ListOpLogTimeChangePageQuery,
  user: AuthContext,
): Promise<ListOpLogTimeChangePageResponse> {
  if (!user.companyId) throw new AuthorizationError('User is not assigned to a company');
  const companyId = user.companyId;
  const sf = readSf(input.sf);
  const pat = input.search ? `%${likeEscape(input.search)}%` : null;
  const searchFrag = pat
    ? sql`AND (
        jc.code ILIKE ${pat} ESCAPE '\\'
        OR i.code ILIKE ${pat} ESCAPE '\\'
        OR COALESCE(sol.revision::text, rev_jwl.revision::text) ILIKE ${pat} ESCAPE '\\'
        OR i.name ILIKE ${pat} ESCAPE '\\'
        OR sol.client_po_line_no ILIKE ${pat} ESCAPE '\\'
        OR o.operation ILIKE ${pat} ESCAPE '\\'
        OR COALESCE(m.code, l.machine_code_text) ILIKE ${pat} ESCAPE '\\'
        OR r.reason ILIKE ${pat} ESCAPE '\\'
        OR COALESCE(ru.full_name, ru.email) ILIKE ${pat} ESCAPE '\\'
        OR COALESCE(du.full_name, du.email) ILIKE ${pat} ESCAPE '\\'
      )`
    : sql``;
  const where = sql`${searchFrag} ${sfWhere(TIME_CHANGE_SF_COLUMNS, sf)}`;
  // Waiting is a FIFO queue (oldest first); the decided tabs read newest
  // first. Ends on r.id so pages never skip or repeat a request.
  const fallback =
    input.status === 'pending' || !input.status
      ? sql`r.requested_at ASC, r.id ASC`
      : sql`r.requested_at DESC, r.id DESC`;
  const orderBy = sfOrderBy(TIME_CHANGE_SF_COLUMNS, sf, fallback);

  return withUserContext(user, async (tx) => {
    const items = await selectTimeChangeRequests(tx, companyId, {
      ...(input.status ? { status: input.status } : {}),
      limit: input.limit,
      offset: input.offset,
      where,
      orderBy,
    });
    const [row] = (await tx.execute(sql`
      SELECT COUNT(*)::int AS total
      ${TIME_CHANGE_FROM}
      WHERE r.company_id = ${companyId}::uuid
        AND r.deleted_at IS NULL
        ${input.status ? sql`AND r.status = ${input.status}::public.op_log_change_status` : sql``}
        ${where}
    `)) as unknown as Array<{ total: number }>;
    return { items, total: Number(row?.total ?? 0), limit: input.limit, offset: input.offset };
  });
}
