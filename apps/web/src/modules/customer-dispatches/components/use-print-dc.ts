// The Print DC click logic, used by the ⋯
// menu's Print item on the Customer Dispatch list.
//
// The list is built from register rows, which carry no customer address, so
// `start()` lazily reads the one dispatch (lines + clientId) and then the one
// client, and prints once both have landed — the same shape as the JW invoice
// register's print button. It returns a Promise that settles when the print
// has fired, failed, or the row unmounted, so the ⋯ menu shows busy and cannot
// fire a second print meanwhile (mirrors usePrintJc in job-cards).

import { useCallback, useEffect, useRef, useState } from 'react';
import { useClient } from '@/modules/clients/api';
import { useMyCompany } from '@/modules/settings/api';
import { useDispatchDetail } from '../api';
import { printDispatchChallan } from '../lib/print-dc';

/** The dispatch to print: its id, or any row carrying `id` / `dispatchId`. */
export type PrintDcTarget = string | { id: string } | { dispatchId: string };

function targetId(t: PrintDcTarget): string {
  if (typeof t === 'string') return t;
  return 'dispatchId' in t ? t.dispatchId : t.id;
}

export function usePrintDc(target: PrintDcTarget): {
  start: () => Promise<void>;
  loading: boolean;
} {
  const dispatchId = targetId(target);
  // `armed` gates the on-demand reads; `pending` means "print as soon as the
  // data is in". The ref guards against printing twice if a query re-settles.
  const [armed, setArmed] = useState(false);
  const [pending, setPending] = useState(false);
  const printedRef = useRef(false);
  const waitRef = useRef<{ promise: Promise<void>; resolve: () => void } | null>(null);
  const settle = useCallback((): void => {
    waitRef.current?.resolve();
    waitRef.current = null;
  }, []);
  // A row that unmounts mid-fetch must not leave the ⋯ busy for ever.
  useEffect(() => settle, [settle]);

  const companyQuery = useMyCompany();
  const detailQuery = useDispatchDetail(armed ? dispatchId : undefined);
  const clientId = detailQuery.data?.clientId ?? undefined;
  const clientQuery = useClient(clientId);

  useEffect(() => {
    if (!pending || printedRef.current) return;
    if (companyQuery.isLoading) return;
    if (detailQuery.isError) {
      setPending(false);
      settle();
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
    settle();
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
    settle,
  ]);

  const start = useCallback((): Promise<void> => {
    if (waitRef.current) return waitRef.current.promise;
    let resolve: () => void = () => undefined;
    const promise = new Promise<void>((r) => {
      resolve = r;
    });
    waitRef.current = { promise, resolve };
    printedRef.current = false;
    setArmed(true);
    setPending(true);
    return promise;
  }, []);

  return { start, loading: pending && (detailQuery.isFetching || clientQuery.isFetching) };
}
