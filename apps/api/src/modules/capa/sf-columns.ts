// Sort & Filter (ADR-200) — the CAPA list's sortable / filterable fields. Each
// expression is the column the CAPA list shows (capa_records, no joins), so the
// same map serves the page and its count.

import { sql } from 'drizzle-orm';

import { capaRecords as c } from '../../db/schema';
import type { SfColumnMap } from '../../lib/list-query';

/** NC No. as the cell prints it: the jsonb array joined with ", ". */
export const CAPA_NC_REFS_TEXT = sql`(SELECT string_agg(x, ', ') FROM jsonb_array_elements_text(${c.ncRefs}) AS x)`;

export const CAPA_SF_COLUMNS: SfColumnMap = {
  code: { sql: sql`${c.code}`, type: 'text' },
  type: { sql: sql`${c.type}`, type: 'list' },
  ncRefs: { sql: CAPA_NC_REFS_TEXT, type: 'text' },
  problem: { sql: sql`${c.problem}`, type: 'text' },
  responsible: { sql: sql`${c.responsible}`, type: 'text' },
  targetDate: { sql: sql`${c.targetDate}`, type: 'date' },
  status: { sql: sql`${c.status}`, type: 'list' },
  capaDate: { sql: sql`${c.capaDate}`, type: 'date' },
};
