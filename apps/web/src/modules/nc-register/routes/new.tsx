// Report NC route (UI-003-06).

import type { CreateNcRegisterInput } from '@innovic/shared';
import { Link, createRoute, useNavigate } from '@tanstack/react-router';
import { ArrowLeft, Loader2 } from 'lucide-react';
import { useState } from 'react';
import { effectiveFormPerms, useMyAccess } from '@/lib/access-control';
import { authenticatedRoute } from '@/routes/_authenticated';
import { useCreateNcRegister } from '../api';
import { NcRegisterForm } from '../components/nc-register-form';

export const ncRegisterNewRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: 'nc-register/new',
  component: NcRegisterNewPage,
});

function NcRegisterNewPage(): React.JSX.Element {
  const navigate = useNavigate();
  const create = useCreateNcRegister();
  const [submitError, setSubmitError] = useState<string | null>(null);
  // Tier-driven, per department (QC). The ❌ Report NC button is hidden from
  // anyone without entry rights, but this screen had no gate of its own —
  // typing the URL still handed over the form (an L1 Viewer, an L4 Approver).
  const { data: eff, isLoading: accessLoading } = useMyAccess();
  const perms = effectiveFormPerms(eff, 'nc_dispose');

  if (accessLoading) {
    return (
      <div>
        <Loader2 className="inline h-4 w-4 animate-spin" /> Loading NC Register…
      </div>
    );
  }

  if (!perms.entry) {
    return (
      <div className="panel">
        <div className="panel-body">
          <div style={{ marginBottom: 8 }}>
            <Link to="/nc-register" className="btn btn-ghost btn-sm">
              <ArrowLeft size={14} /> Back to NC Register
            </Link>
          </div>
          <div className="empty-state" style={{ color: 'var(--amber)' }}>
            ⛔ You do not have create access to NC Register. Ask an admin for L2 Data Entry or above
            in QC.
          </div>
        </div>
      </div>
    );
  }

  return (
    <div>
      <Link to="/nc-register" className="btn btn-ghost btn-sm" style={{ marginBottom: 10 }}>
        <ArrowLeft size={14} /> Back to NC Register
      </Link>
      <div className="panel">
        <div className="panel-hdr">
          <div>
            <div className="panel-title">❌ Report Non-Conformance</div>
            <div className="text3" style={{ fontSize: 11, marginTop: 2 }}>
              Status starts as <span className="mono">pending</span> until disposition.
            </div>
          </div>
        </div>
        <div className="panel-body">
          <NcRegisterForm
            mode="create"
            submitError={submitError}
            submitLabel="Save"
            onCancel={() => void navigate({ to: '/nc-register' })}
            onSubmit={async (values: CreateNcRegisterInput) => {
              setSubmitError(null);
              try {
                const created = await create.mutateAsync(values);
                void navigate({ to: '/nc-register/$id', params: { id: created.id } });
              } catch (e) {
                setSubmitError(e instanceof Error ? e.message : 'Failed to report NC.');
              }
            }}
          />
        </div>
      </div>
    </div>
  );
}
