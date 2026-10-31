// JW detail page (UI-003-04).

import {
  type DocumentEditChange,
  type JobWorkOrderDetail,
  type JobWorkOrderLine,
  type JwDocumentFile,
  SO_DOC_CATEGORY_LABELS,
  placeOfSupplyLabel,
} from '@innovic/shared';
import { Link, createRoute, useNavigate } from '@tanstack/react-router';
import { ArrowLeft, Loader2, Pencil } from 'lucide-react';
import { useRef, useState } from 'react';
import { z } from 'zod';
import { undecidedChangesOf, usePendingEditForDoc } from '@/modules/document-edits/api';
import {
  PendingChangeChip,
  PendingLineChanges,
  headerPendingChange,
} from '@/modules/document-edits/components/pending-change-chip';
import { fmtDate } from '@/lib/date';
import { inrFormat } from '@/lib/print/doc-print';
import { useOrderPrint } from '@/modules/sales-orders/components/use-order-print';
import { OrderTotalsStrip } from '@/modules/sales-orders/components/order-totals-strip';
import { taxTypeLabel } from '@/modules/sales-orders/lib/gst-rows';
import { useHistoryTab } from '@/components/shared/document-history';
import { FilePreviewModal } from '@/components/shared/file-preview-modal';
import { ItemBadge } from '@/components/shared/item-badge';
import { ItemRevLink } from '@/modules/item-revisions/components/item-rev-link';
import {
  RevChangesSection,
  useRevChangeCount,
} from '@/modules/item-revisions/components/rev-changes-table';
import { RelatedDocsTabs } from '@/components/shared/related-docs-tabs';
import { useSession } from '@/lib/session';
import { canDeleteRecords, effectiveFormPerms, useMyAccess } from '@/lib/access-control';
import {
  uploadJwDocFile,
  useCreateJwDocument,
  useDeleteJwDocument,
  useJwDocuments,
} from '@/modules/jwso-documents/api';
import { SoStatusBadge } from '@/modules/sales-orders/components/so-status-badge';
import { authenticatedRoute } from '@/routes/_authenticated';
import { RowMenu } from '@/ui/data';
import { Banner } from '@/ui/feedback';
import { ActionMenu, DetailHeader, PageState } from '@/ui/layout';
import { CancelDocDialog } from '@/modules/cancel-requests/components/cancel-doc-dialog';
import { CancelPendingBanner } from '@/modules/cancel-requests/components/cancel-pending-banner';
import { OrderCancelledBanner } from '@/modules/sales-orders/components/order-cancelled-banner';
import { useJobWorkOrder } from '../api';
import { DeleteJwsoModal } from '../components/delete-jwso-modal';
import { CustomerRmStatus } from '../components/customer-rm-status';
import { ShortCloseJwLineModal } from '../components/short-close-jw-line-modal';

/** `uploadFailed` — set by New / Edit JWSO when the JWSO saved but a picked
 *  Client PO / Email Reference file did not upload; names the file(s) for the
 *  red banner. */
const detailSearchSchema = z.object({ uploadFailed: z.string().optional() });

export const jobWorkOrderDetailRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: 'job-work-orders/$id',
  validateSearch: detailSearchSchema,
  component: JobWorkOrderDetailPage,
});

