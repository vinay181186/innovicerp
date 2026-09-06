import type { CreateTpiMasterInput } from '@innovic/shared';
import { Link, createRoute, useNavigate } from '@tanstack/react-router';
import { ArrowLeft, Loader2 } from 'lucide-react';
import { useState } from 'react';
import { effectiveFormPerms, useMyAccess } from '@/lib/access-control';
import { authenticatedRoute } from '@/routes/_authenticated';
import { useCreateTpiMaster } from '../api';
import { TpiMasterForm } from '../components/tpi-master-form';

export const tpiMasterNewRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: 'tpi-masters/new',
  component: TpiMasterNewPage,
});

function TpiMasterNewPage(): React.JSX.Element {
  const navigate = useNavigate();
  const create = useCreateTpiMaster();
  const [submitError, setSubmitError] = useState<string | null>(null);
  // Tier-driven, per department (QC). The + Add Inspector button is hidden from
  // anyone without entry rights; this gate stops the form appearing at all when
  // the URL is typed directly (an L1 Viewer, an L4 Approver).
  const { data: eff, isLoading: accessLoading } = useMyAccess();
  const perms = effectiveFormPerms(eff, 'tpimaster_create');

  if (accessLoading) {
    return (
      <div>
        <Loader2 className="inline h-4 w-4 animate-spin" /> Loading TPI Master…
      </div>
    );
  }

  if (!perms.entry) {
    return (
      <div className="panel">
        <div className="panel-body">
          <div style={{ marginBottom: 8 }}>
            <Link to="/tpi-masters" className="btn btn-ghost btn-sm">
              <ArrowLeft size={14} /> Back to TPI Master
            </Link>
          </div>
          <div className="empty-state" style={{ color: 'var(--amber)' }}>
            ⛔ You do not have create access to TPI Master. Ask an admin for L2 Data Entry or above
            in QC.
          </div>
        </div>
      </div>
    );
  }

  return (
    <div>
      <Link to="/tpi-masters" className="btn btn-ghost btn-sm" style={{ marginBottom: 10 }}>
        <ArrowLeft size={14} /> Back to TPI Master
      </Link>
      <div className="panel">
        <div className="panel-hdr">
          <div>
            <div className="panel-title">🔍 Add Inspector</div>
            <div className="text3" style={{ fontSize: 11, marginTop: 2 }}>
              Master record for third-party inspectors — the TPI screen&apos;s Inspector Name field
              picks from this list.
            </div>
          </div>
        </div>
        <div className="panel-body">
          <TpiMasterForm
            mode="create"
            submitError={submitError}
            submitLabel="Save"
            onCancel={() => void navigate({ to: '/tpi-masters' })}
            onSubmit={async (values: CreateTpiMasterInput) => {
              setSubmitError(null);
              try {
                const created = await create.mutateAsync(values);
                void navigate({ to: '/tpi-masters/$id', params: { id: created.id } });
              } catch (e) {
                setSubmitError(e instanceof Error ? e.message : 'Failed to create inspector.');
              }
            }}
          />
        </div>
      </div>
    </div>
  );
}
