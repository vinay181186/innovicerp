// AL-009 — QC rejections in the last 3 days (qc). Legacy line 22273-22274.
// Filter: nc_date >= today - 3 days. Includes NCs in any status (it's a
// "what happened recently?" tripwire, not a backlog).

import { sql } from 'drizzle-orm';
import type { RegisteredAlert } from '../registry';

export const al009NcRecent: RegisteredAlert = {
  definition: {
    code: 'AL-009',
    dept: 'qc',
    name: 'QC rejections (last 3 days)',
    description: 'NCs filed within the last 3 days.',
    columns: [
      { key: 'nc_code', label: 'NC no.', type: 'text' },
      { key: 'nc_date', label: 'Date', type: 'date' },
      { key: 'jc_code', label: 'JC', type: 'text' },
      { key: 'item', label: 'Item', type: 'text' },
      { key: 'rejected_qty', label: 'Rejected', type: 'number' },
      { key: 'status', label: 'Status', type: 'text' },
    ],
    defaultActive: true,
  },
  async run({ tx, companyId }) {
    const result = await tx.execute(sql`
      SELECT nc.code AS nc_code, nc.nc_date, jc.code AS jc_code,
             COALESCE(nc.item_code_text, '') AS item,
             nc.rejected_qty, nc.status
      FROM public.nc_register nc
      JOIN public.job_cards jc ON jc.id = nc.job_card_id
      WHERE nc.company_id = ${companyId}::uuid
        AND nc.deleted_at IS NULL
        AND nc.nc_date >= CURRENT_DATE - INTERVAL '3 days'
      ORDER BY nc.nc_date DESC, nc.code
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
      status: (r['status'] as string) ?? '',
    }));
    return { records: rows };
  },
};
