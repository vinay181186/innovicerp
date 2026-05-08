// AL-012 — Job cards overdue (production). Legacy line 22279-22280.
// Filter: due_date < today AND derived status NOT IN ('complete',
// 'closed'). Joins v_jc_status because job_cards has no status column
// per ADR-011 #2.

import { sql } from 'drizzle-orm';
import type { RegisteredAlert } from '../registry';

export const al012JcOverdue: RegisteredAlert = {
  definition: {
    code: 'AL-012',
    dept: 'production',
    name: 'Job cards overdue',
    description:
      'Job cards with due_date in the past whose derived status is open or qc_pending (not complete/closed/no_ops).',
    columns: [
      { key: 'jc_code', label: 'JC no.', type: 'text' },
      { key: 'item', label: 'Item', type: 'text' },
      { key: 'order_qty', label: 'Qty', type: 'number' },
      { key: 'due_date', label: 'Due', type: 'date' },
      { key: 'computed_status', label: 'Status', type: 'text' },
    ],
    defaultActive: true,
  },
  async run({ tx, companyId }) {
    const result = await tx.execute(sql`
      SELECT jc.code AS jc_code, i.code AS item, jc.order_qty, jc.due_date,
             COALESCE(s.computed_status, 'no_ops') AS computed_status
      FROM public.job_cards jc
      JOIN public.items i ON i.id = jc.item_id
      LEFT JOIN public.v_jc_status s ON s.job_card_id = jc.id
      WHERE jc.company_id = ${companyId}::uuid
        AND jc.deleted_at IS NULL
        AND jc.due_date IS NOT NULL
        AND jc.due_date < CURRENT_DATE
        AND COALESCE(s.computed_status, 'no_ops') NOT IN ('complete', 'closed')
      ORDER BY jc.due_date, jc.code
    `);
    const rows = (result as unknown as Array<Record<string, unknown>>).map((r) => ({
      jc_code: (r['jc_code'] as string) ?? '',
      item: (r['item'] as string) ?? '',
      order_qty: r['order_qty'] != null ? Number(r['order_qty']) : 0,
      due_date:
        r['due_date'] instanceof Date
          ? r['due_date'].toISOString().slice(0, 10)
          : String(r['due_date'] ?? ''),
      computed_status: (r['computed_status'] as string) ?? '',
    }));
    return { records: rows };
  },
};
