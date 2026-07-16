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
import { Loader2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useItem } from '@/modules/items/api';
import { useMyCompany } from '@/modules/settings/api';
import { useRouteCard } from '../api';
import { printRouteCard } from '../lib/print-route-card';

export function PrintRouteCardButton({ rc }: { rc: RouteCardListItem }): React.JSX.Element {
  // `armed` gates the on-demand fetches; `pending` means "print as soon as the
  // queries resolve". A ref guards against printing twice if a query re-settles.
  const [armed, setArmed] = useState(false);
  const [pending, setPending] = useState(false);
  const printedRef = useRef(false);

  const { data: company } = useMyCompany();
  // useRouteCard / useItem enable themselves off Boolean(id), so passing
  // undefined until armed keeps both queries idle for rows never printed.
  const rcQuery = useRouteCard(armed ? rc.id : undefined);
  const itemQuery = useItem(armed ? rc.itemId : undefined);

  useEffect(() => {
    if (!pending || printedRef.current) return;
    if (rcQuery.isError) {
      setPending(false);
      window.alert(
        rcQuery.error instanceof Error
          ? `Could not load route card: ${rcQuery.error.message}`
          : 'Could not load this route card.',
      );
      return;
    }
    if (!rcQuery.data) return; // ops still loading
    // The item only supplies drawing / rev / material. If it 404s (soft-deleted)
    // print anyway — printRouteCard renders those as '—'.
    if (!itemQuery.data && !itemQuery.isError) return;
    printedRef.current = true;
    setPending(false);
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
  ]);

  const onClick = (e: React.MouseEvent): void => {
    e.stopPropagation();
    printedRef.current = false;
    setArmed(true);
    setPending(true);
  };

  const loading = pending && (rcQuery.isFetching || itemQuery.isFetching);

  return (
    <button
      type="button"
      className="btn btn-ghost btn-sm"
      onClick={onClick}
      disabled={loading}
      title="Print Route Card"
    >
      {loading ? <Loader2 size={13} className="inline animate-spin" /> : '🖨'}
    </button>
  );
}
