// Item new + edit routes (UI-003-01). Both wrap <ItemForm> in the
// Innovic panel chrome with a section header + back link.

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
          <div>
            <div className="panel-title">+ New Item</div>
            <div className="text3" style={{ fontSize: 11, marginTop: 2 }}>
              Create a master record for a component or assembly.
            </div>
          </div>
        </div>
        <div className="panel-body">
          <ItemForm
            mode="create"
            onSubmit={onSubmit}
            submitError={submitError}
            onCancel={() => void navigate({ to: '/items' })}
          />
        </div>
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
          <div>
            <div
              className="td-code"
              style={{ color: 'var(--purple)', fontSize: 14, fontWeight: 700 }}
            >
              {item.code}
            </div>
            <div className="panel-title" style={{ marginTop: 2 }}>
              Edit Item
            </div>
          </div>
        </div>
        <div className="panel-body">
          <ItemForm
            mode="edit"
            item={item}
            onSubmit={onSubmit}
            submitError={submitError}
            onCancel={() => void navigate({ to: '/items/$id', params: { id } })}
          />
        </div>
      </div>
    </div>
  );
}
