// GRN detail (UI-003-05) — the page: permissions, data, the header chrome
// (buttons, QC badge, delete confirm) and the panels in order.
//
// The two panels that carry the content live beside it, split out 2026-10-06
// under CLAUDE.md §12's 400-line cap:
//   components/grn-detail-header.tsx   the identity line + the four clusters
//   components/grn-detail-lines.tsx    the lines table, the ▸ and the totals
//
// Every figure the two of them show comes from `components/grn-receipt-figures
// .ts`, the one leaf shared with the create and edit screens — so a GRN cannot
// read one way on Edit and another here.
//
// What the layout replaced, and why, is written at the top of
// `grn-detail-header.tsx`. This file owns ONE judgement the panels do not make:
// whether this receipt has an account at all. See `againstPo` below.

import type { GrnQcStatus } from '@innovic/shared';
import { Link, createRoute, useNavigate } from '@tanstack/react-router';
import { ArrowLeft, Loader2 } from 'lucide-react';
import { useState } from 'react';
import { usePendingEditForDoc } from '@/modules/document-edits/api';
import { CancelDocDialog } from '@/modules/cancel-requests/components/cancel-doc-dialog';
import { CancelPendingBanner } from '@/modules/cancel-requests/components/cancel-pending-banner';
import { AssignTaskButton } from '@/modules/tasks/components/assign-task-button';
import { ActionLink } from '@/components/shared/action-link';
import { DocumentHistory } from '@/components/shared/document-history';
import { RelatedDocsPanel } from '@/components/shared/related-docs-panel';
import { canDeleteRecords, effectiveFormPerms, useMyAccess } from '@/lib/access-control';
import { LIVE_FALLBACK_POLL_MS } from '@/lib/live-updates/constants';
import { authenticatedRoute } from '@/routes/_authenticated';
import { Panel } from '@/ui/data';
import { Banner, ConfirmDialog } from '@/ui/feedback';
import { fmtDateTime } from '@/lib/date';
import { ActionMenu } from '@/ui/layout';
import { useSession } from '@/lib/session';
import { useMyCompany } from '@/modules/settings/api';
import { usePrintTemplates } from '@/modules/print-templates/api';
import { useVendor } from '@/modules/vendors/api';
import { useGoodsReceiptNote, useSoftDeleteGoodsReceiptNote } from '../api';
import { receiptAccount } from '../components/grn-receipt-figures';
import { ReceiptGrid, ReceiptIdent } from '../components/grn-detail-header';
import { GrnDetailLines } from '../components/grn-detail-lines';
import { grnTypeLabel } from '../components/grn-list-columns';
import { QcStatusBadge } from '../components/qc-status-badge';
import { printGrn } from '../lib/print-grn';
import { runPrint } from '@/lib/print/preview-host';

export const goodsReceiptNoteDetailRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: 'goods-receipt-notes/$id',
  component: GoodsReceiptNoteDetailPage,
});

