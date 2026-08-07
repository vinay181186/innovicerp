import { createRoute, useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import { authenticatedRoute } from '@/routes/_authenticated';
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
  const create = useCreateBomMaster();
  const [submitError, setSubmitError] = useState<string | null>(null);

  const submit = async (header: BomFormHeaderDraft, lines: BomFormLineDraft[]): Promise<void> => {
    setSubmitError(null);
    try {
      const created = await create.mutateAsync({
        bomNo: header.bomNo.trim() || undefined,
        bomName: header.bomName.trim(),
        parentItemId: header.parentItemId,
        status: header.status,
        lines: linesToInput(lines),
      });
      void navigate({ to: '/bom-masters/$id', params: { id: created.id } });
    } catch (e) {
      setSubmitError(e instanceof Error ? e.message : 'Failed to create BOM.');
    }
  };

  return (
    // A new BOM is usable straight away, so it opens as 'active' — nobody has
    // to remember to promote it out of Draft.
    <BomForm
      mode="create"
      initialHeader={{
        bomNo: '',
        bomName: '',
        parentItemId: '',
        parentItemCodeText: '',
        status: 'active',
      }}
      // Start with no part rows: the parent has to be chosen first, and an
      // empty row sitting under a locked list only invites confusion.
      initialLines={[]}
      onSubmit={submit}
      submitting={create.isPending}
      submitError={submitError}
      onCancel={() => void navigate({ to: '/bom-masters' })}
    />
  );
}
