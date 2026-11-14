// Drawing page (ADR-290) — the drawing corrections asked on a released Rev.
// A released (or superseded) Rev's file is never swapped directly: "Replace
// drawing" files a correction here, and a person with the Drawing Release
// switch approves it (only then does the file change; the old one stays in the
// drawing history) or rejects it with a reason. Short per-record list, read
// whole with the record.

import {
  REV_CHANGE_REASON_MIN,
  type DrawingCorrection,
  type DrawingCorrectionStatus,
} from '@innovic/shared';
import { useState } from 'react';
import { FilePreviewModal, fileNameFromPath } from '@/components/shared/file-preview-modal';
import { fmtDateTime } from '@/lib/date';
import { Badge, type BadgeTone } from '@/ui/core';
import { DataTable, type DataTableColumn, type RowMenuItem } from '@/ui/data';
import { TABLE_KEYS } from '@/ui/data/table-keys';
import { ConfirmDialog, useToast } from '@/ui/feedback';
import { FormField } from '@/ui/forms';
import { useDecideDrawingCorrection } from '../api';

const STATUS: Record<DrawingCorrectionStatus, { label: string; tone: BadgeTone }> = {
  pending: { label: 'Waiting', tone: 'amber' },
  approved: { label: 'Approved', tone: 'green' },
  rejected: { label: 'Rejected', tone: 'red' },
};

const COLUMNS: DataTableColumn<DrawingCorrection>[] = [
  {
    id: 'requested_on',
    header: 'Requested On',
    kind: 'date',
    className: 'mono',
    nowrap: true,
    render: (c) => fmtDateTime(c.requestedAt),
  },
  {
    id: 'requested_by',
    header: 'Requested By',
    kind: 'text',
    ellipsis: true,
    render: (c) => c.requestedByName ?? '—',
  },
  {
    id: 'file',
    header: 'Drawing File',
    kind: 'text',
    ellipsis: true,
    title: (c) => fileNameFromPath(c.drawingFilePath),
    render: (c) => fileNameFromPath(c.drawingFilePath),
  },
  {
    id: 'drawing_no',
    header: 'Drawing No.',
    kind: 'code',
    className: 'mono',
    nowrap: true,
    render: (c) => c.drawingNo ?? '—',
  },
  {
    id: 'reason',
    header: 'Correction Reason',
    kind: 'text',
    ellipsis: true,
    title: (c) => c.reason,
    render: (c) => c.reason,
  },
  {
    id: 'status',
    header: 'Correction Status',
    kind: 'badge',
    nowrap: true,
    filterValue: (c) => STATUS[c.status].label,
    render: (c) => <Badge tone={STATUS[c.status].tone}>{STATUS[c.status].label}</Badge>,
  },
  {
    id: 'decided_by',
    header: 'Decided By',
    kind: 'text',
    ellipsis: true,
    render: (c) => c.decidedByName ?? '—',
  },
  {
    id: 'decided_on',
    header: 'Decided On',
    kind: 'date',
    className: 'mono',
    nowrap: true,
    render: (c) => fmtDateTime(c.decidedAt),
  },
  {
    id: 'decision_note',
    header: 'Decision Note',
    kind: 'text',
    ellipsis: true,
    title: (c) => c.decisionNote ?? '',
    render: (c) => c.decisionNote ?? '—',
  },
];

export function DrawingCorrectionsTable({
  rows,
  label,
  mayDecide,
}: {
  rows: DrawingCorrection[];
  /** "ABC/1" — for the dialog titles and the drawing access log. */
  label: string;
  /** canReleaseDrawings — Approve / Reject on pending rows. */
  mayDecide: boolean;
}): React.JSX.Element {
  const [viewing, setViewing] = useState<string | null>(null);
  const [deciding, setDeciding] = useState<{
    row: DrawingCorrection;
    decision: 'approve' | 'reject';
  } | null>(null);
  const decide = useDecideDrawingCorrection();
  const toast = useToast();
  const [note, setNote] = useState('');

  const menu = (c: DrawingCorrection): RowMenuItem[] => [
    { key: 'view', label: 'View file', icon: 'eye', onSelect: () => setViewing(c.drawingFilePath) },
    {
      key: 'approve',
      // One label per control: the drawing page header also has the Rev's own
      // "Approve" / "Reject…" — these name what they decide.
      label: 'Approve correction',
      icon: 'check',
      group: 'workflow',
      hidden: !mayDecide || c.status !== 'pending',
      onSelect: () => {
        setNote('');
        setDeciding({ row: c, decision: 'approve' });
      },
    },
    {
      key: 'reject',
      label: 'Reject correction…',
      group: 'danger',
      hidden: !mayDecide || c.status !== 'pending',
      onSelect: () => {
        setNote('');
        setDeciding({ row: c, decision: 'reject' });
      },
    },
  ];

  const rejecting = deciding?.decision === 'reject';
  return (
    <>
      <DataTable<DrawingCorrection>
        tableKey={TABLE_KEYS.drawingCorrections}
        columns={COLUMNS}
        rows={rows}
        empty="No drawing corrections."
        rowMenu={menu}
      />
      {viewing ? (
        <FilePreviewModal
          storagePath={viewing}
          kind="drawing"
          source="item_revision"
          refCode={label}
          onClose={() => setViewing(null)}
        />
      ) : null}
      {deciding ? (
        <ConfirmDialog
          title={
            rejecting ? `Reject the correction of ${label}?` : `Approve the correction of ${label}?`
          }
          tone={rejecting ? 'danger' : 'primary'}
          confirmLabel={rejecting ? 'Reject correction' : 'Approve correction'}
          pendingLabel={rejecting ? 'Rejecting…' : 'Approving…'}
          message={
            <div style={{ display: 'grid', gap: 'var(--sp-2)', marginTop: 'var(--sp-2)' }}>
              <span>
                {rejecting
                  ? 'The drawing stays as it is.'
                  : 'The new file becomes the drawing of this Rev; the old file stays in the drawing history.'}
              </span>
              <FormField label="Decision Note" required={rejecting} htmlFor="dc-decide-note">
                <textarea
                  id="dc-decide-note"
                  className="innovic-input"
                  rows={2}
                  maxLength={500}
                  placeholder={rejecting ? `At least ${REV_CHANGE_REASON_MIN} characters` : ''}
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                />
              </FormField>
            </div>
          }
          onCancel={() => setDeciding(null)}
          onConfirm={async () => {
            const trimmed = note.trim();
            if (rejecting && trimmed.length < REV_CHANGE_REASON_MIN) {
              throw new Error(
                `Decision Note is required (at least ${REV_CHANGE_REASON_MIN} characters).`,
              );
            }
            await decide.mutateAsync({
              correctionId: deciding.row.id,
              input: { decision: deciding.decision, ...(trimmed ? { note: trimmed } : {}) },
            });
            toast.ok(rejecting ? 'Correction rejected' : 'Correction approved');
            setDeciding(null);
          }}
        />
      ) : null}
    </>
  );
}
