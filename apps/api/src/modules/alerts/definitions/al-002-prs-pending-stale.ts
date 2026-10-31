// AL-002 — PRs waiting for a PO > 2 days (purchase). Legacy line 22259-22260.
// PRs have no approval (owner rule 2026-10-31), so this follows the wait for a
// PO instead: AL-006's filter (prWaitingForPoSql — not cancelled, not
// short-closed, qty still to order) AND pr_date <= today - 2 days. Code AL-002 kept.

import { docNavPage } from '@innovic/shared';
import { sql } from 'drizzle-orm';
import { prWaitingForPoSql } from '../../purchase-requests/service';
import type { RegisteredAlert } from '../registry';

export const al002PrsPendingStale: RegisteredAlert = {
  definition: {
    code: 'AL-002',
    dept: 'purchase',
    name: 'PRs Waiting for PO Over 2 Days',
    description: 'PRs with qty still to order on a PO, more than 2 days after they were raised.',
    columns: [
      { key: 'pr_code', label: 'PR No.', type: 'text' },
      { key: 'pr_date', label: 'PR Date', type: 'date' },
      { key: 'vendor', label: 'Vendor', type: 'text' },
      { key: 'item', label: 'Item Code', type: 'text' },
      { key: 'qty', label: 'PR Qty', type: 'number' },
    ],
    defaultActive: true,
  },
  async run({ tx, companyId }) {
    const result = await tx.execute(sql`
      SELECT pr.id AS nav_id, pr.code AS pr_code, pr.pr_date,
             COALESCE(v.code, pr.vendor_code_text, '') AS vendor,
             COALESCE(i.code, pr.item_code_text, '') AS item, pr.qty
      FROM public.purchase_requests pr
      LEFT JOIN public.vendors v ON v.id = pr.vendor_id
      LEFT JOIN public.items i ON i.id = pr.item_id
      WHERE pr.company_id = ${companyId}::uuid
        AND pr.deleted_at IS NULL
        AND ${prWaitingForPoSql('pr')}
        AND pr.pr_date <= CURRENT_DATE - INTERVAL '2 days'
      ORDER BY pr.pr_date, pr.code
    `);
    const rows = (result as unknown as Array<Record<string, unknown>>).map((r) => ({
      navPage: docNavPage('purchase-request', String(r['nav_id'])),
      pr_code: (r['pr_code'] as string) ?? '',
      pr_date:
        r['pr_date'] instanceof Date
          ? r['pr_date'].toISOString().slice(0, 10)
          : String(r['pr_date'] ?? ''),
      vendor: (r['vendor'] as string) ?? '',
      item: (r['item'] as string) ?? '',
      qty: r['qty'] != null ? Number(r['qty']) : 0,
    }));
    return { records: rows };
  },
};
