// Per-row Preview / ⬇ Download PDF for the Route Card list (Print Templates
// P3, ADR-034; owner rule 2026-10-21: every document offers Preview and
// Download PDF instead of Print).
//
// The print needs the RC's ops plus the item's drawing / revision / material —
// neither is on the list row, which carries only `opCount` (RouteCardListItem).
// To avoid fetching a detail for every row up-front, the hook lazily arms both
// queries on the click, then hands the print to runPrint
// (lib/print/preview-host.tsx) once they resolve: Preview opens the box AT THE
// CLICK with "Loading preview…", Download saves `<RC No.>.pdf`.
//
// Mirrors usePrintJc (job-cards/components/print-jc-button.tsx).

import type { RouteCardListItem } from '@innovic/shared';
import { useCallback, useEffect, useRef, useState } from 'react';
import { runPrint } from '@/lib/print/preview-host';
import { useItem } from '@/modules/items/api';
import { useMyCompany } from '@/modules/settings/api';
import { useRouteCard } from '../api';
import { printRouteCard } from '../lib/print-route-card';

type Waiter = {
  promise: Promise<void>;
  ready: (build: () => unknown) => void;
  fail: (e: Error) => void;
};

/**
 * The Preview / Download click logic for the sheet's ⋯ menu. Each arms the
 * lazy fetches and prints once they resolve; its Promise settles when the box
 * shows / the PDF is saved (or failed), so the ⋯ menu shows busy and cannot
 * fire a second print meanwhile.
 */
export function usePrintRouteCard(rc: RouteCardListItem): {
  preview: () => Promise<void>;
  download: () => Promise<void>;
} {
  // `armed` gates the on-demand fetches; `pending` means "build as soon as the
  // queries resolve". The waiter ref guards against building twice if a query
  // re-settles.
  const [armed, setArmed] = useState(false);
  const [pending, setPending] = useState(false);
  const waitRef = useRef<Waiter | null>(null);
  // A row that unmounts mid-fetch must not leave the ⋯ busy for ever.
  useEffect(
    () => () => {
      waitRef.current?.fail(new Error('The Route Card closed before it loaded. Try again.'));
      waitRef.current = null;
    },
    [],
  );

  const { data: company } = useMyCompany();
  // useRouteCard / useItem enable themselves off Boolean(id), so passing
  // undefined until armed keeps both queries idle for rows never printed.
  const rcQuery = useRouteCard(armed ? rc.id : undefined);
  const itemQuery = useItem(armed ? rc.itemId : undefined);

  useEffect(() => {
    const w = waitRef.current;
    if (!pending || !w) return;
    if (rcQuery.isError) {
      setPending(false);
      waitRef.current = null;
      w.fail(new Error('Could not load Route Card. Try again.'));
      return;
    }
    if (!rcQuery.data) return; // ops still loading
    // The item only supplies drawing / rev / material. If it 404s (soft-deleted)
    // print anyway — printRouteCard renders those as '—'.
    if (!itemQuery.data && !itemQuery.isError) return;
    setPending(false);
    waitRef.current = null;
    const detail = rcQuery.data;
    const item = itemQuery.data;
    w.ready(() => printRouteCard({ rc: detail, item, company }));
  }, [pending, rcQuery.data, rcQuery.isError, itemQuery.data, itemQuery.isError, company]);

  const start = useCallback(
    (action: 'preview' | 'download'): Promise<void> => {
      if (waitRef.current) return waitRef.current.promise;
      const waiter = {} as Waiter;
      const load = (): Promise<() => unknown> =>
        new Promise<() => unknown>((resolve, reject) => {
          waiter.ready = resolve;
          waiter.fail = reject;
        });
      waiter.promise = runPrint(action, { title: 'Route Card', fileName: rc.code }, load);
      waitRef.current = waiter;
      setArmed(true);
      setPending(true);
      return waiter.promise;
    },
    [rc.code],
  );

  return {
    preview: useCallback(() => start('preview'), [start]),
    download: useCallback(() => start('download'), [start]),
  };
}
