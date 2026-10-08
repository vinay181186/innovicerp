import type { UpdateCostCenterInput } from '@innovic/shared';
import { Link, createRoute, useNavigate } from '@tanstack/react-router';
import { ArrowLeft, Loader2 } from 'lucide-react';
import { useCallback, useState } from 'react';
import { effectiveFormPerms, useMyAccess } from '@/lib/access-control';
import { useExitConfirm } from '@/lib/exit-guard';
import { useEditConflict } from '@/lib/use-edit-conflict';
import { isStagedResult } from '@/modules/document-edits/api';
import { Banner } from '@/ui/feedback';
import { authenticatedRoute } from '@/routes/_authenticated';
import { useCostCenter, useFetchCostCenter, useUpdateCostCenter } from '../api';
import { CostCenterForm } from '../components/cost-center-form';

// ADR-225 — the fields THIS screen can edit, and what the user calls each one.
//
// The list drives two things: the save sends only the ones whose value actually
// changed, and a notice names the field another person moved. It is written out
// rather than inferred: the Cost Centre Code is read-only on edit and
// updateCostCenterInputSchema omits it outright, and the record also carries the
// audit columns, which are nobody's edit.
const COST_CENTER_EDITABLE = ['name', 'department', 'type', 'description', 'isActive'] as const;

// `Cost Centre Name` is the registered name (docs/NAMING.md, the 2026-09-30
// naming audit row for `cost_centers.name`) — never a bare "Name". The other
// four have no register row; these are the labels already on this form.
const COST_CENTER_LABELS: Record<string, string> = {
  name: 'Cost Centre Name',
  department: 'Department',
  type: 'Cost Centre Type',
  description: 'Description',
  isActive: 'Active',
};

export const costCenterEditRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: 'cost-centers/$id/edit',
  component: CostCenterEditPage,
});

function CostCenterEditPage(): React.JSX.Element {
  const { id } = costCenterEditRoute.useParams();
  const navigate = useNavigate();
  const { data: detail, isLoading, isError, error } = useCostCenter(id);
  const update = useUpdateCostCenter(id);
  const fetchCostCenter = useFetchCostCenter();
  // ADR-225 / §20.4 — sends only what changed, merges onto someone else's save
  // instead of overwriting it, and raises the 3-second notice. Also subscribes
  // to this one cost centre, so the user is told the moment somebody else saves
  // it rather than after they have typed into a stale form.
  const conflict = useEditConflict({
    table: 'cost_centers',
    id,
    record: detail,
    refetch: () => fetchCostCenter(id),
    editableKeys: COST_CENTER_EDITABLE,
    label: (f) => COST_CENTER_LABELS[f] ?? f,
    noun: 'cost centre',
  });
  const [submitError, setSubmitError] = useState<string | null>(null);
  // ADR-202 — set when an edit to a LIVE cost centre is staged for approval
  // instead of applied; the neutral "Sent for approval" banner shows it.
  const [stagedNotice, setStagedNotice] = useState<string | null>(null);
  const goBack = useCallback(
    () => void navigate({ to: '/cost-centers/$id', params: { id } }),
    [navigate, id],
  );
  const exit = useExitConfirm({ onExit: goBack });
  // Changing a saved record is `edit` on cc_create (Finance), so L2 Data Entry
  // (create-only) is correctly refused. Checked here too because the route is
  // reachable by URL, not just from the Edit button.
  const { data: eff } = useMyAccess();
  const perms = effectiveFormPerms(eff, 'cc_create');

  if (eff && !perms.edit) {
    return (
      <div className="empty-state" style={{ color: 'var(--amber2)', padding: 40 }}>
        You do not have permission to edit Cost Centres. Ask an admin.
      </div>
    );
  }

  if (isLoading) {
    return (
      <div>
        <Loader2 className="inline h-4 w-4 animate-spin" /> Loading cost centre…
      </div>
    );
  }
  if (isError || !detail) {
    return (
      <div className="panel">
        <div className="panel-body">
          <div style={{ marginBottom: 8 }}>
            <Link to="/cost-centers" className="btn btn-ghost btn-sm">
              <ArrowLeft size={14} /> Back
            </Link>
          </div>
          <div className="empty-state" style={{ color: 'var(--red2)' }}>
            {error instanceof Error ? error.message : 'Cost Centre not found. Refresh the page.'}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div>
      {exit.dialog}
      <Link
        to="/cost-centers/$id"
        params={{ id: detail.id }}
        className="btn btn-ghost btn-sm"
        style={{ marginBottom: 10 }}
      >
        <ArrowLeft size={14} /> Back to {detail.code}
      </Link>
      {stagedNotice ? (
        <Banner tone="success" role="status">
          {stagedNotice}
        </Banner>
      ) : null}
      <div className="panel">
        <div className="panel-hdr">
          <div>
            <div className="td-code fw-700" style={{ color: 'var(--cyan)', fontSize: 14 }}>
              {detail.code}
            </div>
            <div className="panel-title" style={{ marginTop: 2 }}>
              Edit Cost Centre
            </div>
          </div>
        </div>
        <div className="panel-body">
          <CostCenterForm
            mode="edit"
            detail={detail}
            submitError={submitError}
            submitLabel="Save Changes"
            onCancel={() => exit.leave(goBack)}
            onSubmit={async (values: UpdateCostCenterInput) => {
              setSubmitError(null);
              try {
                // Only the fields that actually moved are sent; a 409 re-reads
                // and retries onto the fresh row instead of overwriting someone
                // else's change.
                const result = await conflict.save(values, (payload, expectedUpdatedAt) =>
                  update.mutateAsync({ ...payload, expectedUpdatedAt }),
                );
                // null = nothing actually changed; the user has been told and
                // nothing was written. Stay on the form.
                if (result === null) return;
                if (isStagedResult(result)) {
                  // Gate on and this cost centre is live: nothing was changed —
                  // the edit is now waiting for approval. Say so, then return to
                  // the record (its fields now carry the pending chip).
                  setStagedNotice(
                    'Sent for approval — your changes will apply once an approver signs off.',
                  );
                }
                exit.leave(goBack);
              } catch (e) {
                setSubmitError(
                  e instanceof Error ? e.message : 'Could not save changes. Try again.',
                );
              }
            }}
          />
        </div>
      </div>
    </div>
  );
}
