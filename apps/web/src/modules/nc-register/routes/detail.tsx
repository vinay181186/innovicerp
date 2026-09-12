// NC detail (UI-003-06). DisposeNcPanel inlined for the pending → disposed flow.
//
// QC–NC handling (docs/QC-NC-HANDLING-DESIGN.md §2–§5, §8): the page now
// carries the qty strip (rejected / cleared / failed / open), the links a
// recovery leaves behind (child JC, RTV challan, split siblings), the
// Create-DC form for a return-to-vendor NC, and one Close button that runs
// under the server's closure gate. The legacy in-route rework row (one with
// `reworkOpSeq`) keeps its old "Close rework" button.

import type { DisposeNcResult, NcRegister } from '@innovic/shared';
import { Link, createRoute, useNavigate } from '@tanstack/react-router';
import { ArrowLeft, CheckCircle2, Loader2, Pencil, Shield, Stamp, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { useCreateCapa } from '@/modules/capa/api';
import { useJcOpsEnriched } from '@/modules/op-entry/api';
import { AssignTaskButton } from '@/modules/tasks/components/assign-task-button';
import { RelatedDocsPanel } from '@/components/shared/related-docs-panel';
import { StatStrip } from '@/components/shared/stat-strip';
import { effectiveFormPerms, useMyAccess } from '@/lib/access-control';
import { itemCodeWithRev } from '@/lib/item-code';
import { authenticatedRoute } from '@/routes/_authenticated';
import {
  useCloseNc,
  useCloseNcRework,
  useCreateNcDc,
  useDisposeNcRegister,
  useNcRegister,
  useNcRegisterList,
  useSoftDeleteNcRegister,
} from '../api';
import { CreateNcDcPanel } from '../components/create-nc-dc-panel';
import { DisposeNcPanel } from '../components/dispose-nc-panel';
import { NcDispositionBadge } from '../components/nc-disposition-badge';
import { NcLinksBlock } from '../components/nc-links-block';
import { Note } from '../components/nc-note';
import { NcStatusBadge } from '../components/nc-status-badge';
import { ncOpenQty } from '../nc-qty';

export const ncRegisterDetailRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: 'nc-register/$id',
  component: NcRegisterDetailPage,
});

// Siblings are found through the list endpoint, which cannot filter by
// splitFromNcId — but it CAN filter by job card, and every split sibling
// shares the parent's job card. One page of the JC's NCs is bounded and small.
const SIBLING_PAGE = 200;

