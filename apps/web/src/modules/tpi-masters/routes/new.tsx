import type { CreateTpiMasterInput } from '@innovic/shared';
import { Link, createRoute, useNavigate } from '@tanstack/react-router';
import { ArrowLeft, Loader2 } from 'lucide-react';
import { useCallback, useMemo, useRef, useState } from 'react';
import { effectiveFormPerms, useMyAccess } from '@/lib/access-control';
import { useExitConfirm } from '@/lib/exit-guard';
import { useSaveKey } from '@/lib/use-save-key';
import { authenticatedRoute } from '@/routes/_authenticated';
import { useCreateTpiMaster } from '../api';
import { TpiMasterForm } from '../components/tpi-master-form';
import { useToast } from '@/ui/feedback';
import { useFormDraft } from '@/lib/use-form-draft';

export const tpiMasterNewRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: 'tpi-masters/new',
  component: TpiMasterNewPage,
});

function TpiMasterNewPage(): React.JSX.Element {
  const toast = useToast();
  const navigate = useNavigate();
  const saveKey = useSaveKey();
  const create = useCreateTpiMaster(saveKey);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const goBack = useCallback(() => void navigate({ to: '/tpi-masters' }), [navigate]);
  // ADR-313 — the half-typed form survives a tab switch (lib/use-form-draft.tsx).
  const [draftValues, setDraftValues] = useState<unknown>(null);
  const draftApply = useRef<(v: unknown) => void>(() => undefined);
  const draftLink = useMemo(
    () => ({
      onValues: setDraftValues,
      bind: (apply: (v: unknown) => void) => {
        draftApply.current = apply;
      },
    }),
    [],
  );
  const draft = useFormDraft({
    key: 'tpi-master-new',
    ready: draftValues !== null,
    values: draftValues,
    apply: (v) => draftApply.current(v),
  });
  const exit = useExitConfirm({ onExit: goBack, draft });
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
          <div style={{ marginBottom: 'var(--sp-2)' }}>
            <Link to="/tpi-masters" className="btn btn-ghost btn-sm">
              <ArrowLeft size={14} /> Back to TPI Master
            </Link>
          </div>
          <div className="empty-state" style={{ color: 'var(--amber2)' }}>
            ⛔ You do not have permission to add an Inspector. Ask an admin.
          </div>
        </div>
      </div>
    );
  }

  return (
    <div>
      {exit.dialog}
      {draft.band}
      <Link to="/tpi-masters" className="btn btn-ghost btn-sm" style={{ marginBottom: 10 }}>
        <ArrowLeft size={14} /> Back to TPI Master
      </Link>
      <TpiMasterForm
        draftLink={draftLink}
        panelHeader={
          <div>
            <div className="panel-title">🔍 Add Inspector</div>
          </div>
        }
        mode="create"
        submitError={submitError}
        submitLabel="Save Inspector"
        onCancel={() => exit.leave(goBack)}
        onSubmit={async (values: CreateTpiMasterInput) => {
          setSubmitError(null);
          try {
            const created = await create.mutateAsync(values);
            toast.ok(`Inspector ${created.code} saved`);
            exit.leave(() => void navigate({ to: '/tpi-masters/$id', params: { id: created.id } }));
          } catch (e) {
            setSubmitError(e instanceof Error ? e.message : 'Could not save Inspector. Try again.');
          }
        }}
      />
    </div>
  );
}
