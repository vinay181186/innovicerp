// JW detail page (UI-003-04).

import type { JobWorkOrderDetail, JobWorkOrderLine, JwDocumentFile } from '@innovic/shared';
import { Link, createRoute, useNavigate } from '@tanstack/react-router';
import { ArrowLeft, Loader2, Pencil, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { RelatedDocsTabs } from '@/components/shared/related-docs-tabs';
import { useSession } from '@/lib/session';
import {
  jwDocSignedUrl,
  useDeleteJwDocument,
  useJwDocuments,
} from '@/modules/jwso-documents/api';
import { SoStatusBadge } from '@/modules/sales-orders/components/so-status-badge';
import { authenticatedRoute } from '@/routes/_authenticated';
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
  const softDelete = useSoftDeleteJobWorkOrder();
  const [confirmDelete, setConfirmDelete] = useState(false);

  if (isLoading) {
    return (
      <div>
        <Loader2 className="inline h-4 w-4 animate-spin" /> Loading job-work order…
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
          <div className="empty-state" style={{ color: 'var(--red)' }}>
            {error instanceof Error ? error.message : 'Job-work order not found'}
          </div>
        </div>
      </div>
    );
  }

  const onDelete = (): void => {
    softDelete.mutate(detail.id, {
      onSuccess: () => {
        void navigate({ to: '/job-work-orders', replace: true });
      },
    });
  };

  const canEdit = me?.role === 'admin' || me?.role === 'manager';
  const isAdmin = me?.role === 'admin';

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
      <Link to="/job-work-orders" className="btn btn-ghost btn-sm" style={{ marginBottom: 10 }}>
        <ArrowLeft size={14} /> Back to JWSO Master
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
              <JwMaterialStatusBadge receivedQty={partyReceivedTotal} expectedQty={clientMatTotal} />
            </div>
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            {canEdit ? (
              <Link
                to="/job-work-orders/$id/edit"
                params={{ id: detail.id }}
                className="btn btn-ghost btn-sm"
              >
                <Pencil size={13} /> Edit
              </Link>
            ) : null}
            {isAdmin ? (
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
                : 'Failed to delete job-work order.'}
            </div>
          ) : null}
          <DetailGrid detail={detail} />
        </div>
      </div>

      <div className="panel">
        <div className="panel-hdr">
          <div className="panel-title" style={{ color: 'var(--blue)', textTransform: 'uppercase' }}>Line items ({detail.lines.length})</div>
          <span className="text3" style={{ fontSize: 11, fontFamily: 'var(--mono)' }}>
            total qty <b style={{ color: 'var(--text)' }}>{totalQty}</b>
            {!priceHidden && lineValueTotal > 0 ? (
              <>
                {' '}· value <b style={{ color: 'var(--green2, var(--green))' }}>₹{lineValueTotal.toFixed(2)}</b>
              </>
            ) : null}
            {clientMatTotal > 0 ? (
              <>
                {' '}
                · client material{' '}
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
                <th>#</th>
                <th>Item</th>
                <th>Part name</th>
                <th>Material</th>
                <th>Drawing</th>
                <th>Qty</th>
                <th>UOM</th>
                {priceHidden ? null : (
                  <>
                    <th style={{ color: 'var(--green)' }}>Rate ₹</th>
                    <th style={{ color: 'var(--green)' }}>Amount</th>
                  </>
                )}
                <th>Due</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {detail.lines.length === 0 ? (
                <tr>
                  <td colSpan={priceHidden ? 9 : 11} className="empty-state">
                    No lines on this JW yet.
                  </td>
                </tr>
              ) : (
                detail.lines.map((l) => <LineRow key={l.id} line={l} priceHidden={priceHidden} />)
              )}
            </tbody>
          </table>
        </div>
      </div>

      <JwDocumentsPanel jwId={detail.id} canDelete={me?.role !== 'viewer'} />

      <RelatedDocsTabs module="job-work-orders" id={detail.id} />
    </div>
  );
}

/** Client PO / other documents attached to the JWSO (#8). Reflects the upload
 *  made from the JWSO form; view opens a short-lived signed URL. */
