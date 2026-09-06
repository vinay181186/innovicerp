// Sales Order detail (UI-003-05).

import type { SalesOrderDetail, SalesOrderLine } from '@innovic/shared';
import { useQueryClient } from '@tanstack/react-query';
import { Link, createRoute, useNavigate } from '@tanstack/react-router';
import { Activity, ArrowLeft, Loader2, Pencil, Trash2 } from 'lucide-react';
import { useRef, useState } from 'react';
import { AssignTaskButton } from '@/modules/tasks/components/assign-task-button';
import { uploadSoDocFile, useCreateSoDocument, useSoDocDetail } from '@/modules/so-documents/api';
import { useSession } from '@/lib/session';
import { effectiveFormPerms, useMyAccess } from '@/lib/access-control';
import { authenticatedRoute } from '@/routes/_authenticated';
import { FilePreviewModal } from '@/components/shared/file-preview-modal';
import { RelatedDocsTabs } from '@/components/shared/related-docs-tabs';
import { SoDocumentsSection } from '@/modules/so-documents/components/so-documents-section';
import { SoDrawingHistory, useSoDrawingHistory } from '../components/so-drawing-history';
import { salesOrdersKeys, useSalesOrder, useSoftDeleteSalesOrder } from '../api';
import { fmtIstDateTime } from '../lib/format';
import { SoStatusBadge } from '../components/so-status-badge';

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
};

export const salesOrderDetailRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: 'sales-orders/$id',
  component: SalesOrderDetailPage,
});

