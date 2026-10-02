// Sort & Filter (ADR-200) — the Raw Material Master GRADE tab's fields.
// listMaterialGrades reads the materialGrades table alone (list and count over the
// same WHERE), so each expression is one of its columns. Active is the stored
// flag as 'true' / 'false'.

import { sql } from 'drizzle-orm';

import { materialGrades } from '../../db/schema';
import type { SfColumnMap } from '../../lib/list-query';

export const MATERIAL_GRADE_SF_COLUMNS: SfColumnMap = {
  code: { sql: sql`${materialGrades.code}`, type: 'text' },
  name: { sql: sql`${materialGrades.name}`, type: 'text' },
  description: { sql: sql`${materialGrades.description}`, type: 'text' },
  isActive: { sql: sql`${materialGrades.isActive}::text`, type: 'list' },
};
