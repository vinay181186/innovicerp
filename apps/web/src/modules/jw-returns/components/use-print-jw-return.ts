// Print one JW Return challan from the register's ⋯ row menu.
//
// The same click logic as PrintJwReturnButton (the row's old button): the
// register row carries everything but the customer's address, so the one
// client is read only when Print is chosen, and the challan prints once it
// lands (or without the address if that read failed). The returned function
// gives back a Promise that settles once the print window was opened (or
// refused by the popup blocker), so the ⋯ shows busy meanwhile and ignores a
// second click. One print at a time — the shape of usePrintJwInvoice.

import type { JwReturnChallanListItem } from '@innovic/shared';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useClient } from '@/modules/clients/api';
import { useMyCompany } from '@/modules/settings/api';
import { printJwReturnChallan } from '../lib/print-jw-return';

export function usePrintJwReturn(): (row: JwReturnChallanListItem) => Promise<void> {
  // The return waiting to print, or null. `done` settles its Promise and is
  // the "already printed" guard.
  const [target, setTarget] = useState<JwReturnChallanListItem | null>(null);
  const done = useRef<(() => void) | null>(null);

  const companyQuery = useMyCompany();
  // Passing undefined leaves the query disabled.
  const clientQuery = useClient(target?.clientId ?? undefined);

  useEffect(() => {
    if (!target || !done.current) return;
    if (companyQuery.isLoading) return;
    // The client read is an enrichment: wait while in flight, print with the
    // customer name on the return if it failed.
    if (target.clientId && !clientQuery.isError && !clientQuery.data) return;

    const settle = done.current;
    done.current = null;
    setTarget(null);
    if (!printJwReturnChallan(target, clientQuery.data, companyQuery.data)) {
      window.alert('Allow popups to print.');
    }
    settle();
  }, [target, clientQuery.data, clientQuery.isError, companyQuery.data, companyQuery.isLoading]);

  return useCallback((row: JwReturnChallanListItem): Promise<void> => {
    if (done.current) return Promise.resolve();
    return new Promise<void>((resolve) => {
      done.current = resolve;
      setTarget(row);
    });
  }, []);
}
