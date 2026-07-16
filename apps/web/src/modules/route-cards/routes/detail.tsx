// Route Card detail page — header + ops table + revision history.
// Mirrors legacy viewRouteCard modal (L10143).

import { Link, createRoute, useNavigate } from '@tanstack/react-router';
import { ArrowLeft, Loader2, Pencil, Printer, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { useSession } from '@/lib/session';
import { authenticatedRoute } from '@/routes/_authenticated';
import { useItem } from '../../items/api';
import { useMyCompany } from '../../settings/api';
import { useDeleteRouteCard, useRouteCard } from '../api';
import { printRouteCard } from '../lib/print-route-card';

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
  const { data: item } = useItem(detail?.itemId);
  const { data: company } = useMyCompany();
  const del = useDeleteRouteCard();
  const [delError, setDelError] = useState<string | null>(null);

  const onPrint = (): void => {
    if (!detail) return;
    if (!printRouteCard({ rc: detail, item, company })) {
      window.alert('Allow popups to print.');
    }
  };

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
            <button type="button" className="btn btn-ghost btn-sm" onClick={onPrint}>
              <Printer size={13} /> Print
            </button>
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
                <th className="td-ctr">Cycle(h)</th>
                <th>Program / Lead</th>
                <th>Tool No.</th>
                <th>Tool Details</th>
              </tr>
            </thead>
            <tbody>
              {detail.ops.length === 0 ? (
                <tr>
                  <td colSpan={8} className="empty-state">
                    No operations
                  </td>
                </tr>
              ) : (
                detail.ops.map((op) => {
                  // Op-type accents follow legacy's own convention: the sequence
                  // number is text3 on process rows (L10147/L10237), green on QC
                  // (L10213) and purple on OSP (L10226).
                  const accent =
                    op.opType === 'qc'
                      ? 'var(--green)'
                      : op.opType === 'outsource'
                        ? 'var(--purple)'
                        : 'var(--text3)';
                  const bg =
                    op.opType === 'qc'
                      ? 'rgba(34,197,94,0.06)'
                      : op.opType === 'outsource'
                        ? 'rgba(124,58,237,0.06)'
                        : undefined;
                  // machTag (L1980) renders the machine as a cyan `.tag` chip:
                  // code on a bold line, machine name on a 9px text3 line under
                  // it. OSP/QC rows reuse the chip with their own accent.
                  const tagColor =
                    op.opType === 'qc'
                      ? 'var(--green)'
                      : op.opType === 'outsource'
                        ? 'var(--purple)'
                        : 'var(--cyan)';
                  const tagCode =
                    op.opType === 'outsource'
                      ? (op.ospVendorCode ?? op.ospVendorCodeText ?? '—')
                      : (op.machineCode ?? op.machineCodeText ?? '—');
                  const tagName = op.opType === 'outsource' ? op.ospVendorName : op.machineName;
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
                      <td>
                        <span
                          className="tag"
                          style={{
                            background: 'var(--bg4)',
                            color: tagColor,
                            lineHeight: 1.25,
                            verticalAlign: 'top',
                          }}
                        >
                          <span style={{ fontWeight: 700, display: 'block' }}>{tagCode}</span>
                          {tagName ? (
                            <span
                              style={{
                                fontSize: 9,
                                color: 'var(--text3)',
                                fontWeight: 400,
                                display: 'block',
                              }}
                            >
                              {tagName}
                            </span>
                          ) : null}
                        </span>
                      </td>
                      <td className="fw-700">{op.operation}</td>
                      <td className="td-ctr mono">{Number(op.cycleTimeMin) || '—'}</td>
                      <td className="mono" style={{ fontSize: 12, color: 'var(--blue)' }}>
                        {op.opType === 'outsource'
                          ? op.ospLeadDays != null
                            ? `${op.ospLeadDays}d lead`
                            : '—'
                          : (op.program ?? '—')}
                      </td>
                      <td className="mono" style={{ fontSize: 12, color: 'var(--cyan)' }}>
                        {op.toolNo ?? '—'}
                      </td>
                      <td className="text3" style={{ fontSize: 12 }}>
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
