// Preview / ⬇ Download PDF for one Item Issue slip, from the register row ⋯
// and the slip's view box. The slip is fetched fresh (staleTime 0) with the
// SAME query key/fn as the view box (useStoreIssue), so a Return or Reverse
// made since the list loaded is never printed stale; the company loads in
// parallel.

import type { Company, StoreIssueDetail } from '@innovic/shared';
import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect } from 'react';
import { apiFetch } from '@/lib/api';
import { runPrint } from '@/lib/print/preview-host';
import { companyKeys } from '@/modules/settings/api';
import { storeIssuesKeys } from '../api';
import { printStoreIssue } from '../lib/print-store-issue';

const companyQuery = {
  queryKey: companyKeys.me(),
  queryFn: () => apiFetch<Company>('/companies/me'),
};

export interface StoreIssuePrintTarget {
  id: string;
  code: string;
}

export function useStoreIssuePrint(): (
  action: 'preview' | 'download',
  t: StoreIssuePrintTarget,
) => Promise<void> {
  const qc = useQueryClient();

  // Warm the company read so the first click does not wait on it.
  useEffect(() => {
    void qc.prefetchQuery(companyQuery);
  }, [qc]);

  return useCallback(
    (action: 'preview' | 'download', t: StoreIssuePrintTarget): Promise<void> =>
      runPrint(action, { title: 'Item Issue Slip', fileName: t.code }, async () => {
        const [issue, company] = await Promise.all([
          qc.fetchQuery({
            queryKey: storeIssuesKeys.detail(t.id),
            queryFn: () => apiFetch<StoreIssueDetail>(`/store-issues/${t.id}`),
            staleTime: 0,
          }),
          qc.fetchQuery(companyQuery),
        ]);
        return () => printStoreIssue({ issue, company });
      }),
    [qc],
  );
}
