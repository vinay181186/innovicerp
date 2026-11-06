// Revision-history modal for a single print-template block. Mirrors legacy
// _pteShowRevisions (L14989): newest-first, max 5, click Restore to load that
// version back into the editor (still needs an explicit Save to commit).

import { Loader2 } from 'lucide-react';
import { fmtDateTime } from '@/lib/date';
import { RowMenu } from '@/ui/data';
import { Modal } from '@/ui/feedback';
import { usePrintTemplateRevisions } from '../api';

interface Props {
  templateKey: string;
  blockName: string;
  onClose: () => void;
  onRestore: (content: string) => void;
  /** ADR-232: Restore loads a version into the editor — Edit tick only. */
  canRestore: boolean;
}

export function RevisionsModal({
  templateKey,
  blockName,
  onClose,
  onRestore,
  canRestore,
}: Props): React.JSX.Element {
  const { data, isLoading, isError } = usePrintTemplateRevisions(templateKey);
  const items = data?.items ?? [];

  return (
    <Modal title={`🕐 Revision History — ${blockName}`} onClose={onClose} confirmExit={false}>
      <div className="text3" style={{ fontSize: 'var(--fs-xs)', marginBottom: 10 }}>
        Restore loads that version into the editor — you still need to Save it.
      </div>
      {isLoading ? (
        <div className="empty-state">
          <Loader2 className="inline h-4 w-4 animate-spin" /> Loading…
        </div>
      ) : isError ? (
        <div className="empty-state" style={{ color: 'var(--red2)' }}>
          Could not load revisions. Try again.
        </div>
      ) : items.length === 0 ? (
        <div className="empty-state">No revision history yet.</div>
      ) : (
        <table className="innovic-table">
          <thead>
            <tr>
              <th className="th-ctr" style={{ width: 30 }}>
                Sr No
              </th>
              <th className="th-ctr" style={{ width: 150 }}>
                Revision Date
              </th>
              <th style={{ width: 130 }}>Revised By</th>
              <th>Preview</th>
              <th className="th-ctr" style={{ width: 48 }} aria-label="Actions" />
            </tr>
          </thead>
          <tbody>
            {items.map((r, i) => (
              <tr key={r.id}>
                <td className="td-ctr text3">{i + 1}</td>
                <td className="td-ctr" style={{ fontSize: 'var(--fs-xs)' }}>
                  {fmtDateTime(r.createdAt)}
                </td>
                <td style={{ fontSize: 'var(--fs-xs)' }}>{r.editedByName ?? '—'}</td>
                <td
                  className="text2"
                  style={{ fontSize: 'var(--fs-xs)', whiteSpace: 'pre-wrap', lineHeight: 1.5 }}
                >
                  {r.content.slice(0, 150)}
                  {r.content.length > 150 ? '…' : ''}
                </td>
                <td className="td-ctr">
                  <RowMenu
                    items={[
                      {
                        key: 'restore',
                        label: 'Restore',
                        icon: 'refresh-cw',
                        hidden: !canRestore,
                        onSelect: () => onRestore(r.content),
                      },
                    ]}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Modal>
  );
}
