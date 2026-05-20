// NC detail (UI-003-06). DisposeNcPanel inlined for the pending → disposed flow.

import type { NcRegister } from '@innovic/shared';
import { Link, createRoute, useNavigate } from '@tanstack/react-router';
import { ArrowLeft, CheckCircle2, Loader2, Pencil, Stamp, Trash2 } from 'lucide-react';
import { useState } from 'react';
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
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [showDispose, setShowDispose] = useState(false);
  const [reworkDoneQty, setReworkDoneQty] = useState<number | ''>('');
  const [closeError, setCloseError] = useState<string | null>(null);

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
              {detail.itemNameText ?? detail.itemCodeText ?? 'Untitled item'}
              <NcStatusBadge status={detail.status} />
            </div>
          </div>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
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
          <DetailGrid detail={detail} />
        </div>
      </div>

      {showDispose ? (
        <DisposeNcPanel
          nc={detail}
          jcOpSeqs={[]}
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

      {detail.disposition || detail.dispositionDate ? (
        <div className="panel">
          <div className="panel-hdr">
            <div>
              <div className="panel-title">Disposition</div>
              <div className="text3" style={{ fontSize: 11, marginTop: 2 }}>
                Set during the disposition workflow (T-040b cascade).
              </div>
            </div>
          </div>
          <div className="panel-body">
            <DispositionGrid detail={detail} />
          </div>
        </div>
      ) : null}
    </div>
  );
}

function DetailGrid(props: { detail: NcRegister }): React.JSX.Element {
  const { detail } = props;
  return (
    <div className="form-grid form-grid-3">
      <Pair label="NC date" value={detail.ncDate} />
      <Pair label="Item code" value={detail.itemCodeText} />
      <Pair label="Item name" value={detail.itemNameText ?? '—'} />
      <Pair label="Job card" value={detail.jobCardId ? '— linked —' : '—'} />
      <Pair label="Op seq" value={detail.opSeq != null ? String(detail.opSeq) : '—'} />
      <Pair label="Operation" value={detail.operationText ?? detail.qcOperationText ?? '—'} />
      <Pair label="Machine" value={detail.machineCodeText ?? '—'} />
      <Pair label="SO No." value={detail.soCodeText ?? '—'} />
      <Pair label="Rejected qty" value={Number(detail.rejectedQty).toFixed(2)} />
      <Pair label="Reason category" value={detail.reasonCategory.replaceAll('_', ' ')} />
      <Pair label="Reported by" value={detail.reportedByText ?? '—'} />
      <Pair label="Time logged" value={detail.timeLogged ?? '—'} />
      <div className="form-grp form-full">
        <span className="form-label">Defect description</span>
        <div style={{ whiteSpace: 'pre-wrap' }}>{detail.reason ?? '—'}</div>
      </div>
    </div>
  );
}

function DispositionGrid(props: { detail: NcRegister }): React.JSX.Element {
  const { detail } = props;
  return (
    <div className="form-grid form-grid-3">
      <Pair label="Action" value={<NcDispositionBadge disposition={detail.disposition} />} />
      <Pair label="Disposed on" value={detail.dispositionDate ?? '—'} />
      <Pair label="Disposed by" value={detail.dispositionByText ?? '—'} />
      <Pair label="Rework JC" value={detail.reworkJcCodeText ?? '—'} />
      <Pair
        label="Rework op"
        value={detail.reworkOpSeq != null ? String(detail.reworkOpSeq) : '—'}
      />
      <Pair
        label="Rework done qty"
        value={detail.reworkDoneQty ? Number(detail.reworkDoneQty).toFixed(2) : '—'}
      />
      <Pair
        label="Scrap cost"
        value={Number(detail.scrapCost) > 0 ? `₹${Number(detail.scrapCost).toFixed(2)}` : '—'}
      />
      <div className="form-grp form-full">
        <span className="form-label">Disposition remarks</span>
        <div style={{ whiteSpace: 'pre-wrap' }}>{detail.dispositionRemarks ?? '—'}</div>
      </div>
    </div>
  );
}

function Pair(props: { label: string; value: string | React.ReactNode }): React.JSX.Element {
  return (
    <div className="form-grp">
      <span className="form-label">{props.label}</span>
      <div style={{ fontWeight: 600 }}>{props.value}</div>
    </div>
  );
}
