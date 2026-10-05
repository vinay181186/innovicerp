import type { UpdateTpiMasterInput } from '@innovic/shared';
import { Link, createRoute, useNavigate } from '@tanstack/react-router';
import { ArrowLeft, Loader2 } from 'lucide-react';
import { useCallback, useState } from 'react';
import { effectiveFormPerms, useMyAccess } from '@/lib/access-control';
import { useExitConfirm } from '@/lib/exit-guard';
import { isStagedResult } from '@/modules/document-edits/api';
import { Banner } from '@/ui/feedback';
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
  // ADR-202 — set when an edit to a LIVE inspector is staged for approval
  // instead of applied; the neutral "Sent for approval" banner shows it.
  const [stagedNotice, setStagedNotice] = useState<string | null>(null);
  const goBack = useCallback(
    () => void navigate({ to: '/tpi-masters/$id', params: { id } }),
    [navigate, id],
  );
  const exit = useExitConfirm({ onExit: goBack });
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
          <div className="empty-state" style={{ color: 'var(--amber2)' }}>
            ⛔ You do not have permission to edit an Inspector. Ask an admin.
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
          <div className="empty-state" style={{ color: 'var(--red2)' }}>
            {error instanceof Error ? error.message : 'Inspector not found.'}
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
            <div className="fw-700" style={{ color: 'var(--green2)', fontSize: 14 }}>
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
            submitLabel="Save Changes"
            onCancel={() => exit.leave(goBack)}
            onSubmit={async (values: UpdateTpiMasterInput) => {
              setSubmitError(null);
              try {
                const saved = await update.mutateAsync(values);
                if (isStagedResult(saved)) {
                  // The edit-approval gate is on and this inspector is live:
                  // nothing was changed — the edit is now waiting for approval.
                  // Say so, then return to the detail page (its fields carry the
                  // pending-change chip).
                  setStagedNotice(
                    'Sent for approval — your changes will apply once an approver signs off.',
                  );
                  exit.leave(goBack);
                  return;
                }
                exit.leave(goBack);
              } catch (e) {
                setSubmitError(
                  e instanceof Error ? e.message : 'Could not save Inspector. Try again.',
                );
              }
            }}
          />
        </div>
      </div>
    </div>
  );
}
