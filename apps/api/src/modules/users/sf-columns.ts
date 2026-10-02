// Sort & Filter (ADR-200) — the User Management list's sortable / filterable
// fields. listUsers reads the users table alone (drizzle builder), list and
// count over the same WHERE, so every expression is a users column. Status is
// the is_active boolean as text ('true' / 'false'). Department, Access and
// Approver are not here: they come from other endpoints (access control,
// approval config) and are drawn in the browser, not stored on this row.

import { sql } from 'drizzle-orm';

import { users } from '../../db/schema';
import type { SfColumnMap } from '../../lib/list-query';

export const USER_SF_COLUMNS: SfColumnMap = {
  fullName: { sql: sql`${users.fullName}`, type: 'text' },
  email: { sql: sql`${users.email}`, type: 'text' },
  phone: { sql: sql`${users.phone}`, type: 'text' },
  isActive: { sql: sql`${users.isActive}`, type: 'list' },
};
