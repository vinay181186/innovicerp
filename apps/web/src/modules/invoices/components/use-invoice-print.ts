// Preview / ⬇ Download PDF for one Tax Invoice — the list row ⋯ and the detail
// page share it. Loads the invoice (fresh, staleTime 0) and the company in
// parallel, then calls printInvoice exactly as the detail page does.

import type { Company, InvoiceDetail } from '@innovic/shared';
import { useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';
import { apiFetch } from '@/lib/api';
import { runPrint } from '@/lib/print/preview-host';
import { companyKeys } from '@/modules/settings/api';
import { invoiceKeys } from '../api';
import { printInvoice } from '../lib/print';

export function useInvoicePrint(): (
  action: 'preview' | 'download',
  t: { id: string; code: string },
) => Promise<void> {
  const qc = useQueryClient();
  return useCallback(
    (action, t) =>
      runPrint(action, { title: 'Tax Invoice', fileName: t.code }, async () => {
        const [inv, company] = await Promise.all([
          qc.fetchQuery({
            queryKey: invoiceKeys.detail(t.id),
            queryFn: () => apiFetch<InvoiceDetail>(`/invoices/${t.id}`),
            staleTime: 0,
          }),
          qc.fetchQuery({
            queryKey: companyKeys.me(),
            queryFn: () => apiFetch<Company>('/companies/me'),
          }),
        ]);
        return () => printInvoice(inv, company);
      }),
    [qc],
  );
}
