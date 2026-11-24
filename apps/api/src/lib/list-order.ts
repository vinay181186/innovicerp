// ADR-318 — THE default order of every list: newest created first (owner
// 2026-11-24: "latest no. on top across system", latest = Created On time).
//
// Created time is the order numbers were issued, so the newest number is on
// top in every series (typed SO-433 and system IN-SO-00025 alike — sorting the
// number TEXT puts every "SO-" above every "IN-SO-" and SO-99 above SO-433).
// The id ends the order so paging never skips or repeats a row.
//
// A column the user picks (▾ sort, sfOrderBy) still wins; this order then
// breaks its ties. Lists that keep their own order on purpose (work queues,
// value reports, lines inside a document) are named in
// list-order.guard.unit.test.ts with the reason.

import { sql, type SQL } from 'drizzle-orm';

/** `<a>.created_at DESC, <a>.id DESC` — newest created first, stable. */
export function newestFirst(alias: string, idCol = 'id', createdCol = 'created_at'): SQL {
  return sql.raw(`${alias}.${createdCol} DESC, ${alias}.${idCol} DESC`);
}

/** The same order over already-selected columns (a CTE / derived table whose
 *  created time and id are exposed under their own names). */
export function newestFirstCols(createdExpr: string, idExpr: string): SQL {
  return sql.raw(`${createdExpr} DESC, ${idExpr} DESC`);
}

/** A timestamptz as fixed-width UTC text that sorts in time order — for
 *  text sort keys (Home checks' sort_key). */
export function createdKey(expr: string): SQL {
  return sql.raw(`to_char((${expr}) AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US')`);
}
