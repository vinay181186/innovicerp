import { createRoute, useNavigate } from '@tanstack/react-router';
import { useCallback, useState } from 'react';
import { z } from 'zod';
import { effectiveFormPerms, useMyAccess } from '@/lib/access-control';
import { useExitConfirm } from '@/lib/exit-guard';
import { useSaveKey } from '@/lib/use-save-key';
import { authenticatedRoute } from '@/routes/_authenticated';
import { useCreateRouteCard } from '../api';
import {
  RouteCardForm,
  type RouteCardFormHeaderDraft,
  type RouteCardFormOpDraft,
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
  const saveKey = useSaveKey();
  const create = useCreateRouteCard(saveKey);
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
      // ADR-224: no `code` is sent. The RC No. on screen is a preview; the
      // server picks the number under its series lock. So a preview that went
      // stale — someone else saved first, or this is the second card in a row
      // from the same screen — costs the user nothing: this save takes the
      // next free number instead of being refused as a duplicate.
      const created = await create.mutateAsync({
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
      <div className="empty-state" style={{ color: 'var(--amber2)', padding: 40 }}>
        You do not have permission to create Route Cards. Ask an admin.
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
          rawMaterialItemId: null,
          rawMaterialItemCode: null,
          rmQtyPerPiece: '',
          notes: '',
          planType: 'manufacture',
        }}
        initialOps={[]}
        onSubmit={submit}
        submitting={create.isPending}
        submitError={submitError}
        onCancel={() => exit.leave(goBack)}
        onBack={goBack}
      />
    </>
  );
}
