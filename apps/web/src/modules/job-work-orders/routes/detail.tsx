// JW detail page (UI-003-04).

import type { JobWorkOrderDetail, JobWorkOrderLine, JwDocumentFile } from '@innovic/shared';
import { Link, createRoute, useNavigate } from '@tanstack/react-router';
import { ArrowLeft, Loader2, Pencil, Trash2 } from 'lucide-react';
import { useState } from 'react';
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
  const matRecvTotal = Number(detail.materialReceivedQty ?? 0);
  const lineValueTotal = detail.lines.reduce((s, l) => s + l.orderQty * Number(l.rate ?? 0), 0);

  return (
    <div>
      <Link to="/job-work-orders" className="btn btn-ghost btn-sm" style={{ marginBottom: 10 }}>
        <ArrowLeft size={14} /> Back to JWSO Master
      </Link>

      <div className="panel">
        <div className="panel-hdr">
          <div>
            <div className="td-code" style={{ color: 'var(--cyan)', fontSize: 16, fontWeight: 700 }}>
              {detail.code}
            </div>
            <div
              className="panel-title"
              style={{ marginTop: 2, display: 'flex', alignItems: 'center', gap: 10 }}
            >
              {detail.customerName ?? 'Untitled customer'}
              <SoStatusBadge status={detail.status} />
              <JwMaterialStatusBadge receivedQty={matRecvTotal} expectedQty={clientMatTotal} />
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
          <div className="panel-title">Line items ({detail.lines.length})</div>
          <span className="text3" style={{ fontSize: 11, fontFamily: 'var(--mono)' }}>
            total qty <b style={{ color: 'var(--text)' }}>{totalQty}</b>
            {lineValueTotal > 0 ? (
              <>
                {' '}· value <b style={{ color: 'var(--green2, var(--green))' }}>₹{lineValueTotal.toFixed(2)}</b>
              </>
            ) : null}
            {clientMatTotal > 0 ? (
              <>
                {' '}
                · client material{' '}
                <b style={{ color: 'var(--text)' }}>
                  {matRecvTotal}/{clientMatTotal}
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
                <th className="td-right">Qty</th>
                <th>UOM</th>
                <th className="td-right" style={{ color: 'var(--green)' }}>Rate ₹</th>
                <th className="td-right" style={{ color: 'var(--green)' }}>Amount</th>
                <th>Due</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {detail.lines.length === 0 ? (
                <tr>
                  <td colSpan={11} className="empty-state">
                    No lines on this JW yet.
                  </td>
                </tr>
              ) : (
                detail.lines.map((l) => <LineRow key={l.id} line={l} />)
              )}
            </tbody>
          </table>
        </div>
      </div>

      <JwDocumentsPanel jwId={detail.id} canDelete={me?.role !== 'viewer'} />
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

function LineRow(props: { line: JobWorkOrderLine }): React.JSX.Element {
  const { line: l } = props;
  return (
    <tr>
      <td className="mono">{l.lineNo}</td>
      <td className="mono" style={{ fontSize: 11 }}>
        {l.itemCodeText ?? (l.itemId ? '— linked —' : '—')}
      </td>
      <td>{l.partName}</td>
      <td className="text3" style={{ fontSize: 11 }}>
        {l.material ?? '—'}
      </td>
      <td className="mono" style={{ fontSize: 11 }}>
        {l.drawingNo ?? '—'}
      </td>
      <td className="td-right mono">{l.orderQty}</td>
      <td>{l.uom}</td>
      <td className="td-right mono" style={{ color: 'var(--green)' }}>{Number(l.rate).toFixed(2)}</td>
      <td className="td-right mono fw-700" style={{ color: 'var(--green)' }}>
        {(l.orderQty * Number(l.rate ?? 0)).toFixed(2)}
      </td>
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
  return (
    <div className="form-grid form-grid-3">
      <Pair label="Date" value={detail.jwDate} />
      <Pair label="Client PO" value={detail.clientPoNo ?? '—'} />
      <Pair label="Status" value={<SoStatusBadge status={detail.status} />} />
      <Pair label="🟢 Client Material" value={detail.clientMaterial ?? '—'} />
      <Pair
        label="Material Qty / Received"
        value={`${Number(detail.clientMaterialQty ?? 0)} / ${Number(detail.materialReceivedQty ?? 0)}`}
      />
      <Pair label="Material Received Date" value={detail.materialReceivedDate ?? '—'} />
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
