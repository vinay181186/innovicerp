// Item new + edit routes (UI-003-01). Legacy addItem/editItem
// (legacy/InnovicERP_v82_12_3_DataLossFix_29-04-2026.html L11598, L11609) open
// these as modals via showModal('Add Item'|'Edit Item', itemForm(...)). We serve
// them as routes instead — a pre-existing, deliberate container divergence — so
// the modal's hdr/body/footer shape maps onto panel-hdr + panel-body +
// modal-footer, and the ✕ close maps onto the back link. Titles match legacy.

import type { CreateItemInput, UpdateItemInput } from '@innovic/shared';
import { Link, createRoute, useNavigate } from '@tanstack/react-router';
import { ArrowLeft, Loader2 } from 'lucide-react';
import { useState } from 'react';
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

function ItemNewPage(): React.JSX.Element {
  const navigate = useNavigate();
  const create = useCreateItem();
  const [submitError, setSubmitError] = useState<string | null>(null);

  const onSubmit = async (values: CreateItemInput): Promise<void> => {
    setSubmitError(null);
    try {
      const created = await create.mutateAsync(values);
      await navigate({ to: '/items/$id', params: { id: created.id }, replace: true });
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'Failed to create item');
    }
  };

  return (
    <div>
      <Link to="/items" className="btn btn-ghost btn-sm" style={{ marginBottom: 10 }}>
        <ArrowLeft size={14} /> Back to Item Master
      </Link>
      <div className="panel">
        <div className="panel-hdr">
          <div className="panel-title">Add Item</div>
        </div>
        <ItemForm
          mode="create"
          onSubmit={onSubmit}
          submitError={submitError}
          onCancel={() => void navigate({ to: '/items' })}
        />
      </div>
    </div>
  );
}

function ItemEditPage(): React.JSX.Element {
  const { id } = itemEditRoute.useParams();
  const navigate = useNavigate();
  const { data: item, isLoading, isError, error } = useItem(id);
  const update = useUpdateItem(id);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const onSubmit = async (values: UpdateItemInput): Promise<void> => {
    setSubmitError(null);
    try {
      await update.mutateAsync(values);
      await navigate({ to: '/items/$id', params: { id }, replace: true });
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'Failed to update item');
    }
  };

  if (isLoading) {
    return (
      <div>
        <Loader2 className="inline h-4 w-4 animate-spin" /> Loading item…
      </div>
    );
  }

  if (isError || !item) {
    return (
      <div className="panel">
        <div className="panel-body">
          <div style={{ marginBottom: 8 }}>
            <Link to="/items" className="btn btn-ghost btn-sm">
              <ArrowLeft size={14} /> Back
            </Link>
          </div>
          <div className="empty-state" style={{ color: 'var(--red)' }}>
            {error instanceof Error ? error.message : 'Item not found'}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div>
      <Link to="/items/$id" params={{ id }} className="btn btn-ghost btn-sm" style={{ marginBottom: 10 }}>
        <ArrowLeft size={14} /> Back to item
      </Link>
      <div className="panel">
        <div className="panel-hdr">
          <div className="panel-title">Edit Item</div>
        </div>
        <ItemForm
          mode="edit"
          item={item}
          onSubmit={onSubmit}
          submitError={submitError}
          onCancel={() => void navigate({ to: '/items/$id', params: { id } })}
        />
      </div>
    </div>
  );
}
