// "Create Purchase Order" route.
//
// One route, both doors into raising a PO:
//   • From a PR page  → `?prId=<id>` is supplied, and line 1 opens with that PR
//     already picked and filled in (the classic "convert this PR" button).
//   • From "+ New PO" → no `prId`; the form opens straight away with one empty
//     line whose PR NO. cell says "Select …".
//
// The old two-step "step 1 of 2 — pick a PR first" screen is gone: the PR is a
// per-LINE field now (one PO may cover several PRs), so there is nothing to ask
// before the form can be shown.
//
// Everything else lives in <PoForm>, which the edit route renders too — see
// `components/po-form.tsx`.

import { createRoute } from '@tanstack/react-router';
import { Loader2 } from 'lucide-react';
import { z } from 'zod';
import { effectiveFormPerms, useMyAccess } from '@/lib/access-control';
import { authenticatedRoute } from '@/routes/_authenticated';
import { PoForm } from '../components/po-form';

// prId is OPTIONAL: present when the PR page hands us a specific PR, absent when
// the buyer arrives from "+ New PO".
const fromPrSearchSchema = z.object({
  prId: z.string().uuid().optional(),
});

export const purchaseOrderFromPrRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: 'purchase-orders/from-pr',
  validateSearch: fromPrSearchSchema,
  component: PurchaseOrderCreatePage,
});

function PurchaseOrderCreatePage(): React.JSX.Element {
  const { prId } = purchaseOrderFromPrRoute.useSearch();
  // Route-level gate. Raising a PO is the entry action (L2 Data Entry and up).
  // The URL is typeable — without this the whole form is open to anyone who can
  // log in.
  const { data: eff, isPending: accessPending } = useMyAccess();
  const canCreate = effectiveFormPerms(eff, 'po_create').entry;

  if (accessPending) {
    return (
      <div>
        <Loader2 className="inline h-4 w-4 animate-spin" /> Loading…
      </div>
    );
  }

  if (!canCreate) {
    return (
      <div className="panel">
        <div className="panel-body empty-state" style={{ color: 'var(--amber)' }}>
          ⛔ Data entry access required to create a purchase order.
        </div>
      </div>
    );
  }

  // Keyed by the incoming PR so arriving from a different PR remounts the form
  // fresh rather than re-seeding a half-filled one.
  return <PoForm key={prId ?? 'blank'} mode="create" initialPrId={prId} />;
}
