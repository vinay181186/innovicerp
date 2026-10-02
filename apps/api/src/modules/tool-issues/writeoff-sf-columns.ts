// Sort & Filter (ADR-200) — the Tool Write-offs list's sortable / filterable
// fields. listToolWriteoffs reads SELECT (writeoffs.ts: tool_writeoffs w JOIN
// items i, LEFT JOIN instruments ins, tool_issues ti, users ru / du) for the
// page and wraps the SAME select for the count, so each expression is the one
// the row shows. Requested By sorts / filters by the requester's name (the
// date under it is the request date). No money on this list.

import { sql } from 'drizzle-orm';

import type { SfColumnMap } from '../../lib/list-query';

export const TOOL_WRITEOFF_SF_COLUMNS: SfColumnMap = {
  kind: { sql: sql`w.kind`, type: 'list' },
  itemCode: { sql: sql`i.code`, type: 'text' },
  serialNo: { sql: sql`ins.serial_no`, type: 'text' },
  qty: { sql: sql`w.qty`, type: 'num' },
  issueNo: { sql: sql`ti.code`, type: 'text' },
  issuedTo: { sql: sql`ti.issued_to`, type: 'text' },
  reason: { sql: sql`w.reason`, type: 'text' },
  requestedBy: { sql: sql`ru.full_name`, type: 'text' },
  status: { sql: sql`w.status`, type: 'list' },
};
