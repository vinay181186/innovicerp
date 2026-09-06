import type { UpdateTpiMasterInput } from '@innovic/shared';
import { Link, createRoute, useNavigate } from '@tanstack/react-router';
import { ArrowLeft, Loader2 } from 'lucide-react';
import { useState } from 'react';
import { effectiveFormPerms, useMyAccess } from '@/lib/access-control';
import { authenticatedRoute } from '@/routes/_authenticated';
import { useTpiMaster, useUpdateTpiMaster } from '../api';
import { TpiMasterForm } from '../components/tpi-master-form';

export const tpiMasterEditRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: 'tpi-masters/$id/edit',
  component: TpiMasterEditPage,
});

function TpiMasterEditPage(): React.JSX.Element {
  const { id } = tpiMasterEditRoute.useParams();
  const navigate = useNavigate();
  const { data: detail, isLoading, isError, error } = useTpiMaster(id);
  const update = useUpdateTpiMaster(id);
  const [submitError, setSubmitError] = useState<string | null>(null);
  // Tier-driven, per department (QC) — without this the URL alone would hand
  // the form to an L1 Viewer or an L4 Approver, who deliberately cannot change
  // a saved record.
  const { data: eff, isLoading: accessLoading } = useMyAccess();
  const perms = effectiveFormPerms(eff, 'tpimaster_create');

  if (isLoading || accessLoading) {
    return (
      <div>
        <Loader2 className="inline h-4 w-4 animate-spin" /> Loading inspector…
      </div>
    );
  }

  if (!perms.edit) {
    return (
      <div className="panel">
        <div className="panel-body">
          <div style={{ marginBottom: 8 }}>
            <Link to="/tpi-masters" className="btn btn-ghost btn-sm">
              <ArrowLeft size={14} /> Back to TPI Master
            </Link>
          </div>
          <div className="empty-state" style={{ color: 'var(--amber)' }}>
            ⛔ You do not have edit access to TPI Master. Ask an admin for L3 Editor or above in QC.
          </div>
        </div>
      </div>
    );
  }
  if (isError || !detail) {
    return (
      <div className="panel">
        <div className="panel-body">
          <div style={{ marginBottom: 8 }}>
            <Link to="/tpi-masters" className="btn btn-ghost btn-sm">
              <ArrowLeft size={14} /> Back
            </Link>
          </div>
          <div className="empty-state" style={{ color: 'var(--red)' }}>
            {error instanceof Error ? error.message : 'Inspector not found'}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div>
      <Link
        to="/tpi-masters/$id"
        params={{ id: detail.id }}
        className="btn btn-ghost btn-sm"
        style={{ marginBottom: 10 }}
      >
        <ArrowLeft size={14} /> Back to {detail.code}
      </Link>
      <div className="panel">
        <div className="panel-hdr">
          <div>
            <div className="fw-700" style={{ color: 'var(--green)', fontSize: 14 }}>
              {detail.code}
            </div>
            <div className="panel-title" style={{ marginTop: 2 }}>
              ✏ Edit Inspector
            </div>
          </div>
        </div>
        <div className="panel-body">
          <TpiMasterForm
            mode="edit"
            detail={detail}
            submitError={submitError}
            submitLabel="Save"
            onCancel={() => void navigate({ to: '/tpi-masters/$id', params: { id: detail.id } })}
            onSubmit={async (values: UpdateTpiMasterInput) => {
              setSubmitError(null);
              try {
                await update.mutateAsync(values);
                void navigate({ to: '/tpi-masters/$id', params: { id: detail.id } });
              } catch (e) {
                setSubmitError(e instanceof Error ? e.message : 'Failed to save changes.');
              }
            }}
          />
        </div>
      </div>
    </div>
  );
}