function GoodsReceiptNoteDetailPage(): React.JSX.Element {
  const { id } = goodsReceiptNoteDetailRoute.useParams();
  const navigate = useNavigate();
  const {
    data: detail,
    isLoading,
    isError,
    error,
  } = useGoodsReceiptNote(id, { refetchInterval: LIVE_FALLBACK_POLL_MS });
  // ADR-202 — the edit(s) staged against this GRN and still waiting for a
  // decision. Their per-field changes drive the inline amber chips next to the
  // record fields in the header grid. Flattened across requests (usually one).
  const pendingEdit = usePendingEditForDoc('GoodsReceiptNote', id);
  const pendingChanges = (pendingEdit.data?.rows ?? []).flatMap((r) => r.changes);
  // ADR-202 — any pending edit overlays grey "Draft" on the status chip.
  const isDraft = (pendingEdit.data?.rows?.length ?? 0) > 0;
  // Tier-driven, per department (Store). Was role admin/manager for Edit and
  // role admin for Delete.
  const { data: eff } = useMyAccess();
  const perms = effectiveFormPerms(eff, 'grn_create');
  const softDelete = useSoftDeleteGoodsReceiptNote();
  const { data: company } = useMyCompany();
  const { data: me } = useSession();
  // Vendor row + the effective GRN print blocks, so the printed sheet can fill
  // {vendorAddress}/{vendorGSTIN}/{vendorContact} and render whatever an admin
  // wrote in Settings → Print Templates. Same wiring the OSP DC detail uses.
  const { data: vendor } = useVendor(detail?.vendorId ?? undefined);
  const { data: templates, isLoading: templatesLoading } = usePrintTemplates();
  const [confirmDelete, setConfirmDelete] = useState(false);
  // Why it is being moved to Trash — required (ADR-197), shown on History.
  const [deleteReason, setDeleteReason] = useState('');
  // ADR-235 — the ONE standard Cancel dialog (docType 'grn').
  const [cancelOpen, setCancelOpen] = useState(false);

  // "Hide page" (Access Control → Config): once access has loaded, a user whose
  // VIEW was removed for this page sees the no-access panel, not the page. `eff`
  // is undefined only while access loads — don't block then, or every legitimate
  // user flashes this panel on cold load.
  if (eff && !perms.view) {
    return (
      <div className="empty-state" style={{ color: 'var(--amber2)', padding: 40 }}>
        You do not have permission to view GRNs. Ask an admin.
      </div>
    );
  }

  if (isLoading) {
    return (
      <div>
        <Loader2 className="inline h-4 w-4 animate-spin" /> Loading goods receipt note…
      </div>
    );
  }
  if (isError || !detail) {
    return (
      <div className="panel">
        <div className="panel-body">
          <div style={{ marginBottom: 8 }}>
            <Link to="/goods-receipt-notes" className="btn btn-ghost btn-sm">
              <ArrowLeft size={14} /> Back
            </Link>
          </div>
          <div className="empty-state" style={{ color: 'var(--red2)' }}>
            {error instanceof Error ? error.message : 'GRN not found. Refresh the page.'}
          </div>
        </div>
      </div>
    );
  }

  // mutateAsync: ConfirmDialog stays pending while it runs and shows a
  // rejection inside the dialog instead of closing.
  const onDelete = async (): Promise<void> => {
    const reason = deleteReason.trim();
    if (!reason) throw new Error('Enter the reason for moving this GRN to Trash.');
    await softDelete.mutateAsync({ id: detail.id, reason });
    setConfirmDelete(false);
    await navigate({ to: '/goods-receipt-notes', replace: true });
  };

  // Print follows the page's existing VIEW permission — if you can read the
  // GRN you may put it on paper. No new gate is introduced.
  const printArgs = {
    grn: detail,
    vendor,
    company,
    templates: templates?.items ?? [],
    currentUser: me?.email,
    draft: isDraft,
  };
  const onPrint = (): void => {
    const ok = printGrn(printArgs);
    if (!ok) window.alert('Allow popups to print.');
  };
  // ⬇ Download PDF — the same sheet as Preview, saved as `<GRN code>.pdf`.
  const onDownload = (): Promise<void> =>
    runPrint(
      'download',
      { title: 'Goods Receipt Note', fileName: detail.code },
      async () => () => printGrn(printArgs),
    );

  // ADR-235 — a Cancelled GRN is read-only: no Edit, no Incoming QC, no Delete.
  const cancelled = Boolean(detail.cancelledAt);
  // Cancel GRN -> Edit OR Approve: Edit sends a Cancel Request, Approve decides
  // it. The dialog reads the server's preview for which buttons this user gets.
  const canCancel = !cancelled && (perms.edit || perms.approve);
  const canEdit = perms.edit && !cancelled;
  // ADR-234 — Assign Task: the same Advance gate as the GRN list ⋯.
  const canAssign = perms.advance;
  // ADR-234 — "Open in Incoming QC" deep-links to the Inspect popup, whose save
  // needs Incoming QC Entry. False while access loads (no flash).
  const canInspect = !!eff && effectiveFormPerms(eff, 'qc_incoming').entry;
  // ADR-232 (owner, 2026-10-15): deleting any record is Super Admin only.
  const canDelete = canDeleteRecords(eff);

  // ADR-189: a GRN with ANY inspected qty (not only a fully cleared line)
  // cannot be deleted — the server refuses it, so the menu says so up front.
  const anyInspected = detail.lines.some(
    (l) => l.qcStatus === 'completed' || l.qcAcceptedQty + l.qcRejectedQty > 0,
  );
  // The next step for a GRN is Incoming QC. `?line=` deep-links straight to
  // the Inspect popup for that GRN line (incoming-qc/routes/index.tsx).
  const firstQcPending = detail.lines.find((l) => l.qcStatus !== 'completed');
  // Header QC status — same rule as the GRN list card and tile: cleared once
  // every line is inspected, "In Progress" only when a line's QC status is
  // 'in_progress', else pending.
  const headerQcStatus: GrnQcStatus =
    detail.lines.length > 0 && !firstQcPending
      ? 'completed'
      : detail.lines.some((l) => l.qcStatus === 'in_progress')
        ? 'in_progress'
        : 'pending';

  // `GRN Type` once, for the identity line and the first cluster. Neither panel
  // re-derives it.
  const grnType = grnTypeLabel(detail);

  // THE page's own judgement: the receipt account (PO Qty → Received Earlier →
  // Received → To Receive) and the lines table's `PO Qty` column are AGAINST-PO
  // ONLY. `grnTypeLabel` is the one place the three sources are told apart —
  // the same NC → DC → PO order the Open NC / Open DC / Open PO buttons below
  // use — so the test is read off it rather than spelt out a second time.
  // Why the other two types get no account:
  //   - the figure a clerk types a DC or NC receipt against is the challan's
  //     `Sent Qty`, not the purchase-order line's qty. Both sides DO come back
  //     populated on those GRNs (a job-work DC hangs off a JW PO, which has a
  //     line with a quantity), so this is not a null check — it is the wrong
  //     fact. The GRN detail response carries no challan quantity, so the
  //     equivalent account cannot be built here at all; printing the PO line's
  //     qty under either label would put a number on screen that disagrees
  //     with what the clerk entered against.
  //   - on a replacement GRN (`ncId` set) the API deliberately leaves that
  //     GRN's own receipt inside `Received Earlier`, because the PO's received
  //     column excludes replacement receipts until QC clears them. `PO Qty −
  //     Received Earlier − Received` would then understate what is still owed
  //     by exactly this line's Received. Suppressing the account keeps that
  //     figure off the screen.
  // `receiptAccount` owns all four of its own terms and withholds the account
  // unless EVERY line traces to an ordered line — the same rule, from the same
  // function, that the create and edit screens obey.
  const againstPo = grnType === 'Direct Purchase';
  const account = againstPo ? receiptAccount(detail.lines) : null;

  return (
    <div>
      <Link to="/goods-receipt-notes" className="btn btn-ghost btn-sm" style={{ marginBottom: 10 }}>
        <ArrowLeft size={14} /> Back to GRN list
      </Link>

      <div className="panel">
        <div className="panel-hdr">
          {/* The GRN code and the vendor used to BE this header (an unlabelled
              16px code and the vendor as the panel title). Both are identity,
              not facts about the receipt, so they moved into the identity line
              in the body and the panel says what the panel is. The QC badge
              stays. */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span className="panel-title">Receipt</span>
            <QcStatusBadge status={headerQcStatus} draft={isDraft} />
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            {canAssign ? (
              <AssignTaskButton
                linkedRef={{
                  type: 'grn',
                  id: detail.id,
                  display: `GRN ${detail.code}`,
                  navPage: `/goods-receipt-notes/${detail.id}`,
                }}
                suggestedTitle={`Follow up on GRN ${detail.code}`}
              />
            ) : null}
            {detail.purchaseOrderId ? (
              <ActionLink
                to="/purchase-orders/$id"
                params={{ id: detail.purchaseOrderId }}
                className="btn btn-ghost btn-sm"
              >
                Open PO
              </ActionLink>
            ) : null}
            {/* Set only on a GRN raised by receiving an NC's return-to-vendor
                challan (Against NC, ADR-161). */}
            {detail.ncId ? (
              <ActionLink
                to="/nc-register/$id"
                params={{ id: detail.ncId }}
                className="btn btn-ghost btn-sm"
              >
                Open NC
              </ActionLink>
            ) : null}
            {/* Set only on a GRN the DC receive auto-raised (Against JW PO / DC
                or Against NC — both come back through the challan). */}
            {detail.deliveryChallanId ? (
              <ActionLink
                to="/delivery-challans/$id"
                params={{ id: detail.deliveryChallanId }}
                className="btn btn-ghost btn-sm"
              >
                Open DC
              </ActionLink>
            ) : null}
            {/* Print stays disabled until the print blocks land. Printing early
                is worse than waiting: the sheet comes out looking complete but
                carries none of the special notes, terms, footer or signature an
                admin wrote, and nothing on it says so. Delete opens the inline
                "Move to Trash?" confirm below. */}
            <ActionMenu
              items={[
                {
                  label: 'Preview',
                  onClick: onPrint,
                  disabled: templatesLoading,
                  title: templatesLoading ? 'Loading print templates…' : 'Preview this GRN',
                },
                {
                  label: '⬇ Download PDF',
                  onClick: () => void onDownload(),
                  disabled: templatesLoading,
                  title: templatesLoading
                    ? 'Loading print templates…'
                    : 'Download this GRN as a PDF',
                },
                {
                  label: 'Edit',
                  onClick: () =>
                    void navigate({
                      to: '/goods-receipt-notes/$id/edit',
                      params: { id: detail.id },
                    }),
                  hidden: !canEdit,
                },
                {
                  label: 'Delete',
                  danger: true,
                  onClick: () => {
                    softDelete.reset();
                    setDeleteReason('');
                    setConfirmDelete(true);
                  },
                  hidden: !canDelete || cancelled,
                  disabled: anyInspected,
                  title: anyInspected
                    ? 'Incoming QC has already inspected a line, so this GRN cannot be moved to Trash.'
                    : undefined,
                },
                {
                  label: 'Cancel GRN',
                  danger: true,
                  onClick: () => setCancelOpen(true),
                  hidden: !canCancel,
                },
              ]}
            />
            {/* The one next step: while any line still waits for QC. */}
            {/* ADR-251: Incoming QC lists only GRNs Against PO; an OSP return
                (Against JW PO / DC) or NC return is inspected on the QC Call
                Register. Same `grnTypeLabel` rule as the identity line. */}
            {firstQcPending && canInspect && !cancelled ? (
              grnType === 'Against NC' || grnType === 'Against JW PO / DC' ? (
                <Link
                  to="/qc-call-register"
                  search={{ line: firstQcPending.id }}
                  className="btn btn-primary"
                >
                  Open in QC Call Register
                </Link>
              ) : (
                <Link
                  to="/incoming-qc"
                  search={{ line: firstQcPending.id }}
                  className="btn btn-primary"
                >
                  Open in Incoming QC
                </Link>
              )
            ) : null}
          </div>
        </div>
        <div className="panel-body">
          <ReceiptIdent detail={detail} grnType={grnType} />
          <ReceiptGrid
            detail={detail}
            vendor={vendor}
            pendingChanges={pendingChanges}
            grnType={grnType}
            account={account}
          />
        </div>
      </div>

      {/* ADR-235 — an open Cancel Request (orange), or the Cancelled mark (red). */}
      <CancelPendingBanner
        docType="grn"
        docId={detail.id}
        cancelled={cancelled}
        {...(canCancel ? { onOpen: () => setCancelOpen(true) } : {})}
      />
      {cancelled ? (
        <div className="mb-2">
          <Banner tone="error" accent title="Cancelled — this GRN is void">
            <div>
              Reason: <b>{detail.cancelReason ?? '—'}</b>
              {detail.cancelledAt ? ` · ${fmtDateTime(detail.cancelledAt)}` : ''}
            </div>
          </Banner>
        </div>
      ) : null}

      <GrnDetailLines
        lines={detail.lines}
        againstPo={againstPo}
        poQtyTotal={account ? account.poQty : null}
      />

      <RelatedDocsPanel module="goods-receipt-notes" id={detail.id} />

      {/* ADR-197 — this GRN's own History: create, edits (before → after),
          Incoming QC per line (inspector + accepted qty), delete. */}
      <Panel title="History" bodyPadding="none">
        <DocumentHistory entity="GoodsReceiptNote" entityId={detail.id} refId={detail.code} />
      </Panel>

      {cancelOpen ? (
        <CancelDocDialog
          docType="grn"
          docId={detail.id}
          docCode={detail.code}
          onClose={() => setCancelOpen(false)}
        />
      ) : null}

      {canDelete && confirmDelete ? (
        <ConfirmDialog
          title={`Move GRN ${detail.code} to Trash?`}
          message={
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <span>You can restore it from Trash.</span>
              <label className="form-grp" style={{ margin: 0 }}>
                <span className="form-label">
                  Reason<span className="req">★</span>
                </span>
                <textarea
                  className="innovic-input"
                  rows={2}
                  maxLength={500}
                  value={deleteReason}
                  onChange={(e) => setDeleteReason(e.target.value)}
                  placeholder="Why is this GRN being moved to Trash?"
                  autoFocus
                />
              </label>
            </div>
          }
          confirmLabel="Move to Trash"
          pendingLabel="Moving to Trash…"
          tone="danger"
          onConfirm={onDelete}
          onCancel={() => {
            softDelete.reset();
            setConfirmDelete(false);
          }}
          errorText={
            softDelete.isError
              ? softDelete.error instanceof Error
                ? softDelete.error.message
                : 'Could not move GRN to Trash. Try again.'
              : null
          }
        />
      ) : null}
    </div>
  );
}
