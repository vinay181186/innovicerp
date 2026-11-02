// "NC waiting for its disposition" — the ONE SQL definition (AL-018 and the
// home's QC check qc_nc_pending read it, so the two can never disagree).

import { sql, type SQL } from 'drizzle-orm';

/** Parenthesised boolean (no leading AND) for the nc_register row `alias`. */
export function ncPendingDispositionSql(alias = 'nc'): SQL {
  return sql`(${sql.identifier(alias)}.status = 'pending')`;
}
