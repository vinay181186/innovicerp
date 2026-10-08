import { Link, createRoute, useNavigate } from '@tanstack/react-router';
import { useCallback, useMemo, useState } from 'react';
import { effectiveFormPerms, useMyAccess } from '@/lib/access-control';
import { useExitConfirm } from '@/lib/exit-guard';
import { useOpenedVersion } from '@/lib/use-opened-version';
import { useSaveKey } from '@/lib/use-save-key';
import { authenticatedRoute } from '@/routes/_authenticated';
import { Icon } from '@/ui/core';
import { PageState } from '@/ui/layout';
import { useMlBom, useUpdateMlBom } from '../api';
import {
  MlBomForm,
  type MlBomFormHeaderDraft,
  type MlBomFormLineDraft,
  mlBomLinesToInput,
} from '../components/ml-bom-form';

export const mlBomEditRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: 'ml-boms/$id/edit',
  component: MlBomEditPage,
});

function MlBomEditPage(): React.JSX.Element {
  const { id } = mlBomEditRoute.useParams();
  const navigate = useNavigate();
  const { data: detail, isLoading, isError, error } = useMlBom(id);
  const saveKey = useSaveKey();
  const update = useUpdateMlBom(id, saveKey);
  // The version this form opened with — a save over a newer edit is refused
  // with 409 and the server's message shows in the error banner.
  const opened = useOpenedVersion(detail?.updatedAt);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const { data: eff } = useMyAccess();
  const perms = effectiveFormPerms(eff, 'mlbom_create');
  const goBack = useCallback(
    () => void navigate({ to: '/ml-boms/$id', params: { id } }),
    [navigate, id],
  );
  const exit = useExitConfirm({ onExit: goBack });

  const initialLines = useMemo<MlBomFormLineDraft[]>(
    () =>
      (detail?.lines ?? []).map((l) => ({
        rowKey: l.id,
        childItemId: l.childItemId,
        childItemCodeText: l.childItemCode ?? '',
        qtyPerSet: String(Number(l.qtyPerSet)),
        bomType: l.bomType,
        rawMaterialGradeId: l.rawMaterialGradeId,
        rawMaterialGradeText: l.rawMaterialGradeText,
        rawMaterialSizeId: l.rawMaterialSizeId,
        rawMaterialSizeText: l.rawMaterialSizeText,
        remarks: l.remarks ?? '',
        childMlBomId: l.childMlBomId,
        childMlBomCode: l.childMlBomCode,
      })),
    [detail],
  );

  const submit = async (
    header: MlBomFormHeaderDraft,
    lines: MlBomFormLineDraft[],
    revisionNote: string | null,
  ): Promise<void> => {
    setSubmitError(null);
    try {
      const updated = await update.mutateAsync({
        itemId: header.itemId,
        remarks: header.remarks.trim() ? header.remarks.trim() : null,
        lines: mlBomLinesToInput(lines),
        revisionNote,
        expectedUpdatedAt: opened.expected(),
      });
      opened.saved(updated.updatedAt);
      exit.leave(
        () => void navigate({ to: '/ml-boms/$id', params: { id: updated.id }, replace: true }),
      );
    } catch (e) {
      setSubmitError(e instanceof Error ? e.message : 'Could not save BOM. Try again.');
    }
  };

  if (eff && !perms.edit) {
    return <PageState as="page" state="noaccess" />;
  }
  if (isLoading) {
    return <PageState state="loading" message="⟳ Loading BOM…" />;
  }
  if (isError || !detail) {
    return (
      <div>
        <Link
          to="/ml-boms"
          className="btn btn-ghost btn-sm"
          style={{ marginBottom: 'var(--sp-2)' }}
        >
          <Icon name="arrow-left" size={14} /> Back
        </Link>
        <PageState
          state="error"
          message={error instanceof Error ? error.message : 'BOM not found.'}
        />
      </div>
    );
  }

  return (
    <>
      {exit.dialog}
      <MlBomForm
        mode="edit"
        revision={detail.revision}
        initialHeader={{
          code: detail.code,
          itemId: detail.itemId,
          itemCodeText: detail.itemCode ?? '',
          isDefault: detail.isDefault,
          remarks: detail.remarks ?? '',
        }}
        initialLines={initialLines}
        onSubmit={submit}
        submitting={update.isPending}
        submitError={submitError}
        onCancel={() => exit.leave(goBack)}
      />
    </>
  );
}