function JobWorkOrderDetailPage(): React.JSX.Element {
  const { id } = jobWorkOrderDetailRoute.useParams();
  const { uploadFailed } = jobWorkOrderDetailRoute.useSearch();
  const navigate = useNavigate();
  const { data: detail, isLoading, isError, error } = useJobWorkOrder(id);
  const { data: me } = useSession();
  const { data: eff } = useMyAccess();
  const perms = effectiveFormPerms(eff, 'jw_create');
  const orderPrint = useOrderPrint();
  // ADR-202 — the edit(s) staged against this JWSO and still waiting for a
  // decision. Their per-field changes drive the inline amber chips next to the
  // record fields below. Flattened across requests (usually one).
  const pendingEdit = usePendingEditForDoc('JobWorkOrder', id);
  const pendingChanges = undecidedChangesOf(pendingEdit.data?.rows);
  // ADR-202 — any pending edit overlays grey "Draft" on the status chip.
  const isDraft = (pendingEdit.data?.rows?.length ?? 0) > 0;
  const [confirmDelete, setConfirmDelete] = useState(false);
  // ADR-197: the JWSO's own History tab (hooks run before any early return).
  const historyTab = useHistoryTab({ entity: 'JobWorkOrder', entityId: id, refId: detail?.code });
  const revChangeCount = useRevChangeCount({ jobWorkOrderId: id });
  // R6 (ADR-194): the line the Short-close dialog is asking about, or null.
  const [shortCloseLine, setShortCloseLine] = useState<JobWorkOrderLine | null>(null);
  // The line drawing the user asked to look at, or null when nothing is open.
  // The click only records WHICH file; FilePreviewModal fetches and shows it
  // inside the app, so a look never becomes a silent download (the same slot the
  // Documents panel below uses for its own files).
  const [linePreview, setLinePreview] = useState<string | null>(null);
  // ADR-235 — the standard Cancel dialog.
  const [cancelOpen, setCancelOpen] = useState(false);

  if (isLoading) {
    return (
      <div>
        <Loader2 className="inline h-4 w-4 animate-spin" /> Loading JWSO…
      </div>
    );
  }
  if (isError || !detail) {
    return (
      <div className="panel">
        <div className="panel-body">
          <div style={{ marginBottom: 8 }}>
            <Link to="/job-work-orders" className="btn btn-ghost btn-sm">
              <ArrowLeft size={14} /> Back
            </Link>
          </div>
          <div className="empty-state" style={{ color: 'var(--red2)' }}>
            {error instanceof Error ? error.message : 'JWSO not found. Refresh the page.'}
          </div>
        </div>
      </div>
    );
  }

  // Hide-page: VIEW removed for JWSO Master → no-access panel, not the detail.
  if (eff && !perms.view) {
    return <PageState as="page" state="noaccess" />;
  }

  // After the JWSO is in Trash the detail has nothing to show — go to the list.
  const onDeleted = (): void => void navigate({ to: '/job-work-orders', replace: true });

  // Access matrix (jw_create) replaces the old admin/manager role flags.
  // ADR-235 — a cancelled JWSO is read-only: no Edit, next steps or Short Close.
  const cancelled = detail.status === 'cancelled';
  const canEdit = perms.edit && !cancelled;
  // Cancel JWSO: the Edit tick raises the request, the Approve tick decides it.
  // Not on a cancelled or closed JWSO; one with receipts / JCs / DCs is refused
  // by the server's preview (it lists what to cancel first).
  const canCancel =
    (perms.edit || perms.approve) &&
    !cancelled &&
    detail.status !== 'closed' &&
    detail.status !== 'dispatched';
  const canDelete = canDeleteRecords(eff); // ADR-232: delete = L6 Super Admin only
  // R6 (ADR-194) #4: short-close hits requireFormAccess(...,'approve') on the
  // server, so the UI must require approve as well — otherwise a user without
  // it sees the button and gets a 403. ADR-231: the other half of the pair is
  // now `advance` (short close moves the line to its end), not `edit`.
  const canShortCloseAction = perms.advance && perms.approve && !cancelled;
  // The line ⋯ column exists when any line has something in it: Short Close
  // (advance + approve) or a drawing file to preview.
  const showLineMenu =
    canShortCloseAction || (detail?.lines ?? []).some((l) => Boolean(l.drawingFilePath));

  // OW-143: Customer RM figures come from the server (customerRm) — one rule.
  const rmRequiredTotal = detail.customerRm?.requiredQty ?? 0;

  // Next steps — each opens the downstream create screen with this JWSO
  // already picked (`?jw=<jwsoId>`). Gates mirror the target screens (ADR-232,
  // the Entry tick alone): Party GRN is party_create, JW DC is ospdc_create,
  // JW Invoice is invoice_create.
  const canReceive = effectiveFormPerms(eff, 'party_create').entry && !cancelled;
  const canJwDc = effectiveFormPerms(eff, 'ospdc_create').entry && !cancelled;
  const canJwInvoice = effectiveFormPerms(eff, 'invoice_create').entry && !cancelled;
  const goReceive = (): void =>
    void navigate({ to: '/party-grn', search: { tab: 'receive', jw: detail.id } });
  // `jw` is read by the JW DC screen (owned by another module). The assertion
  // keeps this compiling whether or not that route's search type lists `jw`
  // yet; the param still travels in the URL either way.
  const goJwDc = (): void =>
    void navigate({
      to: '/jw-dc',
      search: { tab: 'outward', jw: detail.id } as { tab: 'outward' },
    });
  const goJwInvoice = (): void =>
    void navigate({ to: '/invoices', search: { tab: 'jw', jw: detail.id } });
  // The most likely next step is the one real button; the other two sit in the
  // Actions menu. Material still due (OW-143 GRN Pending) → receive it; every line dispatched → bill it; otherwise → JW DC.
  const materialShort = (detail.customerRm?.grnPendingQty ?? 0) > 0;
  const allDispatched =
    detail.lines.length > 0 && detail.lines.every((l) => l.returnedQty >= l.orderQty);
  const nextSteps = [
    { key: 'receive', label: 'Receive Material', allowed: canReceive, go: goReceive },
    { key: 'jwdc', label: 'JW DC', allowed: canJwDc, go: goJwDc },
    { key: 'invoice', label: 'JW Invoice', allowed: canJwInvoice, go: goJwInvoice },
  ];
  const primaryKey = materialShort ? 'receive' : allDispatched ? 'invoice' : 'jwdc';
  const primaryStep =
    nextSteps.find((n) => n.key === primaryKey && n.allowed) ?? nextSteps.find((n) => n.allowed);

  const totalQty = detail.lines.reduce((s, l) => s + l.orderQty, 0);
  const partyReceivedTotal = detail.customerRm?.acceptedQty ?? 0;
  // Money hidden for L1 Viewers: the API nulls the JWSO's GST % and line rates
  // together, so a null GST % is the single signal to drop ₹ here.
  // Told by the server, not inferred from a null money field: a null also means
  // "no value yet", so probing it hid money from users entitled to see it.
  const priceHidden = detail.priceVisible === false;
  const lineValueTotal = detail.lines
    .filter((l) => l.status !== 'cancelled')
    .reduce((s, l) => s + l.orderQty * Number(l.rate ?? 0), 0);

  // The order this page already shows — printed as is (no refetch).
  const printTarget = {
    kind: 'jwso',
    id: detail.id,
    code: detail.code,
    clientId: detail.clientId,
    detail,
  } as const;
  return (
    <div>
      {/* DetailHeader layout: Back link, code + status badges, customer name.
          One visible action (Edit) and the rest in the Actions menu, Delete
          last. Delete still asks before moving the JWSO to Trash. */}
      <DetailHeader
        backLabel="Back to JWSO Master"
        backTo="/job-work-orders"
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
            <SoStatusBadge status={detail.status} draft={isDraft} />
            <CustomerRmStatus value={detail.customerRm} />
          </>
        }
        actions={
          <>
            {canEdit ? (
              <Link
                to="/job-work-orders/$id/edit"
                params={{ id: detail.id }}
                className="btn btn-ghost btn-sm"
              >
                <Pencil size={13} /> Edit
              </Link>
            ) : null}
            {primaryStep ? (
              <button type="button" className="btn btn-primary btn-sm" onClick={primaryStep.go}>
                {primaryStep.label}
              </button>
            ) : null}
            <ActionMenu
              items={[
                { label: 'Preview', onClick: () => orderPrint.preview(printTarget, isDraft) },
                {
                  label: '⬇ Download PDF',
                  onClick: () => void orderPrint.download(printTarget, isDraft),
                },
                ...nextSteps
                  .filter((n) => n.key !== primaryStep?.key)
                  .map((n) => ({ label: n.label, hidden: !n.allowed, onClick: n.go })),
                {
                  label: 'Cancel JWSO',
                  danger: true,
                  hidden: !canCancel,
                  onClick: () => setCancelOpen(true),
                },
                {
                  label: 'Delete',
                  danger: true,
                  hidden: !canDelete,
                  onClick: () => setConfirmDelete(true),
                },
              ]}
            />
          </>
        }
      >
        <DetailGrid detail={detail} pendingChanges={pendingChanges} />
        <PendingLineChanges changes={pendingChanges} />
        {/* ADR-243 — the JWSO's money from the server (SGST + CGST or IGST,
            Round-off), the same roll-up as the SO. Null when prices are hidden. */}
        <OrderTotalsStrip totals={detail.totals} hasCustomer={detail.clientId != null} />
      </DetailHeader>

      <CancelPendingBanner
        docType="job_work_order"
        docId={detail.id}
        cancelled={cancelled}
        {...(canCancel ? { onOpen: () => setCancelOpen(true) } : {})}
      />
      <OrderCancelledBanner
        cancelled={cancelled}
        docLabel="JWSO"
        reason={detail.cancelReason}
        cancelledAt={detail.cancelledAt}
      />

      {uploadFailed ? (
        <Banner
          tone="error"
          role="alert"
          title="PO document not attached — retry"
          onDismiss={() =>
            void navigate({
              to: '/job-work-orders/$id',
              params: { id: detail.id },
              search: {},
              replace: true,
            })
          }
        >
          JWSO {detail.code} was saved, but the {uploadFailed} did not upload. Upload it again with
          the Upload button in the Documents panel below.
        </Banner>
      ) : null}

      {orderPrint.modal}

      {cancelOpen ? (
        <CancelDocDialog
          docType="job_work_order"
          docId={detail.id}
          docCode={detail.code}
          onClose={() => setCancelOpen(false)}
        />
      ) : null}

      {confirmDelete ? (
        <DeleteJwsoModal
          id={detail.id}
          code={detail.code}
          onClose={() => setConfirmDelete(false)}
          onDeleted={onDeleted}
        />
      ) : null}

      {shortCloseLine ? (
        <ShortCloseJwLineModal
          jwId={detail.id}
          line={shortCloseLine}
          onClose={() => setShortCloseLine(null)}
        />
      ) : null}

      <div className="panel">
        <div className="panel-hdr">
          <div className="panel-title" style={{ color: 'var(--blue)' }}>
            Line Items ({detail.lines.length})
          </div>
          <span className="text3" style={{ fontSize: 11, fontFamily: 'var(--mono)' }}>
            Total Qty <b style={{ color: 'var(--text)' }}>{totalQty}</b>
            {!priceHidden && lineValueTotal > 0 ? (
              <>
                {' '}
                · Value{' '}
                <b style={{ color: 'var(--green2, var(--green))' }}>₹{inrFormat(lineValueTotal)}</b>
              </>
            ) : null}
            {rmRequiredTotal > 0 ? (
              <>
                {' '}
                · Customer RM accepted{' '}
                <b style={{ color: 'var(--text)' }}>
                  {partyReceivedTotal}/{rmRequiredTotal}
                </b>
              </>
            ) : null}
          </span>
        </div>
        <div className="tbl-wrap">
          <table className="innovic-table">
            <thead>
              <tr>
                <th>Ln</th>
                {/* POL — the customer's PO line number (ADR-236), beside Ln as on
                    the SO detail. Purple, mono, bold. */}
                <th style={{ color: 'var(--purple)' }}>POL</th>
                {/* Image · CODE/REV · Part name in one badge cell (user decision
                    2026-09-21) — the former separate Part name column folded in. */}
                <th>Item</th>
                {/* ADR-203 / OW-143: the line's customer RM and where it is. */}
                <th>Customer RM</th>
                <th title="Where this line's customer RM is — hover the word for the quantities">
                  Customer RM Status
                </th>
                <th>Material</th>
                <th>Drawing</th>
                <th className="th-num">Order Qty</th>
                <th>UOM</th>
                {priceHidden ? null : (
                  <>
                    <th className="th-num" style={{ color: 'var(--green2)' }}>
                      Rate (₹)
                    </th>
                    <th className="th-num" style={{ color: 'var(--green2)' }}>
                      Amount
                    </th>
                  </>
                )}
                <th>Due Date</th>
                {/* ADR-236: the LINE's own note (the order's is JWSO Remarks). */}
                <th>Remarks</th>
                <th>JWSO Status</th>
                {showLineMenu ? <th aria-label="Actions" /> : null}
              </tr>
            </thead>
            <tbody>
              {detail.lines.length === 0 ? (
                <tr>
                  <td
                    colSpan={priceHidden ? (showLineMenu ? 13 : 12) : showLineMenu ? 15 : 14}
                    className="empty-state"
                  >
                    No lines yet.
                  </td>
                </tr>
              ) : (
                detail.lines.map((l) => (
                  <LineRow
                    key={l.id}
                    line={l}
                    priceHidden={priceHidden}
                    onPreview={setLinePreview}
                    canShortClose={canShortCloseAction}
                    showMenu={showLineMenu}
                    onShortClose={() => setShortCloseLine(l)}
                  />
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      <JwDocumentsPanel
        jwId={detail.id}
        jwCode={detail.code}
        companyId={me?.companyId ?? null}
        canUpload={perms.entry}
        canDelete={canDeleteRecords(eff)}
      />

      <RelatedDocsTabs
        module="job-work-orders"
        id={detail.id}
        extraTabs={[
          {
            ...historyTab,
            // Item + Drawing Rev register: Drawing Rev changes on this JWSO's
            // lines sit under the document history.
            count: historyTab.count + revChangeCount,
            render: () => (
              <>
                {historyTab.render()}
                <RevChangesSection query={{ jobWorkOrderId: detail.id }} />
              </>
            ),
          },
        ]}
      />

      {linePreview ? (
        <FilePreviewModal
          storagePath={linePreview}
          kind="drawing"
          source="jw_line"
          refCode={detail.code}
          onClose={() => setLinePreview(null)}
        />
      ) : null}
    </div>
  );
}

/** Client PO / other documents attached to the JWSO (#8). Reflects the upload
 *  made from the JWSO form; clicking a file PREVIEWS it inside the app. Upload
 *  here attaches (or re-attaches, after a failed upload on save) a Client PO or
 *  Email Reference without opening the edit form. */
function JwDocumentsPanel(props: {
  jwId: string;
  jwCode: string;
  companyId: string | null;
  canUpload: boolean;
  canDelete: boolean;
}): React.JSX.Element {
  const { data, isLoading } = useJwDocuments(props.jwId);
  const del = useDeleteJwDocument();
  const createDoc = useCreateJwDocument();
  const files = data?.files ?? [];
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploadKind, setUploadKind] = useState<'po-docs' | 'email_reference'>('po-docs');
  const [uploading, setUploading] = useState(false);
  const [uploadErr, setUploadErr] = useState<string | null>(null);

  async function onPick(file: File): Promise<void> {
    if (!props.companyId) {
      setUploadErr('Could not upload file. Sign in again and retry.');
      return;
    }
    setUploading(true);
    setUploadErr(null);
    try {
      const storagePath = await uploadJwDocFile(file, props.companyId);
      await createDoc.mutateAsync({
        jobWorkOrderId: props.jwId,
        jwCodeText: props.jwCode,
        category: uploadKind,
        docType: uploadKind === 'po-docs' ? 'Client PO' : 'Email Reference',
        fileName: file.name,
        storagePath,
        fileSize: file.size,
        fileType: file.type || undefined,
      });
    } catch (e) {
      setUploadErr(e instanceof Error ? e.message : 'Could not upload file. Try again.');
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  // The file currently being previewed. Was `window.open(signedUrl)`, which let
  // the browser decide — and Chrome's "Download PDFs instead of automatically
  // opening them" setting turned a look into a silent save to disk. Previewing
  // now happens in-app; saving only via the modal's own Download button.
  const [preview, setPreview] = useState<{
    storagePath: string;
    fileName: string;
    fileType: string | null;
    category: string;
  } | null>(null);

  // fileType comes straight from file_registry: the JWSO Client PO uploads are
  // often `message/rfc822` (.eml), which the modal answers with a plain
  // "cannot be previewed, use Download" instead of an empty frame.
  const onView = (file: JwDocumentFile): void => {
    setPreview({
      storagePath: file.storagePath,
      fileName: file.fileName,
      fileType: file.fileType,
      category: file.category,
    });
  };

  return (
    <div className="panel">
      <div className="panel-hdr">
        <div className="panel-title">Documents ({files.length})</div>
        {props.canUpload ? (
          <div style={{ display: 'flex', gap: 'var(--sp-2)', alignItems: 'center' }}>
            <select
              className="innovic-select"
              aria-label="Document type to upload"
              value={uploadKind}
              onChange={(e) => setUploadKind(e.target.value as 'po-docs' | 'email_reference')}
              disabled={uploading}
            >
              <option value="po-docs">Client PO</option>
              <option value="email_reference">Email Reference</option>
            </select>
            <button
              type="button"
              className="btn btn-primary btn-sm"
              onClick={() => fileRef.current?.click()}
              disabled={uploading}
            >
              {uploading ? <Loader2 className="inline h-3 w-3 animate-spin" /> : null}
              {uploading ? 'Uploading…' : 'Upload'}
            </button>
            <input
              ref={fileRef}
              type="file"
              style={{ display: 'none' }}
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void onPick(f);
              }}
            />
          </div>
        ) : null}
      </div>
      {uploadErr ? (
        <Banner tone="error" role="alert" onDismiss={() => setUploadErr(null)}>
          {uploadErr}
        </Banner>
      ) : null}
      <div className="tbl-wrap">
        <table className="innovic-table">
          <thead>
            <tr>
              <th>File</th>
              <th>Document Type</th>
              <th>Category</th>
              <th>Uploaded By</th>
              <th aria-label="Actions" />
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr>
                <td colSpan={5} className="empty-state">
                  <Loader2 className="inline h-4 w-4 animate-spin" /> Loading documents…
                </td>
              </tr>
            ) : files.length === 0 ? (
              <tr>
                <td colSpan={5} className="empty-state">
                  No documents yet.
                </td>
              </tr>
            ) : (
              files.map((f) => (
                <DocRow
                  key={f.id}
                  file={f}
                  canDelete={props.canDelete}
                  onView={onView}
                  onDelete={async (id) => {
                    await del.mutateAsync(id);
                  }}
                  deleting={del.isPending}
                />
              ))
            )}
          </tbody>
        </table>
      </div>

      {preview ? (
        /* Only the rows actually filed as a drawing are gated. A client PO, an
           inspection report or an .eml keeps its unconditional Download — the
           restriction is on the company's drawings, not on every piece of
           paperwork that happens to share this panel. Same rule as SO
           Documents. */
        <FilePreviewModal
          storagePath={preview.storagePath}
          fileName={preview.fileName}
          fileType={preview.fileType}
          {...(preview.category === 'drawing'
            ? { kind: 'drawing' as const, source: 'jw_line' as const }
            : {})}
          onClose={() => setPreview(null)}
        />
      ) : null}
    </div>
  );
}

