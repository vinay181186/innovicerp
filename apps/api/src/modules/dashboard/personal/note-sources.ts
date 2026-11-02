// The decision / work note sources (decision-notes.ts, work-notes.ts) read in
// ONE statement: each source is a sub-select aggregated to JSON
// (`SELECT (SELECT json_agg(…) FROM (<source>) x) AS s0, …`), so the bell and
// the home pay one round trip (inside one savepoint) instead of one savepoint
// + query per source. If that statement fails (a missing grant, a renamed
// table in one source), it is rolled back to its savepoint, logged, and the
// sources are re-run one by one, each in its own savepoint — so a failure
// still drops only the source that fails.

import type { DashNote } from '@innovic/shared';
import { type SQL, sql } from 'drizzle-orm';
import type { DbTransaction } from '../../../db/with-user-context';

/** A note worded at read time (not an activity rule). `open` = its next step
 *  is still open (home shows only open ones; a decision is always open). */
export type ExtraNote = DashNote & { actorName: string | null; open: boolean };

export interface NoteSource {
  /** Log name, e.g. `decision:edit`. */
  source: string;
  /** The source's own bounded statement (company, window, LIMIT). */
  query: SQL;
  /** The column the source is ordered by, newest first (its query ends
   *  `ORDER BY <col> DESC, id DESC`); the combined statement aggregates in
   *  the same order, so both paths hand rows over identically. */
  orderCol: 'decided_at' | 'ts';
  /** Its rows → the caller's notes. */
  toNotes: (rows: Array<Record<string, unknown>>) => ExtraNote[];
}

/** Logged on failure only — the logger loads the environment, which the
 *  unit tests do not have. */
async function logFailure(err: unknown, source: string): Promise<void> {
  const { logger } = await import('../../../lib/logger');
  logger.error({ err, source }, 'dashboard note source failed');
}

/** One read inside its own savepoint (drizzle nested transaction): a failing
 *  statement rolls back to the savepoint, is logged, and yields nothing. Run
 *  one at a time — savepoints on one connection must not interleave. */
async function guardedRead<T>(
  tx: DbTransaction,
  source: string,
  read: (sp: DbTransaction) => Promise<T[]>,
): Promise<T[]> {
  try {
    return await tx.transaction((sp) => read(sp as DbTransaction));
  } catch (err) {
    await logFailure(err, source);
    return [];
  }
}

/** ONE statement: one JSON array column per source (`s0`, `s1`, …). Each
 *  source keeps its own ORDER BY / LIMIT inside its sub-select, and the
 *  aggregate repeats that order (orderCol DESC, id DESC). */
export function combinedSourcesSql(sources: readonly NoteSource[]): SQL {
  const cols = sources.map(
    (s, i) =>
      sql`(SELECT COALESCE(json_agg(row_to_json(x) ORDER BY x.${sql.raw(s.orderCol)} DESC, x.id DESC), '[]'::json) FROM (${s.query}) x) AS ${sql.raw(`s${i}`)}`,
  );
  return sql`SELECT ${sql.join(cols, sql`, `)}`;
}

/** postgres-js hands json back parsed; accept a string too. */
function rowsOf(v: unknown): Array<Record<string, unknown>> {
  const parsed = typeof v === 'string' ? (JSON.parse(v) as unknown) : v;
  return Array.isArray(parsed) ? (parsed as Array<Record<string, unknown>>) : [];
}

/** Every source's notes: the combined statement, else (it failed) each
 *  source alone under its own savepoint. */
export async function readSources(
  tx: DbTransaction,
  sources: readonly NoteSource[],
): Promise<ExtraNote[]> {
  if (sources.length === 0) return [];
  let row: Record<string, unknown> | undefined;
  try {
    const res = await tx.transaction(
      async (sp) =>
        (await sp.execute(combinedSourcesSql(sources))) as unknown as Array<
          Record<string, unknown>
        >,
    );
    row = res[0];
  } catch (err) {
    await logFailure(err, 'combined');
  }
  const got = row;
  if (got) return sources.flatMap((s, i) => s.toNotes(rowsOf(got[`s${i}`])));
  const out: ExtraNote[] = [];
  for (const s of sources) {
    out.push(
      ...(await guardedRead(tx, s.source, async (sp) =>
        s.toNotes((await sp.execute(s.query)) as unknown as Array<Record<string, unknown>>),
      )),
    );
  }
  return out;
}
