// NC detail (UI-003-06). DisposeNcPanel inlined for the pending → disposed flow.
//
// QC–NC handling (docs/QC-NC-HANDLING-DESIGN.md §2–§5, §8): the page now
// carries the qty strip (rejected / cleared / failed / open), the links a
// recovery leaves behind (child JC, RTV challan, split siblings), the
// Create-DC form for a return-to-vendor NC, and one Close button that runs
// under the server's closure gate. The legacy in-route rework row (one with
// `reworkOpSeq`) keeps its old "Close rework" button.

import {
  type DisposeNcResult,
  type DocumentEditChange,
  NC_REASON_CATEGORY_LABELS,
  NC_STATUS_MOVES,
  type NcRegister,
  QTY_STEP,
  canMoveStatus,
  opSrNo,
} from '@innovic/shared';
import { Link, createRoute, useNavigate } from '@tanstack/react-router';
import { ArrowLeft, CheckCircle2, Loader2, Pencil, Shield, Stamp, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { usePendingEditForDoc } from '@/modules/document-edits/api';
import {
  PendingChangeChip,
  headerPendingChange,
} from '@/modules/document-edits/components/pending-change-chip';
import { fmtDate } from '@/lib/date';
import { Panel } from '@/ui/data';
import { ConfirmDialog } from '@/ui/feedback';
import { useCreateCapa } from '@/modules/capa/api';
import { useJcOpsEnriched } from '@/modules/op-entry/api';
import { AssignTaskButton } from '@/modules/tasks/components/assign-task-button';
import { DocumentHistory } from '@/components/shared/document-history';
import { RelatedDocsPanel } from '@/components/shared/related-docs-panel';
import { StatStrip } from '@/components/shared/stat-strip';
import { effectiveFormPerms, useMyAccess } from '@/lib/access-control';
import { itemCodeWithRev } from '@/lib/item-code';
import { soNoWithInternal } from '@/lib/so-number';
import { useSaveKey } from '@/lib/use-save-key';
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
import { NcTimelinePanel } from '@/modules/flow-views/components/nc-timeline-panel';

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
  // ADR-202 — edits staged against this NC and still waiting for a decision.
  // Their per-field changes drive the inline amber chips next to the record
  // fields below. Flattened across requests (usually one).
  const pendingEdit = usePendingEditForDoc('NonConformance', detail?.id);
  const pendingChanges = (pendingEdit.data?.rows ?? []).flatMap((r) => r.changes);
  const softDelete = useSoftDeleteNcRegister();
  const dispose = useDisposeNcRegister(id);
  const closeRework = useCloseNcRework(id);
  const closeNc = useCloseNc(id);
  // R2 — the Create DC panel's save carries one key per open page, reused on a retry.
  const saveKey = useSaveKey();
  const createDc = useCreateNcDc(id, saveKey);
  const createCapa = useCreateCapa();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleteReason, setDeleteReason] = useState('');
  const [showDispose, setShowDispose] = useState(false);
  const [disposeResult, setDisposeResult] = useState<DisposeNcResult | null>(null);
  const [reworkDoneQty, setReworkDoneQty] = useState<number | ''>('');
  const [closeError, setCloseError] = useState<string | null>(null);
  const [capaError, setCapaError] = useState<string | null>(null);

  // Full op list for the NC's JC — drives the dispose panel's legacy rework-op
  // dropdown (legacy `_disposeNC` renders every op of the JC, HTML L22637) and
  // resolves the human JC code.
  const { data: jcOps } = useJcOpsEnriched(
    { jobCardId: detail?.jobCardId ?? undefined },
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
          <div className="empty-state" style={{ color: 'var(--red2)' }}>
            {error instanceof Error ? error.message : 'NC not found. Refresh the page.'}
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
      <div className="empty-state" style={{ color: 'var(--amber2)', padding: 40 }}>
        You do not have permission to view this NC. Ask an admin.
      </div>
    );
  }

  const isPending = detail.status === 'pending';
  // S8 — the buttons that move the NC follow the allowed status moves.
  const mayMoveTo = (to: NcRegister['status']): boolean =>
    detail.status !== to && canMoveStatus(NC_STATUS_MOVES, detail.status, to);
  // A legacy in-route rework row is the one that carries rework_op_seq; only
  // it keeps the old "Close rework" path. Every new row closes through the
  // gate (design §3, interlock 6).
  const isLegacyRework = detail.reworkOpSeq != null;
  const isReworkDisposed =
    isLegacyRework && detail.status === 'disposed' && detail.disposition === 'rework';
  // Return-to-vendor, chosen but the challan not yet issued (design §5).
  const awaitingDc =
    detail.disposition === 'return_to_vendor' &&
    mayMoveTo('sent_to_vendor') &&
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
  const showClose = canEdit && !isPending && mayMoveTo('closed') && !isLegacyRework;

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
      const created = await createCapa.mutateAsync({
        type: 'Corrective',
        ncRefs: [detail.code],
        ...(jcCode ? { jcNo: jcCode } : {}),
        ...(detail.soCodeText ? { soNo: detail.soCodeText } : {}),
        ...(detail.itemCodeText ? { itemCode: detail.itemCodeText } : {}),
        ...(operation ? { operation } : {}),
        problem: detail.reason ?? NC_REASON_CATEGORY_LABELS[detail.reasonCategory],
        department: 'QC',
      });
      // Land on the new CAPA's 5-step edit, not the bare NC list.
      void navigate({
        to: '/nc-register',
        search: { tab: 'capa', capa: created.code, capaEdit: true },
      });
    } catch (e) {
      setCapaError(e instanceof Error ? e.message : 'Could not create CAPA. Try again.');
    }
  };

  // mutateAsync: ConfirmDialog keeps its buttons disabled while this runs and
  // shows a rejection in the dialog instead of closing it.
  const onDelete = async (): Promise<void> => {
    // ADR-197 — a delete says why; the dialog shows this error in place.
    const reason = deleteReason.trim();
    if (!reason) throw new Error('Reason is required.');
    await softDelete.mutateAsync({ id: detail.id, reason });
    setConfirmDelete(false);
    await navigate({ to: '/nc-register', replace: true });
  };

  const onCloseRework = async (): Promise<void> => {
    setCloseError(null);
    try {
      await closeRework.mutateAsync(
        reworkDoneQty === '' ? {} : { reworkDoneQty: Number(reworkDoneQty) },
      );
      setReworkDoneQty('');
    } catch (e) {
      setCloseError(e instanceof Error ? e.message : 'Could not close rework. Try again.');
    }
  };

  // The 409 body carries the exact shortfall; apiFetch puts it on
  // Error.message, so it is shown as-is.
  const onClose = async (): Promise<void> => {
    setCloseError(null);
    try {
      await closeNc.mutateAsync();
    } catch (e) {
      setCloseError(e instanceof Error ? e.message : 'Could not close the NC. Try again.');
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
              <NcStatusBadge status={detail.status} />
              {detail.linkedCapaCode ? (
                <Link
                  to="/nc-register"
                  search={{ tab: 'capa', capa: detail.linkedCapaCode }}
                  className="mono"
                  style={{
                    fontSize: 12,
                    color: 'var(--purple)',
                    fontWeight: 700,
                    textDecoration: 'none',
                  }}
                  title={`Open CAPA ${detail.linkedCapaCode}`}
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
                  Rework Completed Qty
                </span>
                <input
                  type="number"
                  min={0}
                  step={QTY_STEP}
                  className="innovic-input"
                  placeholder="Optional"
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
                  Close Rework
                </button>
              </>
            ) : null}
            {showClose ? (
              <>
                {detail.closeBlockedReason ? (
                  <span className="text3" style={{ fontSize: 11, maxWidth: 360 }}>
                    {detail.closeBlockedReason}
                  </span>
                ) : null}
                <button
                  type="button"
                  className="btn btn-success btn-sm"
                  onClick={() => void onClose()}
                  disabled={closeNc.isPending || detail.closeBlockedReason != null}
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
            {canEdit && isPending ? (
              <Link
                to="/nc-register/$id/edit"
                params={{ id: detail.id }}
                className="btn btn-ghost btn-sm"
              >
                <Pencil size={13} /> Edit
              </Link>
            ) : null}
            {canDelete && isPending ? (
              <button
                type="button"
                className="btn btn-danger btn-sm"
                onClick={() => {
                  setDeleteReason('');
                  setConfirmDelete(true);
                }}
              >
                <Trash2 size={13} /> Delete
              </button>
            ) : null}
          </div>
        </div>
        <div className="panel-body">
          {closeError || capaError ? (
            <div style={{ marginBottom: 10 }}>
              {closeError ? <Note tone="red">{closeError}</Note> : null}
              {capaError ? <Note tone="red">{capaError}</Note> : null}
            </div>
          ) : null}
          <DetailGrid detail={detail} jcCode={jcCode} pendingChanges={pendingChanges} />
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
              color: 'var(--red2)',
              title: 'Pieces this NC covers',
            },
            {
              key: 'cleared',
              label: 'Cleared',
              count: Number(detail.clearedQty),
              color: 'var(--green2)',
              title: 'Accepted at QC after recovery',
            },
            {
              key: 'failed',
              label: 'Rejected Again',
              count: Number(detail.failedQty),
              color: 'var(--amber2)',
              title: 'Rejected at QC after recovery',
            },
            {
              key: 'open',
              label: 'Open',
              count: ncOpenQty(detail),
              color: 'var(--blue)',
              title: 'Rejected − Cleared − Rejected Again',
            },
            ...(isRtv
              ? [
                  {
                    key: 'sent',
                    label: 'Sent',
                    count: Number(detail.rtvSentQty),
                    color: 'var(--blue)',
                    title: 'Sent on the return DC',
                  },
                  {
                    key: 'received',
                    label: 'Received',
                    count: Number(detail.rtvReceivedQty),
                    color: 'var(--cyan)',
                    title: 'Received back from the vendor',
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
                : 'Could not save DC. Try again.'
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
          DC saved:{' '}
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

      {/* Step-by-step path of this NC with qty and user (req. 3.5, read-only). */}
      <NcTimelinePanel ncId={detail.id} />

      <RelatedDocsPanel module="nc-register" id={detail.id} />

      {/* ADR-197 — every action on this NC: who, what, qty, before → after, why. */}
      <Panel title="History" bodyPadding="none" style={{ marginTop: 10 }}>
        <DocumentHistory entity="NonConformance" entityId={detail.id} refId={detail.code} />
      </Panel>

      {confirmDelete ? (
        <ConfirmDialog
          title={`Move NC ${detail.code} to Trash?`}
          message={
            <>
              You can restore it from Trash.
              <span className="form-grp" style={{ display: 'block', marginTop: 10 }}>
                <label className="form-label" htmlFor="nc-delete-reason">
                  Reason <span className="req">★</span>
                </label>
                <textarea
                  id="nc-delete-reason"
                  className="innovic-input"
                  rows={3}
                  maxLength={500}
                  value={deleteReason}
                  onChange={(e) => setDeleteReason(e.target.value)}
                />
              </span>
            </>
          }
          confirmLabel="Move to Trash"
          pendingLabel="Moving to Trash…"
          onConfirm={onDelete}
          onCancel={() => setConfirmDelete(false)}
        />
      ) : null}

      {showDispose ? (
        <DisposeNcPanel
          nc={detail}
          canApprove={ncPerms.approve}
          jcOps={reworkOpOptions}
          canSeePrice={ncPerms.price}
          pending={dispose.isPending}
          error={
            dispose.isError
              ? dispose.error instanceof Error
                ? dispose.error.message
                : 'Could not save disposition. Try again.'
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

function DetailGrid(props: {
  detail: NcRegister;
  jcCode: string | null;
  pendingChanges: readonly DocumentEditChange[];
}): React.JSX.Element {
  const { detail, jcCode, pendingChanges } = props;
  // Legacy renders "Op<seq>: <operation>" as one fused field (HTML L22729).
  const operation = detail.operationText ?? detail.qcOperationText;
  // Operation and Machine are no longer BOTH shown — that mixed two unrelated
  // facts on every NC. Which one is relevant follows the disposition:
  //   • rework            → the source-op MACHINE the rework runs back on
  //   • return_to_vendor  → the OPERATION the pieces go back out for
  //   • anything else / not yet disposed → the OPERATION (sensible default).
  const isReworkDisp = detail.disposition === 'rework';
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
        <CtxField label="NC Date">
          <b>{fmtDate(detail.ncDate)}</b>
          <Chip changes={pendingChanges} field="ncDate" />
        </CtxField>
        <CtxField label="JC No.">
          <b className="cyan">{jcCode ?? '—'}</b>
        </CtxField>
        <CtxField label="SO No.">
          <b>
            {detail.soCodeText ? soNoWithInternal(detail.soCodeText, detail.soInternalNo) : '—'}
          </b>
        </CtxField>
      </div>
      <div className="form-grid" style={{ fontSize: 12, marginBottom: 12 }}>
        {/* POL — the CUSTOMER's own PO line number off the SO line behind this
            NC's job card. Not our SO line number; the two rarely match. */}
        <InlinePair label="POL:">
          <span className="mono fw-700" style={{ color: 'var(--purple)' }}>
            {detail.clientPoLineNo ?? '—'}
          </span>
        </InlinePair>
        <InlinePair label="Item Code:">
          {/* SO pattern: the code strong-mono (td-code) in var(--text) so the
              part reads as THE value; the name quiet beside it. CODE/REV only on
              the live joined code; the itemCodeText fallback is what the reporter
              typed and stays bare. */}
          <span className="td-code" style={{ color: 'var(--text)' }}>
            {detail.itemCode
              ? itemCodeWithRev(detail.itemCode, detail.itemRevision)
              : (detail.itemCodeText ?? '—')}
          </span>
          {(detail.itemName ?? detail.itemNameText) ? (
            <span className="text3" style={{ marginLeft: 6, fontWeight: 400 }}>
              {detail.itemName ?? detail.itemNameText}
            </span>
          ) : null}
        </InlinePair>
        {/* Source of the rejected material. A vendor-sourced NC (sourceVendorId
            present, e.g. a GRN/OSP reject) shows the original vendor and its
            PO/GRN so the return-to-vendor route is clear. An in-house NC keeps
            the Rework-Machine XOR Operation display it always had. */}
        {detail.sourceVendorId ? (
          <>
            <InlinePair label="Source Vendor:">
              <span className="td-code" style={{ color: 'var(--text)' }}>
                {detail.sourceVendorCode ?? '—'}
              </span>
              {detail.sourceVendorName ? (
                <span className="text3" style={{ marginLeft: 6, fontWeight: 400 }}>
                  {detail.sourceVendorName}
                </span>
              ) : null}
            </InlinePair>
            {detail.sourcePoCode ? (
              <InlinePair label="Source PO No.:">
                <span className="td-code" style={{ color: 'var(--text)' }}>
                  {detail.sourcePoCode}
                </span>
              </InlinePair>
            ) : null}
            {detail.sourceGrnCode ? (
              <InlinePair label="Source GRN No.:">
                <span className="td-code" style={{ color: 'var(--text)' }}>
                  {detail.sourceGrnCode}
                </span>
              </InlinePair>
            ) : null}
          </>
        ) : isReworkDisp ? (
          <InlinePair label="Actual Machine:">{detail.machineCodeText ?? '—'}</InlinePair>
        ) : (
          <InlinePair label="Operation:">
            {/* Op numbers show in tens (display rule, see opSrNo). */}
            {detail.opSeq != null ? `Op ${opSrNo(detail.opSeq)}` : ''}
            {detail.opSeq != null && operation ? ' — ' : ''}
            {operation ?? (detail.opSeq == null ? '—' : '')}
          </InlinePair>
        )}
        <InlinePair label="Operator:">
          {detail.operatorText ?? '—'}
          <Chip changes={pendingChanges} field="operatorText" />
        </InlinePair>
        <InlinePair label="Reported By:">
          {detail.reportedByText ?? '—'}
          <Chip changes={pendingChanges} field="reportedByText" />
        </InlinePair>
        <InlinePair label="Reason Category:">
          {NC_REASON_CATEGORY_LABELS[detail.reasonCategory]}
          <Chip changes={pendingChanges} field="reasonCategory" />
        </InlinePair>
        <InlinePair label="Defect Description:">
          {detail.reason ?? '—'}
          <Chip changes={pendingChanges} field="reason" />
        </InlinePair>
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
      <div className="form-grid" style={{ fontSize: 12 }}>
        <InlinePair label="Disposition:">
          <NcDispositionBadge disposition={detail.disposition} />
        </InlinePair>
        <InlinePair label="Disposition Date:">{fmtDate(detail.dispositionDate)}</InlinePair>
        <InlinePair label="Disposed By:">{detail.dispositionByText ?? ''}</InlinePair>
        {/* Legacy in-route rework only — a new rework raises a child JC
            (linked below) and never sets rework_op_seq. */}
        {detail.reworkOpSeq != null ? (
          <InlinePair label="Rework Op:">Op {opSrNo(detail.reworkOpSeq)}</InlinePair>
        ) : null}
        {/* Not in legacy `_viewNC`, but legacy's LIST row shows "♻ n/m done"
            (HTML L22536) and our close-rework flow captures it. Kept. */}
        {detail.disposition === 'rework' && detail.reworkDoneQty ? (
          <InlinePair label="Rework Completed:">
            {Number(detail.reworkDoneQty)} of {Number(detail.rejectedQty)}
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
      <span className="text3" style={{ fontSize: 11 }}>
        {props.label}
      </span>
      <br />
      {props.children}
    </div>
  );
}

/** ADR-202 — the amber "→ after" chip for a record field with a staged edit
 *  waiting for approval. Matched on the NC edit diff's field key. Renders
 *  nothing when no edit is pending for that field. */
function Chip(props: {
  changes: readonly DocumentEditChange[];
  field: string;
}): React.JSX.Element | null {
  const c = headerPendingChange(props.changes, props.field);
  return c ? <PendingChangeChip after={c.after} /> : null;
}
