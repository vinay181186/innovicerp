// AL-014 — Overdue PO delivery (purchase). Legacy line 22283-22284.
// Filter: status IN ('open', 'partial') AND due_date < today.
// Legacy uses `requiredDate`; our schema renames to `due_date` per
// Phase 5 (ADR-015).

import { sql } from 'drizzle-orm';
import type { RegisteredAlert } from '../registry';

export const al014PoOverdue: RegisteredAlert = {
  definition: {
    code: 'AL-014',
    dept: 'purchase',
    name: 'Overdue PO delivery',
    description: 'Purchase orders in open/partial status with due_date in the past.',
    columns: [
      { key: 'po_code', label: 'PO no.', type: 'text' },
      { key: 'po_date', label: 'PO date', type: 'date' },
      { key: 'vendor', label: 'Vendor', type: 'text' },
      { key: 'due_date', label: 'Due', type: 'date' },
      { key: 'status', label: 'Status', type: 'text' },
    ],
    defaultActive: true,
  },
  async run({ tx, companyId }) {
    const result = await tx.execute(sql`
      SELECT po.code AS po_code, po.po_date,
             COALESCE(v.code, po.vendor_code_text, '') AS vendor,
             po.due_date, po.status
      FROM public.purchase_orders po
      LEFT JOIN public.vendors v ON v.id = po.vendor_id
      WHERE po.company_id = ${companyId}::uuid
        AND po.deleted_at IS NULL
        AND po.status IN ('open', 'partial')
        AND po.due_date IS NOT NULL
        AND po.due_date < CURRENT_DATE
      ORDER BY po.due_date, po.code
    `);
    const rows = (result as unknown as Array<Record<string, unknown>>).map((r) => ({
      po_code: (r['po_code'] as string) ?? '',
      po_date:
        r['po_date'] instanceof Date
          ? r['po_date'].toISOString().slice(0, 10)
          : String(r['po_date'] ?? ''),
      vendor: (r['vendor'] as string) ?? '',
      due_date:
        r['due_date'] instanceof Date
          ? r['due_date'].toISOString().slice(0, 10)
          : String(r['due_date'] ?? ''),
      status: (r['status'] as string) ?? '',
    }));
    return { records: rows };
  },
};
