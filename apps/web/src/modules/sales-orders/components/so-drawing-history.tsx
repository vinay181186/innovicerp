// Drawing History — every drawing an SO line has ever shipped against.
//
// The drawing on a sales-order line is not fixed for the life of the order.
// The customer sends a corrected print, engineering re-issues it, sometimes it
// is pulled entirely — and the moment the new file overwrites the old one on
// the line, the old drawing is off the screen. That is the problem: parts made
// last month were made to the OLD print, so "which drawing was on this line in
// June" has to stay answerable, not just "which drawing is on it today".
//
// So the Rev number here belongs to the DRAWING FILE, not to the line and not
// to the item. A line is born at Rev 0 and climbs by one only when the file
// actually changes; re-saving the SO changes nothing. The server owns that
// number — this screen only reads it.
//
// Layout is two levels of tabs on purpose: the parent Related Documents strip
// picks "Drawing History", then a lighter second strip picks the item code,
// because an SO with eight lines has eight independent drawing timelines and
// stacking them in one table makes the one you want unfindable.

import type { SoDrawingAction, SoDrawingHistory, SoDrawingHistoryLine } from '@innovic/shared';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { apiFetch } from '@/lib/api';
import { FilePreviewModal, fileNameFromPath } from '@/components/shared/file-preview-modal';
import { fmtIstDateTime } from '../lib/format';

/** One query, two callers.
 *
 *  The SO detail page needs the LINE COUNT to decide whether the Drawing
 *  History tab exists at all, and this component needs the rows. Both go
 *  through this hook so they share the single ['so-drawing-history', id]
 *  cache entry — TanStack Query dedupes them into one request instead of the
 *  tab strip and the tab body each fetching the same thing. */
export function useSoDrawingHistory(salesOrderId: string) {
  return useQuery<SoDrawingHistory>({
    queryKey: ['so-drawing-history', salesOrderId],
    queryFn: () => apiFetch<SoDrawingHistory>(`/sales-orders/${salesOrderId}/drawing-history`),
    enabled: Boolean(salesOrderId),
  });
}

/** What happened to the drawing, in the badge shape used everywhere else
 *  (see StatusBadge in components/shared/related-docs-panel). */
const ACTION_LABEL: Record<SoDrawingAction, string> = {
  added: 'Added',
  replaced: 'Replaced',
  removed: 'Removed',
};
const ACTION_CLASS: Record<SoDrawingAction, string> = {
  added: 'b-green',
  replaced: 'b-cyan',
  removed: 'b-red',
};

/** Chip caption for one line. The item code alone is what the user thinks in,
 *  so keep it bare — but the same code can legitimately sit on two lines of
 *  one SO (different due dates, different lots), and then two identical chips
 *  are worse than useless. In that case BOTH get the line number, so no chip
 *  is ever ambiguous about which one it is. */
function chipLabels(lines: SoDrawingHistoryLine[]): Map<string, string> {
  const base = new Map<string, string>();
  const seen = new Map<string, number>();
  for (const l of lines) {
    const label = l.itemCode ?? l.partName;
    base.set(l.soLineId, label);
    seen.set(label, (seen.get(label) ?? 0) + 1);
  }
  const out = new Map<string, string>();
  for (const l of lines) {
    const label = base.get(l.soLineId) ?? l.partName;
    out.set(l.soLineId, (seen.get(label) ?? 0) > 1 ? `${label} (Ln ${l.lineNo})` : label);
  }
  return out;
}

