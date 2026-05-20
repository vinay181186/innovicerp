import { createRoute, useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import { authenticatedRoute } from '@/routes/_authenticated';
import { useCreateRouteCard } from '../api';
import {
  RouteCardForm,
  type RouteCardFormHeaderDraft,
  type RouteCardFormOpDraft,
  emptyProcessOp,
  opsToInput,
} from '../components/route-card-form';

export const routeCardNewRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: 'route-cards/new',
  component: RouteCardNewPage,
});

function RouteCardNewPage(): React.JSX.Element {
  const navigate = useNavigate();
  const create = useCreateRouteCard();
  const [submitError, setSubmitError] = useState<string | null>(null);

  const submit = async (
    header: RouteCardFormHeaderDraft,
    ops: RouteCardFormOpDraft[],
  ): Promise<void> => {
    setSubmitError(null);
    try {
      const created = await create.mutateAsync({
        code: header.code.trim() || undefined,
        itemId: header.itemId,
        notes: header.notes.trim() || null,
        ops: opsToInput(ops),
      });
      void navigate({ to: '/route-cards/$id', params: { id: created.id } });
    } catch (e) {
      setSubmitError(e instanceof Error ? e.message : 'Failed to create route card.');
    }
  };

  return (
    <RouteCardForm
      mode="create"
      initialHeader={{ code: '', itemId: '', itemCodeText: '', notes: '' }}
      initialOps={[emptyProcessOp()]}
      onSubmit={submit}
      submitting={create.isPending}
      submitError={submitError}
      onCancel={() => void navigate({ to: '/route-cards' })}
    />
  );
}
