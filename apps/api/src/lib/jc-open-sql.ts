import { sql, type SQL } from 'drizzle-orm';

// Open Job Card — the one rule for "this card's leftover operations still count
// as pending work" (owner decision 2a, 24-Nov). A card is OPEN when it is
// neither Closed nor cancelled:
//
//   closed_at IS NULL   — Closed / short-closed cards set closed_at
//                         (v_jc_status: WHEN jc.closed_at IS NOT NULL THEN 'closed')
//   deleted_at IS NULL  — cancelled cards are soft-deleted
//
// Every pending-op reader (Job Queue, Machine Loading, Production Dashboard,
// Home widgets, Stuck Dashboard, WIP reports) ANDs this onto its job_cards
// join. Use this, never a hand-written pair: one place to change the rule.

const ALIAS = /^[a-z_][a-z0-9_]*$/;

/** `(<jc>.closed_at IS NULL AND <jc>.deleted_at IS NULL)` as plain text, for
 *  the few readers that build their query as a string (`sql.raw`, `q(tx, …)`).
 *  `jcAlias` is the job_cards alias from the caller's own FROM clause. */
export function jcOpenCond(jcAlias: string): string {
  if (!ALIAS.test(jcAlias)) {
    throw new Error(`jcOpenSql: bad alias "${jcAlias}"`);
  }
  return `(${jcAlias}.closed_at IS NULL AND ${jcAlias}.deleted_at IS NULL)`;
}

/** The same rule as a drizzle `sql` fragment for tagged-template queries. */
export function jcOpenSql(jcAlias: string): SQL {
  return sql.raw(jcOpenCond(jcAlias));
}
