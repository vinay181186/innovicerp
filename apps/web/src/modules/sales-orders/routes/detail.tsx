// Sales Order detail (UI-003-05).
//
// THE REFERENCE DOCUMENT-DETAIL SCREEN. The other nine document details
// (purchase-orders, purchase-requests, job-work-orders, goods-receipt-notes,
// delivery-challans, bom-master, route-cards, plans, so-costing) copy this
// composition, which is the canonical one from design-ref/README.md:
//
//   DetailHeader (+ ReadGrid of ReadFields)
//     -> Panel(s)  — documents bar, line items as a DataTable, delivery schedule
//     -> RelatedDocs (+ Timeline)
//
// Nothing about the data, the permissions or the routes changed in the Phase-4
// migration: same `useSalesOrder`, same `so_create` access matrix, same
// soft-delete mutation, same preview modal, same POL and CODE/REV on every
// line. What changed is that this screen no longer draws its own panels,
// tables, badges, buttons, empty states or delete confirmation.

import type {
  DocumentEditChange,
  DrawingSource,
  SalesOrderDetail,
  SalesOrderLine,
} from '@innovic/shared';
import { SO_CLOSABLE_STATUSES } from '@innovic/shared';
import { useQueryClient } from '@tanstack/react-query';
import { Link, createRoute, useNavigate } from '@tanstack/react-router';
import { useRef, useState } from 'react';
import { z } from 'zod';
import { usePendingEditForDoc } from '@/modules/document-edits/api';
import {
  PendingChangeChip,
  headerPendingChange,
} from '@/modules/document-edits/components/pending-change-chip';
import { AssignTaskModal } from '@/modules/tasks/components/task-modals';
import { uploadSoDocFile, useCreateSoDocument, useSoDocDetail } from '@/modules/so-documents/api';
import { useSession } from '@/lib/session';
import { effectiveFormPerms, useMyAccess } from '@/lib/access-control';
import { fmtDate } from '@/lib/date';
import { inrFormat } from '@/lib/print/doc-print';
import { authenticatedRoute } from '@/routes/_authenticated';
import { FilePreviewModal } from '@/components/shared/file-preview-modal';
import { RelatedDocsTabs } from '@/components/shared/related-docs-tabs';
import { SoLevelMatrixPanel } from '@/modules/flow-views/components/so-level-matrix-panel';
import { useHistoryTab } from '@/components/shared/document-history';
import { SoDocumentsSection } from '@/modules/so-documents/components/so-documents-section';
import { Button, Icon, StatusBadge } from '@/ui/core';
import { DataTable, Panel, QtyStrip } from '@/ui/data';
import { TABLE_KEYS } from '@/ui/data/table-keys';
import { Banner, ConfirmDialog } from '@/ui/feedback';
import { ActionMenu, DetailHeader, PageState, ReadField, ReadGrid } from '@/ui/layout';
import { SoDrawingHistory, useSoDrawingHistory } from '../components/so-drawing-history';
import { SoCloseModal, closableQty } from '../components/so-close-modal';
import { REASON_REQUIRED_MESSAGE, ReasonField } from '../components/reason-field';
import { SoFulfilmentBadge } from '../components/so-fulfilment-badge';
import { salesOrdersKeys, useSalesOrder, useSoftDeleteSalesOrder } from '../api';
import { fmtIstDateTime } from '../lib/format';
import { SO_STATUS_LABEL, SO_TYPE_LABEL } from '../lib/so-status-label';
import { MILESTONE_COLUMNS, lineColumns, lineRowMenu } from '../components/so-line-columns';

