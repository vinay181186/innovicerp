// Sort & Filter (ADR-200) — the Vendor Master list's sortable / filterable
// fields. listVendors reads the vendors table alone (drizzle builder), list
// and count over the same WHERE, so every expression is a vendors column,
// exactly what the screen's cell shows. Active / Inactive is the status
// dropdown (the server `isActive` param), not a column filter.

import { sql } from 'drizzle-orm';

import { vendors } from '../../db/schema';
import type { SfColumnMap } from '../../lib/list-query';

export const VENDOR_SF_COLUMNS: SfColumnMap = {
  code: { sql: sql`${vendors.code}`, type: 'text' },
  name: { sql: sql`${vendors.name}`, type: 'text' },
  contactPerson: { sql: sql`${vendors.contactPerson}`, type: 'text' },
  phone: { sql: sql`${vendors.phone}`, type: 'text' },
  email: { sql: sql`${vendors.email}`, type: 'text' },
  gstNumber: { sql: sql`${vendors.gstNumber}`, type: 'text' },
  paymentTermsDays: { sql: sql`${vendors.paymentTermsDays}`, type: 'num' },
  address: { sql: sql`${vendors.addressLine1}`, type: 'text' },
  rating: { sql: sql`${vendors.rating}`, type: 'text' },
};
