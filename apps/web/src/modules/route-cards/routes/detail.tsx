// Route Card detail page — header + ops table + revision history.
// Mirrors legacy viewRouteCard modal (L10143).

import { Link, createRoute, useNavigate } from '@tanstack/react-router';
import { ArrowLeft, Loader2, Pencil, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { useSession } from '@/lib/session';
import { authenticatedRoute } from '@/routes/_authenticated';
import { useDeleteRouteCard, useRouteCard } from '../api';

export const routeCardDetailRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: 'route-cards/$id',
  component: RouteCardDetailPage,
});

function RouteCardDetailPage(): React.JSX.Element {
  const { id } = routeCardDetailRoute.useParams();
  const navigate = useNavigate();
  const { data: detail, isLoading, isError, error } = useRouteCard(id);
  const { data: me } = useSession();
  const del = useDeleteRouteCard();
  const [delError, setDelError] = useState<string | null>(null);

  const onDelete = async (): Promise<void> => {
    if (!detail) return;
    if (!window.confirm(`Delete route card "${detail.code}"? This soft-deletes the record.`))
      return;
    setDelError(null);
    try {
      await del.mutateAsync(detail.id);
      void navigate({ to: '/route-cards' });
    } catch (e) {
      setDelError(e instanceof Error ? e.message : 'Delete failed.');
    }
  };

  if (isLoading) {
    return (
      <div>
        <Loader2 className="inline h-4 w-4 animate-spin" /> Loading route card…
      </div>
    );
  }
  if (isError || !detail) {
    return (
      <div className="panel">
        <div className="panel-body">
          <div style={{ marginBottom: 8 }}>
            <Link to="/route-cards" className="btn btn-ghost btn-sm">
              <ArrowLeft size={14} /> Back
            </Link>
          </div>
          <div className="empty-state" style={{ color: 'var(--red)' }}>
            {error instanceof Error ? error.message : 'Route card not found.'}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div>
      <Link to="/route-cards" className="btn btn-ghost btn-sm" style={{ marginBottom: 10 }}>
        <ArrowLeft size={14} /> Back to Route Cards
      </Link>

      <div className="panel">
        <div className="panel-hdr">
          <div>
            <div className="td-code cyan" style={{ fontSize: 16, fontWeight: 800 }}>
              {detail.code}
            </div>
            <div
              className="panel-title"
              style={{ marginTop: 2, display: 'flex', alignItems: 'center', gap: 10 }}
            >
              <span style={{ color: 'var(--purple)' }}>{detail.itemCode ?? '—'}</span>
              <span className="text2">{detail.itemName ?? '— unknown item —'}</span>
              <span
                className="mono"
                style={{ fontSize: 11, color: 'var(--cyan)', fontWeight: 700 }}
              >
                Rev {detail.currentRevision}
              </span>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            {(me?.role === 'admin' || me?.role === 'manager') && (
              <Link
                to="/route-cards/$id/edit"
                params={{ id: detail.id }}
                className="btn btn-ghost btn-sm"
              >
                <Pencil size={13} /> Edit / Revise
              </Link>
            )}
            {me?.role === 'admin' && (
              <button
                type="button"
                className="btn btn-danger btn-sm"
                onClick={() => void onDelete()}
                disabled={del.isPending}
                title="Delete route card"
              >
                <Trash2 size={13} /> Delete
              </button>
            )}
          </div>
        </div>
        <div className="panel-body">
          <div className="form-grid">
            <div className="form-grp">
              <span className="form-label">Operations</span>
              <div className="mono fw-700">{detail.ops.length}</div>
            </div>
            <div className="form-grp">
              <span className="form-label">Last Updated</span>
              <div className="text2" style={{ fontSize: 12 }}>
                {new Date(detail.updatedAt).toISOString().slice(0, 10)}
              </div>
            </div>
            <div className="form-grp form-full">
              <span className="form-label">Notes</span>
              <div className="text2">{detail.notes ?? '—'}</div>
            </div>
          </div>
          {delError ? (
            <div
              style={{
                marginTop: 8,
                color: 'var(--red)',
                background: 'var(--red3)',
                border: '1px solid #fca5a5',
                borderRadius: 6,
                padding: '6px 10px',
                fontSize: 12,
              }}
            >
              {delError}
            </div>
          ) : null}
        </div>
      </div>

      <div className="panel">
        <div className="panel-hdr">
          <div className="panel-title">⚙️ Operation Sequence ({detail.ops.length})</div>
        </div>
        <div className="tbl-wrap">
          <table className="innovic-table">
            <thead>
              <tr>
                <th style={{ width: 40 }}>#</th>
                <th>Type</th>
                <th>Machine / Vendor</th>
                <th>Operation</th>
                <th className="td-ctr">Cycle (hrs)</th>
                <th>Program / Lead</th>
                <th>Tool No.</th>
                <th>Tool Details</th>
              </tr>
            </thead>
            <tbody>
              {detail.ops.length === 0 ? (
                <tr>
                  <td colSpan={8} className="empty-state">
                    No operations on this route card.
                  </td>
                </tr>
              ) : (
                detail.ops.map((op) => {
                  const accent =
                    op.opType === 'qc'
                      ? 'var(--green)'
                      : op.opType === 'outsource'
                        ? '#7c3aed'
                        : 'var(--text3)';
                  const bg =
                    op.opType === 'qc'
                      ? 'rgba(34,197,94,0.06)'
                      : op.opType === 'outsource'
                        ? 'rgba(124,58,237,0.06)'
                        : undefined;
                  return (
                    <tr key={op.id} style={{ background: bg }}>
                      <td className="td-ctr mono fw-700" style={{ color: accent }}>
                        {op.opSeq}
                      </td>
                      <td>
                        <span className="badge" style={{ color: accent, fontWeight: 700 }}>
                          {op.opType.toUpperCase()}
                        </span>
                      </td>
                      <td className="mono" style={{ fontSize: 12, color: accent }}>
                        {op.opType === 'outsource'
                          ? (op.ospVendorCode ?? op.ospVendorCodeText ?? '—')
                          : (op.machineCode ?? op.machineCodeText ?? '—')}
                        {op.opType === 'outsource' && op.ospVendorName ? (
                          <span className="text3" style={{ fontSize: 10, marginLeft: 4 }}>
                            {op.ospVendorName}
                          </span>
                        ) : null}
                        {op.opType !== 'outsource' && op.machineName ? (
                          <span className="text3" style={{ fontSize: 10, marginLeft: 4 }}>
                            {op.machineName}
                          </span>
                        ) : null}
                      </td>
                      <td style={{ fontWeight: 600 }}>{op.operation}</td>
                      <td className="td-ctr mono">{Number(op.cycleTimeMin)}</td>
                      <td className="mono" style={{ fontSize: 11 }}>
                        {op.opType === 'outsource'
                          ? op.ospLeadDays != null
                            ? `${op.ospLeadDays}d lead`
                            : '—'
                          : (op.program ?? '—')}
                      </td>
                      <td className="mono" style={{ fontSize: 11, color: 'var(--cyan)' }}>
                        {op.toolNo ?? '—'}
                      </td>
                      <td className="text2" style={{ fontSize: 11 }}>
                        {op.toolDetails ?? '—'}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {detail.revisions.length > 0 ? (
        <div className="panel">
          <div className="panel-hdr">
            <div className="panel-title">▸ Revision History ({detail.revisions.length})</div>
          </div>
          <div className="tbl-wrap">
            <table className="innovic-table">
              <thead>
                <tr>
                  <th>Rev</th>
                  <th>Date</th>
                  <th>Notes</th>
                  <th className="td-ctr">Snapshot ops</th>
                </tr>
              </thead>
              <tbody>
                {detail.revisions.map((rev) => (
                  <tr key={rev.id}>
                    <td className="mono fw-700" style={{ color: 'var(--amber)' }}>
                      Rev {rev.revisionNo}
                    </td>
                    <td className="text2" style={{ fontSize: 11 }}>
                      {new Date(rev.createdAt).toISOString().slice(0, 10)}
                    </td>
                    <td className="text2" style={{ fontSize: 11, whiteSpace: 'pre-wrap' }}>
                      {rev.notes ?? '—'}
                    </td>
                    <td className="td-ctr mono">{rev.opsSnapshot.length}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}
    </div>
  );
}
