// AL-001 — Today's approved POs (purchase). Legacy line 22257-22258.
// Filter: po_date = today AND status = 'open' (legacy 'Open' lowercased).

import { sql } from 'drizzle-orm';
import type { RegisteredAlert } from '../registry';

export const al001PosTodayApproved: RegisteredAlert = {
  definition: {
    code: 'AL-001',
    dept: 'purchase',
    name: "Today's approved POs",
    description: 'Purchase orders with po_date = today and status = open.',
    columns: [
      { key: 'po_code', label: 'PO no.', type: 'text' },
      { key: 'po_date', label: 'PO date', type: 'date' },
      { key: 'vendor', label: 'Vendor', type: 'text' },
      { key: 'status', label: 'Status', type: 'text' },
    ],
    defaultActive: true,
  },
  async run({ tx, companyId }) {
    const result = await tx.execute(sql`
      SELECT po.code AS po_code, po.po_date, COALESCE(v.code, po.vendor_code_text, '') AS vendor, po.status
      FROM public.purchase_orders po
      LEFT JOIN public.vendors v ON v.id = po.vendor_id
      WHERE po.company_id = ${companyId}::uuid
        AND po.deleted_at IS NULL
        AND po.po_date = CURRENT_DATE
        AND po.status = 'open'
      ORDER BY po.code
    `);
    const rows = (result as unknown as Array<Record<string, unknown>>).map((r) => ({
      po_code: (r['po_code'] as string) ?? '',
      po_date:
        r['po_date'] instanceof Date
          ? r['po_date'].toISOString().slice(0, 10)
          : String(r['po_date'] ?? ''),
      vendor: (r['vendor'] as string) ?? '',
      status: (r['status'] as string) ?? '',
    }));
    return { records: rows };
  },
};
