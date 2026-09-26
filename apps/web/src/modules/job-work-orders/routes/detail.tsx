// JW detail page (UI-003-04).

import {
  type JobWorkOrderDetail,
  type JobWorkOrderLine,
  type JwDocumentFile,
  SO_DOC_CATEGORY_LABELS,
} from '@innovic/shared';
import { Link, createRoute, useNavigate } from '@tanstack/react-router';
import { ArrowLeft, Loader2, Pencil, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { fmtDate } from '@/lib/date';
import { inrFormat } from '@/lib/print/doc-print';
import { FilePreviewModal } from '@/components/shared/file-preview-modal';
import { ItemBadge } from '@/components/shared/item-badge';
import { RelatedDocsTabs } from '@/components/shared/related-docs-tabs';
import { useSession } from '@/lib/session';
import { effectiveFormPerms, useMyAccess } from '@/lib/access-control';
import { useDeleteJwDocument, useJwDocuments } from '@/modules/jwso-documents/api';
import { SoStatusBadge } from '@/modules/sales-orders/components/so-status-badge';
import { authenticatedRoute } from '@/routes/_authenticated';
import { ConfirmDialog } from '@/ui/feedback';
import { ActionMenu, DetailHeader, PageState } from '@/ui/layout';
import { useJobWorkOrder, useSoftDeleteJobWorkOrder } from '../api';
import { JwMaterialStatusBadge } from '../components/jw-material-status';

export const jobWorkOrderDetailRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: 'job-work-orders/$id',
  component: JobWorkOrderDetailPage,
});