export function SoDrawingHistory({ salesOrderId }: { salesOrderId: string }): React.JSX.Element {
  const { data, isLoading, isError } = useSoDrawingHistory(salesOrderId);
  // Which item-code chip is open, and which file the user asked to look at.
  // One modal for the whole tab — every 👁 feeds the same slot.
  const [activeLineId, setActiveLineId] = useState<string | null>(null);
  const [previewPath, setPreviewPath] = useState<string | null>(null);

  if (isLoading) return <div className="empty-state">Loading drawing history…</div>;
  if (isError) return <div className="empty-state" style={{ color: 'var(--red)' }}>Could not load drawing history.</div>;
  if (!data || data.lines.length === 0) {
    return <div className="empty-state">No drawing history on this order yet.</div>;
  }

  const labels = chipLabels(data.lines);
  // Fall back to the first line if the stored id no longer exists (the line was
  // removed from the SO between refetches).
  const active = data.lines.find((l) => l.soLineId === activeLineId) ?? data.lines[0] ?? null;

  return (
    <div>
      {/* Second-level strip: lighter than the parent tabs so the two levels
          never read as one row of equals. */}
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 10 }}>
        {data.lines.map((l) => {
          const isActive = active?.soLineId === l.soLineId;
          return (
            <button
              key={l.soLineId}
              type="button"
              className="btn btn-sm"
              onClick={() => setActiveLineId(l.soLineId)}
              title={l.partName}
              style={
                isActive
                  ? {
                      background: 'var(--bg4)',
                      color: 'var(--cyan)',
                      border: '1px solid var(--cyan)',
                      fontWeight: 700,
                    }
                  : {
                      background: 'transparent',
                      color: 'var(--text3)',
                      border: '1px solid var(--border)',
                    }
              }
            >
              <span className="mono">{labels.get(l.soLineId) ?? l.partName}</span>
              <span
                className="mono"
                style={{ marginLeft: 6, fontWeight: 700, color: isActive ? 'var(--cyan)' : 'var(--text3)' }}
              >
                {l.revisions.length}
              </span>
            </button>
          );
        })}
      </div>

      {active ? (
        <>
          <div className="text3" style={{ fontSize: 11, marginBottom: 8 }}>
            Line {active.lineNo} · {active.partName}
            {active.drawingNo ? ` · Drawing ${active.drawingNo}` : ''} · current Rev{' '}
            <span className="mono" style={{ color: 'var(--text2)' }}>{active.currentRevision}</span>
          </div>
          <div className="tbl-wrap">
            <table className="innovic-table tbl-ctr" style={{ width: '100%' }}>
              <thead>
                <tr>
                  <th style={{ width: '14%' }}>Rev</th>
                  <th style={{ width: '12%' }}>Change</th>
                  <th style={{ width: '34%' }}>File</th>
                  <th style={{ width: '16%' }}>By</th>
                  <th style={{ width: '18%' }}>When</th>
                  <th style={{ width: '6%' }} />
                </tr>
              </thead>
              <tbody>
                {active.revisions.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="empty-state">No revisions on this line.</td>
                  </tr>
                ) : (
                  // Rendered in the order the API sent — newest first. Not re-sorted
                  // here, so the screen can never disagree with the stored history.
                  active.revisions.map((r, i) => {
                    const path = r.drawingFilePath;
                    return (
                      <tr key={r.id}>
                        <td className="mono" style={{ fontWeight: 700, color: 'var(--text2)' }}>
                          Rev {r.revisionNo}
                          {i === 0 ? (
                            <span className="badge b-blue" style={{ marginLeft: 6 }}>current</span>
                          ) : null}
                        </td>
                        <td>
                          <span className={`badge ${ACTION_CLASS[r.action]}`}>{ACTION_LABEL[r.action]}</span>
                        </td>
                        <td
                          className="text2"
                          style={{ fontSize: 12, maxWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}
                          title={path ? fileNameFromPath(path) : 'drawing cleared'}
                        >
                          {path ? (
                            fileNameFromPath(path)
                          ) : (
                            <span className="text3">— drawing cleared</span>
                          )}
                        </td>
                        <td className="text2" style={{ fontSize: 12 }}>{r.createdByName ?? '—'}</td>
                        <td className="text3" style={{ fontSize: 11 }}>{fmtIstDateTime(r.createdAt)}</td>
                        <td>
                          {path ? (
                            <button
                              type="button"
                              className="btn btn-ghost btn-sm"
                              style={{ padding: '1px 6px', fontSize: 11 }}
                              onClick={() => setPreviewPath(path)}
                              title="Preview this drawing"
                            >
                              👁
                            </button>
                          ) : null}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </>
      ) : null}

      {previewPath ? (
        <FilePreviewModal storagePath={previewPath} onClose={() => setPreviewPath(null)} />
      ) : null}
    </div>
  );
}
