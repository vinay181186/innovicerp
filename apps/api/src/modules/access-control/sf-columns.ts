// Sort & Filter (ADR-200) — the Access Control list's sortable / filterable
// fields. listUserAccess reads users LEFT JOIN user_access, so each expression
// is the column the row shows: User (name, else e-mail) and Home Dept (the
// stored department key — the screen ticks from ACCESS_DEPTS). Tiers /
// Departments / Extras are worked out per row from the jsonb matrix and are
// not filterable on the server.

import { sql } from 'drizzle-orm';

import { userAccess, users } from '../../db/schema';
import type { SfColumnMap } from '../../lib/list-query';

export const ACCESS_SF_COLUMNS: SfColumnMap = {
  user: { sql: sql`COALESCE(${users.fullName}, ${users.email})`, type: 'text' },
  homeDept: { sql: sql`${userAccess.mainDept}`, type: 'list' },
};