function JobWorkOrderDetailPage(): React.JSX.Element {
  const { id } = jobWorkOrderDetailRoute.useParams();
  const navigate = useNavigate();
  const { data: detail, isLoading, isError, error } = useJobWorkOrder(id);
  const { data: me } = useSession();
  const { data: eff } = useMyAccess();
  const perms = effectiveFormPerms(eff, 'jw_create');
  const softDelete = useSoftDeleteJobWorkOrder();
  const [confirmDelete, setConfirmDelete] = useState(false);
  // The line drawing the user asked to look at, or null when nothing is open.
  // The click only records WHICH file; FilePreviewModal fetches and shows it
  // inside the app, so a look never becomes a silent download (the same slot the
  // Documents panel below uses for its own files).
  const [linePreview, setLinePreview] = useState<string | null>(null);

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

  // mutateAsync: ConfirmDialog keeps its buttons disabled while this runs and
  // shows a failure inside the dialog.
  const onDelete = async (): Promise<void> => {
    await softDelete.mutateAsync(detail.id);
    setConfirmDelete(false);
    void navigate({ to: '/job-work-orders', replace: true });
  };

  // Access matrix (jw_create) replaces the old admin/manager role flags.
  const canEdit = perms.edit;
  const canDelete = perms.edit && perms.approve;

  // Next steps — each opens the downstream create screen with this JWSO
  // already picked (`?jw=<jwsoId>`). Gates mirror the target screens: Party
  // GRN is party_create entry; JW DC and JW Invoice are admin/manager there.
  const canReceive = effectiveFormPerms(eff, 'party_create').entry;
  const canJwWrite = me?.role === 'admin' || me?.role === 'manager';
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
  // Actions menu. Material still short → receive it; every line dispatched →
  // bill it; otherwise the job is in work → JW DC.
  const materialShort =
    Number(detail.clientMaterialQty ?? 0) > 0
      ? detail.partyReceivedQty < Number(detail.clientMaterialQty ?? 0)
      : detail.partyReceivedQty === 0;
  const allDispatched =
    detail.lines.length > 0 && detail.lines.every((l) => l.returnedQty >= l.orderQty);
  const nextSteps = [
    { key: 'receive', label: 'Receive Material', allowed: canReceive, go: goReceive },
    { key: 'jwdc', label: 'JW DC', allowed: canJwWrite, go: goJwDc },
    { key: 'invoice', label: 'JW Invoice', allowed: canJwWrite, go: goJwInvoice },
  ];
  const primaryKey = materialShort ? 'receive' : allDispatched ? 'invoice' : 'jwdc';
  const primaryStep =
    nextSteps.find((n) => n.key === primaryKey && n.allowed) ?? nextSteps.find((n) => n.allowed);

  const totalQty = detail.lines.reduce((s, l) => s + l.orderQty, 0);
  // Client material is header-level (migration 0053).
  const clientMatTotal = Number(detail.clientMaterialQty ?? 0);
  // Actual client-material received = Σ Party GRN receipts (source of truth for
  // the badge and the client-material summary).
  const partyReceivedTotal = detail.partyReceivedQty;
  // Money hidden for L1 Viewers: the API nulls the JWSO's GST % and line rates
  // together, so a null GST % is the single signal to drop ₹ here.
  // Told by the server, not inferred from a null money field: a null also means
  // "no value yet", so probing it hid money from users entitled to see it.
  const priceHidden = detail.priceVisible === false;
  const lineValueTotal = detail.lines.reduce((s, l) => s + l.orderQty * Number(l.rate ?? 0), 0);

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
        name={detail.customerName ?? 'Untitled customer'}
        badges={
          <>
            <SoStatusBadge status={detail.status} />
            <JwMaterialStatusBadge receivedQty={partyReceivedTotal} expectedQty={clientMatTotal} />
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
                ...nextSteps
                  .filter((n) => n.key !== primaryStep?.key)
                  .map((n) => ({ label: n.label, hidden: !n.allowed, onClick: n.go })),
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
        <DetailGrid detail={detail} />
      </DetailHeader>

      {confirmDelete ? (
        <ConfirmDialog
          title={`Move JWSO ${detail.code} to Trash?`}
          message="You can restore it from Trash."
          confirmLabel="Move to Trash"
          pendingLabel="Moving to Trash…"
          onConfirm={onDelete}
          onCancel={() => setConfirmDelete(false)}
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
            {clientMatTotal > 0 ? (
              <>
                {' '}
                · Customer Material{' '}
                <b style={{ color: 'var(--text)' }}>
                  {partyReceivedTotal}/{clientMatTotal}
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
                {/* Image · CODE/REV · Part name in one badge cell (user decision
                    2026-09-21) — the former separate Part name column folded in. */}
                <th>Item</th>
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
                <th>JWSO Status</th>
              </tr>
            </thead>
            <tbody>
              {detail.lines.length === 0 ? (
                <tr>
                  <td colSpan={priceHidden ? 8 : 10} className="empty-state">
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
                  />
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      <JwDocumentsPanel jwId={detail.id} canDelete={me?.role !== 'viewer'} />

      <RelatedDocsTabs module="job-work-orders" id={detail.id} />

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
 *  made from the JWSO form; clicking a file PREVIEWS it inside the app. */
function JwDocumentsPanel(props: { jwId: string; canDelete: boolean }): React.JSX.Element {
  const { data, isLoading } = useJwDocuments(props.jwId);
  const del = useDeleteJwDocument();
  const files = data?.files ?? [];

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
      </div>
      <div className="tbl-wrap">
        <table className="innovic-table">
          <thead>
            <tr>
              <th>File</th>
              <th>Document Type</th>
              <th>Category</th>
              <th>Uploaded By</th>
              <th />
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
                  No documents yet. Upload a Client PO from the JWSO form.
                </td>
              </tr>
            ) : (
              files.map((f) => (
                <DocRow
                  key={f.id}
                  file={f}
                  canDelete={props.canDelete}
                  onView={onView}
                  onDelete={(id) => del.mutate(id)}
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
  onDelete: (id: string) => void;
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
      <td>
        {props.canDelete ? (
          <button
            type="button"
            className="btn btn-danger btn-sm btn-icon"
            onClick={() => props.onDelete(f.id)}
            disabled={props.deleting}
            aria-label={`Delete ${f.fileName}`}
          >
            <Trash2 size={12} />
          </button>
        ) : null}
      </td>
    </tr>
  );
}

function LineRow(props: {
  line: JobWorkOrderLine;
  priceHidden: boolean;
  onPreview: (storagePath: string) => void;
}): React.JSX.Element {
  const { line: l, priceHidden, onPreview } = props;
  const drawingFilePath = l.drawingFilePath ?? null;
  return (
    <tr>
      <td className="mono" style={{ color: 'var(--blue)' }}>
        {l.lineNo}
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
        />
      </td>
      <td className="text3" style={{ fontSize: 11 }}>
        {l.material ?? '—'}
      </td>
      {/* Drawing No. + the attached drawing file, the way the Sales Order detail
          shows them. No Rev here any more: it is the same value the Item cell
          now carries as CODE/REV, and printing one fact twice in one row reads
          as two facts that might disagree. The 📎 records which file was asked
          for; the shared preview modal fetches it. */}
      <td className="mono" style={{ fontSize: 11 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2, alignItems: 'center' }}>
          <span>{l.drawingNo ?? '—'}</span>
          {drawingFilePath ? (
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              style={{ padding: '1px 6px', fontSize: 11 }}
              onClick={() => onPreview(drawingFilePath)}
              title="Preview drawing"
            >
              📎 Drawing
            </button>
          ) : null}
        </div>
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
      <td>
        <SoStatusBadge status={l.status} />
      </td>
    </tr>
  );
}

function DetailGrid(props: { detail: JobWorkOrderDetail }): React.JSX.Element {
  const { detail } = props;
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
      <StripItem label="JWSO Date" value={<span className="mono">{fmtDate(detail.jwDate)}</span>} />
      <StripItem
        label="Client PO No."
        value={
          detail.clientPoNo ? (
            <span className="mono" style={{ color: 'var(--purple)', fontWeight: 700 }}>
              {detail.clientPoNo}
            </span>
          ) : (
            '—'
          )
        }
      />
      <StripItem label="Customer Material" value={detail.clientMaterial ?? '—'} />
      <StripItem label="Material Qty" value={String(Number(detail.clientMaterialQty ?? 0))} />
      <div style={{ flex: '1 1 240px', minWidth: 200 }}>
        <span className="form-label">Remarks</span>
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
        </div>
      </div>
    </div>
  );
}

function StripItem(props: { label: string; value: React.ReactNode }): React.JSX.Element {
  return (
    <div style={{ minWidth: 0 }}>
      <span className="form-label">{props.label}</span>
      <div style={{ fontWeight: 600 }}>{props.value}</div>
    </div>
  );
}
