// NC edit route (UI-003-06). Editable only while status='pending'.

import { NC_STATUS_LABELS, type UpdateNcRegisterInput } from '@innovic/shared';
import { Link, createRoute, useNavigate } from '@tanstack/react-router';
import { ArrowLeft, Loader2 } from 'lucide-react';
import { useCallback, useState } from 'react';
import { isStagedResult } from '@/modules/document-edits/api';
import { effectiveFormPerms, useMyAccess } from '@/lib/access-control';
import { useExitConfirm } from '@/lib/exit-guard';
import { authenticatedRoute } from '@/routes/_authenticated';
import { Banner } from '@/ui/feedback';
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
  // ADR-202 — set when an edit to a LIVE NC is staged for approval instead of
  // applied; the neutral "Sent for approval" banner shows it.
  const [stagedNotice, setStagedNotice] = useState<string | null>(null);
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
      {stagedNotice ? (
        <Banner tone="success" role="status">
          {stagedNotice}
        </Banner>
      ) : null}
      <NcRegisterForm
        mode="edit"
        title={`Edit NC — ${detail.code}`}
        subtitle="Only NC Date, Reason Category, Defect Description and Reported By can be changed."
        backLabel={`Back to ${detail.code}`}
        onBack={() => exit.leave(goBack)}
        detail={detail}
        submitError={submitError}
        submitLabel="Save Changes"
        onCancel={() => exit.leave(goBack)}
        onSubmit={async (values: UpdateNcRegisterInput) => {
          setSubmitError(null);
          try {
            const saved = await update.mutateAsync(values);
            if (isStagedResult(saved)) {
              // Edit-approval gate is on and this NC is live: nothing changed on
              // the NC — the edit is waiting for approval. Say so, then return to
              // the NC (its fields now carry the pending-change chip).
              setStagedNotice(
                'Sent for approval — your changes will apply once an approver signs off.',
              );
              exit.leave(
                () => void navigate({ to: '/nc-register/$id', params: { id }, replace: true }),
              );
              return;
            }
            exit.leave(goBack);
          } catch (e) {
            setSubmitError(e instanceof Error ? e.message : 'Could not save NC. Try again.');
          }
        }}
      />
    </div>
  );
}