function JwDocumentsPanel(props: { jwId: string; canDelete: boolean }): React.JSX.Element {
  const { data, isLoading } = useJwDocuments(props.jwId);
  const del = useDeleteJwDocument();
  const files = data?.files ?? [];

  const onView = async (storagePath: string): Promise<void> => {
    try {
      const url = await jwDocSignedUrl(storagePath);
      window.open(url, '_blank', 'noopener,noreferrer');
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Could not open file');
    }
  };

  return (
    <div className="panel">
      <div className="panel-hdr">
        <div className="panel-title">Documents ({files.length})</div>
        <span className="text3" style={{ fontSize: 11 }}>
          Uploaded from the JWSO form (Client PO No.)
        </span>
      </div>
      <div className="tbl-wrap">
        <table className="innovic-table">
          <thead>
            <tr>
              <th>File</th>
              <th>Type</th>
              <th>Category</th>
              <th>Uploaded by</th>
              <th className="td-right">Size</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr>
                <td colSpan={6} className="empty-state">
                  <Loader2 className="inline h-4 w-4 animate-spin" /> Loading documents…
                </td>
              </tr>
            ) : files.length === 0 ? (
              <tr>
                <td colSpan={6} className="empty-state">
                  No documents yet. Upload a Client PO from the JWSO form.
                </td>
              </tr>
            ) : (
              files.map((f) => (
                <DocRow key={f.id} file={f} canDelete={props.canDelete} onView={onView} onDelete={(id) => del.mutate(id)} deleting={del.isPending} />
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function DocRow(props: {
  file: JwDocumentFile;
  canDelete: boolean;
  onView: (storagePath: string) => void;
  onDelete: (id: string) => void;
  deleting: boolean;
}): React.JSX.Element {
  const { file: f } = props;
  const sizeKb = f.fileSize != null ? `${(f.fileSize / 1024).toFixed(0)} KB` : '—';
  return (
    <tr>
      <td>
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          style={{ fontSize: 12 }}
          onClick={() => props.onView(f.storagePath)}
        >
          📎 {f.fileName}
        </button>
      </td>
      <td className="text3" style={{ fontSize: 11 }}>{f.docType ?? '—'}</td>
      <td className="mono" style={{ fontSize: 11 }}>{f.category}</td>
      <td className="text3" style={{ fontSize: 11 }}>{f.uploadedByText ?? '—'}</td>
      <td className="td-right mono" style={{ fontSize: 11 }}>{sizeKb}</td>
      <td className="td-right">
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

function LineRow(props: { line: JobWorkOrderLine; priceHidden: boolean }): React.JSX.Element {
  const { line: l, priceHidden } = props;
  return (
    <tr>
      <td className="mono" style={{ color: 'var(--blue)' }}>{l.lineNo}</td>
      <td className="mono" style={{ fontSize: 11 }}>
        {l.itemCodeText ?? (l.itemId ? '— linked —' : '—')}
      </td>
      <td style={{ color: 'var(--amber)', fontWeight: 700 }}>{l.partName}</td>
      <td className="text3" style={{ fontSize: 11 }}>
        {l.material ?? '—'}
      </td>
      <td className="mono" style={{ fontSize: 11 }}>
        {l.drawingNo ?? '—'}
      </td>
      <td className="mono">{l.orderQty}</td>
      <td>{l.uom}</td>
      {priceHidden ? null : (
        <>
          <td className="mono" style={{ color: 'var(--green)' }}>{Number(l.rate ?? 0).toFixed(2)}</td>
          <td className="mono fw-700" style={{ color: 'var(--green)' }}>
            {(l.orderQty * Number(l.rate ?? 0)).toFixed(2)}
          </td>
        </>
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
      <StripItem label="Date" value={<span className="mono">{detail.jwDate}</span>} />
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
      <StripItem label="Status" value={<SoStatusBadge status={detail.status} />} />
      <StripItem label="🟢 Client Material" value={detail.clientMaterial ?? '—'} />
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
