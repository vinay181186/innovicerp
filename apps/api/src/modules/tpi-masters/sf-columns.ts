// Sort & Filter (ADR-200) — the TPI Master list's sortable / filterable
// fields. listTpiMasters reads the tpi_masters table alone (drizzle builder),
// list and count over the same WHERE, so every expression is a tpi_masters
// column, exactly what the screen's cell shows. `code` is the inspector's
// NAME. Active / Inactive is the dropdown (`isActive`), not a column filter.

import { sql } from 'drizzle-orm';

import { tpiMasters } from '../../db/schema';
import type { SfColumnMap } from '../../lib/list-query';

export const TPI_MASTER_SF_COLUMNS: SfColumnMap = {
  name: { sql: sql`${tpiMasters.code}`, type: 'text' },
  organization: { sql: sql`${tpiMasters.organization}`, type: 'text' },
  contactNo: { sql: sql`${tpiMasters.contactNo}`, type: 'text' },
  email: { sql: sql`${tpiMasters.email}`, type: 'text' },
};
