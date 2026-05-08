// AL-018 — NCs pending disposition (qc). Legacy line 22291-22292.
// Filter: nc_register.status = 'pending'.

import { sql } from 'drizzle-orm';
import type { RegisteredAlert } from '../registry';

export const al018NcPendingDisposition: RegisteredAlert = {
  definition: {
    code: 'AL-018',
    dept: 'qc',
    name: 'NCs pending disposition',
    description: 'Non-conformance records awaiting a disposition decision.',
    columns: [
      { key: 'nc_code', label: 'NC no.', type: 'text' },
      { key: 'nc_date', label: 'Date', type: 'date' },
      { key: 'jc_code', label: 'JC', type: 'text' },
      { key: 'item', label: 'Item', type: 'text' },
      { key: 'rejected_qty', label: 'Rejected', type: 'number' },
      { key: 'reason_category', label: 'Reason', type: 'text' },
    ],
    defaultActive: true,
  },
  async run({ tx, companyId }) {
    const result = await tx.execute(sql`
      SELECT nc.code AS nc_code, nc.nc_date, jc.code AS jc_code,
             COALESCE(nc.item_code_text, '') AS item,
             nc.rejected_qty, nc.reason_category
      FROM public.nc_register nc
      JOIN public.job_cards jc ON jc.id = nc.job_card_id
      WHERE nc.company_id = ${companyId}::uuid
        AND nc.deleted_at IS NULL
        AND nc.status = 'pending'
      ORDER BY nc.nc_date, nc.code
    `);
    const rows = (result as unknown as Array<Record<string, unknown>>).map((r) => ({
      nc_code: (r['nc_code'] as string) ?? '',
      nc_date:
        r['nc_date'] instanceof Date
          ? r['nc_date'].toISOString().slice(0, 10)
          : String(r['nc_date'] ?? ''),
      jc_code: (r['jc_code'] as string) ?? '',
      item: (r['item'] as string) ?? '',
      rejected_qty: r['rejected_qty'] != null ? Number(r['rejected_qty']) : 0,
      reason_category: (r['reason_category'] as string) ?? '',
    }));
    return { records: rows };
  },
};
