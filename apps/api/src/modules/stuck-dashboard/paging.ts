// Stuck Dashboard paging (ADR-201). The stuck rows are worked out in code (the
// rule engine in ./rules), so to page, search and Sort & Filter them on the
// server with the SAME helpers every list uses, the computed rows are handed
// to Postgres as a jsonb recordset and queried like a table (alias `t`).
//
// Default order = the screen's long-standing one: rows grouped by stage, the
// largest group first (ties: the group whose worst row is more over
// threshold), most-over-threshold first inside a group. Group sizes are
// counted AFTER search + filters, exactly as the screen used to.

import type { StuckItem } from '@innovic/shared';
import { type SQL, sql } from 'drizzle-orm';
import type { DbTransaction } from '../../db/with-user-context';
import { likeEscape, readSf, sfOrderBy, sfWhere, type SfColumnMap } from '../../lib/list-query';

export const STUCK_SF_COLUMNS: SfColumnMap = {
  soNo: { sql: sql`t.so_no`, type: 'text' },
  stage: { sql: sql`t.stage`, type: 'text' },
  customer: { sql: sql`t.customer`, type: 'text' },
  days: { sql: sql`t.days`, type: 'num' },
  threshold: { sql: sql`t.threshold`, type: 'num' },
  overBy: { sql: sql`(t.days - t.threshold)`, type: 'num' },
  since: { sql: sql`NULLIF(left(t.since, 10), '')::date`, type: 'date' },
  detail: { sql: sql`t.detail`, type: 'text' },
};

const REC = sql`t(so_id text, so_no text, customer text, stage text, days int,
  threshold int, detail text, since text, color text, ord int)`;

/** `items` must already be in most-over-threshold order (that order is `ord`). */
export async function pageStuckItems(
  tx: DbTransaction,
  items: StuckItem[],
  input: { search?: string | undefined; sf?: string | undefined; limit: number; offset: number },
): Promise<{ page: StuckItem[]; total: number }> {
  const sf = readSf(input.sf);
  const json = JSON.stringify(
    items.map((it, ord) => ({
      so_id: it.soId,
      so_no: it.soNo,
      customer: it.customer,
      stage: it.stage,
      days: it.days,
      threshold: it.threshold,
      detail: it.detail,
      since: it.since,
      color: it.color,
      ord,
    })),
  );
  const term = (input.search ?? '').trim().replace(/\s+/g, ' ');
  let search: SQL = sql``;
  if (term !== '') {
    const pat = `%${likeEscape(term)}%`;
    search = sql`AND (t.so_no ILIKE ${pat} ESCAPE '\' OR t.customer ILIKE ${pat} ESCAPE '\'
      OR t.stage ILIKE ${pat} ESCAPE '\' OR t.detail ILIKE ${pat} ESCAPE '\')`;
  }
  const filtered = sql`SELECT t.* FROM jsonb_to_recordset(${json}::jsonb) AS ${REC}
    WHERE TRUE ${search} ${sfWhere(STUCK_SF_COLUMNS, sf)}`;
  const order = sfOrderBy(STUCK_SF_COLUMNS, sf, sql`t.gc DESC, t.gf, t.ord`);
  const rows = (await tx.execute(sql`
    SELECT t.* FROM (
      SELECT f.*, COUNT(*) OVER (PARTITION BY f.stage) AS gc,
                  MIN(f.ord) OVER (PARTITION BY f.stage) AS gf
      FROM (${filtered}) f
    ) t
    ORDER BY ${order}
    LIMIT ${input.limit} OFFSET ${input.offset}
  `)) as unknown as Array<{ ord: number }>;
  const [cnt] = (await tx.execute(
    sql`SELECT COUNT(*)::int AS c FROM (${filtered}) f`,
  )) as unknown as Array<{ c: number }>;
  return {
    page: rows.map((r) => items[Number(r.ord)]!),
    total: Number(cnt?.c) || 0,
  };
}
