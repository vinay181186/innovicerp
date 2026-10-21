// Preview / ⬇ Download PDF for one PO from the list's row ⋯ — the same sheet
// the detail page prints (printPurchaseOrder with the PO, its vendor, the
// company and the print templates, ADR-202 draft flag included).
//
// The PO is fetched fresh (staleTime 0) with the SAME query key/fn as the
// detail page, so another user's edit is never printed stale; vendor, company
// and templates load in parallel. A vendor the user may not read prints the
// PO's own vendor text (print-po falls back), so that fetch never fails it.

import type {
  Company,
  ListPrintTemplatesResponse,
  PurchaseOrderDetail,
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
import { purchaseOrdersKeys } from '../api';
import { printPurchaseOrder } from '../lib/print-po';

const companyQuery = {
  queryKey: companyKeys.me(),
  queryFn: () => apiFetch<Company>('/companies/me'),
};
const templatesQuery = {
  queryKey: printTemplatesKeys.list(),
  queryFn: () => apiFetch<ListPrintTemplatesResponse>('/print-templates'),
};

export interface PoPrintTarget {
  id: string;
  code: string;
  vendorId: string | null;
}

export function usePoPrint(): (
  action: 'preview' | 'download',
  t: PoPrintTarget,
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
    (action: 'preview' | 'download', t: PoPrintTarget, draft?: boolean): Promise<void> =>
      runPrint(action, { title: 'Purchase Order', fileName: t.code }, async () => {
        const vendorId = t.vendorId;
        const [po, vendor, company, templates] = await Promise.all([
          qc.fetchQuery({
            queryKey: purchaseOrdersKeys.detail(t.id),
            queryFn: () => apiFetch<PurchaseOrderDetail>(`/purchase-orders/${t.id}`),
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
          printPurchaseOrder({
            po,
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
