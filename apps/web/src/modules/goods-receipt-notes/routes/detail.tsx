// GRN detail (UI-003-05).

import type { GoodsReceiptNoteDetail, GoodsReceiptNoteLineDetail } from '@innovic/shared';
import { Link, createRoute, useNavigate } from '@tanstack/react-router';
import { ArrowLeft, Loader2, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { fmtDate } from '@/lib/date';
import { AssignTaskButton } from '@/modules/tasks/components/assign-task-button';
import { RelatedDocsPanel } from '@/components/shared/related-docs-panel';
import { effectiveFormPerms, useMyAccess } from '@/lib/access-control';
import { itemCodeWithRev } from '@/lib/item-code';
import { authenticatedRoute } from '@/routes/_authenticated';
import { ActionMenu } from '@/ui/layout';
import { useSession } from '@/lib/session';
import { useMyCompany } from '@/modules/settings/api';
import { usePrintTemplates } from '@/modules/print-templates/api';
import { useVendor } from '@/modules/vendors/api';
import { useGoodsReceiptNote, useSoftDeleteGoodsReceiptNote } from '../api';
import { QcStatusBadge } from '../components/qc-status-badge';
import { printGrn } from '../lib/print-grn';

export const goodsReceiptNoteDetailRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: 'goods-receipt-notes/$id',
  component: GoodsReceiptNoteDetailPage,
});

