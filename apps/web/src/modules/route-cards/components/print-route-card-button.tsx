// Per-row 🖨 Print action for the Route Card list (Print Templates P3, ADR-034).
//
// Legacy renders a 🖨 button on every Route Card Master row (renderRouteCards
// L10117 → printRouteCard L10629). The print needs the RC's ops plus the item's
// drawing / revision / material — neither is on the list row, which carries only
// `opCount` (RouteCardListItem). To avoid fetching a detail for every row
// up-front, this button lazily arms both queries on first click, then fires the
// print once they resolve.
//
// Mirrors the PrintJcButton precedent (job-cards/components/print-jc-button.tsx).

import type { RouteCardListItem } from '@innovic/shared';
import { Loader2, Printer } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useItem } from '@/modules/items/api';
import { useMyCompany } from '@/modules/settings/api';
import { useRouteCard } from '../api';
import { printRouteCard } from '../lib/print-route-card';

/**
 * The Print click logic, shared by the row button and the sheet's ⋯ menu
 * item. `start()` arms the lazy fetches and prints once they resolve; its
 * Promise settles when the print has fired (or failed), so the ⋯ menu shows
 * busy and cannot fire a second print meanwhile.
 */
export function usePrintRouteCard(rc: RouteCardListItem): {
  start: () => Promise<void>;
  loading: boolean;
} {
  // `armed` gates the on-demand fetches; `pending` means "print as soon as the
  // queries resolve". A ref guards against printing twice if a query re-settles.
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
  // useRouteCard / useItem enable themselves off Boolean(id), so passing
  // undefined until armed keeps both queries idle for rows never printed.
  const rcQuery = useRouteCard(armed ? rc.id : undefined);
  const itemQuery = useItem(armed ? rc.itemId : undefined);

  useEffect(() => {
    if (!pending || printedRef.current) return;
    if (rcQuery.isError) {
      setPending(false);
      settle();
      window.alert('Could not load Route Card. Try again.');
      return;
    }
    if (!rcQuery.data) return; // ops still loading
    // The item only supplies drawing / rev / material. If it 404s (soft-deleted)
    // print anyway — printRouteCard renders those as '—'.
    if (!itemQuery.data && !itemQuery.isError) return;
    printedRef.current = true;
    setPending(false);
    settle();
    const ok = printRouteCard({ rc: rcQuery.data, item: itemQuery.data, company });
    if (!ok) window.alert('Allow popups to print.');
  }, [
    pending,
    rcQuery.data,
    rcQuery.isError,
    rcQuery.error,
    itemQuery.data,
    itemQuery.isError,
    company,
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

  return { start, loading: pending && (rcQuery.isFetching || itemQuery.isFetching) };
}

export function PrintRouteCardButton({ rc }: { rc: RouteCardListItem }): React.JSX.Element {
  const { start, loading } = usePrintRouteCard(rc);

  const onClick = (e: React.MouseEvent): void => {
    e.stopPropagation();
    void start();
  };

  // Icon-only, like the other Action-column buttons on the Route Card sheet
  // (Eye / Pencil / Trash2): same trim, hover names the action.
  return (
    <button
      type="button"
      className="btn btn-ghost btn-sm btn-icon"
      style={{ padding: '2px 3px' }}
      onClick={onClick}
      disabled={loading}
      title="Print"
      aria-label="Print"
    >
      {loading ? <Loader2 size={13} className="inline animate-spin" /> : <Printer size={13} />}
    </button>
  );
}
