// Per-row 🖨 Print action for the Job Cards list (Print Templates P3, ADR-034).
//
// The Job Card print needs the JC's enriched ops, which are NOT on the list row
// — they come from `/op-entry/jc-ops?jobCardId=…`. To avoid fetching ops for
// every row up-front, this button lazily enables that query on first click,
// then fires the print once both ops + company are loaded.
//
// Mirrors the route-card Print precedent (route-cards/routes/detail.tsx) but
// wrapped as a list-row action that fetches its data on demand.

import type { JobCardListItem } from '@innovic/shared';
import { Loader2, Printer } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useJcOpsEnriched } from '@/modules/op-entry/api';
import { useProductionOrderForJobCard } from '@/modules/production-orders/api';
import { useMyCompany } from '@/modules/settings/api';
import { printJobCard } from '../lib/print-job-card';

/**
 * The Print click logic, shared by the card view's button and the sheet's ⋯
 * menu item. `start()` arms the lazy fetch and prints once the data is in; it
 * returns a Promise that settles when the print has fired (or failed), so the
 * ⋯ menu shows busy and cannot fire a second print meanwhile.
 */
export function usePrintJc(jc: JobCardListItem): {
  start: () => Promise<void>;
  loading: boolean;
} {
  // `armed` gates the on-demand ops fetch; `pending` means "print as soon as
  // the ops query resolves". A ref guards against printing twice if the query
  // re-settles.
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

  const { data: company } = useMyCompany();
  const opsQuery = useJcOpsEnriched({ jobCardId: jc.id }, { enabled: armed });
  // ADR-182 — the traveller prints the `Actual Size` the store really cut,
  // which lives on the Production Order, not on the Job Card row. Fetched on
  // the same lazy `armed` switch as the ops, so an unclicked list row still
  // costs nothing. A card no order built simply prints the line blank.
  const { order, isLoading: orderLoading } = useProductionOrderForJobCard(jc.id, armed);

  useEffect(() => {
    if (!pending || printedRef.current) return;
    if (opsQuery.isError) {
      setPending(false);
      settle();
      window.alert('Could not load operations for this Job Card. Try again.');
      return;
    }
    if (!opsQuery.data) return; // still loading
    if (orderLoading) return; // the Production Order's Actual Size is still on its way
    printedRef.current = true;
    setPending(false);
    settle();
    const ok = printJobCard({
      jc,
      ops: opsQuery.data,
      company,
      actualSize: order?.actualSize ?? null,
    });
    if (!ok) window.alert('Allow popups to print.');
  }, [pending, opsQuery.data, opsQuery.isError, jc, company, order, orderLoading, settle]);

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

  return { start, loading: pending && opsQuery.isFetching };
}

export function PrintJcButton({
  jc,
  iconOnly = false,
}: {
  jc: JobCardListItem;
  /** The list sheet's Action column: icon alone, the title names the action. */
  iconOnly?: boolean | undefined;
}): React.JSX.Element {
  const { start, loading } = usePrintJc(jc);

  const onClick = (e: React.MouseEvent): void => {
    e.stopPropagation();
    void start();
  };

  const icon = loading ? (
    <Loader2 size={13} className="inline animate-spin" />
  ) : (
    <Printer size={13} />
  );

  if (iconOnly) {
    return (
      <button
        type="button"
        className="btn btn-ghost btn-sm btn-icon"
        onClick={onClick}
        disabled={loading}
        title="Print"
        aria-label="Print"
        style={{ padding: '2px 3px' }}
      >
        {icon}
      </button>
    );
  }

  return (
    <button
      type="button"
      className="btn btn-ghost btn-sm"
      onClick={onClick}
      disabled={loading}
      title="Print Job Card"
      style={{ whiteSpace: 'nowrap' }}
    >
      {icon} Print
    </button>
  );
}
