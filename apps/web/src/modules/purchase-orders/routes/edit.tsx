// PO edit route.
//
// Renders the SAME <PoForm> as the create route (`routes/from-pr.tsx`), in edit
// mode: identical layout, lines pre-filled from the PO — each line's source PR
// shown in the PR NO. cell — plus the read-only Status box and the per-line
// Received column that only edit needs. The form owns the PATCH itself, so this
// file is just the route, the access gate and the load/error states.

import { Link, createRoute } from '@tanstack/react-router';
import { ArrowLeft, Loader2 } from 'lucide-react';
import { effectiveFormPerms, useMyAccess } from '@/lib/access-control';
import { authenticatedRoute } from '@/routes/_authenticated';
import { usePurchaseOrder } from '../api';
import { PoForm } from '../components/po-form';

export const purchaseOrderEditRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: 'purchase-orders/$id/edit',
  component: PurchaseOrderEditPage,
});

function PurchaseOrderEditPage(): React.JSX.Element {
  const { id } = purchaseOrderEditRoute.useParams();
  // Route-level gate. Editing needs the edit action (L3 Editor and up) — an L2
  // Data Entry clerk creates a PO but cannot alter one after it is saved. The
  // list hides the Edit link for them; this stops the typed URL too.
  const { data: eff, isPending: accessPending } = useMyAccess();
  const canEdit = effectiveFormPerms(eff, 'po_create').edit;
  const { data: detail, isLoading, isError, error } = usePurchaseOrder(id);

  if (isLoading || accessPending) {
    return (
      <div>
        <Loader2 className="inline h-4 w-4 animate-spin" /> Loading purchase order…
      </div>
    );
  }

  if (!canEdit) {
    return (
      <div className="panel">
        <div className="panel-body empty-state" style={{ color: 'var(--amber)' }}>
          ⛔ Edit access required to change a purchase order.
        </div>
      </div>
    );
  }

  if (isError || !detail) {
    return (
      <div className="panel">
        <div className="panel-body">
          <div style={{ marginBottom: 8 }}>
            <Link to="/purchase-orders" className="btn btn-ghost btn-sm">
              <ArrowLeft size={14} /> Back
            </Link>
          </div>
          <div className="empty-state" style={{ color: 'var(--red)' }}>
            {error instanceof Error ? error.message : 'Purchase order not found'}
          </div>
        </div>
      </div>
    );
  }

  // Keyed by the PO id so navigating between two POs' edit screens remounts the
  // form on the new document's values instead of keeping the old ones.
  return <PoForm key={detail.id} mode="edit" detail={detail} />;
}
