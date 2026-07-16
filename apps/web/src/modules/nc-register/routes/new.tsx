// Report NC route (UI-003-06).

import type { CreateNcRegisterInput } from '@innovic/shared';
import { Link, createRoute, useNavigate } from '@tanstack/react-router';
import { ArrowLeft } from 'lucide-react';
import { useState } from 'react';
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
