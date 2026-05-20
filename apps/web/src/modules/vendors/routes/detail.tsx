// Vendor detail page (UI-003-03). Mirrors items/routes/detail.tsx pattern.

import type { Vendor } from '@innovic/shared';
import { Link, createRoute, useNavigate } from '@tanstack/react-router';
import { ArrowLeft, Loader2, Pencil, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { useSession } from '@/lib/session';
import { authenticatedRoute } from '@/routes/_authenticated';
import { useSoftDeleteVendor, useVendor } from '../api';

export const vendorDetailRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: 'vendors/$id',
  component: VendorDetailPage,
});

function ratingBadgeClass(rating: string | null): string {
  if (!rating) return 'b-grey';
  const g = rating.trim().toUpperCase()[0];
  if (g === 'A') return 'b-green';
  if (g === 'B') return 'b-blue';
  if (g === 'C') return 'b-amber';
  if (g === 'D') return 'b-red';
  return 'b-grey';
}

function VendorDetailPage(): React.JSX.Element {
  const { id } = vendorDetailRoute.useParams();
  const navigate = useNavigate();
  const { data: vendor, isLoading, isError, error } = useVendor(id);
  const { data: me } = useSession();
  const softDelete = useSoftDeleteVendor();
  const [confirmDelete, setConfirmDelete] = useState(false);

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

  const onDelete = (): void => {
    softDelete.mutate(vendor.id, {
      onSuccess: () => {
        void navigate({ to: '/vendors', replace: true });
      },
    });
  };

  const canEdit = me?.role === 'admin' || me?.role === 'manager';
  const isAdmin = me?.role === 'admin';

  return (
    <div>
      <Link to="/vendors" className="btn btn-ghost btn-sm" style={{ marginBottom: 10 }}>
        <ArrowLeft size={14} /> Back to Vendor Master
      </Link>

      <div className="panel">
        <div className="panel-hdr">
          <div>
            <div
              className="td-code"
              style={{ color: 'var(--cyan)', fontSize: 16, fontWeight: 700 }}
            >
              {vendor.code}
            </div>
            <div className="panel-title" style={{ marginTop: 2 }}>
              {vendor.name}
            </div>
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            {canEdit ? (
              <Link
                to="/vendors/$id/edit"
                params={{ id: vendor.id }}
                className="btn btn-ghost btn-sm"
              >
                <Pencil size={13} /> Edit
              </Link>
            ) : null}
            {isAdmin ? (
              confirmDelete ? (
                <>
                  <span className="text3" style={{ fontSize: 12, alignSelf: 'center' }}>
                    Delete?
                  </span>
                  <button
                    type="button"
                    className="btn btn-danger btn-sm"
                    onClick={onDelete}
                    disabled={softDelete.isPending}
                  >
                    {softDelete.isPending ? (
                      <Loader2 size={13} className="animate-spin" />
                    ) : (
                      <Trash2 size={13} />
                    )}
                    Confirm
                  </button>
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    onClick={() => setConfirmDelete(false)}
                    disabled={softDelete.isPending}
                  >
                    Cancel
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  className="btn btn-danger btn-sm"
                  onClick={() => setConfirmDelete(true)}
                >
                  <Trash2 size={13} /> Delete
                </button>
              )
            ) : null}
          </div>
        </div>
        <div className="panel-body">
          {softDelete.isError ? (
            <div
              style={{
                color: 'var(--red)',
                background: 'var(--red3)',
                border: '1px solid #fca5a5',
                borderRadius: 6,
                padding: '6px 10px',
                fontSize: 12,
                marginBottom: 10,
              }}
            >
              {softDelete.error instanceof Error
                ? softDelete.error.message
                : 'Failed to delete vendor.'}
            </div>
          ) : null}
          <DetailGrid vendor={vendor} />
        </div>
      </div>
    </div>
  );
}

function DetailGrid(props: { vendor: Vendor }): React.JSX.Element {
  const { vendor } = props;
  return (
    <div className="form-grid">
      <Pair
        label="Status"
        value={
          <span className={`badge ${vendor.isActive ? 'b-green' : 'b-red'}`}>
            {vendor.isActive ? 'active' : 'inactive'}
          </span>
        }
      />
      <Pair
        label="Rating"
        value={
          <span className={`badge ${ratingBadgeClass(vendor.rating)}`}>
            ⭐ {vendor.rating ?? '—'}
          </span>
        }
      />
      <Pair label="Contact person" value={vendor.contactPerson ?? '—'} />
      <Pair label="Email" value={vendor.email ?? '—'} />
      <Pair label="Phone" value={vendor.phone ?? '—'} />
      <Pair label="GST number" value={vendor.gstNumber ?? '—'} />
      <Pair label="City" value={vendor.city ?? '—'} />
      <Pair label="State" value={vendor.state ?? '—'} />
      <Pair label="Pincode" value={vendor.pincode ?? '—'} />
      <div className="form-grp form-full">
        <span className="form-label">Materials supplied</span>
        <div style={{ whiteSpace: 'pre-wrap' }}>{vendor.materialsSupplied ?? '—'}</div>
      </div>
      <div className="form-grp form-full">
        <span className="form-label">Address</span>
        <div style={{ whiteSpace: 'pre-wrap' }}>{vendor.addressLine1 ?? '—'}</div>
      </div>
    </div>
  );
}

function Pair(props: { label: string; value: string | React.ReactNode }): React.JSX.Element {
  return (
    <div className="form-grp">
      <span className="form-label">{props.label}</span>
      <div style={{ fontWeight: 600 }}>{props.value}</div>
    </div>
  );
}
