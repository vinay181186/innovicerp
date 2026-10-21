// Preview / ⬇ Download PDF for one GRN from the list's row ⋯ — the same sheet
// the detail page prints (printGrn with the GRN, its vendor, the
// company and the print templates, ADR-202 draft flag included).
//
// The GRN is fetched fresh (staleTime 0) with the SAME query key/fn as the
// detail page, so another user's edit is never printed stale; vendor, company
// and templates load in parallel. A vendor the user may not read prints the
// GRN's own vendor text (print-grn falls back), so that fetch never fails it.

import type {
  Company,
  ListPrintTemplatesResponse,
  GoodsReceiptNoteDetail,
  Vendor,
} from '@innovic/shared';
import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect } from 'react';
import { apiFetch } from '@/lib/api';
import { runPrint } from '@/lib/print/preview-host';
import { useSession } from '@/lib/session';
import { printTemplatesKeys } from '@/modules/print-templates/api';
import { companyKeys } from '@/modules/settings/api';
import { vendorsKeys } from '@/modules/vendors/api';
import { goodsReceiptNotesKeys } from '../api';
import { printGrn } from '../lib/print-grn';

const companyQuery = {
  queryKey: companyKeys.me(),
  queryFn: () => apiFetch<Company>('/companies/me'),
};
const templatesQuery = {
  queryKey: printTemplatesKeys.list(),
  queryFn: () => apiFetch<ListPrintTemplatesResponse>('/print-templates'),
};

export interface GrnPrintTarget {
  id: string;
  code: string;
  vendorId: string | null;
}

export function useGrnPrint(): (
  action: 'preview' | 'download',
  t: GrnPrintTarget,
  draft?: boolean,
) => Promise<void> {
  const qc = useQueryClient();
  const { data: me } = useSession();

  // Warm the two company-wide reads so the first click does not wait on them.
  useEffect(() => {
    void qc.prefetchQuery(companyQuery);
    void qc.prefetchQuery(templatesQuery);
  }, [qc]);

  return useCallback(
    (action: 'preview' | 'download', t: GrnPrintTarget, draft?: boolean): Promise<void> =>
      runPrint(action, { title: 'Goods Receipt Note', fileName: t.code }, async () => {
        const vendorId = t.vendorId;
        const [grn, vendor, company, templates] = await Promise.all([
          qc.fetchQuery({
            queryKey: goodsReceiptNotesKeys.detail(t.id),
            queryFn: () => apiFetch<GoodsReceiptNoteDetail>(`/goods-receipt-notes/${t.id}`),
            staleTime: 0,
          }),
          vendorId
            ? qc
                .fetchQuery({
                  queryKey: vendorsKeys.detail(vendorId),
                  queryFn: () => apiFetch<Vendor>(`/vendors/${vendorId}`),
                })
                .catch(() => null)
            : Promise.resolve(null),
          qc.fetchQuery(companyQuery),
          qc.fetchQuery(templatesQuery),
        ]);
        return () =>
          printGrn({
            grn,
            vendor,
            company,
            templates: templates.items,
            currentUser: me?.email,
            draft,
          });
      }),
    [qc, me?.email],
  );
}
