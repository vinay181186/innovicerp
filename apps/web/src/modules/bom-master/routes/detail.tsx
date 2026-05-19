// BOM Master detail page — header + lines + revision log + linked SO count.
// Mirrors the legacy expand-row contents (L8462-8491) plus the revision
// history table (L8485-8489).

import type { BomStatus } from '@innovic/shared';
import { Link, createRoute, useNavigate } from '@tanstack/react-router';
import { ArrowLeft, Loader2, Pencil, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { useSession } from '@/lib/session';
import { authenticatedRoute } from '@/routes/_authenticated';
import { useBomMaster, useDeleteBomMaster } from '../api';

export const bomMasterDetailRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: 'bom-masters/$id',
  component: BomMasterDetailPage,
});

const STATUS_BADGE: Record<BomStatus, string> = {
  active: 'b-green',
  draft: 'b-amber',
  obsolete: 'b-red',
};

const BOM_TYPE_DISPLAY: Record<string, { label: string; color: string }> = {
  manufacture: { label: '🏭 Manufacture', color: 'var(--cyan)' },
  purchase: { label: '🛒 Purchase', color: 'var(--green)' },
  outsource: { label: '🏭 Outsource', color: 'var(--amber)' },
};

function BomMasterDetailPage(): React.JSX.Element {
  const { id } = bomMasterDetailRoute.useParams();
  const navigate = useNavigate();
  const { data: detail, isLoading, isError, error } = useBomMaster(id);
  const { data: me } = useSession();
  const del = useDeleteBomMaster();
  const [delError, setDelError] = useState<string | null>(null);

  const onDelete = async (): Promise<void> => {
    if (!detail) return;
    if (detail.linkedSoCount > 0) {
      setDelError(
        `This BOM is linked to ${detail.linkedSoCount} SO line(s). Cancel those SO lines or remove the BOM reference first.`,
      );
      return;
    }
    if (!window.confirm(`Delete BOM "${detail.bomNo}"? This soft-deletes the record.`)) return;
    setDelError(null);
    try {
      await del.mutateAsync(detail.id);
      void navigate({ to: '/bom-masters' });
    } catch (e) {
      setDelError(e instanceof Error ? e.message : 'Delete failed.');
    }
  };

  if (isLoading) {
    return (
      <div>
        <Loader2 className="inline h-4 w-4 animate-spin" /> Loading BOM…
      </div>
    );
  }
  if (isError || !detail) {
    return (
      <div className="panel">
        <div className="panel-body">
          <div style={{ marginBottom: 8 }}>
            <Link to="/bom-masters" className="btn btn-ghost btn-sm">
              <ArrowLeft size={14} /> Back
            </Link>
          </div>
          <div className="empty-state" style={{ color: 'var(--red)' }}>
            {error instanceof Error ? error.message : 'BOM not found.'}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div>
      <Link to="/bom-masters" className="btn btn-ghost btn-sm" style={{ marginBottom: 10 }}>
        <ArrowLeft size={14} /> Back to BOM list
      </Link>

      <div className="panel">
        <div className="panel-hdr">
          <div>
            <div className="td-code cyan" style={{ fontSize: 16, fontWeight: 800 }}>
              {detail.bomNo}
            </div>
            <div
              className="panel-title"
              style={{ marginTop: 2, display: 'flex', alignItems: 'center', gap: 10 }}
            >
              {detail.bomName}
              <span className={`badge ${STATUS_BADGE[detail.status]}`}>{detail.status}</span>
              <span
                className="mono"
                style={{ fontSize: 11, color: 'var(--cyan)', fontWeight: 700 }}
              >
                Rev {detail.revision}
              </span>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            {(me?.role === 'admin' || me?.role === 'manager') && (
              <Link
                to="/bom-masters/$id/edit"
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
                title={
                  detail.linkedSoCount > 0
                    ? `Linked to ${detail.linkedSoCount} SO line(s)`
                    : 'Delete BOM'
                }
              >
                <Trash2 size={13} /> Delete
              </button>
            )}
          </div>
        </div>
        <div className="panel-body">
          <div className="form-grid">
            <div className="form-grp">
              <span className="form-label">Revision Date</span>
              <div>{detail.revisionDate}</div>
            </div>
            <div className="form-grp">
              <span className="form-label">Linked SO Lines</span>
              <div>
                {detail.linkedSoCount > 0 ? (
                  <span style={{ color: 'var(--green)', fontWeight: 700 }}>
                    {detail.linkedSoCount}
                  </span>
                ) : (
                  <span className="text3">—</span>
                )}
              </div>
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
          <div className="panel-title">📦 Part List ({detail.lines.length})</div>
        </div>
        <div className="tbl-wrap">
          <table className="innovic-table">
            <thead>
              <tr>
                <th style={{ width: 40 }}>#</th>
                <th>Item Code</th>
                <th>Item Name</th>
                <th className="td-ctr">Qty / Set</th>
                <th>Type</th>
              </tr>
            </thead>
            <tbody>
              {detail.lines.length === 0 ? (
                <tr>
                  <td colSpan={5} className="empty-state">
                    No lines on this BOM.
                  </td>
                </tr>
              ) : (
                detail.lines.map((line, idx) => {
                  const cfg = BOM_TYPE_DISPLAY[line.bomType] ?? {
                    label: line.bomType,
                    color: 'var(--text3)',
                  };
                  return (
                    <tr key={line.id}>
                      <td className="td-ctr mono fw-700">{idx + 1}</td>
                      <td className="td-code" style={{ color: 'var(--purple)' }}>
                        {line.childItemCode ?? '—'}
                      </td>
                      <td>{line.childItemName ?? '—'}</td>
                      <td className="td-ctr mono fw-700" style={{ fontSize: 14 }}>
                        {Number(line.qtyPerSet)}
                      </td>
                      <td>
                        <span style={{ color: cfg.color, fontSize: 11, fontWeight: 700 }}>
                          {cfg.label}
                        </span>
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
                  <th>Changed By</th>
                  <th>Notes</th>
                  <th className="td-ctr">Snapshot items</th>
                </tr>
              </thead>
              <tbody>
                {detail.revisions.map((rev) => (
                  <tr key={rev.id}>
                    <td className="mono fw-700" style={{ color: 'var(--amber)' }}>
                      Rev {rev.revision}
                    </td>
                    <td className="text2" style={{ fontSize: 11 }}>
                      {new Date(rev.createdAt).toISOString().slice(0, 10)}
                    </td>
                    <td>{rev.changedByText}</td>
                    <td className="text2" style={{ fontSize: 11, whiteSpace: 'pre-wrap' }}>
                      {rev.notes ?? '—'}
                    </td>
                    <td className="td-ctr mono">{rev.itemsSnapshot.length}</td>
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
