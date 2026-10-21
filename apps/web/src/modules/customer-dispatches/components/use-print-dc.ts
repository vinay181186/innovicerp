// Preview / ⬇ Download PDF for one Delivery Challan — used by the ⋯ menu on the
// Customer Dispatch list (owner rule 2026-10-21: every document offers the
// same two actions, Preview and Download PDF, instead of Print).
//
// The list is built from register rows, which carry no customer address, so
// the load reads the one dispatch (lines + clientId) and then the one client,
// and builds the challan once both have landed. Both actions go through
// runPrint (lib/print/preview-host.tsx): Preview opens the box AT THE CLICK
// with "Loading preview…"; Download saves `<DC No.>.pdf`. The returned Promise
// keeps the ⋯ busy, so a second click cannot fire meanwhile.

import type { Client, Company, CustomerDispatchDetail } from '@innovic/shared';
import { useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';
import { apiFetch } from '@/lib/api';
import { runPrint } from '@/lib/print/preview-host';
import { clientsKeys } from '@/modules/clients/api';
import { companyKeys } from '@/modules/settings/api';
import { dispatchKeys } from '../api';
import { printDispatchChallan } from '../lib/print-dc';

const TITLE = 'Delivery Challan';

export function usePrintDc(): {
  preview: (dispatchId: string, code: string) => Promise<void>;
  download: (dispatchId: string, code: string) => Promise<void>;
} {
  const qc = useQueryClient();

  const load = useCallback(
    async (dispatchId: string): Promise<() => unknown> => {
      const [company, d] = await Promise.all([
        qc
          .fetchQuery({
            queryKey: companyKeys.me(),
            queryFn: () => apiFetch<Company>('/companies/me'),
          })
          .catch(() => undefined),
        qc
          .fetchQuery({
            queryKey: dispatchKeys.detail(dispatchId),
            queryFn: () => apiFetch<CustomerDispatchDetail>(`/customer-dispatches/${dispatchId}`),
          })
          .catch(() => {
            throw new Error('Could not load the dispatch to print. Try again.');
          }),
      ]);
      // The client read is an enrichment: print with the customer name the
      // dispatch carries if it failed.
      const client = d.clientId
        ? await qc
            .fetchQuery({
              queryKey: clientsKeys.detail(d.clientId),
              queryFn: () => apiFetch<Client>(`/clients/${d.clientId}`),
            })
            .catch(() => undefined)
        : undefined;
      return () => printDispatchChallan(d, client, company);
    },
    [qc],
  );

  const preview = useCallback(
    (dispatchId: string, code: string) =>
      runPrint('preview', { title: TITLE, fileName: code }, () => load(dispatchId)),
    [load],
  );
  const download = useCallback(
    (dispatchId: string, code: string) =>
      runPrint('download', { title: TITLE, fileName: code }, () => load(dispatchId)),
    [load],
  );
  return { preview, download };
}
