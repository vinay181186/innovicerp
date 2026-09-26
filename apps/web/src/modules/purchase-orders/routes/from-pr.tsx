// "Create Purchase Order" route.
//
// One route, both doors into raising a PO:
//   • From a PR page  → `?prId=<id>` is supplied, and line 1 opens with that PR
//     already picked and filled in (the classic "convert this PR" button).
//   • From the PR list's "Create PO from selected" → `?prIds=a,b,c`, one line
//     per PR, each seeded like the single `prId` case.
//   • From a Vendor page's "New PO" → `?vendorId=`, the Vendor box pre-set.
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
// prIds: "Create PO from selected" on the PR list — a comma-joined list of PR
// ids, one PO line each. Anything that is not a uuid is dropped rather than
// failing the whole route.
// vendorId: "New PO" on a Vendor page — the Vendor box opens with that vendor.
const fromPrSearchSchema = z.object({
  prId: z.string().uuid().optional(),
  prIds: z.string().optional(),
  vendorId: z.string().uuid().optional(),
});

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function parsePrIds(raw: string | undefined): string[] {
  if (!raw) return [];
  return [
    ...new Set(
      raw
        .split(',')
        .map((s) => s.trim())
        .filter((s) => UUID_RE.test(s)),
    ),
  ];
}

export const purchaseOrderFromPrRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: 'purchase-orders/from-pr',
  validateSearch: fromPrSearchSchema,
  component: PurchaseOrderCreatePage,
});

function PurchaseOrderCreatePage(): React.JSX.Element {
  const { prId, prIds: prIdsRaw, vendorId } = purchaseOrderFromPrRoute.useSearch();
  const prIds = parsePrIds(prIdsRaw);
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
        <div className="panel-body empty-state" style={{ color: 'var(--amber2)' }}>
          ⛔ Data entry access required to create a purchase order.
        </div>
      </div>
    );
  }

  // Keyed by the incoming PR(s) / vendor so arriving from a different source
  // remounts the form fresh rather than re-seeding a half-filled one.
  const formKey = prIds.length > 0 ? prIds.join(',') : (prId ?? `v:${vendorId ?? 'blank'}`);
  return (
    <PoForm
      key={formKey}
      mode="create"
      initialPrId={prId}
      initialPrIds={prIds.length > 0 ? prIds : undefined}
      initialVendorId={vendorId}
    />
  );
}
