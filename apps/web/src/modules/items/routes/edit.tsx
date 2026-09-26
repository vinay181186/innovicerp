// Item new + edit routes (UI-003-01). Legacy addItem/editItem
// (legacy/InnovicERP_v82_12_3_DataLossFix_29-04-2026.html L11598, L11609) open
// these as modals via showModal('Add Item'|'Edit Item', itemForm(...)). We serve
// them as routes instead — a pre-existing, deliberate container divergence.
// Titles match legacy.
//
// PHASE 4 (UI overhaul): the page chrome moved INTO <ItemForm>, which now
// renders the canonical create/edit composition (PageHeader with Cancel + Save
// → Panel → FormGrid). This file keeps only what is not layout: the data
// hooks, the access gate, the exit guard and the navigation. Its loading,
// no-access and not-found branches are <PageState>, with the app's existing
// wording passed through unchanged.

import type { CreateItemInput, UpdateItemInput } from '@innovic/shared';
import { createRoute, useNavigate } from '@tanstack/react-router';
import { useCallback, useState } from 'react';
import { useExitConfirm } from '@/lib/exit-guard';
import { effectiveFormPerms, useMyAccess } from '@/lib/access-control';
import { PageHeader, PageState } from '@/ui/layout';
import { authenticatedRoute } from '@/routes/_authenticated';
import { useCreateItem, useItem, useUpdateItem } from '../api';
import { ItemForm } from '../components/item-form';

export const itemNewRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: 'items/new',
  component: ItemNewPage,
});

export const itemEditRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: 'items/$id/edit',
  component: ItemEditPage,
});

const BACK_TO_LIST = 'Back to Item Master';

function ItemNewPage(): React.JSX.Element {
  const navigate = useNavigate();
  const create = useCreateItem();
  const [submitError, setSubmitError] = useState<string | null>(null);
  // Tier-driven, per department (Store). The + Add Item button is hidden from
  // anyone without entry rights, but this screen had no gate of its own —
  // typing the URL still handed over the create form (an L1 Viewer, an L4
  // Approver). Same guard shape as the edit page below.
  const { data: eff, isLoading: accessLoading } = useMyAccess();
  const perms = effectiveFormPerms(eff, 'item_create');
  const goBack = useCallback(() => void navigate({ to: '/items' }), [navigate]);
  const exit = useExitConfirm({ onExit: goBack });

  const onSubmit = async (values: CreateItemInput): Promise<void> => {
    setSubmitError(null);
    try {
      const created = await create.mutateAsync(values);
      exit.leave(
        () => void navigate({ to: '/items/$id', params: { id: created.id }, replace: true }),
      );
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'Could not save Item. Try again.');
    }
  };

  if (accessLoading) {
    return <PageState state="loading" as="page" message="⟳ Loading item…" />;
  }

  if (!perms.entry) {
    return (
      <>
        <PageHeader title="New Item" backLabel={BACK_TO_LIST} onBack={goBack} />
        <PageState
          state="noaccess"
          message="⛔ You do not have create access to Item Master. Ask an admin for L2 Data Entry or above in Store."
        />
      </>
    );
  }

  return (
    <>
      {exit.dialog}
      <ItemForm
        mode="create"
        title="New Item"
        backLabel={BACK_TO_LIST}
        // NOT exit.leave: the old back link went through the guard too, so
        // leaving this way still asks "are you sure you want to exit?".
        onBack={goBack}
        onSubmit={onSubmit}
        submitError={submitError}
        onCancel={() => exit.leave(goBack)}
      />
    </>
  );
}

function ItemEditPage(): React.JSX.Element {
  const { id } = itemEditRoute.useParams();
  const navigate = useNavigate();
  const { data: item, isLoading, isError, error } = useItem(id);
  const update = useUpdateItem(id);
  const [submitError, setSubmitError] = useState<string | null>(null);
  // Same hole on the edit route: the row's Edit link is hidden without edit
  // rights, but the URL was open to anyone signed in.
  const { data: eff, isLoading: accessLoading } = useMyAccess();
  const perms = effectiveFormPerms(eff, 'item_create');

  const goBack = useCallback(
    () => void navigate({ to: '/items/$id', params: { id } }),
    [navigate, id],
  );
  const goToList = useCallback(() => void navigate({ to: '/items' }), [navigate]);
  const exit = useExitConfirm({ onExit: goBack });

  const onSubmit = async (values: UpdateItemInput): Promise<void> => {
    setSubmitError(null);
    try {
      await update.mutateAsync(values);
      exit.leave(() => void navigate({ to: '/items/$id', params: { id }, replace: true }));
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'Could not save Item. Try again.');
    }
  };

  if (isLoading || accessLoading) {
    return <PageState state="loading" as="page" message="⟳ Loading item…" />;
  }

  if (!perms.edit) {
    return (
      <>
        <PageHeader title="Edit Item" backLabel="Back to item" onBack={goBack} />
        <PageState
          state="noaccess"
          message="⛔ You do not have edit access to Item Master. Ask an admin for L3 Editor or above in Store."
        />
      </>
    );
  }

  if (isError || !item) {
    return (
      <>
        <PageHeader title="Edit Item" backLabel={BACK_TO_LIST} onBack={goToList} />
        <PageState
          state="error"
          message={error instanceof Error ? error.message : 'Item not found'}
        />
      </>
    );
  }

  return (
    <>
      {exit.dialog}
      <ItemForm
        mode="edit"
        item={item}
        title="Edit Item"
        backLabel="Back to item"
        onBack={goBack}
        onSubmit={onSubmit}
        submitError={submitError}
        onCancel={() => exit.leave(goBack)}
      />
    </>
  );
}
