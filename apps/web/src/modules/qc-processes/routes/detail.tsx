import { Link, createRoute, useNavigate } from '@tanstack/react-router';
import { ArrowLeft, Loader2, Pencil, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { effectiveFormPerms, useMyAccess } from '@/lib/access-control';
import { authenticatedRoute } from '@/routes/_authenticated';
import { useQcProcess, useSoftDeleteQcProcess } from '../api';

export const qcProcessDetailRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: 'qc-processes/$id',
  component: QcProcessDetailPage,
});

function QcProcessDetailPage(): React.JSX.Element {
  const { id } = qcProcessDetailRoute.useParams();
  const navigate = useNavigate();
  const { data, isLoading, isError, error } = useQcProcess(id);
  const softDelete = useSoftDeleteQcProcess();
  const [confirmDelete, setConfirmDelete] = useState(false);

  // Tier-driven, matching the list and the new/edit routes. Delete is not one
  // of the four tier actions, so "L5 Department Admin and above" is expressed
  // as the pair only L5/L6 hold: L3 Editor has edit without approve, L4
  // Approver has approve without edit. Previously both buttons shared one
  // admin/manager flag, so an editor could delete and a QC lead could not edit.
  const { data: eff } = useMyAccess();
  const perms = effectiveFormPerms(eff, 'qcprocess_create');
  const canEdit = perms.edit;
  const canDelete = perms.edit && perms.approve;

  if (isLoading) {
    return (
      <div>
        <Loader2 className="inline h-4 w-4 animate-spin" /> Loading QC process…
      </div>
    );
  }
  if (isError || !data) {
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

  // "Hide page" (Access Control → Config): once access has loaded, a user whose
  // VIEW was removed for this page sees the no-access panel, not the page. `eff`
  // is undefined only while access loads — don't block then, or every legitimate
  // user flashes this panel on cold load.
  if (eff && !perms.view) {
    return (
      <div className="empty-state" style={{ color: 'var(--amber)', padding: 40 }}>
        ⛔ This page is hidden for your access. Ask an admin if you need access to it.
      </div>
    );
  }

  const onDelete = (): void => {
    softDelete.mutate(data.id, {
      onSuccess: () => {
        void navigate({ to: '/qc-processes', replace: true });
      },
    });
  };

  return (
    <div>
      <Link to="/qc-processes" className="btn btn-ghost btn-sm" style={{ marginBottom: 10 }}>
        <ArrowLeft size={14} /> Back to QC Process Master
      </Link>
      <div className="panel">
        <div className="panel-hdr">
          <div>
            <div className="fw-700" style={{ color: 'var(--green)', fontSize: 16 }}>
              {data.code}
            </div>
            <div
              className="panel-title"
              style={{ marginTop: 2, display: 'flex', alignItems: 'center', gap: 8 }}
            >
              ⚙ QC Process
              <span className={`badge ${data.isActive ? 'b-green' : 'b-amber'}`}>
                {data.isActive ? 'Active' : 'Inactive'}
              </span>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            {canEdit ? (
              <Link
                to="/qc-processes/$id/edit"
                params={{ id: data.id }}
                className="btn btn-ghost btn-sm"
              >
                <Pencil size={13} /> Edit
              </Link>
            ) : null}
            {canDelete ? (
              confirmDelete ? (
                <>
                  <span className="text3" style={{ fontSize: 12 }}>
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
                : 'Failed to delete QC process.'}
            </div>
          ) : null}
          <div className="form-grid form-grid-3">
            <div className="form-grp form-full">
              <span className="form-label">Description</span>
              <div style={{ whiteSpace: 'pre-wrap' }}>{data.description ?? '—'}</div>
            </div>
            <div className="form-grp">
              <span className="form-label">Default cycle time (minutes)</span>
              <div className="mono fw-700">
                {Number(data.defaultCycleTimeMin) > 0
                  ? Number(data.defaultCycleTimeMin).toFixed(2)
                  : '—'}
              </div>
            </div>
            <div className="form-grp">
              <span className="form-label">Status</span>
              <div className="fw-700">{data.isActive ? 'Active' : 'Inactive'}</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
