// BOM Master detail page — header + lines + revision log + linked SO count.
// Mirrors the legacy expand-row contents (L8462-8491) plus the revision
// history table (L8485-8489) and its 👁 View (N) snapshot modal
// (_bomViewSnapshot, L8812-8830).
//
// The legacy expand row's Stock column (L8464/8477) is NOT ported: it reads
// child.stockQty off the items master, and our Item read shape has no on-hand
// stock field (items has min_stock_qty — a threshold, not on-hand). Computing
// it browser-side would violate CLAUDE.md rule 1. Reported, not invented.

import { Link, createRoute, useNavigate } from '@tanstack/react-router';
import { ArrowLeft, Loader2, Pencil } from 'lucide-react';
import { useState } from 'react';
import { RelatedDocsPanel } from '@/components/shared/related-docs-panel';
import { effectiveFormPerms, useMyAccess } from '@/lib/access-control';
import { fmtDate } from '@/lib/date';
import { itemCodeWithRev } from '@/lib/item-code';
import { authenticatedRoute } from '@/routes/_authenticated';
import { StatusBadge } from '@/ui/core';
import { ConfirmDialog } from '@/ui/feedback';
import { ActionMenu } from '@/ui/layout';
import { useBomLinkedSoLines, useBomMaster, useDeleteBomMaster } from '../api';

export const bomMasterDetailRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: 'bom-masters/$id',
  component: BomMasterDetailPage,
});

// Legacy expand-row type icons (L8469-8470) — short forms, not the long
// labels the BOM form's <select> uses (L8537-8539).
const BOM_TYPE_DISPLAY: Record<string, { label: string; color: string }> = {
  manufacture: { label: '🏭 Mfg', color: 'var(--cyan)' },
  purchase: { label: '🛒 Buy', color: 'var(--green2)' },
  outsource: { label: '🏭 Outsrc', color: 'var(--amber2)' },
};

const BOM_TYPE_WORD: Record<string, string> = {
  manufacture: 'Manufacture',
  purchase: 'Purchase',
  outsource: 'Outsource',
};

