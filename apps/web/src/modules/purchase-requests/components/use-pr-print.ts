// Preview / ⬇ Download PDF for one Purchase Request — from the list row ⋯ and
// the detail ⋯. The PR is fetched fresh (staleTime 0) with the SAME query
// key/fn as the detail page, so another user's edit is never printed stale;
// the company loads in parallel. Mirrors purchase-orders/use-po-print.ts.

import type { Company, PurchaseRequestDetail } from '@innovic/shared';
import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect } from 'react';
import { apiFetch } from '@/lib/api';
import { runPrint } from '@/lib/print/preview-host';
import { companyKeys } from '@/modules/settings/api';
import { purchaseRequestsKeys } from '../api';
import { printPurchaseRequest } from '../lib/print-pr';

const companyQuery = {
  queryKey: companyKeys.me(),
  queryFn: () => apiFetch<Company>('/companies/me'),
};

export interface PrPrintTarget {
  id: string;
  code: string;
}

export function usePrPrint(): (action: 'preview' | 'download', t: PrPrintTarget) => Promise<void> {
  const qc = useQueryClient();

  // Warm the company read so the first click does not wait on it.
  useEffect(() => {
    void qc.prefetchQuery(companyQuery);
  }, [qc]);

  return useCallback(
    (action: 'preview' | 'download', t: PrPrintTarget): Promise<void> =>
      runPrint(action, { title: 'Purchase Request', fileName: t.code }, async () => {
        const [pr, company] = await Promise.all([
          qc.fetchQuery({
            queryKey: purchaseRequestsKeys.detail(t.id),
            queryFn: () => apiFetch<PurchaseRequestDetail>(`/purchase-requests/${t.id}`),
            staleTime: 0,
          }),
          qc.fetchQuery(companyQuery),
        ]);
        return () => printPurchaseRequest({ pr, company });
      }),
    [qc],
  );
}
