// QC Process Master detail page. Group-4 migration onto the primitives,
// following the approved DETAIL exemplar (modules/vendors/routes/detail.tsx):
//
//   ← Back to QC Process Master
//   DetailHeader (name + "⚙ QC Process" + Active chip + Edit/Delete) → ReadGrid
//
// A QC process is a flat 4-field master — no line table, no related-document
// query — so the composition stops at the header panel. Markup only: the
// hand-rolled panel-hdr, the inline "Delete? [Confirm][Cancel]" swap and the
// hand-styled red error box are gone. Route, query hooks, the
// `qcprocess_create` permission expression and the soft-delete call are
// untouched.
//
// `code` IS THE NAME the user types and reads (schemas/qc-process.ts: the
// Drizzle column is `code`, the UI has always labelled it "QC Process Name"),
// so it is what DetailHeader prints as the document code, with the screen's
// own "⚙ QC Process" line under it exactly as before.
//
// THE ACTIVE CHIP is `StatusBadge kind="masteractive"` — green / AMBER, the
// colours this screen and its list have always drawn, NOT the generic
// `active` map's green / red. A retired QC process is a row taken out of the
// pickers, which the quality desk reads as something to notice; painting it
// red here would change what the colour means on this page and would put the
// chip at odds with qc-processes/routes/list.tsx, which paints the same amber.
//
// FIELD SIZES — ReadGrid is the same 12-column grid as the edit form's
// FormGrid, and each ReadField carries the size that field has in
// qc-process-form.tsx:
//
//   Description full                                    → 12
//   Default Cycle Time (min) lg · Active lg             → 6 + 6 = 12
//
// Active keeps its own cell here, unlike the sibling masters, because cycle
// time is the only other fact on the page and a row must sum to 12 — and
// because the edit form puts exactly these two side by side in one row.

import type { QcProcess } from '@innovic/shared';
import { Link, createRoute, useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import { effectiveFormPerms, useMyAccess } from '@/lib/access-control';
import { authenticatedRoute } from '@/routes/_authenticated';
import { Button, Icon, StatusBadge } from '@/ui/core';
import { ConfirmDialog } from '@/ui/feedback';
import { DetailHeader, PageState, ReadField, ReadGrid } from '@/ui/layout';
import { useQcProcess, useSoftDeleteQcProcess } from '../api';

export const qcProcessDetailRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: 'qc-processes/$id',
  component: QcProcessDetailPage,
});

const BACK_LABEL = 'Back to QC Process Master';

/** DetailHeader draws this one itself (`backTo` + `renderLink`). The error
 *  state has no header to hang it on, so it renders the same control on its
 *  own — and it stays a real <Link>, because a button + navigate() cannot be
 *  middle-clicked, ctrl-clicked or opened in a new tab. */
function BackToMaster(): React.JSX.Element {
  return (
    <Link
      to="/qc-processes"
      className="btn btn-ghost btn-sm"
      style={{ marginBottom: 'var(--sp-2)' }}
    >
      <Icon name="arrow-left" size={14} /> {BACK_LABEL}
    </Link>
  );
}

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
    return <PageState state="loading" message="⟳ Loading QC process…" />;
  }

  if (isError || !data) {
    return (
      <div>
        <BackToMaster />
        <PageState
          state="error"
          message={error instanceof Error ? error.message : 'QC process not found'}
        />
      </div>
    );
  }

  // "Hide page" (Access Control → Config): once access has loaded, a user whose
  // VIEW was removed for this page sees the no-access panel, not the page. `eff`
  // is undefined only while access loads — don't block then, or every legitimate
  // user flashes this panel on cold load.
  if (eff && !perms.view) {
    return <PageState state="noaccess" as="page" />;
  }

  // `mutateAsync`, not `mutate` + onSuccess: ConfirmDialog keeps both buttons
  // disabled while this promise runs, so a second Confirm cannot fire a second
  // delete, and a rejection is shown IN the dialog instead of closing it.
  const onDelete = async (): Promise<void> => {
    await softDelete.mutateAsync(data.id);
    setConfirmDelete(false);
    await navigate({ to: '/qc-processes', replace: true });
  };

  const deleteError = softDelete.isError
    ? softDelete.error instanceof Error
      ? softDelete.error.message
      : 'Failed to delete QC process.'
    : null;

  return (
    <div>
      <DetailHeader
        backTo="/qc-processes"
        backLabel={BACK_LABEL}
        renderLink={(p) => <Link {...p} />}
        code={data.code}
        name="⚙ QC Process"
        badges={<StatusBadge kind="masteractive" status={String(data.isActive)} />}
        actions={
          <>
            {canEdit ? (
              <Link
                to="/qc-processes/$id/edit"
                params={{ id: data.id }}
                className="btn btn-ghost btn-sm"
              >
                <Icon name="pencil" size={13} /> Edit
              </Link>
            ) : null}
            {canDelete ? (
              <Button
                variant="danger"
                size="sm"
                icon={<Icon name="trash-2" size={13} />}
                onClick={() => setConfirmDelete(true)}
              >
                Delete
              </Button>
            ) : null}
          </>
        }
      >
        <QcProcessFacts qcProcess={data} />
      </DetailHeader>

      {confirmDelete ? (
        <ConfirmDialog
          title={`Delete QC process ${data.code}?`}
          message="It will be removed from the QC Process Master and from the QC operation pickers."
          confirmLabel="Delete"
          pendingLabel="Deleting…"
          onConfirm={onDelete}
          onCancel={() => setConfirmDelete(false)}
          errorText={deleteError}
        />
      ) : null}
    </div>
  );
}

function QcProcessFacts(props: { qcProcess: QcProcess }): React.JSX.Element {
  const { qcProcess } = props;
  // numeric(8,2) arrives as a string. Zero means "not set" on this master, and
  // an unset value is the em dash ReadField draws for a null — not a "0.00"
  // that reads as a measured cycle time.
  const cycleMin = Number(qcProcess.defaultCycleTimeMin);
  return (
    <ReadGrid>
      <ReadField label="Description" size="full" pre value={qcProcess.description} />

      <ReadField
        label="Default Cycle Time (min)"
        size="lg"
        mono
        value={cycleMin > 0 ? cycleMin.toFixed(2) : null}
      />
      <ReadField label="Active" size="lg" value={qcProcess.isActive ? 'Active' : 'Inactive'} />
    </ReadGrid>
  );
}
