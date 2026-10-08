// Operator new + edit routes (UI-003-03).

import type { CreateOperatorInput, UpdateOperatorInput } from '@innovic/shared';
import { Link, createRoute, useNavigate } from '@tanstack/react-router';
import { ArrowLeft, Loader2 } from 'lucide-react';
import { useCallback, useState } from 'react';
import { useExitConfirm } from '@/lib/exit-guard';
import { useEditConflict } from '@/lib/use-edit-conflict';
import { useSaveKey } from '@/lib/use-save-key';
import { effectiveFormPerms, useMyAccess } from '@/lib/access-control';
import { isStagedResult } from '@/modules/document-edits/api';
import { Banner } from '@/ui/feedback';
import { authenticatedRoute } from '@/routes/_authenticated';
import { useCreateOperator, useFetchOperator, useOperator, useUpdateOperator } from '../api';
import { OperatorForm } from '../components/operator-form';

// ADR-226 — the fields THIS screen can edit, and what the user calls each one.
//
// The list drives two things: the save sends only the ones whose value actually
// changed, and a notice names the field another person moved. It is written out
// rather than inferred: `code` is read-only on the edit form (the help text says
// so, and updateOperatorInputSchema omits it), and the operator record also
// carries the audit columns, which are nobody's edit.
//
// The Excel bulk import writes the same columns but is not this screen; it has
// its own whole-sheet request and no conflict notice.
const OPERATOR_EDITABLE = ['name', 'department', 'skills', 'isActive', 'userId'] as const;

// The screen's own labels, so a notice reads "Skills / Machines", never
// `skills`. No row exists in docs/NAMING.md for any of the five; these are the
// labels already on this form.
const OPERATOR_LABELS: Record<string, string> = {
  name: 'Name',
  department: 'Department',
  skills: 'Skills / Machines',
  isActive: 'Active',
  userId: 'Linked User',
};

export const operatorNewRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: 'operators/new',
  component: OperatorNewPage,
});

export const operatorEditRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: 'operators/$id/edit',
  component: OperatorEditPage,
});

function OperatorNewPage(): React.JSX.Element {
  const navigate = useNavigate();
  const saveKey = useSaveKey();
  const create = useCreateOperator(saveKey);
  const [submitError, setSubmitError] = useState<string | null>(null);
  // Tier gate (operator_create sits in Production). The list's Add button is
  // hidden without entry rights, but this URL-reachable form had no gate of its
  // own. The server refuses the save either way; this stops the form appearing.
  const { data: eff, isLoading: accessLoading } = useMyAccess();
  const perms = effectiveFormPerms(eff, 'operator_create');
  const goBack = useCallback(() => void navigate({ to: '/operators' }), [navigate]);
  const exit = useExitConfirm({ onExit: goBack });

  const onSubmit = async (values: CreateOperatorInput): Promise<void> => {
    setSubmitError(null);
    try {
      const created = await create.mutateAsync(values);
      exit.leave(
        () => void navigate({ to: '/operators/$id', params: { id: created.id }, replace: true }),
      );
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'Could not save Operator. Try again.');
    }
  };

  if (accessLoading) {
    return (
      <div>
        <Loader2 className="inline h-4 w-4 animate-spin" /> Loading…
      </div>
    );
  }

  if (!perms.entry) {
    return (
      <div className="panel">
        <div className="panel-body">
          <div style={{ marginBottom: 8 }}>
            <Link to="/operators" className="btn btn-ghost btn-sm">
              <ArrowLeft size={14} /> Back
            </Link>
          </div>
          <div className="empty-state" style={{ color: 'var(--amber2)' }}>
            ⛔ You do not have create access to Operator Master. Ask an admin for L2 Data Entry or
            above in Production.
          </div>
        </div>
      </div>
    );
  }

  return (
    <div>
      {exit.dialog}
      <Link to="/operators" className="btn btn-ghost btn-sm" style={{ marginBottom: 10 }}>
        <ArrowLeft size={14} /> Back
      </Link>
      <div className="panel">
        <div className="panel-hdr">
          <div>
            <div className="panel-title">+ Add Operator</div>
          </div>
        </div>
        <div className="panel-body">
          <OperatorForm
            mode="create"
            onSubmit={onSubmit}
            submitError={submitError}
            onCancel={() => exit.leave(goBack)}
          />
        </div>
      </div>
    </div>
  );
}

