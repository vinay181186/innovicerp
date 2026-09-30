import { createRoute, useNavigate } from '@tanstack/react-router';
import { effectiveFormPerms, useMyAccess } from '@/lib/access-control';
import { useExitConfirm } from '@/lib/exit-guard';
import { useSaveKey } from '@/lib/use-save-key';
import { authenticatedRoute } from '@/routes/_authenticated';
import { useCreatePlan } from '../api';
import { PlanCreateForm } from '../components/plan-create-form';

export const planNewRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: 'plans/new',
  component: PlanNewPage,
});

// New Plan — the SAME Route-Card plan SO Planning "+ Plan" makes: pick the
// SO / JWSO and its line; operations come from the item's Route Card when the
// Production Order is raised (ADR-170). See plan-create-form.tsx.
function PlanNewPage(): React.JSX.Element {
  const navigate = useNavigate();
  const saveKey = useSaveKey();
  const create = useCreatePlan(saveKey);
  const { data: eff } = useMyAccess();
  const perms = effectiveFormPerms(eff, 'plan_create');
  const goBack = (): void => void navigate({ to: '/plans' });
  const exit = useExitConfirm({ onExit: goBack });

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
      <PlanCreateForm
        isSubmitting={create.isPending}
        submitError={create.error instanceof Error ? create.error.message : null}
        onCancel={() => exit.leave(goBack)}
        onSave={(input) => {
          create.mutate(input, {
            onSuccess: (plan) => {
              // The plan detail offers "Create Production Order →" next.
              exit.leave(() => void navigate({ to: '/plans/$id', params: { id: plan.id } }));
            },
          });
        }}
      />
    </div>
  );
}
