// Create Production Order — the Route Card operations panel
// (pro-routecard-create-edit-mockup.html, frame 1, approved 2026-10-06).
//
// Read-only. It shows the operations of the Route Card picked above — exactly
// the rows the Job Card copies on Save — so the planner sees what the order
// will run before raising it. It is the page's one filling block: it takes the
// height left under the fact grid and its table is the only thing that
// scrolls. Nothing here is editable; an operation is changed by revising the
// Route Card, and the footer says so.
//
// Data: the Route Card's own detail fetch (route-cards/api `useRouteCard`),
// the same request the Route Card detail page makes, so the table is the
// card's CURRENT revision. The table itself is the Route Card detail page's
// (route-card-ops-table.tsx), imported unchanged.

import type { RouteCardListItem } from '@innovic/shared';
import { Loader2 } from 'lucide-react';
import { useRouteCard } from '@/modules/route-cards/api';
import { RouteCardOpsTable } from '@/modules/route-cards/components/route-card-ops-table';
import { EmptyState, Panel } from '@/ui/data';

export interface PoCreateOpsPanelProps {
  /** Whether a plan has been picked yet. */
  hasPlan: boolean;
  /** The picked Route Card's list row (code, revision, op count), or null. */
  routeCard: RouteCardListItem | null;
  /** The plan's item has no Route Card at all. */
  noRouteCard: boolean;
  /** The plan's Route Cards are still loading. */
  routeCardsLoading: boolean;
  /** The plan's own Remarks, shown in the footer. */
  planRemarks: string | null;
}

export function PoCreateOpsPanel({
  hasPlan,
  routeCard,
  noRouteCard,
  routeCardsLoading,
  planRemarks,
}: PoCreateOpsPanelProps): React.JSX.Element {
  const detail = useRouteCard(routeCard?.id);
  const ops = detail.data?.ops ?? null;
  // The tab count: the detail's rows once they arrive, the list row's count
  // until then — never a 0 that is really "still loading".
  const count = ops ? ops.length : (routeCard?.opCount ?? null);

  const title = (
    <span className="po-create-ops-title">
      Route Card Operations
      {count !== null ? <span className="badge b-blue">{count}</span> : null}
    </span>
  );
  const meta = routeCard ? (
    <span className="po-create-ops-meta">
      <b>{routeCard.code}</b> Route Card Rev {routeCard.currentRevision} · read-only here · becomes
      the Job Card&apos;s operations on Save
    </span>
  ) : null;

  let body: React.ReactNode;
  if (!hasPlan) {
    body = <EmptyState>Pick a plan — its Route Card&apos;s operations show here.</EmptyState>;
  } else if (routeCardsLoading) {
    body = (
      <EmptyState>
        <Loader2 className="inline h-4 w-4 animate-spin" /> Loading Route Cards…
      </EmptyState>
    );
  } else if (noRouteCard) {
    body = <EmptyState>No Route Card for this item.</EmptyState>;
  } else if (!routeCard) {
    body = <EmptyState>Select the Route Card to see its operations.</EmptyState>;
  } else if (detail.isLoading) {
    body = (
      <EmptyState>
        <Loader2 className="inline h-4 w-4 animate-spin" /> Loading operations…
      </EmptyState>
    );
  } else if (detail.isError || !ops) {
    body = (
      <EmptyState tone="error">
        {detail.error instanceof Error
          ? detail.error.message
          : 'Could not load the Route Card operations.'}
      </EmptyState>
    );
  } else {
    body = <RouteCardOpsTable ops={ops} />;
  }

  return (
    <Panel fill bodyPadding="none" title={title} actions={meta}>
      {body}
      <div className="po-create-ops-foot">
        <span className="po-create-ops-remarks" title={planRemarks ?? undefined}>
          {planRemarks ? `Plan Remarks: ${planRemarks}` : null}
        </span>
        <span>
          {routeCard && routeCard.opCount === 0 ? (
            // The warning the old Route Card help line carried.
            <span className="po-create-ops-warn">
              No operations yet. Add them on the Route Card first.
            </span>
          ) : (
            'To change an operation, revise the Route Card'
          )}
        </span>
      </div>
    </Panel>
  );
}
