import type { UpdateCostCenterInput } from '@innovic/shared';
import { Link, createRoute, useNavigate } from '@tanstack/react-router';
import { ArrowLeft, Loader2 } from 'lucide-react';
import { useState } from 'react';
import { effectiveFormPerms, useMyAccess } from '@/lib/access-control';
import { authenticatedRoute } from '@/routes/_authenticated';
import { useCostCenter, useUpdateCostCenter } from '../api';
import { CostCenterForm } from '../components/cost-center-form';

export const costCenterEditRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: 'cost-centers/$id/edit',
  component: CostCenterEditPage,
});

function CostCenterEditPage(): React.JSX.Element {
  const { id } = costCenterEditRoute.useParams();
  const navigate = useNavigate();
  const { data: detail, isLoading, isError, error } = useCostCenter(id);
  const update = useUpdateCostCenter(id);
  const [submitError, setSubmitError] = useState<string | null>(null);
  // Changing a saved record is `edit` on cc_create (Finance), so L2 Data Entry
  // (create-only) is correctly refused. Checked here too because the route is
  // reachable by URL, not just from the Edit button.
  const { data: eff } = useMyAccess();
  const perms = effectiveFormPerms(eff, 'cc_create');

  if (eff && !perms.edit) {
    return (
      <div className="empty-state" style={{ color: 'var(--amber)', padding: 40 }}>
        ⛔ You do not have edit access to Cost Center Master. Ask an admin for L2 Data Entry or
        above in Finance.
      </div>
    );
  }

  if (isLoading) {
    return (
      <div>
        <Loader2 className="inline h-4 w-4 animate-spin" /> Loading cost center…
      </div>
    );
  }
  if (isError || !detail) {
    return (
      <div className="panel">
        <div className="panel-body">
          <div style={{ marginBottom: 8 }}>
            <Link to="/cost-centers" className="btn btn-ghost btn-sm">
              <ArrowLeft size={14} /> Back
            </Link>
          </div>
          <div className="empty-state" style={{ color: 'var(--red)' }}>
            {error instanceof Error ? error.message : 'Cost center not found'}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div>
      <Link
        to="/cost-centers/$id"
        params={{ id: detail.id }}
        className="btn btn-ghost btn-sm"
        style={{ marginBottom: 10 }}
      >
        <ArrowLeft size={14} /> Back to {detail.code}
      </Link>
      <div className="panel">
        <div className="panel-hdr">
          <div>
            <div className="td-code fw-700" style={{ color: 'var(--cyan)', fontSize: 14 }}>
              {detail.code}
            </div>
            <div className="panel-title" style={{ marginTop: 2 }}>
              ✏ Edit Cost Center
            </div>
          </div>
        </div>
        <div className="panel-body">
          <CostCenterForm
            mode="edit"
            detail={detail}
            submitError={submitError}
            submitLabel="Save"
            onCancel={() =>
              void navigate({ to: '/cost-centers/$id', params: { id: detail.id } })
            }
            onSubmit={async (values: UpdateCostCenterInput) => {
              setSubmitError(null);
              try {
                await update.mutateAsync(values);
                void navigate({ to: '/cost-centers/$id', params: { id: detail.id } });
              } catch (e) {
                setSubmitError(e instanceof Error ? e.message : 'Failed to save changes.');
              }
            }}
          />
        </div>
      </div>
    </div>
  );
}
