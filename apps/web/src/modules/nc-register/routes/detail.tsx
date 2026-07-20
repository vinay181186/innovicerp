// NC detail (UI-003-06). DisposeNcPanel inlined for the pending → disposed flow.

import type { NcRegister } from '@innovic/shared';
import { Link, createRoute, useNavigate } from '@tanstack/react-router';
import { ArrowLeft, CheckCircle2, Loader2, Pencil, Shield, Stamp, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { useCreateCapa } from '@/modules/capa/api';
import { useJcOpsEnriched } from '@/modules/op-entry/api';
import { AssignTaskButton } from '@/modules/tasks/components/assign-task-button';
import { RelatedDocsPanel } from '@/components/shared/related-docs-panel';
import { useSession } from '@/lib/session';
import { authenticatedRoute } from '@/routes/_authenticated';
import {
  useCloseNcRework,
  useDisposeNcRegister,
  useNcRegister,
  useSoftDeleteNcRegister,
} from '../api';
import { DisposeNcPanel } from '../components/dispose-nc-panel';
import { NcDispositionBadge } from '../components/nc-disposition-badge';
import { NcStatusBadge } from '../components/nc-status-badge';

export const ncRegisterDetailRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: 'nc-register/$id',
  component: NcRegisterDetailPage,
});

