// NC edit route (UI-003-06). Editable only while status='pending'.

import { NC_STATUS_LABELS, type UpdateNcRegisterInput } from '@innovic/shared';
import { Link, createRoute, useNavigate } from '@tanstack/react-router';
import { ArrowLeft, Loader2 } from 'lucide-react';
import { useCallback, useState } from 'react';
import { effectiveFormPerms, useMyAccess } from '@/lib/access-control';
import { useExitConfirm } from '@/lib/exit-guard';
import { authenticatedRoute } from '@/routes/_authenticated';
import { useNcRegister, useUpdateNcRegister } from '../api';
import { NcRegisterForm } from '../components/nc-register-form';

export const ncRegisterEditRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: 'nc-register/$id/edit',
  component: NcRegisterEditPage,
});

function NcRegisterEditPage(): React.JSX.Element {
  const { id } = ncRegisterEditRoute.useParams();
  const navigate = useNavigate();
  const { data: detail, isLoading, isError, error } = useNcRegister(id);
  const update = useUpdateNcRegister(id);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const goBack = useCallback(
    () => void navigate({ to: '/nc-register/$id', params: { id } }),
    [navigate, id],
  );
  const exit = useExitConfirm({ onExit: goBack });
  // Tier-driven, per department (QC). This screen had no gate at all — typing
  // the URL handed the form to anyone, including an L1 Viewer, an L2 Data Entry
  // hand (who may raise an NC but not rewrite a saved one) and an L4 Approver.
  const { data: eff, isLoading: accessLoading } = useMyAccess();
  const perms = effectiveFormPerms(eff, 'nc_dispose');

  if (isLoading || accessLoading) {
    return (
      <div>
        <Loader2 className="inline h-4 w-4 animate-spin" /> Loading NC…
      </div>
    );
  }

  if (!perms.edit) {
    return (
      <div className="panel">
        <div className="panel-body">
          <div style={{ marginBottom: 8 }}>
            <Link to="/nc-register/$id" params={{ id }} className="btn btn-ghost btn-sm">
              <ArrowLeft size={14} /> Back to NC
            </Link>
          </div>
          <div className="empty-state" style={{ color: 'var(--amber2)' }}>
            You do not have permission to edit this NC. Ask an admin.
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
            <Link to="/nc-register" className="btn btn-ghost btn-sm">
              <ArrowLeft size={14} /> Back
            </Link>
          </div>
          <div className="empty-state" style={{ color: 'var(--red2)' }}>
            {error instanceof Error ? error.message : 'NC not found. Refresh the page.'}
          </div>
        </div>
      </div>
    );
  }

  if (detail.status !== 'pending') {
    return (
      <div>
        <Link
          to="/nc-register/$id"
          params={{ id: detail.id }}
          className="btn btn-ghost btn-sm"
          style={{ marginBottom: 10 }}
        >
          <ArrowLeft size={14} /> Back to {detail.code}
        </Link>
        <div className="panel">
          <div className="panel-hdr">
            <div>
              <div className="panel-title">Cannot edit a {NC_STATUS_LABELS[detail.status]} NC</div>
              <div className="text3" style={{ fontSize: 11, marginTop: 2 }}>
                Only NC Raised NCs can be edited.
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div>
      {exit.dialog}
      <Link
        to="/nc-register/$id"
        params={{ id: detail.id }}
        className="btn btn-ghost btn-sm"
        style={{ marginBottom: 10 }}
      >
        <ArrowLeft size={14} /> Back to {detail.code}
      </Link>
      <div className="panel">
        <div className="panel-hdr">
          <div>
            <div
              className="td-code"
              style={{ color: 'var(--cyan)', fontSize: 14, fontWeight: 700 }}
            >
              {detail.code}
            </div>
            <div className="panel-title" style={{ marginTop: 2 }}>
              Edit NC
            </div>
            <div className="text3" style={{ fontSize: 11, marginTop: 2 }}>
              Only NC Date, Reason Category, Defect Description and Reported By can be changed.
            </div>
          </div>
        </div>
        <div className="panel-body">
          <NcRegisterForm
            mode="edit"
            detail={detail}
            submitError={submitError}
            submitLabel="Save Changes"
            onCancel={() => exit.leave(goBack)}
            onSubmit={async (values: UpdateNcRegisterInput) => {
              setSubmitError(null);
              try {
                await update.mutateAsync(values);
                exit.leave(goBack);
              } catch (e) {
                setSubmitError(e instanceof Error ? e.message : 'Could not save NC. Try again.');
              }
            }}
          />
        </div>
      </div>
    </div>
  );
}
