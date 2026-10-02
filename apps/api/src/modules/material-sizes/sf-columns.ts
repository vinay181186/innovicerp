// Sort & Filter (ADR-200) — the Raw Material Master SIZE tab's fields.
// listMaterialSizes reads the materialSizes table alone (list and count over the
// same WHERE), so each expression is one of its columns. Active is the stored
// flag as 'true' / 'false'.

import { sql } from 'drizzle-orm';

import { materialSizes } from '../../db/schema';
import type { SfColumnMap } from '../../lib/list-query';

export const MATERIAL_SIZE_SF_COLUMNS: SfColumnMap = {
  code: { sql: sql`${materialSizes.code}`, type: 'text' },
  name: { sql: sql`${materialSizes.name}`, type: 'text' },
  description: { sql: sql`${materialSizes.description}`, type: 'text' },
  isActive: { sql: sql`${materialSizes.isActive}::text`, type: 'list' },
};