function NcRegisterDetailPage(): React.JSX.Element {
  const { id } = ncRegisterDetailRoute.useParams();
  const navigate = useNavigate();
  const { data: detail, isLoading, isError, error } = useNcRegister(id);
  const { data: me } = useSession();
  const softDelete = useSoftDeleteNcRegister();
  const dispose = useDisposeNcRegister(id);
  const closeRework = useCloseNcRework(id);
  const createCapa = useCreateCapa();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [showDispose, setShowDispose] = useState(false);
  const [reworkDoneQty, setReworkDoneQty] = useState<number | ''>('');
  const [closeError, setCloseError] = useState<string | null>(null);
  const [capaError, setCapaError] = useState<string | null>(null);

  // Full op list for the NC's JC — drives the dispose panel's rework-op
  // dropdown (legacy `_disposeNC` renders every op of the JC, HTML L22637).
  const { data: jcOps } = useJcOpsEnriched(
    { jobCardId: detail?.jobCardId },
    { enabled: Boolean(detail?.jobCardId) },
  );

  if (isLoading) {
    return (
      <div>
        <Loader2 className="inline h-4 w-4 animate-spin" /> Loading NC…
      </div>
    );
  }
  if (isError || !detail) {
    return (
      <div className="panel">
        <div className="panel-body">
          <div style={{ marginBottom: 8 }}>
            <Link to="/nc-register" className="btn btn-ghost btn-sm">
              <ArrowLeft size={14} /> Back
            </Link>
          </div>
          <div className="empty-state" style={{ color: 'var(--red)' }}>
            {error instanceof Error ? error.message : 'NC not found'}
          </div>
        </div>
      </div>
    );
  }

  const isPending = detail.status === 'pending';
  const isReworkDisposed = detail.status === 'disposed' && detail.disposition === 'rework';
  const canEdit = me?.role === 'admin' || me?.role === 'manager' || me?.role === 'operator';
  const isAdmin = me?.role === 'admin';
  // CAPA can be created/seen by admin/manager/qc (matches capa_records RLS).
  const canCapa = me?.role === 'admin' || me?.role === 'manager' || me?.role === 'qc';
  // "Create CAPA" only once the NC is disposed/closed and has no linked CAPA
  // (legacy: button shows when status !== 'pending' && !_capaForNC(ncNo)).
  const showCreateCapa = canCapa && !isPending && !detail.linkedCapaCode;

  // Resolve op_seq → operation label for the rework dropdown.
  const reworkOpOptions = (jcOps ?? [])
    .slice()
    .sort((a, b) => a.opSeq - b.opSeq)
    .map((o) => ({ opSeq: o.opSeq, operation: o.operation }));

  // JC code for the CAPA snapshot — the NC read shape only carries jobCardId,
  // so resolve the human code from the loaded JC ops (jobCardCode is joined).
  const jcCode = (jcOps ?? [])[0]?.jobCardCode ?? null;

  const onCreateCapa = async (): Promise<void> => {
    setCapaError(null);
    const operation = detail.operationText ?? detail.qcOperationText;
    try {
      await createCapa.mutateAsync({
        type: 'Corrective',
        ncRefs: [detail.code],
        ...(jcCode ? { jcNo: jcCode } : {}),
        ...(detail.soCodeText ? { soNo: detail.soCodeText } : {}),
        ...(detail.itemCodeText ? { itemCode: detail.itemCodeText } : {}),
        ...(operation ? { operation } : {}),
        problem: detail.reason ?? detail.reasonCategory.replaceAll('_', ' '),
        department: 'QC',
      });
      void navigate({ to: '/capa' });
    } catch (e) {
      setCapaError(e instanceof Error ? e.message : 'Failed to create CAPA.');
    }
  };

  const onDelete = (): void => {
    softDelete.mutate(detail.id, {
      onSuccess: () => {
        void navigate({ to: '/nc-register', replace: true });
      },
    });
  };

  const onCloseRework = async (): Promise<void> => {
    setCloseError(null);
    try {
      await closeRework.mutateAsync(
        reworkDoneQty === '' ? {} : { reworkDoneQty: Number(reworkDoneQty) },
      );
      setReworkDoneQty('');
    } catch (e) {
      setCloseError(e instanceof Error ? e.message : 'Failed to close rework.');
    }
  };

  return (
    <div>
      <Link to="/nc-register" className="btn btn-ghost btn-sm" style={{ marginBottom: 10 }}>
        <ArrowLeft size={14} /> Back to NC Register
      </Link>

      <div className="panel">
        <div className="panel-hdr">
          <div>
            <div className="td-code" style={{ color: 'var(--cyan)', fontSize: 16, fontWeight: 700 }}>
              {detail.code}
            </div>
            <div
              className="panel-title"
              style={{ marginTop: 2, display: 'flex', alignItems: 'center', gap: 10 }}
            >
              {detail.itemName ??
                detail.itemNameText ??
                detail.itemCode ??
                detail.itemCodeText ??
                'Untitled item'}
              <NcStatusBadge status={detail.status} />
              {detail.linkedCapaCode ? (
                <Link
                  to="/capa"
                  className="mono"
                  style={{
                    fontSize: 12,
                    color: 'var(--purple)',
                    fontWeight: 700,
                    textDecoration: 'none',
                  }}
                  title="Open linked CAPA"
                >
                  🛡 {detail.linkedCapaCode}
                </Link>
              ) : null}
            </div>
          </div>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <AssignTaskButton
              linkedRef={{
                type: 'nc',
                id: detail.id,
                display: `NC ${detail.code}`,
                navPage: `/nc-register/${detail.id}`,
              }}
              suggestedTitle={`Action NC ${detail.code}`}
            />
            {isPending && canEdit ? (
              <button
                type="button"
                className="btn btn-primary btn-sm"
                onClick={() => setShowDispose(true)}
                disabled={showDispose}
              >
                <Stamp size={13} /> Dispose
              </button>
            ) : null}
            {isReworkDisposed && canEdit ? (
              <>
                <span className="text3" style={{ fontSize: 11 }}>
                  Rework done qty
                </span>
                <input
                  type="number"
                  min={0}
                  step="0.01"
                  className="innovic-input"
                  placeholder="(opt)"
                  value={reworkDoneQty === '' ? '' : reworkDoneQty}
                  onChange={(e) =>
                    setReworkDoneQty(e.target.value === '' ? '' : Number(e.target.value))
                  }
                  style={{ width: 90, fontSize: 12 }}
                />
                <button
                  type="button"
                  className="btn btn-success btn-sm"
                  onClick={() => void onCloseRework()}
                  disabled={closeRework.isPending}
                >
                  {closeRework.isPending ? (
                    <Loader2 size={13} className="animate-spin" />
                  ) : (
                    <CheckCircle2 size={13} />
                  )}
                  Close rework
                </button>
              </>
            ) : null}
            {showCreateCapa ? (
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                style={{ color: 'var(--purple)' }}
                onClick={() => void onCreateCapa()}
                disabled={createCapa.isPending}
                title="Open a Corrective Action prefilled from this NC"
              >
                {createCapa.isPending ? (
                  <Loader2 size={13} className="animate-spin" />
                ) : (
                  <Shield size={13} />
                )}
                Create CAPA
              </button>
            ) : null}
            {canEdit ? (
              <Link
                to="/nc-register/$id/edit"
                params={{ id: detail.id }}
                className="btn btn-ghost btn-sm"
                style={!isPending ? { opacity: 0.5, pointerEvents: 'none' } : undefined}
                title={!isPending ? 'Cannot edit disposed/closed NCs' : undefined}
              >
                <Pencil size={13} /> Edit
              </Link>
            ) : null}
            {isAdmin ? (
              confirmDelete ? (
                <>
                  <span className="text3" style={{ fontSize: 12 }}>
                    Delete?
                  </span>
                  <button
                    type="button"
                    className="btn btn-danger btn-sm"
                    onClick={onDelete}
                    disabled={softDelete.isPending}
                  >
                    {softDelete.isPending ? (
                      <Loader2 size={13} className="animate-spin" />
                    ) : (
                      <Trash2 size={13} />
                    )}
                    Confirm
                  </button>
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    onClick={() => setConfirmDelete(false)}
                    disabled={softDelete.isPending}
                  >
                    Cancel
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  className="btn btn-danger btn-sm"
                  onClick={() => setConfirmDelete(true)}
                  disabled={!isPending}
                  title={!isPending ? 'Disposed/closed NCs are permanent' : undefined}
                >
                  <Trash2 size={13} /> Delete
                </button>
              )
            ) : null}
          </div>
        </div>
        <div className="panel-body">
          {softDelete.isError ? (
            <div
              style={{
                color: 'var(--red)',
                background: 'var(--red3)',
                border: '1px solid #fca5a5',
                borderRadius: 6,
                padding: '6px 10px',
                fontSize: 12,
                marginBottom: 10,
              }}
            >
              {softDelete.error instanceof Error
                ? softDelete.error.message
                : 'Failed to delete NC.'}
            </div>
          ) : null}
          {closeError ? (
            <div
              style={{
                color: 'var(--red)',
                background: 'var(--red3)',
                border: '1px solid #fca5a5',
                borderRadius: 6,
                padding: '6px 10px',
                fontSize: 12,
                marginBottom: 10,
              }}
            >
              {closeError}
            </div>
          ) : null}
          {capaError ? (
            <div
              style={{
                color: 'var(--red)',
                background: 'var(--red3)',
                border: '1px solid #fca5a5',
                borderRadius: 6,
                padding: '6px 10px',
                fontSize: 12,
                marginBottom: 10,
              }}
            >
              {capaError}
            </div>
          ) : null}
          <DetailGrid detail={detail} jcCode={jcCode} />
          {detail.disposition || detail.dispositionDate ? <DispositionBlock detail={detail} /> : null}
        </div>
      </div>

      <RelatedDocsPanel module="nc-register" id={detail.id} />

      {showDispose ? (
        <DisposeNcPanel
          nc={detail}
          jcCode={jcCode}
          jcOps={reworkOpOptions}
          pending={dispose.isPending}
          error={
            dispose.isError
              ? dispose.error instanceof Error
                ? dispose.error.message
                : 'Failed to dispose NC'
              : null
          }
          onCancel={() => {
            setShowDispose(false);
            dispose.reset();
          }}
          onSubmit={async (input) => {
            try {
              await dispose.mutateAsync(input);
              setShowDispose(false);
            } catch {
              /* inline error via panel */
            }
          }}
        />
      ) : null}
    </div>
  );
}

