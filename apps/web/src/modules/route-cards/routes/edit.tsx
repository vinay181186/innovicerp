import { Link, createRoute, useNavigate } from '@tanstack/react-router';
import { ArrowLeft, Loader2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { authenticatedRoute } from '@/routes/_authenticated';
import { useRouteCard, useUpdateRouteCard } from '../api';
import {
  RouteCardForm,
  type RouteCardFormHeaderDraft,
  type RouteCardFormOpDraft,
  opsToInput,
} from '../components/route-card-form';

export const routeCardEditRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: 'route-cards/$id/edit',
  component: RouteCardEditPage,
});

function RouteCardEditPage(): React.JSX.Element {
  const { id } = routeCardEditRoute.useParams();
  const navigate = useNavigate();
  const { data: detail, isLoading, isError, error } = useRouteCard(id);
  const update = useUpdateRouteCard(id);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const initialOps = useMemo<RouteCardFormOpDraft[]>(
    () =>
      (detail?.ops ?? []).map((op) => ({
        machineId: op.machineId ?? '',
        machineCodeText: op.machineCode ?? op.machineCodeText ?? '',
        operation: op.operation,
        opType: op.opType,
        cycleTimeMin: String(Number(op.cycleTimeMin)),
        program: op.program ?? '',
        toolNo: op.toolNo ?? '',
        toolDetails: op.toolDetails ?? '',
        qcRequired: op.qcRequired,
        ospVendorId: op.ospVendorId ?? '',
        ospVendorCodeText: op.ospVendorCode ?? op.ospVendorCodeText ?? '',
        ospLeadDays: op.ospLeadDays != null ? String(op.ospLeadDays) : '',
      })),
    [detail],
  );

  const submit = async (
    header: RouteCardFormHeaderDraft,
    ops: RouteCardFormOpDraft[],
    revisionNote: string | null,
  ): Promise<void> => {
    setSubmitError(null);
    try {
      const updated = await update.mutateAsync({
        code: header.code.trim(),
        itemId: header.itemId,
        notes: header.notes.trim() || null,
        ops: opsToInput(ops),
        revisionNote,
      });
      void navigate({ to: '/route-cards/$id', params: { id: updated.id } });
    } catch (e) {
      setSubmitError(e instanceof Error ? e.message : 'Failed to save route card revision.');
    }
  };

  if (isLoading) {
    return (
      <div>
        <Loader2 className="inline h-4 w-4 animate-spin" /> Loading route card…
      </div>
    );
  }
  if (isError || !detail) {
    return (
      <div className="panel">
        <div className="panel-body">
          <div style={{ marginBottom: 8 }}>
            <Link to="/route-cards" className="btn btn-ghost btn-sm">
              <ArrowLeft size={14} /> Back
            </Link>
          </div>
          <div className="empty-state" style={{ color: 'var(--red)' }}>
            {error instanceof Error ? error.message : 'Route card not found.'}
          </div>
        </div>
      </div>
    );
  }

  return (
    <RouteCardForm
      mode="edit"
      routeCard={detail}
      initialHeader={{
        code: detail.code,
        itemId: detail.itemId,
        itemCodeText: detail.itemCode ?? '',
        notes: detail.notes ?? '',
      }}
      initialOps={initialOps}
      onSubmit={submit}
      submitting={update.isPending}
      submitError={submitError}
      onCancel={() => void navigate({ to: '/route-cards/$id', params: { id } })}
    />
  );
}
