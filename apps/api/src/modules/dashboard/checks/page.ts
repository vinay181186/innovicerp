// ADR-312 — GET /dashboard/checks/:key: the "View all N" page of one check.
// Its rows are the check's OWN inner query (CheckDef.query) — the same SQL the
// home counts with checkSummarySql — so with no search the page total equals
// the count on the home. Visibility is getChecks' rule (visibleChecks: the
// department tier); a check the caller cannot see is 403. The `check` meta is
// built by the home's own path (runCheck → finish), rows by toCheckRow with
// the caller's access, so the document number opens the next step's page
// exactly as on the home. Order = ROW_ORDER, the home's.
// Search: ILIKE over document no., party, item code / name, and the column
// the check's Reference reads (refColumn).

import type { DashCheckKey, DashCheckPageResponse } from '@innovic/shared';
import { type SQL, sql } from 'drizzle-orm';
import { type AuthContext, withUserContext } from '../../../db/with-user-context';
import { AuthorizationError } from '../../../lib/errors';
import { likeEscape } from '../../../lib/list-query';
import { canSeePrice, loadAccess } from '../access';
import type { RawRow } from '../personal/list-query';
import { istToday } from '../personal/util';
import { finish, visibleChecks } from './service';
import {
  type CheckCtx,
  type CheckDef,
  ROW_ORDER,
  colsOf,
  parseCheckSummary,
  runCheck,
  toCheckRow,
  x4Of,
} from './types';

/** dashCheckPageQuerySchema, parsed (defaults applied). */
export interface PageQuery {
  search?: string | undefined;
  limit: number;
  offset: number;
}

const REF_COLUMNS = ['x1', 'x2', 'x3', 'kind'] as const;
type RefColumn = (typeof REF_COLUMNS)[number];

/** Which inner column the check's Reference shows, found by asking refCode
 *  itself (one place to change: the CheckDef). Null = no plain column. */
export function refColumn(d: Pick<CheckDef, 'refCode'>): RefColumn | null {
  if (!d.refCode) return null;
  const probe: RawRow = {
    rowKey: '',
    id: '',
    code: '',
    kind: '\u0001kind',
    docDate: null,
    dueDate: null,
    party: null,
    itemCode: null,
    itemName: null,
    qty: null,
    uom: null,
    amount: null,
    createdBy: null,
    isLate: false,
    x1: '\u0001x1',
    x2: '\u0001x2',
    x3: '\u0001x3',
  };
  const got = d.refCode(probe);
  return REF_COLUMNS.find((c) => got === `\u0001${c}`) ?? null;
}

/** The search condition over alias x (TRUE when there is no search). */
export function searchWhere(d: Pick<CheckDef, 'refCode'>, search: string | undefined): SQL {
  const q = search?.trim();
  if (!q) return sql`TRUE`;
  const pat = `%${likeEscape(q)}%`;
  const ref = refColumn(d);
  const cols = ['code', 'party', 'item_code', 'item_name', ...(ref ? [ref] : [])];
  return sql`(${sql.join(
    cols.map((c) => sql`${sql.raw(`x.${c}`)}::text ILIKE ${pat} ESCAPE '\\'`),
    sql` OR `,
  )})`;
}

/** One page of a check's rows as a summary json (parseCheckSummary reads it):
 *  total = rows matching the search; rows = that page in ROW_ORDER. */
export function checkPageSql(inner: SQL, where: SQL, limit: number, offset: number): SQL {
  return sql`(WITH x AS (${inner}), f AS (SELECT x.* FROM x WHERE ${where})
    SELECT json_build_object(
      'total', (SELECT COUNT(*) FROM f)::int,
      'late', 0, 'dueToday', 0,
      'rows', (SELECT COALESCE(json_agg(r ORDER BY ${ROW_ORDER('r')}), '[]'::json)
               FROM (SELECT ${colsOf('f')}, ${x4Of('f')} FROM f ORDER BY ${ROW_ORDER('f')}
                     LIMIT ${limit} OFFSET ${offset}) r)))`;
}

export async function getCheckPage(
  user: AuthContext,
  key: DashCheckKey,
  query: PageQuery,
): Promise<DashCheckPageResponse> {
  if (!user.companyId) throw new AuthorizationError('User is not assigned to a company');
  const c: CheckCtx = { cid: user.companyId, today: istToday() };
  // Access first: it opens its own transaction (ADR-229).
  const a = await loadAccess(user);
  const d = visibleChecks(a).find((x) => x.key === key);
  if (!d) throw new AuthorizationError('This check is not on your home.');
  const showMoney = canSeePrice(a, d.priceForm);

  return withUserContext(user, async (tx) => {
    // The home's own figures (count, tone) — no rows needed.
    const home = finish(d, await runCheck(tx, d.query(c), c.today, 0), c, a);
    const check = {
      key: home.key,
      dept: home.dept,
      label: home.label,
      count: home.count,
      tone: home.tone,
      head: home.head,
      href: home.href,
    };
    const res = (await tx.execute(
      sql`SELECT ${checkPageSql(d.query(c), searchWhere(d, query.search), query.limit, query.offset)} AS j`,
    )) as unknown as Array<Record<string, unknown>>;
    const page = parseCheckSummary(res[0]?.['j']);
    return {
      check,
      rows: page.rows.map((r) => toCheckRow(d, r, c.today, showMoney, a)),
      total: page.total,
    };
  });
}
