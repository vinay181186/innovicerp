// Drawing History — every drawing an SO line has ever shipped against.
//
// The drawing on a sales-order line is not fixed for the life of the order.
// The customer sends a corrected print, engineering re-issues it, sometimes it
// is pulled entirely — and the moment the new file overwrites the old one on
// the line, the old drawing is off the screen. That is the problem: parts made
// last month were made to the OLD print, so "which drawing was on this line in
// June" has to stay answerable, not just "which drawing is on it today".
//
// Two different things used to share one number here, so read the columns
// carefully. The '#' column is a SEQUENCE POSITION: how many times this line's
// drawing file has changed, this row being the Nth. The server owns it, it
// climbs by one only when the file actually changes, and re-saving the SO does
// nothing to it. The 'Rev' column is the CUSTOMER'S drawing revision — free text
// a human typed on the SO line ('A', 'B', 'R1', '0') — snapshotted onto the row
// as it stood when that drawing change was recorded. Since migration 0119 the
// two are independent: a revision can move on without any upload, and three
// files can be uploaded under one revision. Rows the 0119 backfill could not
// reach carry no snapshot at all, and this screen leaves that blank rather than
// dressing the sequence number up as a revision it never was.
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

export function SoDrawingHistory({
  salesOrderId,
  soCode,
}: {
  salesOrderId: string;
  /** Only so the drawing access log reads "IN-SO-26-00521 L3" rather than a
   *  storage path. Optional — the history stands on its own without it. */
  soCode?: string;
}): React.JSX.Element {
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
  // What the access log should call whatever the user opens from this tab.
  const previewRefCode = active
    ? `${soCode ? `${soCode} ` : ''}L${active.lineNo}`.trim()
    : soCode;

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
            {/* The Rev typed on the SO line TODAY. A string since 0119, printed
                as-is — never compared with or counted against the sequence
                numbers below, which measure a different thing entirely. */}
            <span className="mono" style={{ color: 'var(--text2)' }}>{active.currentRevision}</span>
          </div>
          <div className="tbl-wrap">
            <table className="innovic-table tbl-ctr" style={{ width: '100%' }}>
              <thead>
                {/* Two columns where there used to be one, because the old single
                    "Rev 3" cell was printing a drawing-change count under the name of
                    the customer's revision. '#' is the change count; 'Rev' is what was
                    written on the paper. */}
                <tr>
                  <th style={{ width: '9%' }}>#</th>
                  <th style={{ width: '10%' }}>Rev</th>
                  <th style={{ width: '12%' }}>Change</th>
                  <th style={{ width: '31%' }}>File</th>
                  <th style={{ width: '16%' }}>By</th>
                  <th style={{ width: '18%' }}>When</th>
                  <th style={{ width: '4%' }} />
                </tr>
              </thead>
              <tbody>
                {active.revisions.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="empty-state">No revisions on this line.</td>
                  </tr>
                ) : (
                  // Rendered in the order the API sent — newest first. Not re-sorted
                  // here, so the screen can never disagree with the stored history.
                  active.revisions.map((r, i) => {
                    const path = r.drawingFilePath;
                    return (
                      <tr key={r.id}>
                        {/* Where this drawing sits in the line's own sequence of
                            drawings — the 3rd file it has had, written '#3'. Never
                            labelled "Rev": that is the mislabelling this column was
                            split to end. Newest first, so row 0 is the drawing on the
                            line today. */}
                        <td className="mono" style={{ fontWeight: 700, color: 'var(--text3)' }}>
                          #{r.revisionNo}
                          {i === 0 ? (
                            <span className="badge b-blue" style={{ marginLeft: 6 }}>current</span>
                          ) : null}
                        </td>
                        {/* The customer's revision as it stood when this drawing change
                            was recorded. Null means the row predates 0119 and its
                            revision was never captured — that is unknown, not zero, so
                            it is left blank (the house's "no value" dash) and the hover
                            says why rather than inventing a number. */}
                        <td
                          className="mono"
                          style={{ fontWeight: 700, color: 'var(--text2)' }}
                          title={
                            r.lineRevisionText === null
                              ? 'Revision not recorded for this drawing change.'
                              : `Line Rev ${r.lineRevisionText} at this drawing change`
                          }
                        >
                          {r.lineRevisionText === null ? (
                            <span className="text3">—</span>
                          ) : (
                            r.lineRevisionText
                          )}
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
        // A superseded drawing is still a drawing: same server-minted link, same
        // log row, same gate on Download. If anything, an OLD print is the one
        // you most want a record of somebody taking a copy of.
        <FilePreviewModal
          storagePath={previewPath}
          kind="drawing"
          source="so_line"
          {...(previewRefCode ? { refCode: previewRefCode } : {})}
          onClose={() => setPreviewPath(null)}
        />
      ) : null}
    </div>
  );
}
