// Vendor new + edit routes (UI-003-03).

import type { CreateVendorInput, UpdateVendorInput } from '@innovic/shared';
import { Link, createRoute, useNavigate } from '@tanstack/react-router';
import { ArrowLeft, Loader2 } from 'lucide-react';
import { useState } from 'react';
import { authenticatedRoute } from '@/routes/_authenticated';
import { useCreateVendor, useUpdateVendor, useVendor } from '../api';
import { VendorForm } from '../components/vendor-form';

export const vendorNewRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: 'vendors/new',
  component: VendorNewPage,
});

export const vendorEditRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: 'vendors/$id/edit',
  component: VendorEditPage,
});

function VendorNewPage(): React.JSX.Element {
  const navigate = useNavigate();
  const create = useCreateVendor();
  const [submitError, setSubmitError] = useState<string | null>(null);

  const onSubmit = async (values: CreateVendorInput): Promise<void> => {
    setSubmitError(null);
    try {
      const created = await create.mutateAsync(values);
      await navigate({ to: '/vendors/$id', params: { id: created.id }, replace: true });
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'Failed to create vendor');
    }
  };

  return (
    <div>
      <Link to="/vendors" className="btn btn-ghost btn-sm" style={{ marginBottom: 10 }}>
        <ArrowLeft size={14} /> Back to Vendor Master
      </Link>
      <div className="panel">
        <div className="panel-hdr">
          <div>
            <div className="panel-title">+ New Vendor</div>
            <div className="text3" style={{ fontSize: 11, marginTop: 2 }}>
              Create a master record for a supplier.
            </div>
          </div>
        </div>
        <div className="panel-body">
          <VendorForm
            mode="create"
            onSubmit={onSubmit}
            submitError={submitError}
            onCancel={() => void navigate({ to: '/vendors' })}
          />
        </div>
      </div>
    </div>
  );
}

function VendorEditPage(): React.JSX.Element {
  const { id } = vendorEditRoute.useParams();
  const navigate = useNavigate();
  const { data: vendor, isLoading, isError, error } = useVendor(id);
  const update = useUpdateVendor(id);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const onSubmit = async (values: UpdateVendorInput): Promise<void> => {
    setSubmitError(null);
    try {
      await update.mutateAsync(values);
      await navigate({ to: '/vendors/$id', params: { id }, replace: true });
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'Failed to update vendor');
    }
  };

  if (isLoading) {
    return (
      <div>
        <Loader2 className="inline h-4 w-4 animate-spin" /> Loading vendor…
      </div>
    );
  }

  if (isError || !vendor) {
    return (
      <div className="panel">
        <div className="panel-body">
          <div style={{ marginBottom: 8 }}>
            <Link to="/vendors" className="btn btn-ghost btn-sm">
              <ArrowLeft size={14} /> Back
            </Link>
          </div>
          <div className="empty-state" style={{ color: 'var(--red)' }}>
            {error instanceof Error ? error.message : 'Vendor not found'}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div>
      <Link
        to="/vendors/$id"
        params={{ id }}
        className="btn btn-ghost btn-sm"
        style={{ marginBottom: 10 }}
      >
        <ArrowLeft size={14} /> Back to vendor
      </Link>
      <div className="panel">
        <div className="panel-hdr">
          <div>
            <div
              className="td-code"
              style={{ color: 'var(--cyan)', fontSize: 14, fontWeight: 700 }}
            >
              {vendor.code}
            </div>
            <div className="panel-title" style={{ marginTop: 2 }}>
              Edit Vendor
            </div>
          </div>
        </div>
        <div className="panel-body">
          <VendorForm
            mode="edit"
            vendor={vendor}
            onSubmit={onSubmit}
            submitError={submitError}
            onCancel={() => void navigate({ to: '/vendors/$id', params: { id } })}
          />
        </div>
      </div>
    </div>
  );
}
