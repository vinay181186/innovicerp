import type { UpdateQcProcessInput } from '@innovic/shared';
import { Link, createRoute, useNavigate } from '@tanstack/react-router';
import { ArrowLeft, Loader2 } from 'lucide-react';
import { useState } from 'react';
import { effectiveFormPerms, useMyAccess } from '@/lib/access-control';
import { authenticatedRoute } from '@/routes/_authenticated';
import { useQcProcess, useUpdateQcProcess } from '../api';
import { QcProcessForm } from '../components/qc-process-form';

export const qcProcessEditRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: 'qc-processes/$id/edit',
  component: QcProcessEditPage,
});

function QcProcessEditPage(): React.JSX.Element {
  const { id } = qcProcessEditRoute.useParams();
  const navigate = useNavigate();
  const { data: detail, isLoading, isError, error } = useQcProcess(id);
  const update = useUpdateQcProcess(id);
  const [submitError, setSubmitError] = useState<string | null>(null);
  // Tier-driven, per department (QC). This screen had no gate at all — typing
  // the URL handed the form to anyone, including an L1 Viewer and an L4
  // Approver, who deliberately cannot change a saved record.
  const { data: eff, isLoading: accessLoading } = useMyAccess();
  const perms = effectiveFormPerms(eff, 'qcprocess_create');

  if (isLoading || accessLoading) {
    return (
      <div>
        <Loader2 className="inline h-4 w-4 animate-spin" /> Loading QC process…
      </div>
    );
  }

  if (!perms.edit) {
    return (
      <div className="panel">
        <div className="panel-body">
          <div style={{ marginBottom: 8 }}>
            <Link to="/qc-processes" className="btn btn-ghost btn-sm">
              <ArrowLeft size={14} /> Back to QC Process Master
            </Link>
          </div>
          <div className="empty-state" style={{ color: 'var(--amber)' }}>
            ⛔ You do not have edit access to QC Process Master. Ask an admin for L3 Editor or above
            in QC.
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
            <Link to="/qc-processes" className="btn btn-ghost btn-sm">
              <ArrowLeft size={14} /> Back
            </Link>
          </div>
          <div className="empty-state" style={{ color: 'var(--red)' }}>
            {error instanceof Error ? error.message : 'QC process not found'}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div>
      <Link
        to="/qc-processes/$id"
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
              ✏ Edit QC Process
            </div>
          </div>
        </div>
        <div className="panel-body">
          <QcProcessForm
            mode="edit"
            detail={detail}
            submitError={submitError}
            submitLabel="Save"
            onCancel={() => void navigate({ to: '/qc-processes/$id', params: { id: detail.id } })}
            onSubmit={async (values: UpdateQcProcessInput) => {
              setSubmitError(null);
              try {
                await update.mutateAsync(values);
                void navigate({ to: '/qc-processes/$id', params: { id: detail.id } });
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
