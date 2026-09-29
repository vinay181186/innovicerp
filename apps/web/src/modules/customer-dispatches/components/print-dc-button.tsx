// Per-card 🖨 Print DC on the Customer Dispatch list.
//
// The list is built from register rows, which carry no customer address, so
// the button lazily reads the one dispatch (lines + clientId) and then the
// one client on the first click, and prints once both have landed — the same
// shape as the JW invoice register's print button.

import { Loader2, Printer } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useClient } from '@/modules/clients/api';
import { useMyCompany } from '@/modules/settings/api';
import { useDispatchDetail } from '../api';
import { printDispatchChallan } from '../lib/print-dc';

export function PrintDcButton({ dispatchId }: { dispatchId: string }): React.JSX.Element {
  const [armed, setArmed] = useState(false);
  const [pending, setPending] = useState(false);
  const printedRef = useRef(false);

  const companyQuery = useMyCompany();
  const detailQuery = useDispatchDetail(armed ? dispatchId : undefined);
  const clientId = detailQuery.data?.clientId ?? undefined;
  const clientQuery = useClient(clientId);

  useEffect(() => {
    if (!pending || printedRef.current) return;
    if (companyQuery.isLoading) return;
    if (detailQuery.isError) {
      setPending(false);
      window.alert('Could not load the dispatch to print. Try again.');
      return;
    }
    const d = detailQuery.data;
    if (!d) return;
    // The client read is an enrichment: wait while it is in flight, print with
    // the customer name the dispatch carries if it failed.
    if (d.clientId && !clientQuery.isError && !clientQuery.data) return;

    printedRef.current = true;
    setPending(false);
    if (!printDispatchChallan(d, clientQuery.data, companyQuery.data)) {
      window.alert('Allow popups to print.');
    }
  }, [
    pending,
    detailQuery.data,
    detailQuery.isError,
    clientQuery.data,
    clientQuery.isError,
    companyQuery.data,
    companyQuery.isLoading,
  ]);

  const loading = pending && (detailQuery.isFetching || clientQuery.isFetching);

  return (
    <button
      type="button"
      className="btn btn-ghost btn-sm"
      onClick={(e) => {
        e.stopPropagation();
        printedRef.current = false;
        setArmed(true);
        setPending(true);
      }}
      disabled={loading}
      title="Print the Delivery Challan for this dispatch"
      style={{ whiteSpace: 'nowrap' }}
    >
      {loading ? <Loader2 size={13} className="inline animate-spin" /> : <Printer size={13} />}{' '}
      Print DC
    </button>
  );
}
