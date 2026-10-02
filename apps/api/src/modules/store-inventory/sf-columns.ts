// Sort & Filter (ADR-200) — the Store Inventory list's sortable / filterable
// fields. Each expression is a column of the `base` CTE listStoreInventory
// SELECTs from (alias b), shared by the page and its summary query.

import { sql } from 'drizzle-orm';

import type { SfColumnMap } from '../../lib/list-query';

export const STORE_INV_SF_COLUMNS: SfColumnMap = {
  itemCode: { sql: sql`b.item_code`, type: 'text' },
  itemName: { sql: sql`b.item_name`, type: 'text' },
  material: { sql: sql`b.material`, type: 'text' },
  uom: { sql: sql`b.uom`, type: 'text' },
  inStock: { sql: sql`b.in_stock`, type: 'num' },
  reservedQty: { sql: sql`b.reserved_qty`, type: 'num' },
  availableQty: { sql: sql`b.available_qty`, type: 'num' },
  reorderLevel: { sql: sql`b.reorder_level`, type: 'num' },
  onPoQty: { sql: sql`b.on_po_qty`, type: 'num' },
  atVendorQty: { sql: sql`b.at_vendor_qty`, type: 'num' },
  mfgPendingQty: { sql: sql`b.mfg_pending_qty`, type: 'num' },
};
