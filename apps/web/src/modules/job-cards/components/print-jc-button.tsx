// Per-row Preview / ⬇ Download PDF for the Job Cards list (Print Templates P3,
// ADR-034; owner rule 2026-10-21: every document offers Preview and Download
// PDF instead of Print).
//
// The Job Card print needs the JC's enriched ops, which are NOT on the list row
// — they come from `/op-entry/jc-ops?jobCardId=…`. To avoid fetching ops for
// every row up-front, the hook lazily enables that query on the click, then
// hands the print to runPrint (lib/print/preview-host.tsx) once ops + company
// are loaded: Preview opens the box AT THE CLICK with "Loading preview…",
// Download saves `<JC No.>.pdf`.

import type { JobCardListItem } from '@innovic/shared';
import { useCallback, useEffect, useRef, useState } from 'react';
import { runPrint } from '@/lib/print/preview-host';
import { useJcOpsEnriched } from '@/modules/op-entry/api';
import { useProductionOrderForJobCard } from '@/modules/production-orders/api';
import { useMyCompany } from '@/modules/settings/api';
import { printJobCard } from '../lib/print-job-card';

type Waiter = {
  promise: Promise<void>;
  ready: (build: () => unknown) => void;
  fail: (e: Error) => void;
};

/**
 * The Preview / Download click logic for the sheet's ⋯ menu. `preview()` /
 * `download()` arm the lazy fetch and print once the data is in; each returns
 * a Promise that settles when the box shows / the PDF is saved (or failed), so
 * the ⋯ menu shows busy and cannot fire a second print meanwhile.
 */
export function usePrintJc(
  jc: JobCardListItem,
  /** ADR-202 — the JC has a pending edit; print "Draft — awaiting approval". */
  draft?: boolean | undefined,
): {
  preview: () => Promise<void>;
  download: () => Promise<void>;
} {
  // `armed` gates the on-demand ops fetch; `pending` means "build as soon as
  // the ops query resolves". The waiter ref guards against building twice if
  // the query re-settles.
  const [armed, setArmed] = useState(false);
  const [pending, setPending] = useState(false);
  const waitRef = useRef<Waiter | null>(null);
  // A row that unmounts mid-fetch must not leave the ⋯ busy for ever.
  useEffect(
    () => () => {
      waitRef.current?.fail(new Error('The Job Card closed before it loaded. Try again.'));
      waitRef.current = null;
    },
    [],
  );

  const { data: company } = useMyCompany();
  const opsQuery = useJcOpsEnriched({ jobCardId: jc.id }, { enabled: armed });
  // ADR-182 — the traveller prints the `Actual Size` the store really cut,
  // which lives on the Production Order, not on the Job Card row. Fetched on
  // the same lazy `armed` switch as the ops, so an unclicked list row still
  // costs nothing. A card no order built simply prints the line blank.
  const { order, isLoading: orderLoading } = useProductionOrderForJobCard(jc.id, armed);

  useEffect(() => {
    const w = waitRef.current;
    if (!pending || !w) return;
    if (opsQuery.isError) {
      setPending(false);
      waitRef.current = null;
      w.fail(new Error('Could not load operations for this Job Card. Try again.'));
      return;
    }
    if (!opsQuery.data) return; // still loading
    if (orderLoading) return; // the Production Order's Actual Size is still on its way
    setPending(false);
    waitRef.current = null;
    const ops = opsQuery.data;
    w.ready(() =>
      printJobCard({
        jc,
        ops,
        company,
        actualSize: order?.actualSize ?? null,
        productionOrderCode: order?.code ?? null,
        draft,
      }),
    );
  }, [pending, opsQuery.data, opsQuery.isError, jc, company, order, orderLoading, draft]);

  const start = useCallback(
    (action: 'preview' | 'download'): Promise<void> => {
      if (waitRef.current) return waitRef.current.promise;
      const waiter = {} as Waiter;
      const load = (): Promise<() => unknown> =>
        new Promise<() => unknown>((resolve, reject) => {
          waiter.ready = resolve;
          waiter.fail = reject;
        });
      waiter.promise = runPrint(action, { title: 'Job Card', fileName: jc.code }, load);
      waitRef.current = waiter;
      setArmed(true);
      setPending(true);
      return waiter.promise;
    },
    [jc.code],
  );

  return {
    preview: useCallback(() => start('preview'), [start]),
    download: useCallback(() => start('download'), [start]),
  };
}
