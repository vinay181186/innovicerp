// THE "Created By" name in SQL (ADR-261 rev, owner 2026-11-02): the full name of
// the user in `createdByCol`, else the part of their e-mail before '@'; null when
// the id is null or matches no user (a soft-deleted login still shows its name:
// it did enter the record). One expression for every list endpoint, so
// no list grows its own. The screen shortens it with the shared `shortName`.
//
// `createdByCol` must be the created_by of the SAME record whose created_at the
// list shows as Created On — e.g. sql`COALESCE(pol.created_by, po.created_by)`
// beside `COALESCE(pol.created_at, po.created_at)`. A subquery on the users
// primary key, so callers add no JOIN.

import { type SQL, type SQLWrapper, sql } from 'drizzle-orm';

export function createdByNameSql(createdByCol: SQLWrapper): SQL<string | null> {
  return sql<
    string | null
  >`(SELECT COALESCE(NULLIF(btrim(cbu.full_name), ''), split_part(cbu.email, '@', 1))
    FROM public.users cbu WHERE cbu.id = ${createdByCol})`;
}