function DetailGrid(props: { detail: NcRegister; jcCode: string | null }): React.JSX.Element {
  const { detail, jcCode } = props;
  // Legacy renders "Op<seq>: <operation>" as one fused field (HTML L22729).
  const operation = detail.operationText ?? detail.qcOperationText;
  return (
    <>
      {/* Context strip — legacy `_viewNC` header block (HTML L22721-22726). */}
      <div
        style={{
          padding: 12,
          background: 'var(--bg3)',
          borderRadius: 8,
          border: '1px solid var(--border)',
          marginBottom: 14,
          display: 'flex',
          gap: 16,
          flexWrap: 'wrap',
        }}
      >
        <CtxField label="REJ NO.">
          <b className="red">{detail.code}</b>
        </CtxField>
        <CtxField label="DATE">
          <b>{detail.ncDate}</b>
        </CtxField>
        <CtxField label="JC">
          <b className="cyan">{jcCode ?? '—'}</b>
        </CtxField>
        <CtxField label="SO">
          <b>{detail.soCodeText ?? '—'}</b>
        </CtxField>
        <CtxField label="STATUS">
          <NcStatusBadge status={detail.status} />
        </CtxField>
      </div>
      <div className="form-grid" style={{ fontSize: 12, marginBottom: 12 }}>
        <InlinePair label="Item:">
          {detail.itemCode ?? detail.itemCodeText ?? '—'} —{' '}
          {detail.itemName ?? detail.itemNameText ?? ''}
        </InlinePair>
        <InlinePair label="Operation:">
          {detail.opSeq != null ? `Op${detail.opSeq}` : ''}
          {detail.opSeq != null && operation ? ': ' : ''}
          {operation ?? (detail.opSeq == null ? '—' : '')}
        </InlinePair>
        <InlinePair label="Machine:">{detail.machineCodeText ?? '—'}</InlinePair>
        <InlinePair label="Rejected Qty:">
          <span className="red">{Number(detail.rejectedQty)} pcs</span>
        </InlinePair>
        <InlinePair label="Operator:">{detail.operatorText ?? '—'}</InlinePair>
        <InlinePair label="Reported By:">{detail.reportedByText ?? '—'}</InlinePair>
        <InlinePair label="Reason Category:">{detail.reasonCategory.replaceAll('_', ' ')}</InlinePair>
        <InlinePair label="Reason:">{detail.reason ?? '—'}</InlinePair>
        {detail.timeLogged ? (
          <div className="form-full">
            <span className="text3">⏰ Time Logged:</span> <b>{detail.timeLogged}</b>
          </div>
        ) : null}
      </div>
    </>
  );
}

