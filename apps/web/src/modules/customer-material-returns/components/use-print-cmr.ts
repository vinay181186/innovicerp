// Print one Customer Material Return from the register's ⋯ row menu (or the
// "saved" step of the New Return modal). The shape of usePrintJwReturn: the
// list row has no lines and no customer address, so the return's detail and
// the customer are read only when Print is chosen, and the sheet opens once
// they land (without the address if the customer read failed). The returned
// Promise settles once the print window was opened (or refused by the popup
// blocker), so the ⋯ shows busy meanwhile. One print at a time.

import { useCallback, useEffect, useRef, useState } from 'react';
import { useClient } from '@/modules/clients/api';
import { useMyCompany } from '@/modules/settings/api';
import { useCustomerMaterialReturn } from '../api';
import { printCustomerMaterialReturn } from '../lib/print-cmr';

export function usePrintCmr(): (id: string) => Promise<void> {
  const [targetId, setTargetId] = useState<string | null>(null);
  const done = useRef<(() => void) | null>(null);

  const companyQuery = useMyCompany();
  const detailQuery = useCustomerMaterialReturn(targetId ?? undefined);
  const detail = detailQuery.data && detailQuery.data.id === targetId ? detailQuery.data : null;
  // Passing undefined leaves the query disabled.
  const clientQuery = useClient(detail?.clientId ?? undefined);

  useEffect(() => {
    if (!targetId || !done.current) return;
    const settle = done.current;
    if (detailQuery.isError) {
      done.current = null;
      setTargetId(null);
      window.alert('Could not load the return to print. Try again.');
      settle();
      return;
    }
    if (!detail || companyQuery.isLoading) return;
    // The customer read is an enrichment: wait while in flight, print with the
    // customer name on the return if it failed.
    if (detail.clientId && !clientQuery.isError && !clientQuery.data) return;

    done.current = null;
    setTargetId(null);
    if (!printCustomerMaterialReturn(detail, clientQuery.data, companyQuery.data)) {
      window.alert('Allow popups to print.');
    }
    settle();
  }, [
    targetId,
    detail,
    detailQuery.isError,
    clientQuery.data,
    clientQuery.isError,
    companyQuery.data,
    companyQuery.isLoading,
  ]);

  return useCallback((id: string): Promise<void> => {
    if (done.current) return Promise.resolve();
    return new Promise<void>((resolve) => {
      done.current = resolve;
      setTargetId(id);
    });
  }, []);
}