function GoodsReceiptNoteDetailPage(): React.JSX.Element {
  const { id } = goodsReceiptNoteDetailRoute.useParams();
  const navigate = useNavigate();
  const { data: detail, isLoading, isError, error } = useGoodsReceiptNote(id);
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

  // "Hide page" (Access Control → Config): once access has loaded, a user whose
  // VIEW was removed for this page sees the no-access panel, not the page. `eff`
  // is undefined only while access loads — don't block then, or every legitimate
  // user flashes this panel on cold load.
  if (eff && !perms.view) {
    return (
      <div className="empty-state" style={{ color: 'var(--amber2)', padding: 40 }}>
        ⛔ This page is hidden for your access. Ask an admin if you need access to it.
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
            {error instanceof Error ? error.message : 'GRN not found'}
          </div>
        </div>
      </div>
    );
  }

  const onDelete = (): void => {
    softDelete.mutate(detail.id, {
      onSuccess: () => {
        void navigate({ to: '/goods-receipt-notes', replace: true });
      },
    });
  };

  // Print follows the page's existing VIEW permission — if you can read the
  // GRN you may put it on paper. No new gate is introduced.
  const onPrint = (): void => {
    const ok = printGrn({
      grn: detail,
      vendor,
      company,
      templates: templates?.items ?? [],
      currentUser: me?.email,
    });
    if (!ok) window.alert('Allow popups to print.');
  };

  const canEdit = perms.edit;
  // Delete is not one of the four tier actions, so "L5 Department Admin and
  // above" is expressed as the pair only L5/L6 hold: edit AND approve. L3 has
  // edit without approve; L4 has approve without edit.
  const canDelete = perms.edit && perms.approve;

  const totalReceived = detail.lines.reduce((s, l) => s + l.receivedQty, 0);
  const totalAccepted = detail.lines.reduce((s, l) => s + l.qcAcceptedQty, 0);
  const totalRejected = detail.lines.reduce((s, l) => s + l.qcRejectedQty, 0);
  const anyCompleted = detail.lines.some((l) => l.qcStatus === 'completed');
  // The next step for a GRN is Incoming QC. `?line=` deep-links straight to
  // the Inspect popup for that GRN line (incoming-qc/routes/index.tsx).
  const firstQcPending = detail.lines.find((l) => l.qcStatus !== 'completed');

  return (
    <div>
      <Link to="/goods-receipt-notes" className="btn btn-ghost btn-sm" style={{ marginBottom: 10 }}>
        <ArrowLeft size={14} /> Back to GRN list
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
            <div className="panel-title" style={{ marginTop: 2 }}>
              {detail.vendorName ?? detail.vendorCodeText ?? '—'}
            </div>
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            <AssignTaskButton
              linkedRef={{
                type: 'grn',
                id: detail.id,
                display: `GRN ${detail.code}`,
                navPage: `/goods-receipt-notes/${detail.id}`,
              }}
              suggestedTitle={`Follow up on GRN ${detail.code}`}
            />
            {detail.purchaseOrderId ? (
              <Link
                to="/purchase-orders/$id"
                params={{ id: detail.purchaseOrderId }}
                className="btn btn-ghost btn-sm"
              >
                Open PO
              </Link>
            ) : null}
            {/* Set only on a GRN raised by receiving an NC's return-to-vendor
                challan (Against NC, ADR-161). */}
            {detail.ncId ? (
              <Link
                to="/nc-register/$id"
                params={{ id: detail.ncId }}
                className="btn btn-ghost btn-sm"
              >
                Open NC
              </Link>
            ) : null}
            {/* Set only on a GRN the DC receive auto-raised (Against JWPO / DC
                or Against NC — both come back through the challan). */}
            {detail.deliveryChallanId ? (
              <Link
                to="/delivery-challans/$id"
                params={{ id: detail.deliveryChallanId }}
                className="btn btn-ghost btn-sm"
              >
                Open DC
              </Link>
            ) : null}
            {/* Print stays disabled until the print blocks land. Printing early
                is worse than waiting: the sheet comes out looking complete but
                carries none of the special notes, terms, footer or signature an
                admin wrote, and nothing on it says so. Delete opens the inline
                "Move to Trash?" confirm below. */}
            <ActionMenu
              items={[
                {
                  label: 'Print',
                  onClick: onPrint,
                  disabled: templatesLoading,
                  title: templatesLoading ? 'Loading print templates…' : 'Print this GRN',
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
                  onClick: () => setConfirmDelete(true),
                  hidden: !canDelete || confirmDelete,
                  disabled: anyCompleted,
                  title: anyCompleted
                    ? 'GRN has at least one QC-completed line — create a reversing GRN line instead'
                    : undefined,
                },
              ]}
            />
            {/* The one next step: while any line still waits for QC. */}
            {firstQcPending ? (
              <Link
                to="/incoming-qc"
                search={{ line: firstQcPending.id }}
                className="btn btn-primary"
              >
                Open in Incoming QC
              </Link>
            ) : null}
            {canDelete && confirmDelete ? (
              <>
                <span className="text3" style={{ fontSize: 12, alignSelf: 'center' }}>
                  Move GRN {detail.code} to Trash? You can restore it from Trash.
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
                  Move to Trash
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
            ) : null}
          </div>
        </div>
        <div className="panel-body">
          {softDelete.isError ? (
            <div
              style={{
                color: 'var(--red2)',
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
                : 'Could not delete GRN. Try again.'}
            </div>
          ) : null}
          <DetailGrid detail={detail} />
        </div>
      </div>

      <div className="panel">
        <div className="panel-hdr">
          <div className="panel-title">Line Items ({detail.lines.length})</div>
          <span className="text3" style={{ fontSize: 11, fontFamily: 'var(--mono)' }}>
            received <b style={{ color: 'var(--text)' }}>{totalReceived}</b> · accepted{' '}
            <b style={{ color: 'var(--green2)' }}>{totalAccepted}</b> · rejected{' '}
            <b style={{ color: 'var(--amber2)' }}>{totalRejected}</b>
          </span>
        </div>
        <div className="tbl-wrap">
          <table className="innovic-table">
            <thead>
              <tr>
                <th>Ln</th>
                {/* POL = the CUSTOMER's own PO line number, carried down from
                    the Sales Order line behind this receipt. */}
                <th style={{ color: 'var(--purple)' }}>POL</th>
                <th>Item Code</th>
                <th>Item Name</th>
                <th className="th-num">Received</th>
                <th>Vendor Challan No.</th>
                <th>QC Status</th>
                <th className="th-num">Accepted</th>
                <th className="th-num">Rejected</th>
                <th>QC Date</th>
              </tr>
            </thead>
            <tbody>
              {detail.lines.length === 0 ? (
                <tr>
                  <td colSpan={10} className="empty-state">
                    No lines on this GRN yet.
                  </td>
                </tr>
              ) : (
                detail.lines.map((l) => <LineRow key={l.id} line={l} />)
              )}
            </tbody>
          </table>
        </div>
      </div>

      <RelatedDocsPanel module="goods-receipt-notes" id={detail.id} />
    </div>
  );
}

function LineRow(props: { line: GoodsReceiptNoteLineDetail }): React.JSX.Element {
  const { line: l } = props;
  return (
    <tr>
      <td className="mono">{l.lineNo}</td>
      {/* POL — the CUSTOMER's PO line number off the SO line behind this row. */}
      <td className="mono fw-700" style={{ color: 'var(--purple)' }}>
        {l.clientPoLineNo ?? '—'}
      </td>
      {/* Item code is THE main thing — strong; CODE/REV (ADR-177). */}
      <td className="mono fw-700" style={{ color: 'var(--text)', whiteSpace: 'nowrap' }}>
        {itemCodeWithRev(l.itemCode ?? l.itemCodeText, l.itemRevision)}
      </td>
      <td>{l.itemName}</td>
      <td className="mono td-num">{l.receivedQty}</td>
      <td className="mono">{l.dcRefNo ?? '—'}</td>
      <td>
        <QcStatusBadge status={l.qcStatus} />
      </td>
      <td className="mono td-num" style={{ color: 'var(--green2)' }}>
        {l.qcAcceptedQty}
      </td>
      <td className="mono td-num" style={{ color: 'var(--amber2)' }}>
        {l.qcRejectedQty}
      </td>
      <td className="text2" style={{ fontSize: 11 }}>
        {fmtDate(l.qcDate)}
      </td>
    </tr>
  );
}

function DetailGrid(props: { detail: GoodsReceiptNoteDetail }): React.JSX.Element {
  const { detail } = props;
  return (
    <div className="form-grid form-grid-3">
      <Pair label="GRN Date" value={fmtDate(detail.grnDate)} />
      {/* Two different numbers, each shown only when present: our own DC (when
          the GRN came from a DC receive) and the vendor's challan number the
          storekeeper typed. */}
      {detail.dcCode ? <Pair label="DC No." value={detail.dcCode} /> : null}
      {detail.dcNo && detail.dcNo !== detail.dcCode ? (
        <Pair label="Vendor Challan No." value={detail.dcNo} />
      ) : null}
      <Pair label="Vendor Invoice No." value={detail.invoiceNo ?? '—'} />
      {/* On an NC-return GRN there is no PO: the header's poCodeText holds the
          NC code, so it is shown once, under an "NC" label. */}
      {detail.ncCode ? (
        <Pair label="NC" value={detail.ncCode} />
      ) : (
        <Pair label="PO No." value={detail.poCode ?? detail.poCodeText ?? '—'} />
      )}
      <Pair label="Vendor" value={detail.vendorName ?? detail.vendorCodeText ?? '—'} />
      <div className="form-grp form-full">
        <span className="form-label">Remarks</span>
        <div style={{ whiteSpace: 'pre-wrap' }}>{detail.remarks ?? '—'}</div>
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
