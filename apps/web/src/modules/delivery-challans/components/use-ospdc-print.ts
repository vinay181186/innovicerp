// Preview / ⬇ Download PDF for one OSP DC — the list row ⋯ and the detail page
// share it. Loads the DC (fresh, staleTime 0), its vendor, the company and the
// print templates in parallel, then hands printOspDc the SAME arguments the
// detail page used to, so both sheets are identical.

import type {
  Company,
  DeliveryChallanWithLines,
  ListPrintTemplatesResponse,
  Vendor,
} from '@innovic/shared';
import { useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';
import { apiFetch } from '@/lib/api';
import { runPrint } from '@/lib/print/preview-host';
import { useSession } from '@/lib/session';
import { printTemplatesKeys } from '@/modules/print-templates/api';
import { companyKeys } from '@/modules/settings/api';
import { vendorsKeys } from '@/modules/vendors/api';
import { deliveryChallansKeys } from '../api';
import { printOspDc } from '../lib/print-ospdc';

export interface OspDcPrintTarget {
  id: string;
  code: string;
  vendorId: string | null;
  draft?: boolean | undefined;
}

export function useOspDcPrint(): (
  action: 'preview' | 'download',
  t: OspDcPrintTarget,
) => Promise<void> {
  const qc = useQueryClient();
  const { data: me } = useSession();
  return useCallback(
    (action, t) =>
      runPrint(action, { title: 'OSP Delivery Challan', fileName: t.code }, async () => {
        const vendorId = t.vendorId;
        const [dc, vendor, company, templates] = await Promise.all([
          qc.fetchQuery({
            queryKey: deliveryChallansKeys.detail(t.id),
            queryFn: () => apiFetch<DeliveryChallanWithLines>(`/delivery-challans/${t.id}`),
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
          qc.fetchQuery({
            queryKey: companyKeys.me(),
            queryFn: () => apiFetch<Company>('/companies/me'),
          }),
          qc.fetchQuery({
            queryKey: printTemplatesKeys.list(),
            queryFn: () => apiFetch<ListPrintTemplatesResponse>('/print-templates'),
          }),
        ]);
        return () =>
          printOspDc({
            dc,
            vendor,
            company,
            templates: templates.items,
            currentUser: me?.email,
            draft: t.draft,
          });
      }),
    [qc, me?.email],
  );
}