function NcRegisterDetailPage(): React.JSX.Element {
  const { id } = ncRegisterDetailRoute.useParams();
  const navigate = useNavigate();
  const { data: detail, isLoading, isError, error } = useNcRegister(id);
  const { data: eff } = useMyAccess();
  const softDelete = useSoftDeleteNcRegister();
  const dispose = useDisposeNcRegister(id);
  const closeRework = useCloseNcRework(id);
  const closeNc = useCloseNc(id);
  const createDc = useCreateNcDc(id);
  const createCapa = useCreateCapa();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [showDispose, setShowDispose] = useState(false);
  const [disposeResult, setDisposeResult] = useState<DisposeNcResult | null>(null);
  const [reworkDoneQty, setReworkDoneQty] = useState<number | ''>('');
  const [closeError, setCloseError] = useState<string | null>(null);
  const [capaError, setCapaError] = useState<string | null>(null);

  // Full op list for the NC's JC — drives the dispose panel's legacy rework-op
  // dropdown (legacy `_disposeNC` renders every op of the JC, HTML L22637) and
  // resolves the human JC code.
  const { data: jcOps } = useJcOpsEnriched(
    { jobCardId: detail?.jobCardId },
    { enabled: Boolean(detail?.jobCardId) },
  );

  // The NC this row was split off (design §3) — fetched for its code.
  const { data: splitParent } = useNcRegister(detail?.splitFromNcId ?? undefined);
  // Rows split off THIS NC. See SIBLING_PAGE.
  const { data: jcNcs } = useNcRegisterList(
    {
      ...(detail?.jobCardId ? { jobCardId: detail.jobCardId } : {}),
      limit: SIBLING_PAGE,
      offset: 0,
    },
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

  // "Hide page" (Access Control → Config): once access has loaded, a user whose
  // VIEW was removed for this page sees the no-access panel, not the page. `eff`
  // is undefined only while access loads — don't block then, or every legitimate
  // user flashes this panel on cold load.
  if (eff && !effectiveFormPerms(eff, 'nc_dispose').view) {
    return (
      <div className="empty-state" style={{ color: 'var(--amber)', padding: 40 }}>
        ⛔ This page is hidden for your access. Ask an admin if you need access to it.
      </div>
    );
  }

  const isPending = detail.status === 'pending';
  const isClosed = detail.status === 'closed';
  // A legacy in-route rework row is the one that carries rework_op_seq; only
  // it keeps the old "Close rework" path. Every new row closes through the
  // gate (design §3, interlock 6).
  const isLegacyRework = detail.reworkOpSeq != null;
  const isReworkDisposed =
    isLegacyRework && detail.status === 'disposed' && detail.disposition === 'rework';
  // Return-to-vendor, chosen but the challan not yet issued (design §5).
  const awaitingDc =
    detail.disposition === 'return_to_vendor' &&
    detail.status === 'disposed' &&
    !detail.deliveryChallanId;
  const isRtv = detail.disposition === 'return_to_vendor';
  // Tier-driven, per department (QC). Was a global role string
  // (admin||manager||operator) that ignored the user's actual QC tier.
  const ncPerms = effectiveFormPerms(eff, 'nc_dispose');
  // Dispose / close / create DC / Edit all rewrite a saved NC → `edit`
  // (L3 Editor and above).
  const canEdit = ncPerms.edit;
  // The RTV challan is an outward DC, so it also needs the OSP DC entry right
  // (design §5 gate: nc_dispose edit AND ospdc_create entry).
  const canCreateDc = canEdit && effectiveFormPerms(eff, 'ospdc_create').entry;
  // Delete is not one of the four tier actions, so "L5 Department Admin and
  // above" is expressed as the pair only L5/L6 hold: L3 has edit without
  // approve, L4 has approve without edit. Was admin-only, which locked out the
  // very tier meant to run the department.
  const canDelete = ncPerms.edit && ncPerms.approve;
  // The button creates a CAPA, so it follows the CAPA form key, not nc_dispose.
  const canCreateCapaRecord = effectiveFormPerms(eff, 'capa_create').entry;
  // "Create CAPA" only once the NC is disposed/closed and has no linked CAPA
  // (legacy: button shows when status !== 'pending' && !_capaForNC(ncNo)).
  const showCreateCapa = canCreateCapaRecord && !isPending && !detail.linkedCapaCode;
  // The gate-driven Close: any non-legacy row that has been dispositioned and
  // is not yet closed. Disabled (never hidden) while the server says why not,
  // so the operator sees the shortfall rather than a missing button.
  const showClose = canEdit && !isPending && !isClosed && !isLegacyRework;

  // Resolve op_seq → operation label for the legacy rework dropdown.
  const reworkOpOptions = (jcOps ?? [])
    .slice()
    .sort((a, b) => a.opSeq - b.opSeq)
    .map((o) => ({ opSeq: o.opSeq, operation: o.operation }));

  // JC code for the CAPA snapshot — the NC read shape only carries jobCardId,
  // so resolve the human code from the loaded JC ops (jobCardCode is joined).
  const jcCode = (jcOps ?? [])[0]?.jobCardCode ?? null;

  const siblings = (jcNcs?.items ?? []).filter((n) => n.splitFromNcId === detail.id);

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
      void navigate({ to: '/nc-register' });
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

  // The 409 body carries the exact shortfall; apiFetch puts it on
  // Error.message, so it is shown as-is.
  const onClose = async (): Promise<void> => {
    setCloseError(null);
    try {
      await closeNc.mutateAsync();
    } catch (e) {
      setCloseError(e instanceof Error ? e.message : 'Failed to close the NC.');
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
            <div
              className="td-code"
              style={{ color: 'var(--cyan)', fontSize: 16, fontWeight: 700 }}
            >
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
                  to="/nc-register"
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
          <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
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
            {showClose ? (
              <>
                {detail.closeBlockedReason ? (
                  <span
                    className="text3"
                    style={{ fontSize: 11, maxWidth: 360 }}
                    title={detail.closeBlockedReason}
                  >
                    {detail.closeBlockedReason}
                  </span>
                ) : null}
                <button
                  type="button"
                  className="btn btn-success btn-sm"
                  onClick={() => void onClose()}
                  disabled={closeNc.isPending || detail.closeBlockedReason != null}
                  title={
                    detail.closeBlockedReason ??
                    'Every rejected piece is accounted for — close this NC'
                  }
                >
                  {closeNc.isPending ? (
                    <Loader2 size={13} className="animate-spin" />
                  ) : (
                    <CheckCircle2 size={13} />
                  )}
                  Close
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
            {canDelete ? (
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
          {softDelete.isError || closeError || capaError ? (
            <div style={{ marginBottom: 10 }}>
              {softDelete.isError ? (
                <Note tone="red">
                  {softDelete.error instanceof Error
                    ? softDelete.error.message
                    : 'Failed to delete NC.'}
                </Note>
              ) : null}
              {closeError ? <Note tone="red">{closeError}</Note> : null}
              {capaError ? <Note tone="red">{capaError}</Note> : null}
            </div>
          ) : null}
          <DetailGrid detail={detail} jcCode={jcCode} />
          {detail.disposition || detail.dispositionDate ? (
            <DispositionBlock detail={detail} />
          ) : null}
          <NcLinksBlock detail={detail} splitParent={splitParent ?? null} siblings={siblings} />
        </div>
      </div>

      {/* Where the rejected pieces stand (design §3). One strip, not cards. */}
      <div style={{ margin: '10px 0' }}>
        <StatStrip
          items={[
            {
              key: 'rejected',
              label: 'Rejected',
              count: Number(detail.rejectedQty),
              color: 'var(--red)',
              sub: 'pcs this NC covers',
            },
            {
              key: 'cleared',
              label: 'Cleared',
              count: Number(detail.clearedQty),
              color: 'var(--green)',
              sub: 'QC-accepted after recovery',
            },
            {
              key: 'failed',
              label: 'Failed',
              count: Number(detail.failedQty),
              color: 'var(--amber)',
              sub: 'QC-rejected again',
            },
            {
              key: 'open',
              label: 'Open',
              count: ncOpenQty(detail),
              color: 'var(--blue)',
              sub: 'rejected − cleared − failed',
            },
            ...(isRtv
              ? [
                  {
                    key: 'sent',
                    label: 'Sent',
                    count: Number(detail.rtvSentQty),
                    color: 'var(--blue)',
                    sub: 'on the return challan',
                  },
                  {
                    key: 'received',
                    label: 'Received',
                    count: Number(detail.rtvReceivedQty),
                    color: 'var(--cyan)',
                    sub: 'back from the vendor',
                  },
                ]
              : []),
          ]}
        />
      </div>

      {awaitingDc && canCreateDc ? (
        <CreateNcDcPanel
          nc={detail}
          pending={createDc.isPending}
          error={
            createDc.isError
              ? createDc.error instanceof Error
                ? createDc.error.message
                : 'Failed to create the delivery challan'
              : null
          }
          onSubmit={async (input) => {
            try {
              await createDc.mutateAsync(input);
            } catch {
              /* inline error via panel */
            }
          }}
        />
      ) : null}
      {createDc.isSuccess && detail.deliveryChallanId ? (
        <Note tone="green">
          Return challan issued:{' '}
          <Link
            to="/delivery-challans/$id"
            params={{ id: detail.deliveryChallanId }}
            className="mono fw-700"
            style={{ color: 'var(--cyan)', textDecoration: 'none' }}
          >
            {detail.deliveryChallanCode ?? createDc.data?.deliveryChallanCode}
          </Link>
        </Note>
      ) : null}

      <RelatedDocsPanel module="nc-register" id={detail.id} />

      {showDispose ? (
        <DisposeNcPanel
          nc={detail}
          jcCode={jcCode}
          jcOps={reworkOpOptions}
          canSeePrice={ncPerms.price}
          pending={dispose.isPending}
          error={
            dispose.isError
              ? dispose.error instanceof Error
                ? dispose.error.message
                : 'Failed to dispose NC'
              : null
          }
          result={disposeResult}
          onCancel={() => {
            setShowDispose(false);
            setDisposeResult(null);
            dispose.reset();
          }}
          onSubmit={async (input) => {
            try {
              // The panel stays open to show the child JC / remainder links;
              // "Done" on it is what closes it.
              setDisposeResult(await dispose.mutateAsync(input));
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
          {/* CODE/REV only on the live joined code; the itemCodeText fallback is
              what the reporter typed and stays bare. */}
          {detail.itemCode
            ? itemCodeWithRev(detail.itemCode, detail.itemRevision)
            : (detail.itemCodeText ?? '—')}{' '}
          — {detail.itemName ?? detail.itemNameText ?? ''}
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
        <InlinePair label="Reason Category:">
          {detail.reasonCategory.replaceAll('_', ' ')}
        </InlinePair>
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
        {/* Legacy in-route rework only — a new rework raises a child JC
            (linked below) and never sets rework_op_seq. */}
        {detail.reworkOpSeq != null ? (
          <InlinePair label="Rework Op:">Op{detail.reworkOpSeq}</InlinePair>
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
