// Settings → Approvals → Op Entry, paged on the server (ADR-201). The screen
// asks for 25 requests at a time; search and Sort & Filter run here over ALL
// requests, and `total` is counted with the SAME joins + WHERE as the page.
// The plain list (badge count, log-history ⏳ marker) is unchanged.

import { type SQL, sql } from 'drizzle-orm';
import type {
  ListOpLogTimeChangePageQuery,
  ListOpLogTimeChangePageResponse,
} from '@innovic/shared';
import { type AuthContext, withUserContext } from '../../db/with-user-context';
import { hasFormAccess } from '../../lib/access';
import { AuthorizationError } from '../../lib/errors';
import { polSql } from '../../lib/pol';
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
  clientPoLineNo: { sql: polSql('sol', 'rev_jwl'), type: 'text' },
  itemName: { sql: sql`i.name`, type: 'text' },
  reason: { sql: sql`r.reason`, type: 'text' },
  decidedBy: { sql: sql`COALESCE(du.full_name, du.email)`, type: 'text' },
};

/**
 * ADR-232: which correction requests this caller may decide. A QC row is
 * decided on QC Call Register Approve, a production row on Op Entry Approve
 * (decideOpLogTimeChange) — so the queue and its count show only those, and an
 * approver never sees a row whose Approve button would refuse them. Read before
 * any transaction: each access check opens its own.
 */
export async function decidableTimeChangeScope(user: AuthContext): Promise<SQL> {
  const qc = await hasFormAccess(user, 'qc_submit', 'approve');
  const prod = await hasFormAccess(user, 'op_entry', 'approve');
  if (qc && prod) return sql``;
  if (qc) return sql`AND l.log_type = 'qc'`;
  if (prod) return sql`AND l.log_type <> 'qc'`;
  return sql`AND false`;
}

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
        OR ${polSql('sol', 'rev_jwl')} ILIKE ${pat} ESCAPE '\\'
        OR o.operation ILIKE ${pat} ESCAPE '\\'
        OR COALESCE(m.code, l.machine_code_text) ILIKE ${pat} ESCAPE '\\'
        OR r.reason ILIKE ${pat} ESCAPE '\\'
        OR COALESCE(ru.full_name, ru.email) ILIKE ${pat} ESCAPE '\\'
        OR COALESCE(du.full_name, du.email) ILIKE ${pat} ESCAPE '\\'
      )`
    : sql``;
  const scope = await decidableTimeChangeScope(user);
  const where = sql`${scope} ${searchFrag} ${sfWhere(TIME_CHANGE_SF_COLUMNS, sf)}`;
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
