// Preview / ⬇ Download PDF for one JW Return challan — the register's ⋯ row
// menu and the New Return popup after Save (owner rule 2026-10-21: every
// document offers Preview and Download PDF instead of Print).
//
// The register row carries everything but the customer's address, so the one
// client is read on the click (and, after Save, the one return by id), and the
// challan is built once it lands — without the address if that read failed.
// Both actions go through runPrint (lib/print/preview-host.tsx): Preview opens
// the box AT THE CLICK with "Loading preview…"; Download saves `<code>.pdf`.
// The returned Promise keeps the ⋯ / button busy meanwhile.

import type { Client, Company, JwReturnChallanListItem } from '@innovic/shared';
import { useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';
import { apiFetch } from '@/lib/api';
import { runPrint } from '@/lib/print/preview-host';
import { clientsKeys } from '@/modules/clients/api';
import { companyKeys } from '@/modules/settings/api';
import { jwReturnsKeys } from '../api';
import { printJwReturnChallan } from '../lib/print-jw-return';

const TITLE = 'JW Return Challan';

/** The register row when the caller has it; otherwise the return's id. */
export type PrintJwReturnTarget = { row: JwReturnChallanListItem } | { id: string; code: string };

export function usePrintJwReturn(): {
  preview: (t: PrintJwReturnTarget) => Promise<void>;
  download: (t: PrintJwReturnTarget) => Promise<void>;
} {
  const qc = useQueryClient();

  const load = useCallback(
    async (t: PrintJwReturnTarget): Promise<() => unknown> => {
      const [company, ret] = await Promise.all([
        qc
          .fetchQuery({
            queryKey: companyKeys.me(),
            queryFn: () => apiFetch<Company>('/companies/me'),
          })
          .catch(() => undefined),
        'row' in t
          ? Promise.resolve(t.row)
          : qc
              .fetchQuery({
                queryKey: jwReturnsKeys.detail(t.id),
                queryFn: () => apiFetch<JwReturnChallanListItem>(`/jw-returns/${t.id}`),
              })
              .catch(() => {
                throw new Error('Could not load the JW Return to print. Try again.');
              }),
      ]);
      // The client read is an enrichment: print with the customer name on the
      // return if it failed.
      const client = ret.clientId
        ? await qc
            .fetchQuery({
              queryKey: clientsKeys.detail(ret.clientId),
              queryFn: () => apiFetch<Client>(`/clients/${ret.clientId}`),
            })
            .catch(() => undefined)
        : undefined;
      return () => printJwReturnChallan(ret, client, company);
    },
    [qc],
  );

  const label = (t: PrintJwReturnTarget): { title: string; fileName: string } => ({
    title: TITLE,
    fileName: 'row' in t ? t.row.code : t.code,
  });
  const preview = useCallback(
    (t: PrintJwReturnTarget) => runPrint('preview', label(t), () => load(t)),
    [load],
  );
  const download = useCallback(
    (t: PrintJwReturnTarget) => runPrint('download', label(t), () => load(t)),
    [load],
  );
  return { preview, download };
}
