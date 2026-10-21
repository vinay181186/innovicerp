// Preview / ⬇ Download PDF for one Multi-Level Plan — the ONE entry point the
// list row ⋯ and the detail ⋯ share, so the sheet from the list equals the
// detail one. The detail page passes the plan it has loaded; the list fetches
// it fresh (same key as useMlPlan). Plan and company load in parallel.

import type { Company, MlPlanDetail } from '@innovic/shared';
import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo } from 'react';
import { apiFetch } from '@/lib/api';
import { runPrint } from '@/lib/print/preview-host';
import { companyKeys } from '@/modules/settings/api';
import { mlPlansKeys } from '../api';
import { printMlPlan } from '../lib/print-ml-plan';

export interface MlPlanPrintTarget {
  id: string;
  code: string;
  /** The plan the detail page already has — no refetch. */
  detail?: MlPlanDetail;
}

const companyQuery = {
  queryKey: companyKeys.me(),
  queryFn: () => apiFetch<Company>('/companies/me'),
};

export function useMlPlanPrint(): {
  preview: (t: MlPlanPrintTarget) => void;
  download: (t: MlPlanPrintTarget) => Promise<void>;
} {
  const qc = useQueryClient();

  // Warm the company read so the first click does not wait on it.
  useEffect(() => {
    void qc.prefetchQuery(companyQuery);
  }, [qc]);

  const run = useCallback(
    (action: 'preview' | 'download', t: MlPlanPrintTarget): Promise<void> =>
      runPrint(action, { title: 'Multi-Level Plan', fileName: t.code }, async () => {
        const [detail, company] = await Promise.all([
          t.detail ??
            qc.fetchQuery({
              queryKey: mlPlansKeys.detail(t.id),
              queryFn: () => apiFetch<MlPlanDetail>(`/ml-plans/${t.id}`),
              staleTime: 0,
            }),
          qc.fetchQuery(companyQuery),
        ]);
        return () => printMlPlan({ detail, company });
      }),
    [qc],
  );

  return useMemo(
    () => ({
      preview: (t: MlPlanPrintTarget) => void run('preview', t),
      download: (t: MlPlanPrintTarget) => run('download', t),
    }),
    [run],
  );
}
