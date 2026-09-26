import { Link, createRoute, useNavigate } from '@tanstack/react-router';
import { ArrowLeft } from 'lucide-react';
import { effectiveFormPerms, useMyAccess } from '@/lib/access-control';
import { useExitConfirm } from '@/lib/exit-guard';
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
  const { data: eff } = useMyAccess();
  const perms = effectiveFormPerms(eff, 'plan_create');
  // No Cancel button on this screen, so ESC → Exit falls back to history.
  const exit = useExitConfirm();

  if (eff && !perms.entry) {
    return (
      <div className="empty-state" style={{ color: 'var(--amber2)', padding: 40 }}>
        You do not have permission to create Plans. Ask an admin.
      </div>
    );
  }

  return (
    <div>
      {exit.dialog}
      <Link to="/plans" className="btn btn-ghost btn-sm" style={{ marginBottom: 10 }}>
        <ArrowLeft size={14} /> Back
      </Link>
      <div className="section-hdr" style={{ marginBottom: 10 }}>
        New Plan
      </div>

      <PlanForm
        initialValues={emptyValues()}
        isSubmitting={create.isPending}
        submitLabel="Save Plan"
        submitError={create.error instanceof Error ? create.error.message : null}
        onSubmit={(v) => {
          create.mutate(toCreateInput(v), {
            onSuccess: (plan) => {
              exit.leave(() => void navigate({ to: '/plans/$id', params: { id: plan.id } }));
            },
          });
        }}
      />
    </div>
  );
}