function SalesOrderDetailPage(): React.JSX.Element {
  const { id } = salesOrderDetailRoute.useParams();
  const navigate = useNavigate();
  const { data: detail, isLoading, isError, error } = useSalesOrder(id);
  const { data: me } = useSession();
  const { data: eff } = useMyAccess();
  const perms = effectiveFormPerms(eff, 'so_create');
  const softDelete = useSoftDeleteSalesOrder();
  const [confirmDelete, setConfirmDelete] = useState(false);
  // One preview slot for the whole page — the client PO bar, the email
  // references and the per-line drawings all feed the same modal.
  const [preview, setPreview] = useState<PreviewFile | null>(null);
  // Fetched HERE, not inside the tab, because the tab strip needs the count to
  // decide whether to show 📐 Drawing History at all. <SoDrawingHistory /> calls
  // the same hook, and the shared query key means TanStack Query serves it from
  // cache rather than firing a second request.
  const { data: drawingHistory } = useSoDrawingHistory(id);

  if (isLoading) {
    return (
      <div>
        <Loader2 className="inline h-4 w-4 animate-spin" /> Loading sales order…
      </div>
    );
  }
  if (isError || !detail) {
    return (
      <div className="panel">
        <div className="panel-body">
          <div style={{ marginBottom: 8 }}>
            <Link to="/sales-orders" className="btn btn-ghost btn-sm">
              <ArrowLeft size={14} /> Back
            </Link>
          </div>
          <div className="empty-state" style={{ color: 'var(--red)' }}>
            {error instanceof Error ? error.message : 'Sales order not found'}
          </div>
        </div>
      </div>
    );
  }

  // Hide-page: VIEW removed for SO Master → no-access panel, not the detail.
  if (eff && !perms.view) {
    return (
      <div className="empty-state" style={{ color: 'var(--amber)', padding: 40 }}>
        ⛔ This page is hidden for your access. Ask an admin if you need access to it.
      </div>
    );
  }

  const onDelete = (): void => {
    softDelete.mutate(detail.id, {
      onSuccess: () => {
        void navigate({ to: '/sales-orders', replace: true });
      },
    });
  };

  // Access matrix (so_create) replaces the old admin/manager role flags.
  const canEdit = perms.edit;
  const canDelete = perms.edit && perms.approve;

  const totalQty = detail.lines.reduce((s, l) => s + l.orderQty, 0);
  // Money hidden for L1 Viewers: the API nulls the SO's GST % and every line
  // rate together, so a null GST % is the single signal to drop ₹ here.
  // Told by the server, not inferred from a null money field: a null also means
  // "no value yet", so probing it hid money from users entitled to see it.
  const priceHidden = detail.priceVisible === false;
  const totalValue = detail.lines.reduce((s, l) => s + l.orderQty * Number(l.rate ?? 0), 0);

  return (
    <div>
      <Link to="/sales-orders" className="btn btn-ghost btn-sm" style={{ marginBottom: 10 }}>
        <ArrowLeft size={14} /> Back to Sales Orders
      </Link>

      <div className="panel">
        <div className="panel-hdr">
          <div>
            <div className="td-code" style={{ color: 'var(--blue)', fontSize: 16, fontWeight: 700 }}>
              {detail.code}
            </div>
            <div
              className="panel-title"
              style={{ marginTop: 2, display: 'flex', alignItems: 'center', gap: 10 }}
            >
              {detail.customerName ?? 'Untitled customer'}
              <SoStatusBadge status={detail.status} />
            </div>
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            <AssignTaskButton
              linkedRef={{
                type: 'sales_order',
                id: detail.id,
                display: `SO ${detail.code}`,
                navPage: `/sales-orders/${detail.id}`,
              }}
              suggestedTitle={`Follow up on SO ${detail.code}`}
            />
            <Link
              to="/sales-orders/$id/status"
              params={{ id: detail.id }}
              className="btn btn-ghost btn-sm"
              title="Open SO Status Review"
            >
              <Activity size={13} /> Status
            </Link>
            {canEdit ? (
              <Link
                to="/sales-orders/$id/edit"
                params={{ id: detail.id }}
                className="btn btn-ghost btn-sm"
              >
                <Pencil size={13} /> Edit
              </Link>
            ) : null}
            {canDelete ? (
              confirmDelete ? (
                <>
                  <span className="text3" style={{ fontSize: 12, alignSelf: 'center' }}>
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
                : 'Failed to delete sales order.'}
            </div>
          ) : null}
          <DetailGrid detail={detail} />
        </div>
      </div>

      <ClientPoFileBar
        detail={detail}
        canEdit={canEdit}
        companyId={me?.companyId ?? null}
        onPreview={setPreview}
      />

      <div className="panel">
        <div className="panel-hdr">
          <div className="panel-title" style={{ color: 'var(--blue)', textTransform: 'uppercase' }}>Line items ({detail.lines.length})</div>
          <span className="text3" style={{ fontSize: 11, fontFamily: 'var(--mono)' }}>
            total qty <b style={{ color: 'var(--text)' }}>{totalQty}</b>
            {!priceHidden && totalValue > 0 ? (
              <>
                {' '}
                · value <b style={{ color: 'var(--text)' }}>₹{totalValue.toFixed(2)}</b>
              </>
            ) : null}
          </span>
        </div>
        <div className="tbl-wrap">
          <table className="innovic-table">
            <thead>
              <tr>
                <th>#</th>
                <th>Item</th>
                <th>Part Name</th>
                <th>Material</th>
                <th>Drawing</th>
                <th>Qty</th>
                <th style={{ color: 'var(--green)' }}>Dispatched</th>
                <th style={{ color: 'var(--green)' }}>Billed</th>
                <th style={{ color: 'var(--red)' }}>Pending</th>
                <th>UOM</th>
                {priceHidden ? null : <th>Rate</th>}
                <th>Due date</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {detail.lines.length === 0 ? (
                <tr>
                  <td colSpan={priceHidden ? 12 : 13} className="empty-state">
                    No lines on this SO yet.
                  </td>
                </tr>
              ) : (
                detail.lines.map((l) => (
                  <LineRow key={l.id} line={l} priceHidden={priceHidden} onPreview={setPreview} />
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {detail.milestones.length > 0 ? (
        <div className="panel" style={{ marginTop: 14 }}>
          <div className="panel-hdr">
            <div className="panel-title">📅 Delivery Schedule ({detail.milestones.length})</div>
          </div>
          <div className="panel-body">
            <table className="innovic-table">
              <thead>
                <tr>
                  <th>Lot #</th>
                  <th>Qty</th>
                  <th>Due Date</th>
                  <th>Remarks</th>
                </tr>
              </thead>
              <tbody>
                {detail.milestones.map((m) => (
                  <tr key={m.id}>
                    <td className="mono fw-700">{m.lotNo}</td>
                    <td className="mono">{m.qty}</td>
                    <td style={{ fontSize: 12 }}>{m.dueDate ?? '—'}</td>
                    <td style={{ fontSize: 12 }}>{m.remarks ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}

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
            render: () => <SoDrawingHistory salesOrderId={detail.id} />,
          },
        ]}
      />

      {/* SO Documents — file store folded in from the former standalone screen. */}
      <div className="section-hdr" style={{ marginTop: 20, marginBottom: 12 }}>
        📁 SO Documents
      </div>
      <SoDocumentsSection soId={detail.id} />

      {preview ? <FilePreviewModal {...preview} onClose={() => setPreview(null)} /> : null}
    </div>
  );
}

// Client-PO document bar (ISSUE-013). Stores the client PO file in the unified
// file_registry (category 'client_po') via the SO Documents producer, then
// refreshes this SO's detail so the 📎 link + SO Master paperclip light up.
function ClientPoFileBar({
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

  // Email reference(s) attached to this SO (uploaded on create / SO Documents).
  const docDetail = useSoDocDetail(detail.id);
  const emailRefs = (docDetail.data?.files ?? []).filter(
    (f) => f.category === 'email_reference' && f.status !== 'archived',
  );

  async function onPick(file: File): Promise<void> {
    if (!companyId) {
      setErr('No company on session — cannot upload.');
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
      setErr(e instanceof Error ? e.message : 'Upload failed');
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  return (
    <div className="panel" style={{ marginBottom: 14 }}>
      <div
        className="panel-body"
        style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: '10px 14px' }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <span className="form-label" style={{ marginBottom: 0, fontSize: 12 }}>
            📎 Client PO Document
          </span>
          {detail.clientPoFilePath ? (
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              // Only the path is on the SO record; the modal derives a display
              // name from it.
              onClick={() => onPreview({ storagePath: detail.clientPoFilePath! })}
              title="Preview the client PO document"
            >
              👁 View
            </button>
          ) : (
            <span className="text3" style={{ fontSize: 12 }}>
              None uploaded
            </span>
          )}
          {canEdit ? (
            <>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                disabled={busy}
                onClick={() => fileRef.current?.click()}
              >
                {busy ? 'Uploading…' : detail.clientPoFilePath ? 'Replace' : 'Upload'}
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
            </>
          ) : null}
          {err ? <span style={{ color: 'var(--red)', fontSize: 11 }}>{err}</span> : null}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <span className="form-label" style={{ marginBottom: 0, fontSize: 12 }}>
            📧 Email Reference
          </span>
          {emailRefs.length > 0 ? (
            emailRefs.map((f) => (
              <button
                key={f.id}
                type="button"
                className="btn btn-ghost btn-sm"
                title={f.fileName}
                onClick={() =>
                  onPreview({
                    storagePath: f.storagePath,
                    fileName: f.fileName,
                    fileType: f.fileType,
                  })
                }
              >
                👁 View
                <span
                  style={{ maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginLeft: 4, color: 'var(--text3)', fontSize: 11 }}
                >
                  {f.fileName}
                </span>
              </button>
            ))
          ) : (
            <span className="text3" style={{ fontSize: 12 }}>
              None attached
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

function LineRow(props: {
  line: SalesOrderLine;
  priceHidden: boolean;
  onPreview: (file: PreviewFile) => void;
}): React.JSX.Element {
  const { line: l, priceHidden, onPreview } = props;
  const drawingFilePath = l.drawingFilePath ?? null;
  return (
    <tr>
      <td className="mono" style={{ color: 'var(--blue)' }}>{l.lineNo}</td>
      <td className="mono" style={{ fontSize: 11 }}>
        {l.itemCode ?? l.itemCodeText ?? '—'}
      </td>
      <td style={{ color: 'var(--amber)', fontWeight: 700 }}>{l.partName}</td>
      <td className="text3" style={{ fontSize: 11 }}>
        {l.material ?? '—'}
      </td>
      <td className="mono" style={{ fontSize: 11 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <span>{l.drawingNo ?? '—'}</span>
          {/* Always shown: Rev is a server-owned number, and Rev 0 (the drawing
              the line was born with) is a real value a falsy check would hide. */}
          <span className="text3" style={{ fontSize: 10 }}>Rev {l.revision}</span>
          {drawingFilePath ? (
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              style={{ padding: '1px 6px', fontSize: 11, alignSelf: 'flex-start' }}
              onClick={() => onPreview({ storagePath: drawingFilePath })}
              title="Preview drawing"
            >
              📎 Drawing
            </button>
          ) : null}
        </div>
      </td>
      <td className="mono">{l.orderQty}</td>
      <td className="mono" style={{ color: 'var(--green)' }}>{l.dispatchedQty}</td>
      <td className="mono" style={{ color: 'var(--green)' }}>{l.billedQty}</td>
      <td
        className="mono fw-700"
        style={{ color: l.orderQty - l.billedQty > 0 ? 'var(--red)' : 'var(--green)' }}
      >
        {l.orderQty - l.billedQty}
      </td>
      <td>{l.uom}</td>
      {priceHidden ? null : (
        <td className="mono">
          {Number(l.rate) > 0 ? `₹${Number(l.rate).toFixed(2)}` : '—'}
        </td>
      )}
      <td className="text2" style={{ fontSize: 11 }}>
        {l.dueDate ?? '—'}
      </td>
      <td>
        <SoStatusBadge status={l.status} />
      </td>
    </tr>
  );
}

function DetailGrid(props: { detail: SalesOrderDetail }): React.JSX.Element {
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
      <StripItem label="Type" value={detail.type.replaceAll('_', ' ')} />
      <StripItem label="Date" value={<span className="mono">{detail.soDate}</span>} />
      <StripItem
        label="Client PO"
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
      {detail.gstPercent == null ? null : (
        <StripItem
          label="GST %"
          value={
            <span style={{ color: 'var(--green)', fontWeight: 700 }}>{detail.gstPercent}%</span>
          }
        />
      )}
      <StripItem label="Cost center" value={detail.costCenter ?? '—'} />
      {detail.type !== 'component_manufacturing' ? (
        <StripItem
          label="BOM master"
          value={
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
                  <span className="text3" style={{ marginLeft: 6, fontSize: 11 }}>
                    ({detail.bomStatus})
                  </span>
                ) : null}
              </>
            ) : (
              '—'
            )
          }
        />
      ) : null}
      <StripItem
        label="SO raised by"
        value={
          (detail.createdByName ?? '—') +
          (detail.createdAt ? ` · ${fmtIstDateTime(detail.createdAt)}` : '')
        }
      />
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
