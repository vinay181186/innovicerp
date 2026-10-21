// Preview / ⬇ Download PDF for one Multi-Level BOM — the ONE entry point the
// list row ⋯ and the detail ⋯ share, so the sheet from the list equals the
// detail one. The detail page passes the BOM it has loaded and the Qty on its
// Tree tab; the list fetches the BOM fresh (same key as useMlBom) and prints
// the tree for Qty 1 (the detail page's default). Detail, tree and company
// load in parallel; the tree is always asked fresh (fetchMlBomTree).

import type { Company, MlBomDetail } from '@innovic/shared';
import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo } from 'react';
import { apiFetch } from '@/lib/api';
import { runPrint } from '@/lib/print/preview-host';
import { companyKeys } from '@/modules/settings/api';
import { fetchMlBomTree, mlBomsKeys } from '../api';
import { printMlBom } from '../lib/print-ml-bom';

export interface MlBomPrintTarget {
  id: string;
  code: string;
  /** Tree qty; 1 when omitted. */
  qty?: number;
  /** The BOM the detail page already has — no refetch. */
  detail?: MlBomDetail;
}

const companyQuery = {
  queryKey: companyKeys.me(),
  queryFn: () => apiFetch<Company>('/companies/me'),
};

export function useMlBomPrint(): {
  preview: (t: MlBomPrintTarget) => void;
  download: (t: MlBomPrintTarget) => Promise<void>;
} {
  const qc = useQueryClient();

  // Warm the company read so the first click does not wait on it.
  useEffect(() => {
    void qc.prefetchQuery(companyQuery);
  }, [qc]);

  const run = useCallback(
    (action: 'preview' | 'download', t: MlBomPrintTarget): Promise<void> =>
      runPrint(action, { title: 'Multi-Level BOM', fileName: t.code }, async () => {
        const [detail, tree, company] = await Promise.all([
          t.detail ??
            qc.fetchQuery({
              queryKey: mlBomsKeys.detail(t.id),
              queryFn: () => apiFetch<MlBomDetail>(`/ml-boms/${t.id}`),
              staleTime: 0,
            }),
          fetchMlBomTree(qc, t.id, t.qty ?? 1),
          qc.fetchQuery(companyQuery),
        ]);
        return () => printMlBom({ detail, tree, company });
      }),
    [qc],
  );

  return useMemo(
    () => ({
      preview: (t: MlBomPrintTarget) => void run('preview', t),
      download: (t: MlBomPrintTarget) => run('download', t),
    }),
    [run],
  );
}
