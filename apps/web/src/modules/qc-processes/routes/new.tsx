import type { CreateQcProcessInput } from '@innovic/shared';
import { Link, createRoute, useNavigate } from '@tanstack/react-router';
import { ArrowLeft, Loader2 } from 'lucide-react';
import { useState } from 'react';
import { effectiveFormPerms, useMyAccess } from '@/lib/access-control';
import { authenticatedRoute } from '@/routes/_authenticated';
import { useCreateQcProcess } from '../api';
import { QcProcessForm } from '../components/qc-process-form';

export const qcProcessNewRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: 'qc-processes/new',
  component: QcProcessNewPage,
});

function QcProcessNewPage(): React.JSX.Element {
  const navigate = useNavigate();
  const create = useCreateQcProcess();
  const [submitError, setSubmitError] = useState<string | null>(null);
  // Tier-driven, per department (QC). The + Add QC Process button is hidden
  // from anyone without entry rights, but this screen had no gate of its own —
  // typing the URL still handed over the create form (an L1 Viewer, an L4
  // Approver). The server refuses the save either way; this stops the form
  // appearing at all.
  const { data: eff, isLoading: accessLoading } = useMyAccess();
  const perms = effectiveFormPerms(eff, 'qcprocess_create');

  if (accessLoading) {
    return (
      <div>
        <Loader2 className="inline h-4 w-4 animate-spin" /> Loading QC process…
      </div>
    );
  }

  if (!perms.entry) {
    return (
      <div className="panel">
        <div className="panel-body">
          <div style={{ marginBottom: 8 }}>
            <Link to="/qc-processes" className="btn btn-ghost btn-sm">
              <ArrowLeft size={14} /> Back to QC Process Master
            </Link>
          </div>
          <div className="empty-state" style={{ color: 'var(--amber)' }}>
            ⛔ You do not have create access to QC Process Master. Ask an admin for L2 Data Entry or
            above in QC.
          </div>
        </div>
      </div>
    );
  }

  return (
    <div>
      <Link to="/qc-processes" className="btn btn-ghost btn-sm" style={{ marginBottom: 10 }}>
        <ArrowLeft size={14} /> Back to QC Process Master
      </Link>
      <div className="panel">
        <div className="panel-hdr">
          <div>
            <div className="panel-title">⚙ Add QC Process</div>
            <div className="text3" style={{ fontSize: 11, marginTop: 2 }}>
              Master record for QC inspection processes — reusable across Route Cards and Job Cards.
            </div>
          </div>
        </div>
        <div className="panel-body">
          <QcProcessForm
            mode="create"
            submitError={submitError}
            submitLabel="Save"
            onCancel={() => void navigate({ to: '/qc-processes' })}
            onSubmit={async (values: CreateQcProcessInput) => {
              setSubmitError(null);
              try {
                const created = await create.mutateAsync(values);
                void navigate({ to: '/qc-processes/$id', params: { id: created.id } });
              } catch (e) {
                setSubmitError(e instanceof Error ? e.message : 'Failed to create QC process.');
              }
            }}
          />
        </div>
      </div>
    </div>
  );
}
