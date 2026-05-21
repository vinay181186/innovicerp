import { Link, createRoute, useNavigate } from '@tanstack/react-router';
import { ArrowLeft } from 'lucide-react';
import { authenticatedRoute } from '@/routes/_authenticated';
import { useCreatePlan } from '../api';
import { PlanForm, emptyValues, toCreateInput } from '../components/plan-form';

export const planNewRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: 'plans/new',
  component: PlanNewPage,
});

function PlanNewPage(): React.JSX.Element {
  const navigate = useNavigate();
  const create = useCreatePlan();

  return (
    <div>
      <Link to="/planning-dashboard" className="btn btn-ghost btn-sm" style={{ marginBottom: 10 }}>
        <ArrowLeft size={14} /> Back to dashboard
      </Link>
      <div className="section-hdr" style={{ marginBottom: 10 }}>
        ➕ New plan
      </div>

      <PlanForm
        initialValues={emptyValues()}
        isSubmitting={create.isPending}
        submitLabel="Create plan"
        submitError={create.error instanceof Error ? create.error.message : null}
        onSubmit={(v) => {
          create.mutate(toCreateInput(v), {
            onSuccess: (plan) => {
              void navigate({ to: '/plans/$id', params: { id: plan.id } });
            },
          });
        }}
      />
    </div>
  );
}
