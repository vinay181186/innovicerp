import type { UpdateQcProcessInput } from '@innovic/shared';
import { Link, createRoute, useNavigate } from '@tanstack/react-router';
import { ArrowLeft, Loader2 } from 'lucide-react';
import { useCallback, useState } from 'react';
import { effectiveFormPerms, useMyAccess } from '@/lib/access-control';
import { useExitConfirm } from '@/lib/exit-guard';
import { useEditConflict } from '@/lib/use-edit-conflict';
import { isStagedResult } from '@/modules/document-edits/api';
import { Banner } from '@/ui/feedback';
import { authenticatedRoute } from '@/routes/_authenticated';
import { useFetchQcProcess, useQcProcess, useUpdateQcProcess } from '../api';
import { QcProcessForm } from '../components/qc-process-form';

// ADR-225 — the fields THIS screen can edit, and what the user calls each one.
//
// The list drives two things: the save sends only the ones whose value actually
// changed, and a notice names the field another person moved. It is written out
// rather than inferred: `code` IS the QC Process Name and is permanent — the box
// is read-only on edit and updateQcProcessInputSchema omits it outright — and
// the record also carries the audit columns, which are nobody's edit.
const QC_PROCESS_EDITABLE = ['description', 'defaultCycleTimeMin', 'isActive'] as const;

// The screen's own labels, so a notice reads "Default Cycle Time (min)", never
// `defaultCycleTimeMin`. No row exists in docs/NAMING.md for any of the three;
// these are the labels already on this form, and "Description" matches the
// Sort & Filter column label the API already serves for this master.
const QC_PROCESS_LABELS: Record<string, string> = {
  description: 'Description',
  defaultCycleTimeMin: 'Default Cycle Time (min)',
  isActive: 'Active',
};

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
  const fetchQcProcess = useFetchQcProcess();
  // ADR-225 / §20.4 — sends only what changed, merges onto someone else's save
  // instead of overwriting it, and raises the 3-second notice. Also subscribes
  // to this one QC process, so the user is told the moment somebody else saves
  // it rather than after they have typed into a stale form.
  const conflict = useEditConflict({
    table: 'qc_processes',
    id,
    record: detail,
    refetch: () => fetchQcProcess(id),
    editableKeys: QC_PROCESS_EDITABLE,
    label: (f) => QC_PROCESS_LABELS[f] ?? f,
    noun: 'QC process',
  });
  const [submitError, setSubmitError] = useState<string | null>(null);
  // ADR-202 — set when an edit to a LIVE QC process is staged for approval
  // instead of applied; the neutral "Sent for approval" banner shows it.
  const [stagedNotice, setStagedNotice] = useState<string | null>(null);
  const goBack = useCallback(
    () => void navigate({ to: '/qc-processes/$id', params: { id } }),
    [navigate, id],
  );
  const exit = useExitConfirm({ onExit: goBack });
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
          <div className="empty-state" style={{ color: 'var(--amber2)' }}>
            ⛔ You do not have permission to edit a QC Process. Ask an admin.
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
          <div className="empty-state" style={{ color: 'var(--red2)' }}>
            {error instanceof Error ? error.message : 'QC Process not found.'}
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
            <div className="fw-700" style={{ color: 'var(--green2)', fontSize: 14 }}>
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
            submitLabel="Save Changes"
            onCancel={() => exit.leave(goBack)}
            onSubmit={async (values: UpdateQcProcessInput) => {
              setSubmitError(null);
              try {
                // Only the fields that actually moved are sent; a 409 re-reads
                // and retries onto the fresh row instead of overwriting someone
                // else's change.
                const saved = await conflict.save(values, (payload, expectedUpdatedAt) =>
                  update.mutateAsync({ ...payload, expectedUpdatedAt }),
                );
                // null = nothing actually changed; the user has been told and
                // nothing was written. Stay on the form.
                if (saved === null) return;
                if (isStagedResult(saved)) {
                  // The edit-approval gate is on and this QC process is live:
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
                  e instanceof Error ? e.message : 'Could not save QC Process. Try again.',
                );
              }
            }}
          />
        </div>
      </div>
    </div>
  );
}
