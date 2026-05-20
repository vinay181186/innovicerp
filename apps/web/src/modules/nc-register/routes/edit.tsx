// NC edit route (UI-003-06). Editable only while status='pending'.

import type { UpdateNcRegisterInput } from '@innovic/shared';
import { Link, createRoute, useNavigate } from '@tanstack/react-router';
import { ArrowLeft, Loader2 } from 'lucide-react';
import { useState } from 'react';
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

  if (isLoading) {
    return (
      <div>
        <Loader2 className="inline h-4 w-4 animate-spin" /> Loading NC…
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
          <div className="empty-state" style={{ color: 'var(--red)' }}>
            {error instanceof Error ? error.message : 'NC not found'}
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
              <div className="panel-title">
                Cannot edit a {detail.status.replaceAll('_', ' ')} NC
              </div>
              <div className="text3" style={{ fontSize: 11, marginTop: 2 }}>
                Disposed and closed NCs are permanent records. Disposition workflow lives on the
                detail page.
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

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
            <div className="td-code" style={{ color: 'var(--cyan)', fontSize: 14, fontWeight: 700 }}>
              {detail.code}
            </div>
            <div className="panel-title" style={{ marginTop: 2 }}>
              Edit NC
            </div>
            <div className="text3" style={{ fontSize: 11, marginTop: 2 }}>
              Editable while status is <span className="mono">pending</span> — date / reason
              category / defect description / reporter only.
            </div>
          </div>
        </div>
        <div className="panel-body">
          <NcRegisterForm
            mode="edit"
            detail={detail}
            submitError={submitError}
            submitLabel="Save changes"
            onCancel={() => void navigate({ to: '/nc-register/$id', params: { id: detail.id } })}
            onSubmit={async (values: UpdateNcRegisterInput) => {
              setSubmitError(null);
              try {
                await update.mutateAsync(values);
                void navigate({ to: '/nc-register/$id', params: { id: detail.id } });
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
