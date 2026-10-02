// Sort & Filter (ADR-200) — the Machine Groups tab's sortable / filterable
// fields. listMachineGroups reads the machine_groups table alone (list and
// count over the same WHERE), so each expression is a machine_groups column.
// Active is the stored flag as 'true' / 'false'.

import { sql } from 'drizzle-orm';

import { machineGroups } from '../../db/schema';
import type { SfColumnMap } from '../../lib/list-query';

export const MACHINE_GROUP_SF_COLUMNS: SfColumnMap = {
  code: { sql: sql`${machineGroups.code}`, type: 'text' },
  description: { sql: sql`${machineGroups.description}`, type: 'text' },
  isActive: { sql: sql`${machineGroups.isActive}::text`, type: 'list' },
};
