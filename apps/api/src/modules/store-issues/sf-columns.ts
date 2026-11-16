// Sort & Filter (ADR-200) — the Item Issue Register's sortable / filterable
// fields. Each expression is the SAME one listStoreIssues SELECTs for that
// column (same table aliases; valid in its count query too, which uses the
// same HEADER_FROM), so what the user filters is what the row shows.
//   reference — the CASE mirrors the screen's reference(): JC code, Assembly
//               SO code, else Department, else the legacy "type no".
//   items     — every line's item code on the slip (the cell shows the first
//               line + "+n more"), so a filter finds an item on ANY line;
//               a pre-slip row falls back to its own single item code.

import { sql } from 'drizzle-orm';

import { createdByNameSql } from '../../lib/created-by-sql';
import type { SfColumnMap } from '../../lib/list-query';
import { polSql } from '../../lib/pol';

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
  // ADR-303 — the register is one row per slip again (read.ts HEADER_FROM,
  // shared by page AND count). SO No. / Internal SO No. are the ORDER the slip
  // traces to (`oso` / `ojw`: own Assembly SO, else the Job Card's SO, else its
  // JWSO) — one per slip, so a plain filter keeps each slip one row. The row
  // carries them as `soCode` / `soInternalNo`.
  soCode: { sql: sql`COALESCE(oso.code, ojw.code)`, type: 'text' },
  soInternalNo: { sql: sql`oso.internal_so_no`, type: 'text' },
  issuedTo: { sql: sql`si.issued_to`, type: 'text' },
  purpose: { sql: sql`si.purpose`, type: 'text' },
  issuedBy: { sql: sql`u.full_name`, type: 'text' },
  createdOn: { sql: sql`(si.created_at AT TIME ZONE 'Asia/Kolkata')::date`, type: 'date' },
  createdBy: { sql: createdByNameSql(sql`si.created_by`), type: 'text' },
  // Lines = live lines (`ls` lateral); a pre-0157 slip without one counts 1.
  lineCount: {
    sql: sql`(CASE WHEN COALESCE(ls.line_count, 0) > 0 THEN ls.line_count
                   WHEN si.item_code_text IS NOT NULL THEN 1 ELSE 0 END)`,
    type: 'num',
  },
  // Issue Qty = sum of the live lines (`lq` lateral); pre-0157 slip: its own qty.
  qty: {
    sql: sql`(CASE WHEN COALESCE(ls.line_count, 0) > 0 THEN COALESCE(lq.total_qty, 0)
                   WHEN si.item_code_text IS NOT NULL THEN COALESCE(si.qty, 0) ELSE 0 END)`,
    type: 'num',
  },
};

// ADR-261 — the line register (lines.ts, GET /store-issues/lines). Same fields
// as the slip list plus the lead columns and the line's own qty; every
// expression reads the aliases LINE_FROM joins (page AND count).
export const STORE_ISSUE_LINE_SF_COLUMNS: SfColumnMap = {
  ...STORE_ISSUE_SF_COLUMNS,
  // The line register's joins name the order `so` / `jw` (LINE_FROM).
  soInternalNo: { sql: sql`so.internal_so_no`, type: 'text' },
  // A line row is one line (the slip map's `ls` lateral is not joined here).
  lineCount: { sql: sql`1`, type: 'num' },
  soCode: { sql: sql`COALESCE(so.code, jw.code)`, type: 'text' },
  clientPoLineNo: { sql: polSql('sol', 'jwl'), type: 'text' },
  createdOn: {
    sql: sql`(COALESCE(l.created_at, si.created_at) AT TIME ZONE 'Asia/Kolkata')::date`,
    type: 'date',
  },
  createdBy: { sql: createdByNameSql(sql`COALESCE(l.created_by, si.created_by)`), type: 'text' },
  itemCode: { sql: sql`COALESCE(i.code, l.item_code_text)`, type: 'text' },
  itemName: { sql: sql`i.name`, type: 'text' },
  qty: { sql: sql`l.qty`, type: 'num' },
};