function DocRow(props: {
  file: JwDocumentFile;
  canDelete: boolean;
  onView: (file: JwDocumentFile) => void;
  onDelete: (id: string) => Promise<void>;
  deleting: boolean;
}): React.JSX.Element {
  const { file: f } = props;
  return (
    <tr>
      <td>
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          style={{ fontSize: 12 }}
          onClick={() => props.onView(f)}
        >
          📎 {f.fileName}
        </button>
      </td>
      <td className="text3" style={{ fontSize: 11 }}>
        {f.docType ?? '—'}
      </td>
      <td style={{ fontSize: 11 }}>
        {(SO_DOC_CATEGORY_LABELS as Record<string, string>)[f.category] ?? f.category}
      </td>
      <td className="text3" style={{ fontSize: 11 }}>
        {f.uploadedByText ?? '—'}
      </td>
      <td className="td-ctr">
        {/* ⋯ — Delete removes the file at once, as the old button did; greyed
            while another delete is still running. */}
        <RowMenu
          label={`Actions for ${f.fileName}`}
          items={[
            {
              key: 'delete',
              label: 'Delete',
              icon: 'trash-2',
              group: 'danger',
              hidden: !props.canDelete,
              disabledReason: props.deleting ? 'Deleting…' : undefined,
              onSelect: () => props.onDelete(f.id),
            },
          ]}
        />
      </td>
    </tr>
  );
}

