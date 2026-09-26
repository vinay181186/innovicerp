import { createRoute, useNavigate } from '@tanstack/react-router';
import { useCallback, useState } from 'react';
import { z } from 'zod';
import { effectiveFormPerms, useMyAccess } from '@/lib/access-control';
import { useExitConfirm } from '@/lib/exit-guard';
import { authenticatedRoute } from '@/routes/_authenticated';
import { useCreateRouteCard } from '../api';
import {
  RouteCardForm,
  type RouteCardFormHeaderDraft,
  type RouteCardFormOpDraft,
  emptyProcessOp,
  opsToInput,
  rawMaterialToInput,
} from '../components/route-card-form';

// ?itemId=&itemCode=&itemName= open the form already on an item — the Plans
// list's "+ Create Route Card" arrives this way, so the planner does not pick
// again the item the plan already names. All optional; a bare visit is blank.
const newSearchSchema = z.object({
  itemId: z.string().uuid().optional(),
  itemCode: z.string().optional(),
  itemName: z.string().optional(),
});

export const routeCardNewRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: 'route-cards/new',
  validateSearch: (search) => newSearchSchema.parse(search),
  component: RouteCardNewPage,
});

function RouteCardNewPage(): React.JSX.Element {
  const navigate = useNavigate();
  const search = routeCardNewRoute.useSearch();
  const create = useCreateRouteCard();
  const [submitError, setSubmitError] = useState<string | null>(null);
  const { data: eff } = useMyAccess();
  const perms = effectiveFormPerms(eff, 'routecard_create');
  const goBack = useCallback(() => void navigate({ to: '/route-cards' }), [navigate]);
  const exit = useExitConfirm({ onExit: goBack });

  const submit = async (
    header: RouteCardFormHeaderDraft,
    ops: RouteCardFormOpDraft[],
  ): Promise<void> => {
    setSubmitError(null);
    try {
      const created = await create.mutateAsync({
        code: header.code.trim() || undefined,
        itemId: header.itemId,
        ...rawMaterialToInput(header),
        notes: header.notes.trim() || null,
        planType: header.planType,
        ops: opsToInput(ops),
      });
      exit.leave(() => void navigate({ to: '/route-cards/$id', params: { id: created.id } }));
    } catch (e) {
      setSubmitError(e instanceof Error ? e.message : 'Could not save Route Card. Try again.');
    }
  };

  if (eff && !perms.entry) {
    return (
      <div className="empty-state" style={{ color: 'var(--amber)', padding: 40 }}>
        ⛔ You do not have create access to Route Cards. Ask an admin for L2 Data Entry or above in
        Design.
      </div>
    );
  }

  return (
    <>
      {exit.dialog}
      <RouteCardForm
        mode="create"
        initialHeader={{
          code: '',
          itemId: search.itemId ?? '',
          itemCodeText: search.itemCode ?? '',
          itemName: search.itemName ?? '',
          rawMaterialGradeId: null,
          rawMaterialGradeText: null,
          rawMaterialSizeId: null,
          rawMaterialSizeText: null,
          notes: '',
          planType: 'manufacture',
        }}
        initialOps={[emptyProcessOp()]}
        onSubmit={submit}
        submitting={create.isPending}
        submitError={submitError}
        onCancel={() => exit.leave(goBack)}
      />
    </>
  );
}
