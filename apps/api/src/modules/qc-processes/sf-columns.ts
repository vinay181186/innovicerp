// Sort & Filter (ADR-200) — the QC Process Master list's sortable /
// filterable fields. listQcProcesses reads the qc_processes table alone
// (drizzle builder), list and count over the same WHERE, so every expression
// is a qc_processes column. The QC Process Name column prints the code.
// Active is the boolean as text ('true' / 'false').

import { sql } from 'drizzle-orm';

import { qcProcesses } from '../../db/schema';
import type { SfColumnMap } from '../../lib/list-query';

export const QC_PROCESS_SF_COLUMNS: SfColumnMap = {
  code: { sql: sql`${qcProcesses.code}`, type: 'text' },
  description: { sql: sql`${qcProcesses.description}`, type: 'text' },
  defaultCycleTimeMin: { sql: sql`${qcProcesses.defaultCycleTimeMin}`, type: 'num' },
  isActive: { sql: sql`${qcProcesses.isActive}`, type: 'list' },
};
