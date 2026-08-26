import type { CreateCostCenterInput, ListCostCentersQuery } from '@innovic/shared';
import { Link, createRoute, useNavigate } from '@tanstack/react-router';
import { ArrowLeft } from 'lucide-react';
import { useMemo, useState } from 'react';
import { effectiveFormPerms, useMyAccess } from '@/lib/access-control';
import { authenticatedRoute } from '@/routes/_authenticated';
import { useCostCentersList, useCreateCostCenter } from '../api';
import { CostCenterForm } from '../components/cost-center-form';

export const costCenterNewRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: 'cost-centers/new',
  component: CostCenterNewPage,
});

function CostCenterNewPage(): React.JSX.Element {
  const navigate = useNavigate();
  const create = useCreateCostCenter();
  const [submitError, setSubmitError] = useState<string | null>(null);
  // Creating a master record is `entry` on cc_create (Finance). Checked here as
  // well as on the list button — the route is reachable by URL, so without this
  // an L1 Viewer got the whole form and failed only at the API.
  const { data: eff } = useMyAccess();
  const perms = effectiveFormPerms(eff, 'cc_create');

  // Suggest next code like legacy `CC-NNN` (length + 1, zero-padded). Pull
  // a tight count snapshot — fine to over-pad if there are 1000+ rows.
  const listQuery: ListCostCentersQuery = useMemo(() => ({ limit: 1, offset: 0 }), []);
  const { data: countData } = useCostCentersList(listQuery);
  const suggestedCode = useMemo(() => {
    const next = (countData?.total ?? 0) + 1;
    return `CC-${String(next).padStart(3, '0')}`;
  }, [countData?.total]);

  if (eff && !perms.entry) {
    return (
      <div className="empty-state" style={{ color: 'var(--amber)', padding: 40 }}>
        ⛔ You do not have create access to Cost Center Master. Ask an admin for L2 Data Entry or
        above in Finance.
      </div>
    );
  }

  return (
    <div>
      <Link to="/cost-centers" className="btn btn-ghost btn-sm" style={{ marginBottom: 10 }}>
        <ArrowLeft size={14} /> Back to Cost Center Master
      </Link>
      <div className="panel">
        <div className="panel-hdr">
          <div>
            <div className="panel-title">🏢 Add Cost Center</div>
            <div className="text3" style={{ fontSize: 11, marginTop: 2 }}>
              Master record for budgeting + reporting. Used by Sales Orders + Daily Production
              Reports + SO Costing.
            </div>
          </div>
        </div>
        <div className="panel-body">
          <CostCenterForm
            mode="create"
            suggestedCode={suggestedCode}
            submitError={submitError}
            submitLabel="Save"
            onCancel={() => void navigate({ to: '/cost-centers' })}
            onSubmit={async (values: CreateCostCenterInput) => {
              setSubmitError(null);
              try {
                const created = await create.mutateAsync(values);
                void navigate({ to: '/cost-centers/$id', params: { id: created.id } });
              } catch (e) {
                setSubmitError(e instanceof Error ? e.message : 'Failed to create cost center.');
              }
            }}
          />
        </div>
      </div>
    </div>
  );
}
