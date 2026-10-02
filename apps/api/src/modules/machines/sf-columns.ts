// Sort & Filter (ADR-200) — the Machine Master list's sortable / filterable
// fields. listMachines reads the machines table alone (drizzle builder), list
// and count over the same WHERE, so every expression is a machines column —
// the Machine Group code is read through the machine's own FK, the same way
// the search box matches it.
//   hourRate — money: only for users who may see the machine's ₹/hr.

import { sql } from 'drizzle-orm';

import { machines } from '../../db/schema';
import type { SfColumnMap } from '../../lib/list-query';

export const MACHINE_SF_COLUMNS: SfColumnMap = {
  code: { sql: sql`${machines.code}`, type: 'text' },
  name: { sql: sql`${machines.name}`, type: 'text' },
  machineType: { sql: sql`${machines.machineType}`, type: 'text' },
  machineGroup: {
    sql: sql`(SELECT mg.code FROM public.machine_groups mg
      WHERE mg.id = ${machines.machineGroupId} AND mg.deleted_at IS NULL)`,
    type: 'text',
  },
  capacityPerShift: { sql: sql`${machines.capacityPerShift}`, type: 'num' },
  hourRate: { sql: sql`${machines.hourRate}`, type: 'num', price: true },
  status: { sql: sql`${machines.status}`, type: 'list' },
};
