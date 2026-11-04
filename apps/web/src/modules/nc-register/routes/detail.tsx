// NC detail (UI-003-06). DisposeNcPanel inlined for the pending → disposed flow.
//
// QC–NC handling (docs/QC-NC-HANDLING-DESIGN.md §2–§5, §8): the page now
// carries the qty strip (rejected / cleared / failed / open), the links a
// recovery leaves behind (child JC, RTV challan, split siblings), the
// Create-DC form for a return-to-vendor NC, and one Close button that runs
// under the server's closure gate. The legacy in-route rework row (one with
// `reworkOpSeq`) keeps its old "Close rework" button.
//
// 2026-11-04 (owner): DetailHeader + ClusterGrid facts; History and Related
// Documents are tabs, as on Sales Order detail. The StatStrip stays.

import { Icon } from '@/ui/core';
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
import { ArrowLeft, CheckCircle2, Loader2, Shield, Stamp } from 'lucide-react';
import { useState } from 'react';
import { useCanOpen } from '@/components/shared/action-link';
import { undecidedChangesOf, usePendingEditForDoc } from '@/modules/document-edits/api';
import {
  PendingChangeChip,
  headerPendingChange,
} from '@/modules/document-edits/components/pending-change-chip';
import { fmtDate } from '@/lib/date';
import { Cluster, ClusterFact, ClusterGrid } from '@/ui/forms';
import { ActionMenu, DetailHeader } from '@/ui/layout';
import { ConfirmDialog, useToast } from '@/ui/feedback';
import { useCreateCapa } from '@/modules/capa/api';
import { useJcOpsEnriched } from '@/modules/op-entry/api';
import { AssignTaskButton } from '@/modules/tasks/components/assign-task-button';
import { useHistoryTab } from '@/components/shared/document-history';
import { RelatedDocsTabs } from '@/components/shared/related-docs-tabs';
import { StatStrip } from '@/components/shared/stat-strip';
import { canDeleteRecords, effectiveFormPerms, useMyAccess } from '@/lib/access-control';
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
import { useNcPrint } from '../components/use-nc-print';
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
  // ADR-234 — the saved DC's code links only for someone who may open DCs.
  const canOpenDc = useCanOpen()('/delivery-challans/$id');
  // ADR-202 — edits staged against this NC and still waiting for a decision.
  // Their per-field changes drive the inline amber chips next to the record
  // fields below. Flattened across requests (usually one).
  const pendingEdit = usePendingEditForDoc('NonConformance', detail?.id);
  // ADR-197 — every action on this NC: who, what, qty, before → after, why.
  // Called before the early returns (hooks rule).
  const historyTab = useHistoryTab({
    entity: 'NonConformance',
    entityId: detail?.id,
    refId: detail?.code,
  });
  const pendingChanges = undecidedChangesOf(pendingEdit.data?.rows);
  // ADR-202 — any pending edit overlays grey "Draft" on the status chip.
  const isDraft = (pendingEdit.data?.rows?.length ?? 0) > 0;
  const toast = useToast();
  const softDelete = useSoftDeleteNcRegister();
  const dispose = useDisposeNcRegister(id);
  const closeRework = useCloseNcRework(id);
  const closeNc = useCloseNc(id);
  // R2 — the Create DC panel's save carries one key per open page, reused on a retry.
  const saveKey = useSaveKey();
  const createDc = useCreateNcDc(id, saveKey);
  const createCapa = useCreateCapa();
  // ⋯ Preview / ⬇ Download PDF — the NC Report (use-nc-print).
  const ncPrint = useNcPrint();
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
          <div style={{ marginBottom: 'var(--sp-2)' }}>
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
  // ADR-247 — a customer-material NC (Party GRN Incoming QC) is never reworked
  // and never goes back to a vendor; its return is an IN-CMR, not a vendor DC.
  const isPartyNc = detail.partyGrnLineId != null;
  const isReworkDisposed =
    !isPartyNc && isLegacyRework && detail.status === 'disposed' && detail.disposition === 'rework';
  // Return-to-vendor, chosen but the challan not yet issued (design §5).
  const awaitingDc =
    !isPartyNc &&
    detail.disposition === 'return_to_vendor' &&
    mayMoveTo('sent_to_vendor') &&
    !detail.deliveryChallanId;
  const isRtv = detail.disposition === 'return_to_vendor';
  // Tier-driven, per department (QC). Was a global role string
  // (admin||manager||operator) that ignored the user's actual QC tier.
  const ncPerms = effectiveFormPerms(eff, 'nc_dispose');
  // ADR-231 — Dispose / Close Rework / Close move a saved NC to its next step
  // → `advance` (L2 and above). Correcting the NC (Edit) stays `edit`.
  const canAdvance = ncPerms.advance;
  const canEdit = ncPerms.edit;
  // The RTV challan is an outward DC: OSP Outward DC entry ALONE raises it, on
  // every route (ADR-211, owner) — no NC edit right needed. Disposing the NC
  // (the Advance gate above) stays with QC.
  const canCreateDc = effectiveFormPerms(eff, 'ospdc_create').entry;
  // ADR-232 (owner, 2026-10-15): deleting any record is Super Admin only.
  const canDelete = canDeleteRecords(eff);
  // The button creates a CAPA, so it follows the CAPA form key, not nc_dispose.
  const canCreateCapaRecord = effectiveFormPerms(eff, 'capa_create').entry;
  // "Create CAPA" only once the NC is disposed/closed and has no linked CAPA
  // (legacy: button shows when status !== 'pending' && !_capaForNC(ncNo)).
  const showCreateCapa = canCreateCapaRecord && !isPending && !detail.linkedCapaCode;
  // The gate-driven Close: any non-legacy row that has been dispositioned and
  // is not yet closed. Disabled (never hidden) while the server says why not,
  // so the operator sees the shortfall rather than a missing button.
  const showClose = canAdvance && !isPending && mayMoveTo('closed') && !isLegacyRework;

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
      toast.ok(`CAPA ${created.code} saved`);
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
      toast.ok(`Rework on NC ${detail.code} closed`);
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
      toast.ok(`NC ${detail.code} closed`);
    } catch (e) {
      setCloseError(e instanceof Error ? e.message : 'Could not close the NC. Try again.');
    }
  };

  return (
    <div>
      <DetailHeader
        backLabel="Back to NC Register"
        backTo="/nc-register"
        renderLink={(p) => <Link {...p} />}
        code={detail.code}
        badges={
          <>
            <NcStatusBadge status={detail.status} draft={isDraft} />
            {detail.linkedCapaCode ? (
              <Link
                to="/nc-register"
                search={{ tab: 'capa', capa: detail.linkedCapaCode }}
                className="mono"
                style={{
                  fontSize: 'var(--fs-sm)',
                  color: 'var(--blue)',
                  fontWeight: 700,
                  textDecoration: 'none',
                }}
                title={`Open CAPA ${detail.linkedCapaCode}`}
              >
                🛡 {detail.linkedCapaCode}
              </Link>
            ) : null}
          </>
        }
        actions={
          // Up to eight controls on a disposed NC, so this row wraps.
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
            <ActionMenu
              items={[
                {
                  label: 'Preview',
                  onClick: () =>
                    void ncPrint('preview', { id: detail.id, code: detail.code, jcCode }, isDraft),
                },
                {
                  label: 'Download PDF',
                  icon: 'download',
                  onClick: () =>
                    void ncPrint('download', { id: detail.id, code: detail.code, jcCode }, isDraft),
                },
              ]}
            />
            {isPending && canAdvance ? (
              <button
                type="button"
                className="btn btn-primary btn-sm"
                onClick={() => setShowDispose(true)}
                disabled={showDispose}
                title={showDispose ? 'The Dispose form is already open' : undefined}
              >
                <Stamp size={13} /> Dispose
              </button>
            ) : null}
            {isReworkDisposed && canAdvance ? (
              <>
                <span className="text3" style={{ fontSize: 'var(--fs-xs)' }}>
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
                  style={{ width: 90, fontSize: 'var(--fs-sm)' }}
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
                  <span className="text3" style={{ fontSize: 'var(--fs-xs)', maxWidth: 360 }}>
                    {detail.closeBlockedReason}
                  </span>
                ) : null}
                <button
                  type="button"
                  className="btn btn-success btn-sm"
                  onClick={() => void onClose()}
                  disabled={closeNc.isPending || detail.closeBlockedReason != null}
                  title={detail.closeBlockedReason ?? undefined}
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
                <Icon name="pencil" size={13} /> Edit
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
                <Icon name="trash-2" size={13} /> Delete
              </button>
            ) : null}
          </div>
        }
      >
        {closeError || capaError ? (
          <div style={{ marginBottom: 10 }}>
            {closeError ? <Note tone="red">{closeError}</Note> : null}
            {capaError ? <Note tone="red">{capaError}</Note> : null}
          </div>
        ) : null}
        <ClusterGrid stack>
          <DetailClusters detail={detail} jcCode={jcCode} pendingChanges={pendingChanges} />
          {detail.disposition || detail.dispositionDate ? (
            <DispositionCluster detail={detail} />
          ) : null}
          <NcLinksBlock detail={detail} splitParent={splitParent ?? null} siblings={siblings} />
        </ClusterGrid>
      </DetailHeader>

      {/* Where the rejected pieces stand (design §3). One strip, not cards. */}
      <div style={{ margin: '10px 0' }}>
        <StatStrip
          items={[
            {
              key: 'rejected',
              label: 'Deviated',
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
              title: 'Deviated − Cleared − Rejected Again',
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
            disabled={!canOpenDc}
            className="mono fw-700"
            style={{ color: 'var(--cyan)', textDecoration: 'none' }}
          >
            {detail.deliveryChallanCode ?? createDc.data?.deliveryChallanCode}
          </Link>
        </Note>
      ) : null}

      {/* Step-by-step path of this NC with qty and user (req. 3.5, read-only). */}
      <NcTimelinePanel ncId={detail.id} />

      <RelatedDocsTabs module="nc-register" id={detail.id} extraTabs={[historyTab]} />

      {confirmDelete ? (
        <ConfirmDialog
          title={`Move NC ${detail.code} to Trash?`}
          message={
            <>
              You can restore it from Trash.
              <span className="form-grp" style={{ display: 'block', marginTop: 10 }}>
                <label className="form-label" htmlFor="nc-delete-reason">
                  Reason<span className="req">★</span>
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

/** The NC's facts, in the order they are read: which job, which part, where the
 *  pieces came from, what is wrong. Rendered inside the page's one ClusterGrid. */
function DetailClusters(props: {
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
  const itemName = detail.itemName ?? detail.itemNameText;
  const itemCode = detail.itemCode
    ? itemCodeWithRev(detail.itemCode, detail.itemRevision)
    : (detail.itemCodeText ?? '—');
  // The vendor's cell takes whatever the row has left, so the row stays full.
  const vendorDocs = [
    detail.sourcePoCode,
    detail.sourceGrnCode,
    detail.sourceDeliveryChallanCode,
  ].filter(Boolean).length;
  return (
    <>
      <Cluster name="Reference">
        <ClusterFact
          num
          label="NC Date"
          value={fmtDate(detail.ncDate)}
          after={<Chip changes={pendingChanges} field="ncDate" />}
        />
        <ClusterFact num label="JC No." empty={!jcCode} value={jcCode ?? '—'} />
        <ClusterFact
          num
          label="SO No."
          empty={!detail.soCodeText}
          value={detail.soCodeText ? soNoWithInternal(detail.soCodeText, detail.soInternalNo) : '—'}
        />
        {/* POL — the CUSTOMER's own PO line number off the SO line behind this
            NC's job card. Not our SO line number; the two rarely match. */}
        <ClusterFact
          num
          label="POL"
          empty={!detail.clientPoLineNo}
          value={
            detail.clientPoLineNo ? (
              <span style={{ color: 'var(--purple)' }}>{detail.clientPoLineNo}</span>
            ) : (
              '—'
            )
          }
        />
      </Cluster>

      <Cluster name="Part">
        {/* SO pattern: the code strong-mono (td-code) in var(--text) so the part
            reads as THE value; the name quiet beside it. CODE/REV only on the
            live joined code; the itemCodeText fallback is what the reporter
            typed and stays bare. */}
        <ClusterFact
          span={2}
          label="Item Code"
          title={itemName ? `${itemCode} ${itemName}` : itemCode}
          value={
            <>
              <span className="td-code" style={{ color: 'var(--text)' }}>
                {itemCode}
              </span>
              {itemName ? (
                <span className="text3" style={{ marginLeft: 6, fontWeight: 400 }}>
                  {itemName}
                </span>
              ) : null}
            </>
          }
        />
        <ClusterFact
          label="Operator"
          empty={!detail.operatorText}
          value={detail.operatorText ?? '—'}
          after={<Chip changes={pendingChanges} field="operatorText" />}
        />
        {/* `||`, not `??`: a cleared Reported By can reach the column as a blank
            string as well as NULL, and both mean "nobody named". Both must read
            as the dash, not as an empty gap. */}
        <ClusterFact
          label="Reported By"
          empty={!detail.reportedByText}
          value={detail.reportedByText || '—'}
          after={<Chip changes={pendingChanges} field="reportedByText" />}
        />
      </Cluster>

      {/* Source of the rejected material. A vendor-sourced NC (sourceVendorId
          present, e.g. a GRN/OSP reject) shows the original vendor and its
          PO/GRN so the return-to-vendor route is clear. An in-house NC keeps
          the Rework-Machine XOR Operation display it always had. */}
      <Cluster name="Source">
        {/* ADR-247 — customer material deviated at Party GRN Incoming QC. */}
        {detail.partyGrnLineId ? (
          <>
            <ClusterFact label="Source" value="Customer material" />
            <ClusterFact
              label="Customer"
              empty={!detail.sourceCustomerName}
              value={detail.sourceCustomerName ?? '—'}
            />
            <ClusterFact
              num
              label="JWSO No."
              empty={!detail.sourceJwCode}
              value={detail.sourceJwCode ?? '—'}
            />
            <ClusterFact
              num
              label="Party GRN No."
              empty={!detail.sourcePartyGrnCode}
              value={detail.sourcePartyGrnCode ?? '—'}
            />
          </>
        ) : detail.sourceVendorId ? (
          <>
            <ClusterFact
              span={vendorDocs === 3 ? 1 : vendorDocs === 2 ? 2 : vendorDocs === 1 ? 3 : 4}
              label="Source Vendor"
              empty={!detail.sourceVendorCode && !detail.sourceVendorName}
              title={
                detail.sourceVendorName
                  ? `${detail.sourceVendorCode ?? '—'} ${detail.sourceVendorName}`
                  : undefined
              }
              value={
                <>
                  <span className="td-code" style={{ color: 'var(--text)' }}>
                    {detail.sourceVendorCode ?? '—'}
                  </span>
                  {detail.sourceVendorName ? (
                    <span className="text3" style={{ marginLeft: 6, fontWeight: 400 }}>
                      {detail.sourceVendorName}
                    </span>
                  ) : null}
                </>
              }
            />
            {detail.sourcePoCode ? (
              <ClusterFact num label="Source PO No." value={detail.sourcePoCode} />
            ) : null}
            {detail.sourceGrnCode ? (
              <ClusterFact num label="Source GRN No." value={detail.sourceGrnCode} />
            ) : null}
            {/* ADR-217 Phase 2 — the OUTWARD challan the rejected pieces went
                out on, the number the STORE holds. Stored on the NC, asked for
                at disposition and never guessed, so null is a correct answer
                and shows nothing at all rather than a wrong challan. Same
                grouping and same `Sent on DC No.` label (docs/NAMING.md) the
                GRN Against NC tab uses for the same fact. */}
            {detail.sourceDeliveryChallanCode ? (
              <ClusterFact num label="Sent on DC No." value={detail.sourceDeliveryChallanCode} />
            ) : null}
          </>
        ) : isReworkDisp ? (
          <ClusterFact
            span={4}
            label="Actual Machine"
            empty={!detail.machineCodeText}
            value={detail.machineCodeText ?? '—'}
          />
        ) : (
          <ClusterFact
            span={4}
            label="Operation"
            empty={detail.opSeq == null && !operation}
            value={
              /* Op numbers show in tens (display rule, see opSrNo). */
              <>
                {detail.opSeq != null ? `Op ${opSrNo(detail.opSeq)}` : ''}
                {detail.opSeq != null && operation ? ' — ' : ''}
                {operation ?? (detail.opSeq == null ? '—' : '')}
              </>
            }
          />
        )}
      </Cluster>

      <Cluster name="Defect">
        <ClusterFact
          label="Reason Category"
          value={NC_REASON_CATEGORY_LABELS[detail.reasonCategory]}
          after={<Chip changes={pendingChanges} field="reasonCategory" />}
        />
        <ClusterFact
          span={detail.timeLogged ? 2 : 3}
          wrap
          label="Defect Description"
          empty={!detail.reason}
          value={detail.reason ?? '—'}
          after={<Chip changes={pendingChanges} field="reason" />}
        />
        {detail.timeLogged ? <ClusterFact label="Time Logged" value={detail.timeLogged} /> : null}
      </Cluster>
    </>
  );
}

/** What was decided about the rejected pieces. Up to eight facts, so `wide`. */
function DispositionCluster(props: { detail: NcRegister }): React.JSX.Element {
  const { detail } = props;
  return (
    <Cluster name="Disposition" wide>
      <ClusterFact
        label="Disposition"
        value={<NcDispositionBadge disposition={detail.disposition} />}
      />
      <ClusterFact
        num
        label="Disposition Date"
        empty={!detail.dispositionDate}
        value={fmtDate(detail.dispositionDate)}
      />
      <ClusterFact
        label="Disposed By"
        empty={!detail.dispositionByText}
        value={detail.dispositionByText ?? '—'}
      />
      {/* Legacy in-route rework only — a new rework raises a child JC (linked
          below) and never sets rework_op_seq. */}
      {detail.reworkOpSeq != null ? (
        <ClusterFact num label="Rework Op" value={`Op ${opSrNo(detail.reworkOpSeq)}`} />
      ) : null}
      {/* Not in legacy `_viewNC`, but legacy's LIST row shows "♻ n/m done"
          (HTML L22536) and our close-rework flow captures it. Kept. */}
      {detail.disposition === 'rework' && detail.reworkDoneQty ? (
        <ClusterFact
          num
          label="Rework Completed"
          value={`${Number(detail.reworkDoneQty)} of ${Number(detail.rejectedQty)}`}
        />
      ) : null}
      {detail.disposition === 'scrap' && Number(detail.scrapCost) > 0 ? (
        <ClusterFact
          num
          label="Scrap Cost"
          value={<span className="red">₹{Number(detail.scrapCost).toFixed(2)}</span>}
        />
      ) : null}
      {detail.disposition === 'make_fresh' && detail.reworkJcCodeText ? (
        <ClusterFact
          num
          label="New JC"
          value={<span className="cyan">{detail.reworkJcCodeText}</span>}
        />
      ) : null}
      {detail.dispositionRemarks ? (
        <ClusterFact span={2} wrap label="Remarks" value={detail.dispositionRemarks} />
      ) : null}
    </Cluster>
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