function OperatorEditPage(): React.JSX.Element {
  const { id } = operatorEditRoute.useParams();
  const navigate = useNavigate();
  // Tier gate — editing a saved operator needs `edit` (L3 Editor and up).
  const { data: eff, isLoading: accessLoading } = useMyAccess();
  const canEdit = effectiveFormPerms(eff, 'operator_create').edit;
  const { data: operator, isLoading, isError, error } = useOperator(canEdit ? id : undefined);
  const update = useUpdateOperator(id);
  const fetchOperator = useFetchOperator();
  // ADR-226 / §20.4 — sends only what changed, merges onto someone else's save
  // instead of overwriting it, and raises the 3-second notice. Also subscribes
  // to this one operator, so the user is told the moment somebody else saves it
  // rather than after they have typed into a stale form.
  const conflict = useEditConflict({
    table: 'operators',
    id,
    record: operator,
    refetch: () => fetchOperator(id),
    editableKeys: OPERATOR_EDITABLE,
    label: (f) => OPERATOR_LABELS[f] ?? f,
    noun: 'operator',
  });
  const [submitError, setSubmitError] = useState<string | null>(null);
  // ADR-202 — set when an edit to a LIVE operator is staged for approval instead
  // of applied; the neutral "Sent for approval" banner shows it.
  const [stagedNotice, setStagedNotice] = useState<string | null>(null);

  const goBack = useCallback(
    () => void navigate({ to: '/operators/$id', params: { id } }),
    [navigate, id],
  );
  const exit = useExitConfirm({ onExit: goBack });

  const onSubmit = async (values: UpdateOperatorInput): Promise<void> => {
    setSubmitError(null);
    try {
      // Only the fields that actually moved are sent; a 409 re-reads and retries
      // onto the fresh row instead of overwriting someone else's change.
      const result = await conflict.save(values, (payload, expectedUpdatedAt) =>
        update.mutateAsync({ ...payload, expectedUpdatedAt }),
      );
      // null = nothing actually changed; the user has been told and nothing was
      // written. Stay on the form.
      if (result === null) return;
      if (isStagedResult(result)) {
        // The edit-approval gate is on and this operator is live: nothing was
        // changed on the operator — the edit is now waiting for approval. Say so,
        // then return to the operator (its fields now carry the pending chip).
        setStagedNotice('Sent for approval — your changes will apply once an approver signs off.');
      }
      exit.leave(() => void navigate({ to: '/operators/$id', params: { id }, replace: true }));
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'Could not save Operator. Try again.');
    }
  };

  if (accessLoading) {
    return (
      <div>
        <Loader2 className="inline h-4 w-4 animate-spin" /> Loading…
      </div>
    );
  }

  if (!canEdit) {
    return (
      <div className="panel">
        <div className="panel-body">
          <div style={{ marginBottom: 8 }}>
            <Link to="/operators" className="btn btn-ghost btn-sm">
              <ArrowLeft size={14} /> Back
            </Link>
          </div>
          <div className="empty-state" style={{ color: 'var(--amber2)' }}>
            ⛔ You do not have edit access to Operator Master. Ask an admin for L3 Editor or above in
            Production.
          </div>
        </div>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div>
        <Loader2 className="inline h-4 w-4 animate-spin" /> Loading operator…
      </div>
    );
  }

  if (isError || !operator) {
    return (
      <div className="panel">
        <div className="panel-body">
          <div style={{ marginBottom: 8 }}>
            <Link to="/operators" className="btn btn-ghost btn-sm">
              <ArrowLeft size={14} /> Back
            </Link>
          </div>
          <div className="empty-state" style={{ color: 'var(--red2)' }}>
            {error instanceof Error ? error.message : 'Operator not found.'}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div>
      {exit.dialog}
      <Link
        to="/operators/$id"
        params={{ id }}
        className="btn btn-ghost btn-sm"
        style={{ marginBottom: 10 }}
      >
        <ArrowLeft size={14} /> Back
      </Link>
      {stagedNotice ? (
        <Banner tone="success" role="status">
          {stagedNotice}
        </Banner>
      ) : null}
      <div className="panel">
        <div className="panel-hdr">
          <div>
            <div
              className="td-code"
              style={{ color: 'var(--cyan)', fontSize: 14, fontWeight: 700 }}
            >
              {operator.code}
            </div>
            <div className="panel-title" style={{ marginTop: 2 }}>
              Edit Operator
            </div>
          </div>
        </div>
        <div className="panel-body">
          <OperatorForm
            mode="edit"
            operator={operator}
            onSubmit={onSubmit}
            submitError={submitError}
            onCancel={() => exit.leave(goBack)}
          />
        </div>
      </div>
    </div>
  );
}
