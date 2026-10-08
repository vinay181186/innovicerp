import { createRoute, useNavigate } from '@tanstack/react-router';
import { useCallback, useState } from 'react';
import { effectiveFormPerms, useMyAccess } from '@/lib/access-control';
import { useExitConfirm } from '@/lib/exit-guard';
import { useSaveKey } from '@/lib/use-save-key';
import { authenticatedRoute } from '@/routes/_authenticated';
import { PageState } from '@/ui/layout';
import { useCreateMlBom } from '../api';
import {
  MlBomForm,
  type MlBomFormHeaderDraft,
  type MlBomFormLineDraft,
  mlBomLinesToInput,
} from '../components/ml-bom-form';

export const mlBomNewRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: 'ml-boms/new',
  component: MlBomNewPage,
});

function MlBomNewPage(): React.JSX.Element {
  const navigate = useNavigate();
  const saveKey = useSaveKey();
  const create = useCreateMlBom(saveKey);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const { data: eff } = useMyAccess();
  const perms = effectiveFormPerms(eff, 'mlbom_create');
  const goBack = useCallback(() => void navigate({ to: '/ml-boms' }), [navigate]);
  const exit = useExitConfirm({ onExit: goBack });

  const submit = async (
    header: MlBomFormHeaderDraft,
    lines: MlBomFormLineDraft[],
  ): Promise<void> => {
    setSubmitError(null);
    try {
      // ADR-224: no code is sent — the server numbers the BOM on save.
      // Default: always sent as ticked / unticked. If the item already has a
      // Default the server refuses (409) and its message shows in the banner.
      const created = await create.mutateAsync({
        itemId: header.itemId,
        isDefault: header.isDefault,
        remarks: header.remarks.trim() ? header.remarks.trim() : null,
        lines: mlBomLinesToInput(lines),
      });
      exit.leave(() => void navigate({ to: '/ml-boms/$id', params: { id: created.id } }));
    } catch (e) {
      setSubmitError(e instanceof Error ? e.message : 'Could not save BOM. Try again.');
    }
  };

  if (eff && !perms.entry) {
    return <PageState as="page" state="noaccess" />;
  }

  return (
    <>
      {exit.dialog}
      <MlBomForm
        mode="create"
        initialHeader={{ code: '', itemId: '', itemCodeText: '', isDefault: true, remarks: '' }}
        initialLines={[]}
        onSubmit={submit}
        submitting={create.isPending}
        submitError={submitError}
        onCancel={() => exit.leave(goBack)}
      />
    </>
  );
}
