// Sort & Filter (ADR-200) — the Customer Master list's sortable / filterable
// fields. listClients reads the clients table alone (drizzle builder), list
// and count over the same WHERE, so every expression is a clients column,
// exactly what the screen's cell shows. Active / Inactive is the status
// dropdown (the server `isActive` param), not a column filter.

import { sql } from 'drizzle-orm';

import { clients } from '../../db/schema';
import type { SfColumnMap } from '../../lib/list-query';

export const CLIENT_SF_COLUMNS: SfColumnMap = {
  code: { sql: sql`${clients.code}`, type: 'text' },
  name: { sql: sql`${clients.name}`, type: 'text' },
  address: { sql: sql`${clients.addressLine1}`, type: 'text' },
  contact: { sql: sql`${clients.contactPerson}`, type: 'text' },
  email: { sql: sql`${clients.email}`, type: 'text' },
};
