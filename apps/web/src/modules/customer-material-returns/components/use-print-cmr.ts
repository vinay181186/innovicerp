// Preview / ⬇ Download PDF for one Customer Material Return — the register's
// ⋯ row menu and the "saved" step of the New Return modal (owner rule
// 2026-10-21: every document offers Preview and Download PDF instead of
// Print). The list row has no lines and no customer address, so the return's
// detail and the customer are read on the click, and the sheet is built once
// they land (without the address if the customer read failed).
//
// Both actions go through runPrint (lib/print/preview-host.tsx): Preview opens
// the box AT THE CLICK with "Loading preview…"; Download saves `<code>.pdf`.
// The returned Promise keeps the ⋯ / button busy meanwhile.

import type { Client, Company, CustomerMaterialReturnDetail } from '@innovic/shared';
import { useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';
import { apiFetch } from '@/lib/api';
import { runPrint } from '@/lib/print/preview-host';
import { clientsKeys } from '@/modules/clients/api';
import { companyKeys } from '@/modules/settings/api';
import { customerMaterialReturnKeys } from '../api';
import { printCustomerMaterialReturn } from '../lib/print-cmr';

const TITLE = 'Customer Material Return';

export interface CmrPrint {
  preview: (id: string, code: string) => Promise<void>;
  download: (id: string, code: string) => Promise<void>;
}

export function usePrintCmr(): CmrPrint {
  const qc = useQueryClient();

  const load = useCallback(
    async (id: string): Promise<() => unknown> => {
      const [company, detail] = await Promise.all([
        qc
          .fetchQuery({
            queryKey: companyKeys.me(),
            queryFn: () => apiFetch<Company>('/companies/me'),
          })
          .catch(() => undefined),
        qc
          .fetchQuery({
            queryKey: customerMaterialReturnKeys.detail(id),
            queryFn: () =>
              apiFetch<CustomerMaterialReturnDetail>(`/customer-material-returns/${id}`),
          })
          .catch(() => {
            throw new Error('Could not load the return to print. Try again.');
          }),
      ]);
      // The customer read is an enrichment: print with the customer name on
      // the return if it failed.
      const client = detail.clientId
        ? await qc
            .fetchQuery({
              queryKey: clientsKeys.detail(detail.clientId),
              queryFn: () => apiFetch<Client>(`/clients/${detail.clientId}`),
            })
            .catch(() => undefined)
        : undefined;
      return () => printCustomerMaterialReturn(detail, client, company);
    },
    [qc],
  );

  const preview = useCallback(
    (id: string, code: string) =>
      runPrint('preview', { title: TITLE, fileName: code }, () => load(id)),
    [load],
  );
  const download = useCallback(
    (id: string, code: string) =>
      runPrint('download', { title: TITLE, fileName: code }, () => load(id)),
    [load],
  );
  return { preview, download };
}