/** ₹ with Indian grouping, to the paise — the SO totals strip. */
function fmtInr(n: number): string {
  return `₹${n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** The file the user asked to look at, or null when nothing is open.
 *
 *  Every 📎 on this page used to `window.open` a signed URL, which let the
 *  browser decide — and Chrome's "download PDFs instead of opening them"
 *  setting turned a look into a silent save. Now the click only records WHICH
 *  file, and FilePreviewModal shows it inside the app; saving is a separate,
 *  deliberate press of the modal's own Download button.
 *
 *  Spread straight into the modal (`{...preview}`) so the optional keys stay
 *  absent rather than explicitly undefined (exactOptionalPropertyTypes). */
type PreviewFile = {
  storagePath: string;
  fileName?: string;
  fileType?: string | null;
  /** `drawing` for the per-line drawings: the server mints those links, logs
   *  every open, and hides Download from anyone without the tick. The client PO
   *  and the email references are ordinary files and leave this unset, so they
   *  keep the behaviour they have always had. */
  kind?: 'file' | 'drawing';
  source?: DrawingSource;
  refCode?: string;
};

/** `uploadFailed` — set by New SO when the SO saved but a picked Client PO /
 *  Email Reference file did not upload; names the file(s) for the red banner. */
const detailSearchSchema = z.object({ uploadFailed: z.string().optional() });

export const salesOrderDetailRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: 'sales-orders/$id',
  validateSearch: detailSearchSchema,
  component: SalesOrderDetailPage,
});

function SalesOrderDetailPage(): React.JSX.Element {
  const { id } = salesOrderDetailRoute.useParams();
  const { uploadFailed } = salesOrderDetailRoute.useSearch();
  const navigate = useNavigate();
  const { data: detail, isLoading, isError, error } = useSalesOrder(id);
  const { data: me } = useSession();
  const { data: eff } = useMyAccess();
  const perms = effectiveFormPerms(eff, 'so_create');
  // ADR-202 — the edit(s) staged against this SO and still waiting for a
  // decision. Their per-field changes drive the inline amber chips next to the
  // record fields below. Flattened across requests (usually one).
  const pendingEdit = usePendingEditForDoc('SalesOrder', id);
  const pendingChanges = (pendingEdit.data?.rows ?? []).flatMap((r) => r.changes);
  const softDelete = useSoftDeleteSalesOrder();
  const [confirmDelete, setConfirmDelete] = useState(false);
  // ADR-197 — why the SO goes to Trash (required; lands on its History).
  const [deleteReason, setDeleteReason] = useState('');
  const [assignOpen, setAssignOpen] = useState(false);
  // ADR-196 — the Close dialog: `line` null = the whole SO (Actions ▾ → Close).
  const [closeTarget, setCloseTarget] = useState<{ line: SalesOrderLine | null } | null>(null);
  // One preview slot for the whole page — the client PO bar, the email
  // references and the per-line drawings all feed the same modal.
  const [preview, setPreview] = useState<PreviewFile | null>(null);
  // Fetched HERE, not inside the tab, because the tab strip needs the count to
  // decide whether to show 📐 Drawing History at all. <SoDrawingHistory /> calls
  // the same hook, and the shared query key means TanStack Query serves it from
  // cache rather than firing a second request.
  const { data: drawingHistory } = useSoDrawingHistory(id);
  // ADR-197 — who did what to this SO (before → after, reasons). Called before
  // the early returns (hooks rule); the code joins once the detail is loaded.
  const historyTab = useHistoryTab({ entity: 'SalesOrder', entityId: id, refId: detail?.code });

  if (isLoading) {
    return <PageState state="loading" message="Loading sales order…" />;
  }
  if (isError || !detail) {
    return (
      <>
        <Link to="/sales-orders" className="btn btn-ghost btn-sm">
          <Icon name="arrow-left" size={14} /> Back to Sales Orders
        </Link>
        <PageState
          state="error"
          message={error instanceof Error ? error.message : 'SO not found. Refresh the page.'}
        />
      </>
    );
  }

  // Hide-page: VIEW removed for SO Master → no-access panel, not the detail.
  if (eff && !perms.view) {
    return <PageState state="noaccess" as="page" />;
  }

  // Access matrix (so_create) replaces the old admin/manager role flags.
  const canEdit = perms.edit;
  const canDelete = perms.edit && perms.approve;
  // ADR-196 — Close (short) is a department-admin decision, the same edit +
  // approve pair the JWSO line short close takes (ADR-194 R8). The server
  // enforces it; this only hides the buttons.
  // A draft or cancelled order has nothing to close (the server refuses too) —
  // the shared status map (S8) says which statuses Close is offered from.
  const canClose = perms.edit && perms.approve && SO_CLOSABLE_STATUSES.includes(detail.status);

  const totalQty = detail.lines.reduce((s, l) => s + l.orderQty, 0);
  // Money hidden for L1 Viewers: the API nulls the SO's GST % and every line
  // rate together, so a null GST % is the single signal to drop ₹ here.
  // Told by the server, not inferred from a null money field: a null also means
  // "no value yet", so probing it hid money from users entitled to see it.
  const priceHidden = detail.priceVisible === false;
  const totalValue = detail.lines.reduce((s, l) => s + l.orderQty * Number(l.rate ?? 0), 0);
  // Still to ship = ordered − already dispatched, per line (never below zero);
  // a line closed short (ADR-196) ships nothing more. Drives whether
  // "Dispatch" is offered as the next step, and whether Close is.
  const pendingDispatchQty = detail.lines.reduce((s, l) => s + closableQty(l), 0);

  return (
    <div>
      <DetailHeader
        backTo="/sales-orders"
        backLabel="Back to Sales Orders"
        renderLink={(p) => <Link {...p} />}
        code={detail.code}
        name={
          <>
            {detail.customerName ?? 'Untitled customer'}
            <Chip changes={pendingChanges} field="customerName" />
          </>
        }
        badges={
          <>
            <StatusBadge kind="so" status={detail.status} label={SO_STATUS_LABEL[detail.status]} />
            {/* ADR-196 — ERPNext's To Deliver / To Bill / Completed / Closed. */}
            <SoFulfilmentBadge status={detail.fulfilmentStatus} />
          </>
        }
        actions={
          /* ONE primary next step (Dispatch, while anything is left to ship),
             Plan as a quiet link, and everything else in the Actions menu —
             Delete last, in red. Same permission gates as before. */
          <>
            <Link
              to="/planning"
              search={{ soId: detail.id }}
              className="btn btn-ghost"
              title="Open this SO in Planning"
            >
              Plan
            </Link>
            <ActionMenu
              items={[
                { label: 'Assign Task', onClick: () => setAssignOpen(true) },
                {
                  label: 'Status',
                  title: 'Open SO Status Review',
                  onClick: () =>
                    void navigate({ to: '/sales-orders/$id/status', params: { id: detail.id } }),
                },
                {
                  label: 'Edit',
                  hidden: !canEdit,
                  onClick: () =>
                    void navigate({ to: '/sales-orders/$id/edit', params: { id: detail.id } }),
                },
                {
                  // ADR-196 — ERPNext "Close": every line still to dispatch is
                  // closed short. Offered only while something is left to ship.
                  label: 'Close',
                  title: 'Close this SO — drop the qty not yet dispatched',
                  hidden: !canClose || pendingDispatchQty === 0,
                  onClick: () => setCloseTarget({ line: null }),
                },
                {
                  label: 'Delete',
                  danger: true,
                  hidden: !canDelete,
                  onClick: () => {
                    setDeleteReason('');
                    setConfirmDelete(true);
                  },
                },
              ]}
            />
            {pendingDispatchQty > 0 ? (
              <Link
                to="/customer-dispatches/new"
                search={{ so: detail.id }}
                className="btn btn-primary"
                title={`${pendingDispatchQty} still to dispatch on this SO`}
              >
                Dispatch
              </Link>
            ) : null}
          </>
        }
      >
        <SoReadGrid detail={detail} pendingChanges={pendingChanges} />
        {/* ADR-190 — the SO's money, summed on the server. Null when this
            user's access hides prices, and then the strip is not shown. */}
        {detail.totals ? (
          <QtyStrip
            style={{ marginTop: 'var(--sp-3)' }}
            items={[
              { label: 'Subtotal', value: fmtInr(detail.totals.subtotal) },
              {
                label: `GST ${detail.totals.gstPercent}%`,
                value: fmtInr(detail.totals.gstAmount),
              },
              { label: 'Grand Total', value: fmtInr(detail.totals.grandTotal) },
            ]}
          />
        ) : null}
      </DetailHeader>

      {uploadFailed ? (
        <Banner
          tone="error"
          role="alert"
          title="PO document not attached"
          onDismiss={() =>
            void navigate({
              to: '/sales-orders/$id',
              params: { id: detail.id },
              search: {},
              replace: true,
            })
          }
        >
          SO {detail.code} was saved but {uploadFailed} did not upload. Re-upload it below.
        </Banner>
      ) : null}

      <SoFilesPanel
        detail={detail}
        canEdit={canEdit}
        companyId={me?.companyId ?? null}
        onPreview={setPreview}
      />

      <Panel
        title={`Line Items (${detail.lines.length})`}
        bodyPadding="none"
        actions={
          <QtyStrip
            items={[
              { label: 'Total Qty', value: totalQty },
              ...(!priceHidden && totalValue > 0
                ? [{ label: 'Value', value: `₹ ${inrFormat(totalValue)}` }]
                : []),
            ]}
          />
        }
      >
        <DataTable<SalesOrderLine>
          tableKey={TABLE_KEYS.soDetailLines}
          columns={lineColumns({
            priceHidden,
            soCode: detail.code,
            onPreview: setPreview,
          })}
          rows={detail.lines}
          // ADR-196 — "Close line" in the ⋯; same Close dialog as before.
          rowMenu={(l) =>
            lineRowMenu(l, {
              canClose: perms.edit && perms.approve,
              isWriteRole: me?.role === 'admin' || me?.role === 'manager',
              soStatus: detail.status,
              onCloseLine: (line) => setCloseTarget({ line }),
            })
          }
          empty="No lines on this SO yet."
        />
      </Panel>

      {detail.milestones.length > 0 ? (
        <Panel title={`Delivery Schedule (${detail.milestones.length})`} bodyPadding="none">
          <DataTable
            tableKey={TABLE_KEYS.soDetailMilestones}
            columns={MILESTONE_COLUMNS}
            rows={detail.milestones}
            empty="No delivery lots scheduled."
          />
        </Panel>
      ) : null}

      {/* Every SO line through Plan → Production Order → Job Card → OSP docs (req. 3.5, read-only). */}
      <SoLevelMatrixPanel salesOrderId={detail.id} />

      <RelatedDocsTabs
        module="sales-orders"
        id={detail.id}
        extraTabs={[
          {
            key: 'drawing-history',
            title: 'Drawing History',
            icon: '📐',
            // Zero hides the tab, so an SO whose lines never carried a drawing
            // looks exactly as it did before.
            count: drawingHistory?.lines.length ?? 0,
            render: () => <SoDrawingHistory salesOrderId={detail.id} soCode={detail.code} />,
          },
          historyTab,
        ]}
      />

      {/* SO Documents — file store folded in from the former standalone screen. */}
      <div className="section-hdr" style={{ marginTop: 'var(--sp-5)' }}>
        SO Documents
      </div>
      <SoDocumentsSection soId={detail.id} />

      {preview ? <FilePreviewModal {...preview} onClose={() => setPreview(null)} /> : null}

      {closeTarget ? (
        <SoCloseModal
          detail={detail}
          line={closeTarget.line}
          onClose={() => setCloseTarget(null)}
        />
      ) : null}

      {assignOpen ? (
        <AssignTaskModal
          linkedRef={{
            type: 'sales_order',
            id: detail.id,
            display: `SO ${detail.code}`,
            navPage: `/sales-orders/${detail.id}`,
          }}
          suggestedTitle={`Follow up on SO ${detail.code}`}
          onClose={() => setAssignOpen(false)}
        />
      ) : null}

      {/* Delete goes through the ONE confirm dialog — never an inline
          "Delete? [Confirm][Cancel]" swap, never window.confirm. A failed
          delete is shown INSIDE the dialog and the question stays open, so the
          user does not lose it along with the error. */}
      <ConfirmDialog
        open={confirmDelete}
        title={`Move SO ${detail.code} to Trash?`}
        message={
          <>
            {`${detail.code} and its ${detail.lines.length} line${
              detail.lines.length === 1 ? '' : 's'
            } will be removed from the Sales Order list. You can restore it from Trash.`}
            <ReasonField value={deleteReason} onChange={setDeleteReason} />
          </>
        }
        confirmLabel="Move to Trash"
        pendingLabel="Moving to Trash…"
        onCancel={() => setConfirmDelete(false)}
        onConfirm={async () => {
          const reason = deleteReason.trim();
          if (!reason) throw new Error(REASON_REQUIRED_MESSAGE);
          await softDelete.mutateAsync({ id: detail.id, reason });
          void navigate({ to: '/sales-orders', replace: true });
        }}
      />
    </div>
  );
}

/* ── Client PO + email reference ────────────────────────────────────────────
   Client-PO document bar (ISSUE-013). Stores the client PO file in the unified
   file_registry (category 'client_po') via the SO Documents producer, then
   refreshes this SO's detail so the 📎 link + SO Master paperclip light up. */

function SoFilesPanel({
  detail,
  canEdit,
  companyId,
  onPreview,
}: {
  detail: SalesOrderDetail;
  canEdit: boolean;
  companyId: string | null;
  onPreview: (file: PreviewFile) => void;
}): React.JSX.Element {
  const createDoc = useCreateSoDocument();
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const clientPoPath = detail.clientPoFilePath;

  // Email reference(s) attached to this SO (uploaded on create / SO Documents).
  const docDetail = useSoDocDetail(detail.id);
  const emailRefs = (docDetail.data?.files ?? []).filter(
    (f) => f.category === 'email_reference' && f.status !== 'archived',
  );

  async function onPick(file: File): Promise<void> {
    if (!companyId) {
      setErr('Could not upload file. Sign in again and retry.');
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      const storagePath = await uploadSoDocFile(file, companyId);
      await createDoc.mutateAsync({
        salesOrderId: detail.id,
        soCodeText: detail.code,
        category: 'client_po',
        docType: 'Client PO',
        fileName: file.name,
        storagePath,
        fileSize: file.size,
        fileType: file.type || undefined,
      });
      await qc.invalidateQueries({ queryKey: salesOrdersKeys.detail(detail.id) });
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not upload file. Try again.');
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  return (
    <Panel bodyStyle={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-2)' }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 'var(--sp-2)',
          flexWrap: 'wrap',
        }}
      >
        <span className="form-label">📎 Client PO Document</span>
        {clientPoPath ? (
          <Button
            variant="ghost"
            size="sm"
            icon={<Icon name="eye" size={13} />}
            title="Preview Client PO Document"
            // Only the path is on the SO record; the modal derives a display
            // name from it.
            onClick={() => onPreview({ storagePath: clientPoPath })}
          >
            View
          </Button>
        ) : (
          <span className="text3" style={{ fontSize: 'var(--fs-sm)' }}>
            None uploaded
          </span>
        )}
        {canEdit ? (
          <>
            <Button
              variant="ghost"
              size="sm"
              loading={busy}
              icon={<Icon name="upload" size={13} />}
              onClick={() => fileRef.current?.click()}
            >
              {busy ? 'Uploading…' : clientPoPath ? 'Replace' : 'Upload'}
            </Button>
            <input
              ref={fileRef}
              type="file"
              style={{ display: 'none' }}
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void onPick(f);
              }}
            />
          </>
        ) : null}
      </div>

      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 'var(--sp-2)',
          flexWrap: 'wrap',
        }}
      >
        <span className="form-label">📧 Email Reference</span>
        {emailRefs.length > 0 ? (
          emailRefs.map((f) => (
            <Button
              key={f.id}
              variant="ghost"
              size="sm"
              icon={<Icon name="eye" size={13} />}
              title={f.fileName}
              onClick={() =>
                onPreview({
                  storagePath: f.storagePath,
                  fileName: f.fileName,
                  fileType: f.fileType,
                })
              }
            >
              View
              <span
                className="text3"
                style={{
                  maxWidth: 'var(--field-md)',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                  marginLeft: 'var(--sp-1)',
                  fontSize: 'var(--fs-xs)',
                }}
              >
                {f.fileName}
              </span>
            </Button>
          ))
        ) : (
          <span className="text3" style={{ fontSize: 'var(--fs-sm)' }}>
            None attached
          </span>
        )}
      </div>

      {err ? (
        <Banner tone="error" flush>
          {err}
        </Banner>
      ) : null}
    </Panel>
  );
}

/* ── Header data ────────────────────────────────────────────────────────── */

function SoReadGrid(props: {
  detail: SalesOrderDetail;
  pendingChanges: readonly DocumentEditChange[];
}): React.JSX.Element {
  const { detail, pendingChanges } = props;
  // Remarks can be long; collapse to one line with a "more"/"less" toggle so the
  // grid stays one compact band. Presentation only — no data change.
  const [showAllRemarks, setShowAllRemarks] = useState(false);
  const remarks = detail.remarks ?? '';
  const remarksLong = remarks.length > 80;
  const toggleStyle: React.CSSProperties = {
    background: 'none',
    border: 'none',
    padding: 0,
    marginLeft: 'var(--sp-1)',
    color: 'var(--blue)',
    cursor: 'pointer',
    fontSize: 'var(--fs-sm)',
    fontWeight: 600,
  };

  return (
    <ReadGrid>
      <ReadField
        label="SO Type"
        size="md"
        value={withChip(SO_TYPE_LABEL[detail.type], pendingChanges, 'type')}
      />
      <ReadField
        label="SO Date"
        size="sm"
        mono
        value={withChip(fmtDate(detail.soDate), pendingChanges, 'soDate')}
      />
      <ReadField
        label="Client PO No."
        size="sm"
        mono
        value={withChip(
          detail.clientPoNo ? (
            <span style={{ color: 'var(--purple)', fontWeight: 700 }}>{detail.clientPoNo}</span>
          ) : null,
          pendingChanges,
          'clientPoNo',
        )}
      />
      {detail.gstPercent == null ? null : (
        <ReadField
          label="GST %"
          size="xs"
          value={withChip(
            <span style={{ color: 'var(--green2)', fontWeight: 700 }}>{detail.gstPercent}%</span>,
            pendingChanges,
            'gstPercent',
          )}
        />
      )}
      <ReadField
        label="Cost Centre"
        size="md"
        value={withChip(detail.costCenter, pendingChanges, 'costCenter')}
      />
      {detail.type === 'component_manufacturing' ? null : (
        <ReadField
          label="BOM"
          size="md"
          value={withChip(
            detail.bomMasterId ? (
              <>
                <Link
                  to="/bom-masters/$id"
                  params={{ id: detail.bomMasterId }}
                  className="td-code"
                  style={{ color: 'var(--blue)' }}
                >
                  {detail.bomMasterCode ?? detail.bomMasterId}
                </Link>
                {detail.bomStatus ? (
                  <span
                    className="text3"
                    style={{ marginLeft: 'var(--sp-1)', fontSize: 'var(--fs-xs)' }}
                  >
                    ({detail.bomStatus})
                  </span>
                ) : null}
                <Chip changes={pendingChanges} field="bomStatus" />
              </>
            ) : null,
            pendingChanges,
            'bomMasterId',
          )}
        />
      )}
      <ReadField
        label="Raised By"
        size="md"
        value={
          (detail.createdByName ?? '—') +
          (detail.createdAt ? ` · ${fmtIstDateTime(detail.createdAt)}` : '')
        }
      />
      <ReadField
        label="Remarks"
        size="full"
        pre
        value={withChip(
          remarks === '' ? null : remarksLong && !showAllRemarks ? (
            <>
              {`${remarks.slice(0, 80).trimEnd()}…`}
              <button type="button" style={toggleStyle} onClick={() => setShowAllRemarks(true)}>
                more
              </button>
            </>
          ) : (
            <>
              {remarks}
              {remarksLong ? (
                <button type="button" style={toggleStyle} onClick={() => setShowAllRemarks(false)}>
                  less
                </button>
              ) : null}
            </>
          ),
          pendingChanges,
          'remarks',
        )}
      />
    </ReadGrid>
  );
}

/** ADR-202 — append the amber "→ after" chip to a header field's value when an
 *  edit to that field is staged. With no pending change the value is returned
 *  untouched, so ReadField still renders its own em-dash for an empty field. */
function withChip(
  value: React.ReactNode,
  changes: readonly DocumentEditChange[],
  field: string,
): React.ReactNode {
  const c = headerPendingChange(changes, field);
  if (!c) return value;
  return (
    <>
      {value == null || value === '' ? '—' : value}
      <PendingChangeChip after={c.after} />
    </>
  );
}

/** ADR-202 — the amber "→ after" chip for a record field with a staged edit,
 *  rendered inline (BOM Status, and the customer name in the header). */
function Chip(props: {
  changes: readonly DocumentEditChange[];
  field: string;
}): React.JSX.Element | null {
  const c = headerPendingChange(props.changes, props.field);
  return c ? <PendingChangeChip after={c.after} /> : null;
}
