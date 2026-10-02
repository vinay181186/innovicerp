// Sort & Filter (ADR-200) — the Item Issue Register's sortable / filterable
// fields. Each expression is the SAME one listStoreIssues SELECTs for that
// column (same table aliases; valid in its count query too, which carries the
// same joins), so what the user filters is what the row shows.
//   reference — the CASE mirrors the screen's reference(): JC code, Assembly
//               SO code, else Department, else the legacy "type no".
//   items     — every line's item code on the slip (the cell shows the first
//               line + "+n more"), so a filter finds an item on ANY line;
//               a pre-slip row falls back to its own single item code.

import { sql } from 'drizzle-orm';

import type { SfColumnMap } from '../../lib/list-query';

export const STORE_ISSUE_SF_COLUMNS: SfColumnMap = {
  code: { sql: sql`si.code`, type: 'text' },
  issueDate: { sql: sql`si.issue_date`, type: 'date' },
  issueAgainst: { sql: sql`COALESCE(si.issue_against, 'general')`, type: 'list' },
  reference: {
    sql: sql`(CASE COALESCE(si.issue_against, 'general')
      WHEN 'job_card' THEN jc.code
      WHEN 'assembly_so' THEN so.code
      ELSE COALESCE(
        si.department,
        CASE WHEN COALESCE(si.ref_no, '') <> ''
          THEN btrim(COALESCE(si.ref_type, '') || ' ' || si.ref_no) END
      )
    END)`,
    type: 'text',
  },
  items: {
    sql: sql`COALESCE(
      (SELECT string_agg(COALESCE(sfi.code, sfl.item_code_text), ', ' ORDER BY sfl.line_no)
       FROM public.store_issue_lines sfl
       LEFT JOIN public.items sfi ON sfi.id = sfl.item_id
       WHERE sfl.issue_id = si.id AND sfl.deleted_at IS NULL),
      si.item_code_text
    )`,
    type: 'text',
  },
  issuedTo: { sql: sql`si.issued_to`, type: 'text' },
  purpose: { sql: sql`si.purpose`, type: 'text' },
  issuedBy: { sql: sql`u.full_name`, type: 'text' },
  createdOn: { sql: sql`(si.created_at AT TIME ZONE 'Asia/Kolkata')::date`, type: 'date' },
};
