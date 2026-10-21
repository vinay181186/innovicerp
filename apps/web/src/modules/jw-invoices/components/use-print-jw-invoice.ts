// Preview / ⬇ Download PDF for one JW invoice from the register's ⋯ row menu
// (owner rule 2026-10-21: every document offers Preview and Download PDF
// instead of Print).
//
// The printed invoice needs the CUSTOMER's postal address and GSTIN, and the
// register row carries only `clientId` + `clientName`. Fetching the customer
// master for every visible row up front would download every customer record
// to print one invoice, so the single-customer read happens only on the click.
// Company and the effective print templates are ordinary cached queries shared
// with every other screen.
//
// Both actions go through runPrint (lib/print/preview-host.tsx): Preview opens
// the box AT THE CLICK with "Loading preview…"; Download saves `<code>.pdf`.
// The returned Promise keeps the ⋯ busy, so a second click cannot fire.

import type {
  Client,
  Company,
  JwInvoiceListItem,
  ListPrintTemplatesResponse,
} from '@innovic/shared';
import { useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';
import { apiFetch } from '@/lib/api';
import { runPrint } from '@/lib/print/preview-host';
import { useSession } from '@/lib/session';
import { clientsKeys } from '@/modules/clients/api';
import { printTemplatesKeys } from '@/modules/print-templates/api';
import { companyKeys } from '@/modules/settings/api';
import { printJwInvoice } from '../lib/print-jw-invoice';

const TITLE = 'JW Invoice';

export function usePrintJwInvoice(priceVisible: boolean): {
  preview: (invoice: JwInvoiceListItem) => Promise<void>;
  download: (invoice: JwInvoiceListItem) => Promise<void>;
} {
  const qc = useQueryClient();
  const { data: me } = useSession();
  const email = me?.email;

  const load = useCallback(
    async (invoice: JwInvoiceListItem): Promise<() => unknown> => {
      // The letterhead and the template blocks are worth the wait; the
      // customer master read is an ENRICHMENT — if it fails, print anyway with
      // the customer name the register row already carries.
      const [company, templates, client] = await Promise.all([
        qc
          .fetchQuery({
            queryKey: companyKeys.me(),
            queryFn: () => apiFetch<Company>('/companies/me'),
          })
          .catch(() => undefined),
        qc
          .fetchQuery({
            queryKey: printTemplatesKeys.list(),
            queryFn: () => apiFetch<ListPrintTemplatesResponse>('/print-templates'),
          })
          .catch(() => undefined),
        invoice.clientId
          ? qc
              .fetchQuery({
                queryKey: clientsKeys.detail(invoice.clientId),
                queryFn: () => apiFetch<Client>(`/clients/${invoice.clientId}`),
              })
              .catch(() => undefined)
          : Promise.resolve(undefined),
      ]);
      return () =>
        printJwInvoice({
          invoice,
          priceVisible,
          client,
          company,
          templates: templates?.items ?? [],
          currentUser: email,
        });
    },
    [qc, priceVisible, email],
  );

  const preview = useCallback(
    (invoice: JwInvoiceListItem) =>
      runPrint('preview', { title: TITLE, fileName: invoice.code }, () => load(invoice)),
    [load],
  );
  const download = useCallback(
    (invoice: JwInvoiceListItem) =>
      runPrint('download', { title: TITLE, fileName: invoice.code }, () => load(invoice)),
    [load],
  );
  return { preview, download };
}
