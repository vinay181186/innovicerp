// Sales Order detail (UI-003-05).

import type { SalesOrderDetail, SalesOrderLine } from '@innovic/shared';
import { useQueryClient } from '@tanstack/react-query';
import { Link, createRoute, useNavigate } from '@tanstack/react-router';
import { Activity, ArrowLeft, Loader2, Pencil, Trash2 } from 'lucide-react';
import { useRef, useState } from 'react';
import { AssignTaskButton } from '@/modules/tasks/components/assign-task-button';
import { soDocSignedUrl, uploadSoDocFile, useCreateSoDocument, useSoDocDetail } from '@/modules/so-documents/api';
import { useSession } from '@/lib/session';
import { authenticatedRoute } from '@/routes/_authenticated';
import { RelatedDocsPanel } from '@/components/shared/related-docs-panel';
import { salesOrdersKeys, useSalesOrder, useSoftDeleteSalesOrder } from '../api';
import { SoStatusBadge } from '../components/so-status-badge';

/** Open a stored SO document (PO doc / email ref) via a short-lived signed URL,
 *  inline in a new tab — the signed URL carries no attachment disposition, so
 *  the browser views (not downloads) any type it can render (PDF, images). */
async function openStoredFile(storagePath: string): Promise<void> {
  try {
    const url = await soDocSignedUrl(storagePath);
    window.open(url, '_blank', 'noopener');
  } catch (e) {
    window.alert(e instanceof Error ? e.message : 'Could not open file');
  }
}

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
  const softDelete = useSoftDeleteSalesOrder();
  const [confirmDelete, setConfirmDelete] = useState(false);

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

  const onDelete = (): void => {
    softDelete.mutate(detail.id, {
      onSuccess: () => {
        void navigate({ to: '/sales-orders', replace: true });
      },
    });
  };

  const canEdit = me?.role === 'admin' || me?.role === 'manager';
  const isAdmin = me?.role === 'admin';

  const totalQty = detail.lines.reduce((s, l) => s + l.orderQty, 0);
  const totalValue = detail.lines.reduce((s, l) => s + l.orderQty * Number(l.rate), 0);

  return (
    <div>
      <Link to="/sales-orders" className="btn btn-ghost btn-sm" style={{ marginBottom: 10 }}>
        <ArrowLeft size={14} /> Back to Sales Orders
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
                : 'Failed to delete sales order.'}
            </div>
          ) : null}
          <DetailGrid detail={detail} />
        </div>
      </div>

      <ClientPoFileBar detail={detail} canEdit={canEdit} companyId={me?.companyId ?? null} />

      <div className="panel">
        <div className="panel-hdr">
          <div className="panel-title">Line items ({detail.lines.length})</div>
          <span className="text3" style={{ fontSize: 11, fontFamily: 'var(--mono)' }}>
            total qty <b style={{ color: 'var(--text)' }}>{totalQty}</b>
            {totalValue > 0 ? (
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
                <th className="td-right">Qty</th>
                <th className="td-right" style={{ color: 'var(--green)' }}>Dispatched</th>
                <th className="td-right" style={{ color: 'var(--cyan)' }}>Billed</th>
                <th className="td-right" style={{ color: 'var(--amber)' }}>Pending</th>
                <th>UOM</th>
                <th className="td-right">Rate</th>
                <th>Due date</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {detail.lines.length === 0 ? (
                <tr>
                  <td colSpan={13} className="empty-state">
                    No lines on this SO yet.
                  </td>
                </tr>
              ) : (
                detail.lines.map((l) => <LineRow key={l.id} line={l} />)
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

      <RelatedDocsPanel module="sales-orders" id={detail.id} />
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
}: {
  detail: SalesOrderDetail;
  canEdit: boolean;
  companyId: string | null;
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
              onClick={() => void openStoredFile(detail.clientPoFilePath!)}
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
                onClick={() => void openStoredFile(f.storagePath)}
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

function LineRow(props: { line: SalesOrderLine }): React.JSX.Element {
  const { line: l } = props;
  return (
    <tr>
      <td className="mono">{l.lineNo}</td>
      <td className="mono" style={{ fontSize: 11 }}>
        {l.itemCode ?? l.itemCodeText ?? '—'}
      </td>
      <td>{l.partName}</td>
      <td className="text3" style={{ fontSize: 11 }}>
        {l.material ?? '—'}
      </td>
      <td className="mono" style={{ fontSize: 11 }}>
        {l.drawingNo ?? '—'}
      </td>
      <td className="td-right mono">{l.orderQty}</td>
      <td className="td-right mono" style={{ color: 'var(--green)' }}>{l.dispatchedQty}</td>
      <td className="td-right mono" style={{ color: 'var(--cyan)' }}>{l.billedQty}</td>
      <td
        className="td-right mono fw-700"
        style={{ color: l.orderQty - l.billedQty > 0 ? 'var(--amber)' : 'var(--green)' }}
      >
        {l.orderQty - l.billedQty}
      </td>
      <td>{l.uom}</td>
      <td className="td-right mono">
        {Number(l.rate) > 0 ? `₹${Number(l.rate).toFixed(2)}` : '—'}
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

function DetailGrid(props: { detail: SalesOrderDetail }): React.JSX.Element {
  const { detail } = props;
  return (
    <div className="form-grid form-grid-3">
      <Pair label="Type" value={detail.type.replaceAll('_', ' ')} />
      <Pair label="Date" value={detail.soDate} />
      <Pair label="GST %" value={`${detail.gstPercent}%`} />
      <Pair label="Client PO" value={detail.clientPoNo ?? '—'} />
      <Pair label="Cost center" value={detail.costCenter ?? '—'} />
      <Pair
        label="BOM master"
        value={detail.bomMasterId ? `${detail.bomMasterId} (${detail.bomStatus ?? '—'})` : '—'}
      />
      <Pair
        label="SO raised by"
        value={
          (detail.createdByName ?? '—') +
          (detail.createdAt ? ` · ${fmtIstDateTime(detail.createdAt)}` : '')
        }
      />
      <div className="form-grp form-full">
        <span className="form-label">Remarks</span>
        <div style={{ whiteSpace: 'pre-wrap' }}>{detail.remarks ?? '—'}</div>
      </div>
    </div>
  );
}

/** Format a stored UTC timestamp as IST date + time (e.g. "16 Jun 2026, 02:30 PM"). */
function fmtIstDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString('en-IN', {
    timeZone: 'Asia/Kolkata',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  });
}

function Pair(props: { label: string; value: string | React.ReactNode }): React.JSX.Element {
  return (
    <div className="form-grp">
      <span className="form-label">{props.label}</span>
      <div style={{ fontWeight: 600 }}>{props.value}</div>
    </div>
  );
}
