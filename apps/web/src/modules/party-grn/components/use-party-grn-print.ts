// Preview / ⬇ Download PDF for one Party GRN from the list's row ⋯ (there is
// no Party GRN detail page). The list row has no lines and no customer
// address, so the receipt is read fresh on the click (staleTime 0, the SAME
// query key/fn as the ▸ expand's usePartyGrnDetail) with the company in
// parallel, then the customer master. A customer the user may not read prints
// the receipt's own customer name (print falls back), so that read never fails
// the print.

import type { Client, Company, PartyGrnDetail } from '@innovic/shared';
import { useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';
import { apiFetch } from '@/lib/api';
import { runPrint } from '@/lib/print/preview-host';
import { clientsKeys } from '@/modules/clients/api';
import { companyKeys } from '@/modules/settings/api';
import { partyGrnKeys } from '../api';
import { printPartyGrn } from '../lib/print-party-grn';

export interface PartyGrnPrintTarget {
  id: string;
  code: string;
  clientId: string | null;
  /** ADR-235 — print the CANCELLED stamp. */
  cancelled?: boolean | undefined;
}

export function usePartyGrnPrint(): (
  action: 'preview' | 'download',
  t: PartyGrnPrintTarget,
) => Promise<void> {
  const qc = useQueryClient();
  return useCallback(
    (action: 'preview' | 'download', t: PartyGrnPrintTarget): Promise<void> =>
      runPrint(action, { title: 'Party GRN', fileName: t.code }, async () => {
        const clientId = t.clientId;
        const [grn, client, company] = await Promise.all([
          qc
            .fetchQuery({
              queryKey: partyGrnKeys.detail(t.id),
              queryFn: () => apiFetch<PartyGrnDetail>(`/party-grn/${t.id}`),
              staleTime: 0, // print what is saved now, not a cached copy
            })
            .catch(() => {
              throw new Error('Could not load the Party GRN to print. Try again.');
            }),
          clientId
            ? qc
                .fetchQuery({
                  queryKey: clientsKeys.detail(clientId),
                  queryFn: () => apiFetch<Client>(`/clients/${clientId}`),
                })
                .catch(() => null)
            : Promise.resolve(null),
          qc
            .fetchQuery({
              queryKey: companyKeys.me(),
              queryFn: () => apiFetch<Company>('/companies/me'),
            })
            .catch(() => null),
        ]);
        return () => printPartyGrn({ grn, client, company, cancelled: t.cancelled });
      }),
    [qc],
  );
}
