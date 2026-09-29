// 🖨 Print challan for one JW Return — per register row, and on the New Return
// popup right after Save. The register row already carries everything but the
// customer's address, so the button lazily reads the one client on the first
// click (and, after Save, the one return) and prints once they land — the same
// shape as the JW invoice register's print button.

import type { JwReturnChallanListItem } from '@innovic/shared';
import { Loader2, Printer } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useClient } from '@/modules/clients/api';
import { useMyCompany } from '@/modules/settings/api';
import { useJwReturn } from '../api';
import { printJwReturnChallan } from '../lib/print-jw-return';

export function PrintJwReturnButton({
  returnId,
  row,
  primary = false,
}: {
  returnId: string;
  /** The register row when the caller has it; otherwise it is read by id. */
  row?: JwReturnChallanListItem;
  primary?: boolean;
}): React.JSX.Element {
  const [armed, setArmed] = useState(false);
  const [pending, setPending] = useState(false);
  const printedRef = useRef(false);

  const companyQuery = useMyCompany();
  const retQuery = useJwReturn(armed && !row ? returnId : undefined);
  const ret = row ?? retQuery.data;
  const clientQuery = useClient(armed && ret?.clientId ? ret.clientId : undefined);

  useEffect(() => {
    if (!pending || printedRef.current) return;
    if (companyQuery.isLoading) return;
    if (retQuery.isError) {
      setPending(false);
      window.alert('Could not load the JW Return to print. Try again.');
      return;
    }
    if (!ret) return;
    // The client read is an enrichment: wait while in flight, print with the
    // customer name on the return if it failed.
    if (ret.clientId && !clientQuery.isError && !clientQuery.data) return;

    printedRef.current = true;
    setPending(false);
    if (!printJwReturnChallan(ret, clientQuery.data, companyQuery.data)) {
      window.alert('Allow popups to print.');
    }
  }, [
    pending,
    ret,
    retQuery.isError,
    clientQuery.data,
    clientQuery.isError,
    companyQuery.data,
    companyQuery.isLoading,
  ]);

  const loading = pending && (retQuery.isFetching || clientQuery.isFetching);

  return (
    <button
      type="button"
      className={primary ? 'btn btn-primary' : 'btn btn-ghost btn-sm'}
      onClick={(e) => {
        e.stopPropagation();
        printedRef.current = false;
        setArmed(true);
        setPending(true);
      }}
      disabled={loading}
      title="Print the return challan"
      style={{ whiteSpace: 'nowrap' }}
    >
      {loading ? <Loader2 size={13} className="inline animate-spin" /> : <Printer size={13} />}{' '}
      Print challan
    </button>
  );
}