function BomMasterDetailPage(): React.JSX.Element {
  const { id } = bomMasterDetailRoute.useParams();
  const navigate = useNavigate();
  const { data: detail, isLoading, isError, error } = useBomMaster(id);
  const { data: eff } = useMyAccess();
  const perms = effectiveFormPerms(eff, 'bom_create');
  const del = useDeleteBomMaster();
  const [delError, setDelError] = useState<string | null>(null);
  const [showLinked, setShowLinked] = useState(false);
  // Legacy _bomViewSnapshot (L8812) — which revision's archived part list is open.
  const [snapshotRev, setSnapshotRev] = useState<number | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  // Delete button: the linked-SO guard runs first; only then does the app's
  // ConfirmDialog open (replaces the browser's window.confirm).
  const onDeleteClick = (): void => {
    if (!detail) return;
    if (detail.linkedSoCount > 0) {
      setDelError(
        `This BOM is linked to ${detail.linkedSoCount} SO line(s). Cancel those SO lines or remove the BOM reference first.`,
      );
      return;
    }
    setDelError(null);
    setConfirmDelete(true);
  };

  // `mutateAsync`: ConfirmDialog keeps its buttons disabled while this runs
  // and shows a rejection inside the dialog instead of closing it.
  const onDelete = async (): Promise<void> => {
    if (!detail) return;
    await del.mutateAsync(detail.id);
    setConfirmDelete(false);
    void navigate({ to: '/bom-masters' });
  };

  if (eff && !perms.view) {
    return (
      <div className="empty-state" style={{ color: 'var(--amber2)', padding: 40 }}>
        ⛔ This page is hidden for your access. Ask an admin if you need access to it.
      </div>
    );
  }

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
          <div className="empty-state" style={{ color: 'var(--red2)' }}>
            {error instanceof Error ? error.message : 'BOM not found.'}
          </div>
        </div>
      </div>
    );
  }

  const openSnapshot = detail.revisions.find((r) => r.revision === snapshotRev) ?? null;
  // Legacy resolves the snapshot's item names against the live items master
  // (L8820). We only hold the names the detail payload already joined, so an
  // item dropped by a later revision falls back to '—' — same as legacy's miss.
  const lineNameById = new Map(detail.lines.map((l) => [l.childItemId, l.childItemName]));

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
              {/* One kind, one colour map, shared with the BOM Master list —
                  see ui/core/StatusBadge.tsx `bom`. */}
              <StatusBadge kind="bom" status={detail.status} />
              <span
                className="mono"
                style={{ fontSize: 11, color: 'var(--cyan)', fontWeight: 700 }}
              >
                BOM Rev {detail.revision}
              </span>
            </div>
          </div>
          {/* ONE primary next step (Edit / Revise) + an Actions menu for the
              rest, Delete last in red. */}
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            {perms.edit && (
              <Link
                to="/bom-masters/$id/edit"
                params={{ id: detail.id }}
                className="btn btn-primary"
              >
                <Pencil size={13} /> Edit / Revise
              </Link>
            )}
            <ActionMenu
              items={[
                {
                  label: 'Delete',
                  danger: true,
                  hidden: !(perms.edit && perms.approve),
                  disabled: del.isPending,
                  title:
                    detail.linkedSoCount > 0
                      ? `Linked to ${detail.linkedSoCount} SO line(s)`
                      : 'Delete BOM',
                  onClick: onDeleteClick,
                },
              ]}
            />
          </div>
        </div>
        <div className="panel-body">
          <div className="form-grid">
            {/* The parent leads: it is what the BOM builds. Pre-0085 BOMs have
                none — say so plainly and point at Edit rather than showing a
                blank, so it is obvious something is missing. */}
            <div className="form-grp">
              <span className="form-label">Parent Item</span>
              <div>
                {detail.parentItemCode ? (
                  <>
                    <span className="mono fw-700">{detail.parentItemCode}</span>
                    <span className="text3"> — {detail.parentItemName}</span>
                  </>
                ) : (
                  <span style={{ color: 'var(--amber2)', fontWeight: 700 }}>
                    Not set — use Edit / Revise to pick it
                  </span>
                )}
              </div>
            </div>
            <div className="form-grp">
              <span className="form-label">Revision Date</span>
              <div>{fmtDate(detail.revisionDate)}</div>
            </div>
            <div className="form-grp">
              <span className="form-label">Linked SO Lines</span>
              <div>
                {detail.linkedSoCount > 0 ? (
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    style={{ color: 'var(--green2)', fontWeight: 700 }}
                    title="Show the SO lines built from this BOM"
                    onClick={() => setShowLinked(true)}
                  >
                    {detail.linkedSoCount} — View
                  </button>
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
                color: 'var(--red2)',
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
          <div className="panel-title cyan">
            ▸ PART LIST / ITEMS — {detail.bomNo} ({detail.lines.length})
          </div>
        </div>
        <div className="tbl-wrap">
          <table className="innovic-table">
            <thead>
              <tr>
                <th className="th-num" style={{ width: 36 }}>
                  Sr No
                </th>
                <th>Item Code</th>
                <th>Item Name</th>
                <th className="th-num">Qty / Set</th>
                <th>BOM Type</th>
                {/* Raw material is per LINE: each child is a different part cut
                    from its own stock, and this is what the BOM cascade stamps
                    on that child's Job Card. Blank is normal on a Buy/Outsource
                    line, so it shows a plain dash, not a warning. */}
                <th>Grade</th>
                <th>Size</th>
              </tr>
            </thead>
            <tbody>
              {detail.lines.length === 0 ? (
                <tr>
                  <td colSpan={7} className="empty-state">
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
                      <td className="td-num mono fw-700">{idx + 1}</td>
                      <td className="td-code" style={{ color: 'var(--purple)' }}>
                        {line.childItemCode ?? '—'}
                      </td>
                      <td>{line.childItemName ?? '—'}</td>
                      <td className="td-num mono fw-700" style={{ fontSize: 14 }}>
                        {Number(line.qtyPerSet)}
                      </td>
                      <td>
                        <span style={{ color: cfg.color, fontSize: 11, fontWeight: 700 }}>
                          {cfg.label}
                        </span>
                      </td>
                      <td className="mono" style={{ fontSize: 11 }}>
                        {line.rawMaterialGradeText ?? <span className="text3">—</span>}
                      </td>
                      <td className="mono" style={{ fontSize: 11 }}>
                        {line.rawMaterialSizeText ?? <span className="text3">—</span>}
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
            <div className="panel-title amber">▸ REVISION HISTORY ({detail.revisions.length})</div>
          </div>
          <div className="tbl-wrap">
            <table className="innovic-table">
              <thead>
                <tr>
                  <th>BOM Rev</th>
                  <th>Revision Date</th>
                  <th>Revised By</th>
                  <th>Notes</th>
                  <th>Items</th>
                </tr>
              </thead>
              <tbody>
                {detail.revisions.map((rev) => (
                  <tr key={rev.id}>
                    <td className="mono fw-700" style={{ color: 'var(--amber2)' }}>
                      {rev.revision}
                    </td>
                    <td className="text2" style={{ fontSize: 11 }}>
                      {fmtDate(rev.createdAt)}
                    </td>
                    <td>{rev.changedByText}</td>
                    <td className="text2" style={{ fontSize: 11, whiteSpace: 'pre-wrap' }}>
                      {rev.notes ?? '—'}
                    </td>
                    <td>
                      {rev.itemsSnapshot.length > 0 ? (
                        <button
                          type="button"
                          className="btn btn-ghost btn-sm"
                          style={{ fontSize: 11 }}
                          onClick={() => setSnapshotRev(rev.revision)}
                        >
                          👁 View ({rev.itemsSnapshot.length})
                        </button>
                      ) : (
                        <span className="text3" style={{ fontSize: 11 }}>
                          Current
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}

      <RelatedDocsPanel module="bom-masters" id={detail.id} />

      {showLinked ? (
        <LinkedSoLinesModal
          bomId={detail.id}
          bomNo={detail.bomNo}
          onClose={() => setShowLinked(false)}
        />
      ) : null}

      {openSnapshot ? (
        <div
          className="overlay"
          onClick={(e) => {
            if (e.target === e.currentTarget) setSnapshotRev(null);
          }}
        >
          <div className="modal modal-lg">
            <div className="modal-hdr">
              <span className="modal-title">
                📋 {detail.bomNo} — BOM Rev {openSnapshot.revision} Snapshot (
                {openSnapshot.itemsSnapshot.length} items)
              </span>
              <button
                type="button"
                className="btn btn-ghost btn-sm btn-icon"
                onClick={() => setSnapshotRev(null)}
              >
                ✕
              </button>
            </div>
            <div className="modal-body">
              <div className="text3" style={{ fontSize: 12, marginBottom: 12 }}>
                Archived items from BOM Rev {openSnapshot.revision}
              </div>
              <table className="innovic-table">
                <thead>
                  <tr>
                    <th className="th-num">Sr No</th>
                    <th>Item Code</th>
                    <th>Item Name</th>
                    <th className="th-num">Qty / Set</th>
                    <th>BOM Type</th>
                  </tr>
                </thead>
                <tbody>
                  {openSnapshot.itemsSnapshot.map((it, i) => (
                    <tr key={`${it.childItemId}-${i}`}>
                      <td className="td-num mono">{i + 1}</td>
                      <td className="td-code" style={{ color: 'var(--purple)' }}>
                        {it.childItemCode ?? '—'}
                      </td>
                      <td>{lineNameById.get(it.childItemId) ?? '—'}</td>
                      <td className="td-num mono fw-700">{Number(it.qtyPerSet)}</td>
                      <td style={{ fontSize: 11 }}>{BOM_TYPE_WORD[it.bomType] ?? it.bomType}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="modal-footer">
              <button type="button" className="btn btn-ghost" onClick={() => setSnapshotRev(null)}>
                Cancel
              </button>
              <button
                type="button"
                className="btn btn-success"
                onClick={() => setSnapshotRev(null)}
              >
                ✓ Close
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {confirmDelete ? (
        <ConfirmDialog
          title={`Move BOM ${detail.bomNo} to Trash?`}
          message="You can restore it from Trash."
          confirmLabel="Move to Trash"
          pendingLabel="Moving to Trash…"
          onConfirm={onDelete}
          onCancel={() => setConfirmDelete(false)}
        />
      ) : null}
    </div>
  );
}

/** The SO lines whose BOM is this one (ADR-189, GET /bom-masters/:id/linked-so-lines). */
function LinkedSoLinesModal({
  bomId,
  bomNo,
  onClose,
}: {
  bomId: string;
  bomNo: string;
  onClose: () => void;
}): React.JSX.Element {
  const { data, isLoading, isError } = useBomLinkedSoLines(bomId, true);
  const lines = data?.lines ?? [];
  return (
    <div
      className="overlay"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="modal modal-lg">
        <div className="modal-hdr">
          <span className="modal-title">
            {bomNo} — Linked SO Lines ({lines.length})
          </span>
          <button type="button" className="btn btn-ghost btn-sm btn-icon" onClick={onClose}>
            ✕
          </button>
        </div>
        <div className="modal-body">
          {isLoading ? (
            <div className="text3" style={{ fontSize: 12 }}>
              <Loader2 size={13} className="animate-spin" /> Loading…
            </div>
          ) : isError ? (
            <div style={{ color: 'var(--red2)', fontSize: 12 }}>
              Could not load the linked SO lines. Try again.
            </div>
          ) : lines.length === 0 ? (
            <div className="text3" style={{ fontSize: 12 }}>
              No SO line is built from this BOM.
            </div>
          ) : (
            <table className="innovic-table">
              <thead>
                <tr>
                  <th>SO No.</th>
                  <th>POL</th>
                  <th>Item Code</th>
                  <th>Item Name</th>
                  <th className="th-num">Order Qty</th>
                  <th>Line Status</th>
                  <th>Due Date</th>
                </tr>
              </thead>
              <tbody>
                {lines.map((l) => (
                  <tr key={l.salesOrderLineId}>
                    <td style={{ whiteSpace: 'nowrap' }}>
                      <Link
                        to="/sales-orders/$id"
                        params={{ id: l.salesOrderId }}
                        className="td-code"
                      >
                        {l.soCode}
                      </Link>
                    </td>
                    <td className="mono">{l.clientPoLineNo ?? '—'}</td>
                    <td
                      className="mono fw-700"
                      style={{ color: 'var(--text)', whiteSpace: 'nowrap' }}
                    >
                      {itemCodeWithRev(l.itemCode, l.itemRevision)}
                    </td>
                    <td>{l.itemName ?? '—'}</td>
                    <td className="td-num mono fw-700">{l.orderQty}</td>
                    <td>
                      <StatusBadge kind="so" status={l.lineStatus} />
                    </td>
                    <td style={{ whiteSpace: 'nowrap' }}>{fmtDate(l.dueDate)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
        <div className="modal-footer">
          <button type="button" className="btn btn-primary" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
