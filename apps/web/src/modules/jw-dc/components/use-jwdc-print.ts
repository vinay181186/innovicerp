// Preview / ⬇ Download PDF for one JW DC (outward) — the Outward register row ⋯
// uses it. Loads the DC (fresh, staleTime 0), its vendor, the company and the
// print templates in parallel, then hands printJwDc the SAME arguments the
// detail page passes, so both sheets are identical.

import type {
  Company,
  JwDcOutwardDetail,
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
import { jwDcKeys } from '../api';
import { printJwDc } from '../lib/print-jwdc';

export interface JwDcPrintTarget {
  id: string;
  code: string;
  vendorId: string | null;
}

export function useJwDcPrint(): (
  action: 'preview' | 'download',
  t: JwDcPrintTarget,
) => Promise<void> {
  const qc = useQueryClient();
  const { data: me } = useSession();
  return useCallback(
    (action, t) =>
      runPrint(action, { title: 'JW Delivery Challan', fileName: t.code }, async () => {
        const vendorId = t.vendorId;
        const [dc, vendor, company, templates] = await Promise.all([
          qc.fetchQuery({
            queryKey: jwDcKeys.outwardDetail(t.id),
            queryFn: () => apiFetch<JwDcOutwardDetail>(`/jw-dc/outward/${t.id}`),
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
          printJwDc({
            dc,
            vendor,
            company,
            templates: templates.items,
            currentUser: me?.email,
          });
      }),
    [qc, me?.email],
  );
}
