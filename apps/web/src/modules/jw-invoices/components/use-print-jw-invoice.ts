// Print one JW invoice from the register's ⋯ row menu.
//
// The printed invoice needs the CUSTOMER's postal address and GSTIN, and the
// register row carries only `clientId` + `clientName`. Fetching the customer
// master for every visible row up front would download every customer record
// to print one invoice, so the single-customer read is armed only when Print
// is chosen and the print fires once it resolves — the same shape the Job
// Cards list uses for its on-demand ops fetch.
//
// Company and the effective print templates are ordinary cached queries shared
// with every other screen.
//
// The returned function gives back a Promise that settles once the print
// window was opened (or refused by the popup blocker), so the ⋯ menu shows
// busy meanwhile and ignores a second click. One print at a time: a request
// while one is waiting is dropped, which also stops a double print.

import type { JwInvoiceListItem } from '@innovic/shared';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useSession } from '@/lib/session';
import { useClient } from '@/modules/clients/api';
import { usePrintTemplates } from '@/modules/print-templates/api';
import { useMyCompany } from '@/modules/settings/api';
import { printJwInvoice } from '../lib/print-jw-invoice';

export function usePrintJwInvoice(
  priceVisible: boolean,
): (invoice: JwInvoiceListItem) => Promise<void> {
  // The invoice waiting to print, or null. `done` settles its Promise; it is
  // also the "already printed" guard — cleared the moment the window opens, so
  // a re-settling query cannot print a second window.
  const [target, setTarget] = useState<JwInvoiceListItem | null>(null);
  const done = useRef<(() => void) | null>(null);

  const { data: me } = useSession();
  const companyQuery = useMyCompany();
  const templatesQuery = usePrintTemplates();
  // Passing undefined leaves the query disabled (`enabled: Boolean(id)`).
  const clientQuery = useClient(target?.clientId ?? undefined);

  useEffect(() => {
    if (!target || !done.current) return;
    // The letterhead and the template blocks are worth the wait on a cold
    // click; printing before they land would produce a sheet with no company
    // name on it.
    if (companyQuery.isLoading || templatesQuery.isLoading) return;
    // The customer master read is an ENRICHMENT. If it is still in flight,
    // wait; if it FAILED, print anyway with the customer name the register row
    // already carries. An invoice missing its billing address is worth
    // having; no invoice at all is not.
    if (target.clientId && !clientQuery.isError && !clientQuery.data) return;

    const settle = done.current;
    done.current = null;
    setTarget(null);
    const ok = printJwInvoice({
      invoice: target,
      priceVisible,
      client: clientQuery.data,
      company: companyQuery.data,
      templates: templatesQuery.data?.items ?? [],
      currentUser: me?.email,
    });
    if (!ok) window.alert('Allow popups to print.');
    settle();
  }, [
    target,
    priceVisible,
    clientQuery.data,
    clientQuery.isError,
    companyQuery.data,
    companyQuery.isLoading,
    templatesQuery.data,
    templatesQuery.isLoading,
    me?.email,
  ]);

  return useCallback((invoice: JwInvoiceListItem): Promise<void> => {
    if (done.current) return Promise.resolve();
    return new Promise<void>((resolve) => {
      done.current = resolve;
      setTarget(invoice);
    });
  }, []);
}
