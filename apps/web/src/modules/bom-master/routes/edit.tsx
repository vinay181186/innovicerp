import { Link, createRoute, useNavigate } from '@tanstack/react-router';
import { ArrowLeft, Loader2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { authenticatedRoute } from '@/routes/_authenticated';
import { useBomMaster, useUpdateBomMaster } from '../api';
import {
  BomForm,
  type BomFormHeaderDraft,
  type BomFormLineDraft,
  linesToInput,
} from '../components/bom-form';

export const bomMasterEditRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: 'bom-masters/$id/edit',
  component: BomMasterEditPage,
});

function BomMasterEditPage(): React.JSX.Element {
  const { id } = bomMasterEditRoute.useParams();
  const navigate = useNavigate();
  const { data: detail, isLoading, isError, error } = useBomMaster(id);
  const update = useUpdateBomMaster(id);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const initialLines = useMemo<BomFormLineDraft[]>(
    () =>
      (detail?.lines ?? []).map((l) => ({
        childItemId: l.childItemId,
        childItemCodeText: l.childItemCode ?? '',
        qtyPerSet: String(Number(l.qtyPerSet)),
        bomType: l.bomType,
      })),
    [detail],
  );

  const submit = async (
    header: BomFormHeaderDraft,
    lines: BomFormLineDraft[],
    revisionNote: string | null,
  ): Promise<void> => {
    setSubmitError(null);
    try {
      const updated = await update.mutateAsync({
        bomNo: header.bomNo.trim(),
        bomName: header.bomName.trim(),
        status: header.status,
        lines: linesToInput(lines),
        revisionNote,
      });
      void navigate({ to: '/bom-masters/$id', params: { id: updated.id } });
    } catch (e) {
      setSubmitError(e instanceof Error ? e.message : 'Failed to save BOM revision.');
    }
  };

  if (isLoading) {
    return (
      <div>
        <Loader2 className="inline h-4 w-4 animate-spin" /> Loading BOM…
      </div>
    );
  }
  if (isError || !detail) {
    return (
      <div className="panel">
        <div className="panel-body">
          <div style={{ marginBottom: 8 }}>
            <Link to="/bom-masters" className="btn btn-ghost btn-sm">
              <ArrowLeft size={14} /> Back
            </Link>
          </div>
          <div className="empty-state" style={{ color: 'var(--red)' }}>
            {error instanceof Error ? error.message : 'BOM not found.'}
          </div>
        </div>
      </div>
    );
  }

  return (
    <BomForm
      mode="edit"
      bom={detail}
      initialHeader={{
        bomNo: detail.bomNo,
        bomName: detail.bomName,
        status: detail.status,
      }}
      initialLines={initialLines}
      onSubmit={submit}
      submitting={update.isPending}
      submitError={submitError}
      onCancel={() => void navigate({ to: '/bom-masters/$id', params: { id } })}
    />
  );
}
