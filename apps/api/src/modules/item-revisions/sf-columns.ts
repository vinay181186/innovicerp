// Sort & Filter (ADR-200) — the Drawing Register list's sortable / filterable
// fields (ADR-290). Each expression is the SAME one listDrawingRegister
// SELECTs (aliases ir, i, ru, ol, oj, pc, so — used by its list and count query).

import { sql } from 'drizzle-orm';

import type { SfColumnMap } from '../../lib/list-query';

export const DRAWING_REGISTER_SF_COLUMNS: SfColumnMap = {
  itemCode: { sql: sql`i.code`, type: 'text' },
  itemName: { sql: sql`i.name`, type: 'text' },
  customerPartNo: { sql: sql`i.customer_part_no`, type: 'text' },
  drawingRev: { sql: sql`ir.rev`, type: 'text' },
  drawingNo: { sql: sql`ir.drawing_no`, type: 'text' },
  releaseStatus: { sql: sql`ir.release_status`, type: 'list' },
  releasedAt: {
    sql: sql`(ir.released_at AT TIME ZONE 'Asia/Kolkata')::date`,
    sortSql: sql`ir.released_at`,
    type: 'date',
  },
  releasedByName: {
    sql: sql`COALESCE(NULLIF(btrim(ru.full_name), ''), split_part(ru.email, '@', 1))`,
    type: 'text',
  },
  // ADR-315 — SO No. (alias so: the order codes, newest first).
  orders: { sql: sql`so.codes`, type: 'text' },
  openLines: { sql: sql`ol.n`, type: 'num' },
  openJobCards: { sql: sql`oj.n`, type: 'num' },
  // ADR-317 — lead block: Created On (IST date) / Created By.
  createdOn: {
    sql: sql`(ir.created_at AT TIME ZONE 'Asia/Kolkata')::date`,
    sortSql: sql`ir.created_at`,
    type: 'date',
  },
  createdBy: {
    sql: sql`COALESCE(NULLIF(btrim(cu.full_name), ''), split_part(cu.email, '@', 1))`,
    type: 'text',
  },
  updatedAt: {
    sql: sql`(ir.updated_at AT TIME ZONE 'Asia/Kolkata')::date`,
    sortSql: sql`ir.updated_at`,
    type: 'date',
  },
};
