// AL-008 — Pending GRN for QC (qc). Legacy line 22271-22272.
// Legacy GRN had qc_status at the document level; our schema (Phase 5)
// has it per line. Returns one record per line whose qc_status is
// 'pending' or 'in_progress'.

import { sql } from 'drizzle-orm';
import type { RegisteredAlert } from '../registry';

export const al008GrnPendingQc: RegisteredAlert = {
  definition: {
    code: 'AL-008',
    dept: 'qc',
    name: 'Pending GRN for QC',
    description:
      'GRN lines whose QC has not been completed yet (qc_status pending or in_progress).',
    columns: [
      { key: 'grn_code', label: 'GRN no.', type: 'text' },
      { key: 'grn_date', label: 'GRN date', type: 'date' },
      { key: 'item', label: 'Item', type: 'text' },
      { key: 'received_qty', label: 'Received', type: 'number' },
      { key: 'qc_status', label: 'QC status', type: 'text' },
    ],
    defaultActive: true,
  },
  async run({ tx, companyId }) {
    const result = await tx.execute(sql`
      SELECT g.code AS grn_code, g.grn_date,
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
