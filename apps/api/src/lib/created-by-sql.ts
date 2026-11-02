// THE "Created By" name in SQL (ADR-261 rev, owner 2026-11-02): the full name of
// the user in `createdByCol`, else the part of their e-mail before '@'; null when
// the id is null or matches no user (a soft-deleted login still shows its name:
// it did enter the record). One expression for every list endpoint, so no list
// grows its own. The screen shortens it with the shared `shortName`.
//
// `createdByCol` must be the created_by of the SAME record whose created_at the
// list shows as Created On — e.g. sql`COALESCE(pol.created_by, po.created_by)`
// beside `COALESCE(pol.created_at, po.created_at)`. A subquery on the users
// primary key, so callers add no JOIN.
//
// A Drizzle COLUMN is always written table-qualified here. Drizzle prints a
// column bare ("created_by") in a one-table select, and inside this subquery a
// bare "created_by" would bind to users.created_by — the wrong user, or "more
// than one row returned by a subquery" (bug found on TEST, 2026-11-02). Raw SQL
// passed in must already be qualified (alias.created_by).

import { Column, type SQL, type SQLWrapper, getTableName, is, sql } from 'drizzle-orm';

function qualified(col: SQLWrapper): SQLWrapper {
  if (!is(col, Column)) return col;
  return sql`${sql.identifier(getTableName(col.table))}.${sql.identifier(col.name)}`;
}

export function createdByNameSql(createdByCol: SQLWrapper): SQL<string | null> {
  return sql<
    string | null
  >`(SELECT COALESCE(NULLIF(btrim(cbu.full_name), ''), split_part(cbu.email, '@', 1))
    FROM public.users cbu WHERE cbu.id = ${qualified(createdByCol)})`;
}
