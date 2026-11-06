// Sort & Filter (ADR-200) — the Route Card list's sortable / filterable fields.
// Each expression is the SAME one listRouteCards SELECTs for that column (same
// aliases — rc, i, ir, op_agg — used by both its list and its count query).

import { sql } from 'drizzle-orm';

import { createdByNameSql } from '../../lib/created-by-sql';
import type { SfColumnMap } from '../../lib/list-query';

export const RC_SF_COLUMNS: SfColumnMap = {
  code: { sql: sql`rc.code`, type: 'text' },
  itemCode: { sql: sql`i.code`, type: 'text' },
  itemName: { sql: sql`i.name`, type: 'text' },
  // Item + Drawing Rev register (0232) — the card's Drawing Rev; blank on old cards.
  drawingRev: { sql: sql`ir.rev`, type: 'text' },
  // "RM Grade / RM Size" as the cell prints it.
  rawMaterial: {
    sql: sql`(COALESCE(rc.raw_material_grade_text, '—') || ' / ' || COALESCE(rc.raw_material_size_text, '—'))`,
    type: 'text',
  },
  opCount: { sql: sql`COALESCE(op_agg.op_count, 0)`, type: 'num' },
  currentRevision: { sql: sql`rc.current_revision`, type: 'num' },
  // The screen shows Last Updated with its time: sort by the exact moment, filter by IST day.
  updatedOn: {
    sql: sql`(rc.updated_at AT TIME ZONE 'Asia/Kolkata')::date`,
    sortSql: sql`rc.updated_at`,
    type: 'date',
  },
  // Created By: who entered the card (same row as rc.created_at).
  createdBy: { sql: createdByNameSql(sql`rc.created_by`), type: 'text' },
  // ADR-253 — RC Status: pending / approved / rejected (stored values; the
  // screen shows ROUTE_CARD_APPROVAL_LABEL).
  approvalStatus: { sql: sql`rc.approval_status`, type: 'list' },
};