// Disposition block — legacy `_viewNC` tinted panel (HTML L22738-22749). Blue
// tint mapped from legacy's dark-theme #3b82f6 to the light-theme --blue
// (#2563eb) at the same alpha, per the light-theme port.
function DispositionBlock(props: { detail: NcRegister }): React.JSX.Element {
  const { detail } = props;
  return (
    <div
      style={{
        padding: '10px 14px',
        background: 'rgba(37, 99, 235, 0.05)',
        border: '1px solid rgba(37, 99, 235, 0.2)',
        borderRadius: 8,
        marginBottom: 10,
      }}
    >
      <div className="fw-700" style={{ fontSize: 11, marginBottom: 6 }}>
        DISPOSITION
      </div>
      <div className="form-grid" style={{ fontSize: 12 }}>
        <InlinePair label="Action:">
          <NcDispositionBadge disposition={detail.disposition} />
        </InlinePair>
        <InlinePair label="Date:">{detail.dispositionDate ?? '—'}</InlinePair>
        <InlinePair label="By:">{detail.dispositionByText ?? ''}</InlinePair>
        {detail.disposition === 'rework' ? (
          <InlinePair label="Rework Op:">
            {detail.reworkOpSeq != null ? `Op${detail.reworkOpSeq}` : '—'}
          </InlinePair>
        ) : null}
        {/* Not in legacy `_viewNC`, but legacy's LIST row shows "♻ n/m done"
            (HTML L22536) and our close-rework flow captures it. Kept. */}
        {detail.disposition === 'rework' && detail.reworkDoneQty ? (
          <InlinePair label="Rework Done Qty:">
            {Number(detail.reworkDoneQty)}/{Number(detail.rejectedQty)} done
          </InlinePair>
        ) : null}
        {detail.disposition === 'scrap' && Number(detail.scrapCost) > 0 ? (
          <InlinePair label="Scrap Cost:">
            <span className="red">₹{Number(detail.scrapCost).toFixed(2)}</span>
          </InlinePair>
        ) : null}
        {detail.disposition === 'make_fresh' && detail.reworkJcCodeText ? (
          <InlinePair label="New JC:">
            <span className="cyan">{detail.reworkJcCodeText}</span>
          </InlinePair>
        ) : null}
        {detail.dispositionRemarks ? (
          <div className="form-full">
            <span className="text3">Remarks:</span> {detail.dispositionRemarks}
          </div>
        ) : null}
      </div>
    </div>
  );
}

// Legacy renders body fields as inline "Label: <b>value</b>" pairs inside a
// 2-col grid (HTML L22728-22736), not as stacked .form-label groups.
function InlinePair(props: { label: string; children: React.ReactNode }): React.JSX.Element {
  return (
    <div>
      <span className="text3">{props.label}</span> <b>{props.children}</b>
    </div>
  );
}

function CtxField(props: { label: string; children: React.ReactNode }): React.JSX.Element {
  return (
    <div>
      <span className="text3" style={{ fontSize: 10 }}>
        {props.label}
      </span>
      <br />
      {props.children}
    </div>
  );
}
