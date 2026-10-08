import { createRoute, useNavigate } from '@tanstack/react-router';
import { useCallback, useState } from 'react';
import { effectiveFormPerms, useMyAccess } from '@/lib/access-control';
import { useExitConfirm } from '@/lib/exit-guard';
import { useSaveKey } from '@/lib/use-save-key';
import { authenticatedRoute } from '@/routes/_authenticated';
import { BOM_CREATE_STATUS } from '@innovic/shared';
import { useCreateBomMaster } from '../api';
import {
  BomForm,
  type BomFormHeaderDraft,
  type BomFormLineDraft,
  linesToInput,
} from '../components/bom-form';

export const bomMasterNewRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: 'bom-masters/new',
  component: BomMasterNewPage,
});

function BomMasterNewPage(): React.JSX.Element {
  const navigate = useNavigate();
  const saveKey = useSaveKey();
  const create = useCreateBomMaster(saveKey);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const { data: eff } = useMyAccess();
  const perms = effectiveFormPerms(eff, 'bom_create');
  const goBack = useCallback(() => void navigate({ to: '/bom-masters' }), [navigate]);
  const exit = useExitConfirm({ onExit: goBack });

  const submit = async (header: BomFormHeaderDraft, lines: BomFormLineDraft[]): Promise<void> => {
    setSubmitError(null);
    try {
      // ADR-224: no `bomNo` is sent. The BOM No. on screen is a preview; the
      // server picks the number under its series lock, so a preview that went
      // stale — someone else saved first, or this is the second BOM in a row
      // from the same screen — costs the user nothing: this save takes the
      // next free number instead of being refused as a duplicate.
      const created = await create.mutateAsync({
        bomName: header.bomName.trim(),
        parentItemId: header.parentItemId,
        lines: linesToInput(lines),
      });
      exit.leave(() => void navigate({ to: '/bom-masters/$id', params: { id: created.id } }));
    } catch (e) {
      setSubmitError(e instanceof Error ? e.message : 'Could not save BOM. Try again.');
    }
  };

  if (eff && !perms.entry) {
    return (
      <div className="empty-state" style={{ color: 'var(--amber2)', padding: 40 }}>
        You do not have permission to create BOMs. Ask an admin.
      </div>
    );
  }

  return (
    <>
      {exit.dialog}
      {/* ADR-223 — a new BOM is Active from the start, so a sales order can use
          it the moment it is saved. The status is NOT sent and NOT shown: the
          server sets it from BOM_CREATE_STATUS, so an Excel import or a direct
          API call cannot make a Draft either. The seed below comes from that
          same constant so this screen cannot drift from the server. */}
      <BomForm
        mode="create"
        initialHeader={{
          bomNo: '',
          bomName: '',
          parentItemId: '',
          parentItemCodeText: '',
          status: BOM_CREATE_STATUS,
        }}
        // Start with no part rows: the parent has to be chosen first, and an
        // empty row sitting under a locked list only invites confusion.
        initialLines={[]}
        onSubmit={submit}
        submitting={create.isPending}
        submitError={submitError}
        onCancel={() => exit.leave(goBack)}
      />
    </>
  );
}
