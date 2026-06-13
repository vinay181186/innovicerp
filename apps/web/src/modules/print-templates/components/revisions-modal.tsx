// Revision-history modal for a single print-template block. Mirrors legacy
// _pteShowRevisions (L14989): newest-first, max 5, click Restore to load that
// version back into the editor (still needs an explicit Save to commit).

import { format } from 'date-fns';
import { Loader2, X } from 'lucide-react';
import { usePrintTemplateRevisions } from '../api';

interface Props {
  templateKey: string;
  blockName: string;
  onClose: () => void;
  onRestore: (content: string) => void;
}

export function RevisionsModal({ templateKey, blockName, onClose, onRestore }: Props): React.JSX.Element {
  const { data, isLoading, isError } = usePrintTemplateRevisions(templateKey);
  const items = data?.items ?? [];

  return (
    <div
      role="dialog"
      aria-modal="true"
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,.45)',
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'center',
        padding: '6vh 16px',
        zIndex: 60,
      }}
    >
      <div
        className="panel"
        onClick={(e) => e.stopPropagation()}
        style={{ width: 'min(1100px, 96vw)', maxHeight: '84vh', overflow: 'auto' }}
      >
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            padding: '12px 16px',
            borderBottom: '1px solid var(--border)',
          }}
        >
          <div className="fw-700">🕐 Revision History — {blockName}</div>
          <button type="button" className="btn btn-ghost btn-sm" onClick={onClose}>
            <X size={14} />
          </button>
        </div>
        <div style={{ padding: 16 }}>
          <div className="text3" style={{ fontSize: 11, marginBottom: 10 }}>
            Showing the {items.length} most recent version{items.length === 1 ? '' : 's'} (max 5).
            Restore loads that version into the editor — you still need to Save it.
          </div>
          {isLoading ? (
            <div className="empty-state">
              <Loader2 className="inline h-4 w-4 animate-spin" /> Loading…
            </div>
          ) : isError ? (
            <div className="empty-state" style={{ color: 'var(--red)' }}>
              Failed to load revisions.
            </div>
          ) : items.length === 0 ? (
            <div className="empty-state">No revision history yet.</div>
          ) : (
            <table className="innovic-table">
              <thead>
                <tr>
                  <th style={{ width: 30 }}>#</th>
                  <th style={{ width: 150 }}>Date / Time</th>
                  <th style={{ width: 130 }}>Edited By</th>
                  <th>Preview</th>
                  <th style={{ width: 90 }} />
                </tr>
              </thead>
              <tbody>
                {items.map((r, i) => (
                  <tr key={r.id}>
                    <td className="text3">{i + 1}</td>
                    <td style={{ fontSize: 11 }}>
                      {format(new Date(r.createdAt), 'dd-MM-yyyy HH:mm')}
                    </td>
                    <td style={{ fontSize: 11 }}>{r.editedByName ?? '—'}</td>
                    <td
                      className="text2"
                      style={{ fontSize: 11, whiteSpace: 'pre-wrap', lineHeight: 1.5 }}
                    >
                      {r.content.slice(0, 150)}
                      {r.content.length > 150 ? '…' : ''}
                    </td>
                    <td>
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        onClick={() => onRestore(r.content)}
                      >
                        ↺ Restore
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
