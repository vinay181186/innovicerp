// AL-021 — Tools not returned (store). ADR-193 phase 4b.
// Tool Issues (not cancelled) with something Still Out and the Expected
// Return Date passed. Still Out is derived exactly as the register derives it
// (modules/tool-issues/common.ts). (The legacy AL-021 "QC Pending > 3 Days"
// was never ported — ADR-024 carve-out — so the code is free.)
//
// No navPage: the Tool Issue register has no per-document page kind yet.

import { sql } from 'drizzle-orm';
import { ISSUE_SELECT } from '../../tool-issues/common';
import type { RegisteredAlert } from '../registry';

export const al021ToolsNotReturned: RegisteredAlert = {
  definition: {
    code: 'AL-021',
    dept: 'store',
    name: 'Tools not returned',
    description: 'Tool Issues still out after their Expected Return Date.',
    columns: [
      { key: 'tis_code', label: 'TIS', type: 'text' },
      { key: 'item_code', label: 'Item Code', type: 'text' },
      { key: 'issued_to', label: 'Issued To', type: 'text' },
      { key: 'expected_return_date', label: 'Expected Return Date', type: 'date' },
      { key: 'still_out_qty', label: 'Still Out', type: 'number' },
    ],
    defaultActive: true,
  },
  async run({ tx, companyId }) {
    const result = await tx.execute(sql`
      SELECT x.code AS tis_code, x.item_code, x.issued_to, x.expected_return_date, x.still_out_qty
      FROM (
        ${ISSUE_SELECT}
        WHERE ti.company_id = ${companyId}::uuid AND ti.deleted_at IS NULL
      ) x
      WHERE x.return_status IN ('issued', 'partial')
        AND x.still_out_qty > 0
        AND x.expected_return_date < (now() AT TIME ZONE 'Asia/Kolkata')::date
      ORDER BY x.expected_return_date, x.code
    `);
    const rows = (result as unknown as Array<Record<string, unknown>>).map((r) => ({
      tis_code: (r['tis_code'] as string) ?? '',
      item_code: (r['item_code'] as string) ?? '',
      issued_to: (r['issued_to'] as string) ?? '',
      expected_return_date:
        r['expected_return_date'] instanceof Date
          ? r['expected_return_date'].toISOString().slice(0, 10)
          : String(r['expected_return_date'] ?? ''),
      still_out_qty: Number(r['still_out_qty'] ?? 0),
    }));
    return { records: rows };
  },
};