function LineRow(props: {
  line: JobWorkOrderLine;
  priceHidden: boolean;
  onPreview: (storagePath: string) => void;
  canShortClose: boolean;
  showMenu: boolean;
  onShortClose: () => void;
}): React.JSX.Element {
  const { line: l, priceHidden, onPreview, canShortClose, showMenu, onShortClose } = props;
  const drawingFilePath = l.drawingFilePath ?? null;
  // R6 (ADR-194): an OPEN line with an unmet balance can be short-closed; a line
  // already short-closed shows the badge and its Short Close is greyed.
  const shortClosed = Boolean(l.shortClosedAt);
  // Why the server would refuse a short close for this line, or undefined.
  const shortCloseBlock = shortClosed
    ? 'Already Short Closed'
    : l.status === 'closed'
      ? 'Line closed'
      : l.status === 'cancelled'
        ? 'Line cancelled'
        : l.returnedQty >= l.orderQty
          ? 'Fully returned'
          : undefined;
  return (
    <tr>
      <td className="mono" style={{ color: 'var(--blue)' }}>
        {l.lineNo}
      </td>
      <td className="mono fw-700" style={{ color: 'var(--purple)' }}>
        {l.clientPoLineNo ?? '—'}
      </td>
      {/* Thumbnail · CODE/REV · part name, the same badge the Sales Order detail
          uses. The Rev is the client's drawing revision typed on this JWSO line,
          and it travels with the code (the badge formats it via itemCodeWithRev). */}
      <td>
        <ItemBadge
          size="row"
          code={l.itemCodeText ?? (l.itemId ? '— linked —' : '—')}
          name={l.partName}
          revision={l.itemCodeText ? l.revision : null}
          imagePath={l.itemImagePath}
          // ABC/1 links to its drawing page once in the Item + Drawing Rev register.
          renderCode={(codeText) => (
            <ItemRevLink itemRevisionId={l.itemRevisionId} label={codeText} className="" />
          )}
        />
      </td>
      <td>
        {l.rmItemCode ? (
          <span className="mono fw-700" style={{ color: 'var(--text)' }}>
            {l.rmItemCode}
          </span>
        ) : (
          <span className="text3">—</span>
        )}
      </td>
      <td>
        <CustomerRmStatus value={l.customerRm} />
      </td>
      <td className="text3" style={{ fontSize: 11 }}>
        {l.material ?? '—'}
      </td>
      {/* Drawing No. No Rev here any more: it is the same value the Item cell
          now carries as CODE/REV, and printing one fact twice in one row reads
          as two facts that might disagree. The attached drawing file opens
          from the line ⋯ (Preview drawing); the shared preview modal fetches it.
          The small 📎 is only a marker that a file is attached — not clickable. */}
      <td className="mono" style={{ fontSize: 11 }}>
        {l.drawingNo ?? '—'}
        {drawingFilePath ? (
          <span
            title="Drawing file attached — open it from the line ⋯"
            aria-label="Drawing file attached"
            style={{ marginLeft: 4 }}
          >
            📎
          </span>
        ) : null}
      </td>
      <td className="mono td-num">{l.orderQty}</td>
      <td>{l.uom}</td>
      {priceHidden ? null : (
        <>
          <td className="mono td-num" style={{ color: 'var(--green2)' }}>
            {Number(l.rate ?? 0).toFixed(2)}
          </td>
          <td className="mono fw-700 td-num" style={{ color: 'var(--green2)' }}>
            {inrFormat(l.orderQty * Number(l.rate ?? 0))}
          </td>
        </>
      )}
      <td className="text2" style={{ fontSize: 11 }}>
        {fmtDate(l.dueDate)}
      </td>
      {/* Long prose: one line, cut with "…", the full text on hover. */}
      <td style={{ maxWidth: 240 }} title={l.remarks ?? undefined}>
        {l.remarks ?? '—'}
      </td>
      <td>
        <div style={{ display: 'flex', gap: 4, alignItems: 'center', justifyContent: 'center' }}>
          <SoStatusBadge status={l.status} />
          {shortClosed ? (
            <span
              style={{
                fontSize: 10,
                fontWeight: 700,
                padding: '2px 6px',
                borderRadius: 4,
                color: 'var(--amber2)',
                background: 'rgba(245,158,11,0.12)',
              }}
              title={l.shortCloseReason ? `Short-closed: ${l.shortCloseReason}` : 'Short-closed'}
            >
              Short-closed
            </span>
          ) : null}
        </div>
      </td>
      {showMenu ? (
        <td className="td-ctr">
          {/* ⋯ — Preview drawing (only when a file is attached). Short Close
              closes the line with its balance left unmet; hidden without
              edit + approve, greyed with the reason the server would refuse it. */}
          <RowMenu
            label={`Actions for line ${l.lineNo}`}
            items={[
              {
                key: 'drawing',
                label: 'Preview drawing',
                icon: 'paperclip',
                hidden: !drawingFilePath,
                onSelect: () => {
                  if (drawingFilePath) onPreview(drawingFilePath);
                },
              },
              {
                key: 'short-close',
                label: 'Short Close',
                icon: 'x',
                group: 'workflow',
                hidden: !canShortClose,
                disabledReason: shortCloseBlock,
                onSelect: onShortClose,
              },
            ]}
          />
        </td>
      ) : null}
    </tr>
  );
}

