// Design "still open" rules — the ONE SQL definition of each (ADR-264 phase 2:
// the home's Design checks and the Design screens read the same words).
//
//   project  — not Released and not On Hold (Design Active / In Review)
//   tracker  — not Approved (Pending / In Progress / Review / Revision)
//   issue    — Open or In Progress
//   DCR      — Submitted or Under Review (waiting a decision)
//
// Each takes the alias the caller's FROM clause gives the table and returns a
// parenthesised boolean (no leading AND).

import { sql, type SQL } from 'drizzle-orm';

export function designProjectOpenSql(alias = 'dp'): SQL {
  return sql`(${sql.identifier(alias)}.status NOT IN ('Released', 'On Hold'))`;
}

export function designTrackerPendingSql(alias = 'dt'): SQL {
  return sql`(${sql.identifier(alias)}.status <> 'Approved')`;
}

export function designIssueOpenSql(alias = 'di'): SQL {
  return sql`(${sql.identifier(alias)}.status IN ('Open', 'In Progress'))`;
}

export function designDcrPendingSql(alias = 'dcr'): SQL {
  return sql`(${sql.identifier(alias)}.status IN ('Submitted', 'Under Review'))`;
}
