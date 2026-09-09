// Per-row 🖨 Print action for the JW Invoice register.
//
// The printed invoice needs the CLIENT's postal address and GSTIN, and the
// register row carries only `clientId` + `clientName`. Fetching the client
// master for every visible row up front would download 195 client records to
// print one invoice, so this button lazily arms the single-client read on the
// first click and fires the print once it resolves — the same shape the Job
// Cards list uses for its on-demand ops fetch (components/print-jc-button.tsx).
//
// Company and the effective print templates are ordinary cached queries shared
// with every other screen, so all the rows on the register resolve them once
// between them, not once each.

import type { JwInvoiceListItem } from '@innovic/shared';
import { Loader2, Printer } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useSession } from '@/lib/session';
import { useClient } from '@/modules/clients/api';
import { usePrintTemplates } from '@/modules/print-templates/api';
import { useMyCompany } from '@/modules/settings/api';
import { printJwInvoice } from '../lib/print-jw-invoice';

export function PrintJwInvoiceButton({
  invoice,
  priceVisible,
}: {
  invoice: JwInvoiceListItem;
  priceVisible: boolean;
}): React.JSX.Element {
  // `armed` gates the on-demand client read; `pending` means "print as soon as
  // it resolves". The ref stops a re-settling query printing a second window.
  const [armed, setArmed] = useState(false);
  const [pending, setPending] = useState(false);
  const printedRef = useRef(false);

  const { data: me } = useSession();
  const companyQuery = useMyCompany();
  const templatesQuery = usePrintTemplates();
  // Passing undefined leaves the query disabled — `useClient` is already
  // `enabled: Boolean(id)`, so no options argument is needed to arm it.
  const clientQuery = useClient(armed && invoice.clientId ? invoice.clientId : undefined);

  useEffect(() => {
    if (!pending || printedRef.current) return;
    // The letterhead and the template blocks are worth the wait on a cold
    // click; printing before they land would produce a sheet with no company
    // name on it.
    if (companyQuery.isLoading || templatesQuery.isLoading) return;
    // The client master read is different: it is an ENRICHMENT. If it is still
    // in flight, wait; if it FAILED, print anyway with the client name the
    // register row already carries. An invoice missing its billing address is
    // worth having; no invoice at all is not.
    if (invoice.clientId && !clientQuery.isError && !clientQuery.data) return;

    printedRef.current = true;
    setPending(false);
    const ok = printJwInvoice({
      invoice,
      priceVisible,
      client: clientQuery.data,
      company: companyQuery.data,
      templates: templatesQuery.data?.items ?? [],
      currentUser: me?.email,
    });
    if (!ok) window.alert('Allow popups to print.');
  }, [
    pending,
    invoice,
    priceVisible,
    clientQuery.data,
    clientQuery.isError,
    companyQuery.data,
    companyQuery.isLoading,
    templatesQuery.data,
    templatesQuery.isLoading,
    me?.email,
  ]);

  const onClick = (e: React.MouseEvent): void => {
    e.stopPropagation();
    printedRef.current = false;
    setArmed(true);
    setPending(true);
  };

  const loading = pending && (clientQuery.isFetching || companyQuery.isLoading);

  return (
    <button
      type="button"
      className="btn btn-ghost btn-sm"
      onClick={onClick}
      disabled={loading}
      title="Print this JW invoice"
      style={{ whiteSpace: 'nowrap' }}
    >
      {loading ? <Loader2 size={13} className="inline animate-spin" /> : <Printer size={13} />} Print
    </button>
  );
}