function DetailGrid(props: {
  detail: JobWorkOrderDetail;
  pendingChanges: readonly DocumentEditChange[];
}): React.JSX.Element {
  const { detail, pendingChanges } = props;
  const supplyCode = detail.totals?.placeOfSupply ?? detail.placeOfSupply;
  const supplyTax = detail.totals?.taxType ?? detail.taxType;
  // Remarks can be long; collapse to one line with a "more"/"less" toggle so the
  // strip stays one compact band. Presentation only — no data change.
  const [showAllRemarks, setShowAllRemarks] = useState(false);
  const remarks = detail.remarks ?? '';
  const remarksLong = remarks.length > 80;
  const toggleStyle: React.CSSProperties = {
    background: 'none',
    border: 'none',
    padding: 0,
    marginLeft: 4,
    color: 'var(--blue)',
    cursor: 'pointer',
    fontSize: 12,
    fontWeight: 600,
  };
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-start', gap: '10px 24px' }}>
      <StripItem
        label="JWSO Date"
        value={
          <>
            <span className="mono">{fmtDate(detail.jwDate)}</span>
            <Chip changes={pendingChanges} field="jwDate" />
          </>
        }
      />
      <StripItem
        label="Client PO No."
        value={
          <>
            {detail.clientPoNo ? (
              <span className="mono" style={{ color: 'var(--purple)', fontWeight: 700 }}>
                {detail.clientPoNo}
              </span>
            ) : (
              '—'
            )}
            <Chip changes={pendingChanges} field="clientPoNo" />
          </>
        }
      />
      {/* ADR-243 — decided by the server from the customer's State. */}
      <StripItem
        label="Place of Supply"
        value={supplyCode ? placeOfSupplyLabel(supplyCode) : '—'}
      />
      <StripItem label="Tax Type" value={supplyCode || supplyTax ? taxTypeLabel(supplyTax) : '—'} />
      <div style={{ flex: '1 1 240px', minWidth: 200 }}>
        <span className="form-label">JWSO Remarks</span>
        <div style={{ fontWeight: 600, whiteSpace: 'pre-wrap' }}>
          {remarks === '' ? (
            '—'
          ) : remarksLong && !showAllRemarks ? (
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
          )}
          <Chip changes={pendingChanges} field="remarks" />
        </div>
      </div>
    </div>
  );
}

/** ADR-202 — the amber "→ after" chip for a record field with a staged edit
 *  waiting for approval. Matched on the JWSO edit diff's field key. Renders
 *  nothing when no edit is pending for that field. */
function Chip(props: {
  changes: readonly DocumentEditChange[];
  field: string;
}): React.JSX.Element | null {
  const c = headerPendingChange(props.changes, props.field);
  return c ? <PendingChangeChip after={c.after} /> : null;
}

function StripItem(props: { label: string; value: React.ReactNode }): React.JSX.Element {
  return (
    <div style={{ minWidth: 0 }}>
      <span className="form-label">{props.label}</span>
      <div style={{ fontWeight: 600 }}>{props.value}</div>
    </div>
  );
}
