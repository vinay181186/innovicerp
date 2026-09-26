// AL-008 — GRN QC Pending (qc). Legacy line 22271-22272.
// Legacy GRN had qc_status at the document level; our schema (Phase 5)
// has it per line. Returns one record per line whose qc_status is
// 'pending' or 'in_progress'.

import { docNavPage } from '@innovic/shared';
import { sql } from 'drizzle-orm';
import type { RegisteredAlert } from '../registry';

export const al008GrnPendingQc: RegisteredAlert = {
  definition: {
    code: 'AL-008',
    dept: 'qc',
    name: 'GRN QC Pending',
    description: 'GRN lines whose QC is not completed yet (QC Pending or QC In Progress).',
    columns: [
      { key: 'grn_code', label: 'GRN No.', type: 'text' },
      { key: 'grn_date', label: 'GRN Date', type: 'date' },
      { key: 'item', label: 'Item Code', type: 'text' },
      { key: 'received_qty', label: 'Received', type: 'number' },
      { key: 'qc_status', label: 'QC Status', type: 'text' },
    ],
    defaultActive: true,
  },
  async run({ tx, companyId }) {
    const result = await tx.execute(sql`
      SELECT g.id AS nav_id, g.code AS grn_code, g.grn_date,
             COALESCE(i.code, gl.item_code_text, '') AS item,
             gl.received_qty, gl.qc_status
      FROM public.goods_receipt_note_lines gl
      JOIN public.goods_receipt_notes g ON g.id = gl.goods_receipt_note_id
      LEFT JOIN public.items i ON i.id = gl.item_id
      WHERE gl.company_id = ${companyId}::uuid
        AND gl.deleted_at IS NULL
        AND g.deleted_at IS NULL
        AND gl.qc_status IN ('pending', 'in_progress')
      ORDER BY g.grn_date, g.code
    `);
    const rows = (result as unknown as Array<Record<string, unknown>>).map((r) => ({
      navPage: docNavPage('grn', String(r['nav_id'])),
      grn_code: (r['grn_code'] as string) ?? '',
      grn_date:
        r['grn_date'] instanceof Date
          ? r['grn_date'].toISOString().slice(0, 10)
          : String(r['grn_date'] ?? ''),
      item: (r['item'] as string) ?? '',
      received_qty: r['received_qty'] != null ? Number(r['received_qty']) : 0,
      qc_status: (r['qc_status'] as string) ?? '',
    }));
    return { records: rows };
  },
};
