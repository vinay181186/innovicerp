// Preview / ⬇ Download PDF of the NC Report, from the NC list row ⋯ and the NC
// detail ⋯. The NC is fetched fresh (staleTime 0) with the SAME query key/fn as
// the detail page (useNcRegister), so another user's disposition is never
// printed stale; the company loads in parallel. Copies use-po-print.ts.

import type { Company, NcRegister } from '@innovic/shared';
import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect } from 'react';
import { apiFetch } from '@/lib/api';
import { runPrint } from '@/lib/print/preview-host';
import { companyKeys } from '@/modules/settings/api';
import { ncRegisterKeys } from '../api';
import { printNcReport } from '../lib/print-nc';

const companyQuery = {
  queryKey: companyKeys.me(),
  queryFn: () => apiFetch<Company>('/companies/me'),
};

export interface NcPrintTarget {
  id: string;
  code: string;
  /** The NC read shape has no JC code; the list row / detail page supply it. */
  jcCode?: string | null | undefined;
}

export function useNcPrint(): (
  action: 'preview' | 'download',
  t: NcPrintTarget,
  draft?: boolean,
) => Promise<void> {
  const qc = useQueryClient();

  // Warm the company read so the first click does not wait on it.
  useEffect(() => {
    void qc.prefetchQuery(companyQuery);
  }, [qc]);

  return useCallback(
    (action: 'preview' | 'download', t: NcPrintTarget, draft?: boolean): Promise<void> =>
      runPrint(action, { title: 'NC Report', fileName: t.code }, async () => {
        const [nc, company] = await Promise.all([
          qc.fetchQuery({
            queryKey: ncRegisterKeys.detail(t.id),
            queryFn: () => apiFetch<NcRegister>(`/nc-register/${t.id}`),
            staleTime: 0,
          }),
          qc.fetchQuery(companyQuery),
        ]);
        return () => printNcReport({ nc, company, jcCode: t.jcCode, draft });
      }),
    [qc],
  );
}
