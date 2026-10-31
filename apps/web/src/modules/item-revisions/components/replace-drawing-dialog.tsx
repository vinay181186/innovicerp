// "Replace drawing…" — the ONLY way to change the file of an Item + Rev
// (ABC/1) that already has one. The wrong file is fixed here, with a reason,
// and the old file stays in the drawing history; closed Job Cards keep showing
// the file they were made with. A genuinely new drawing is a new Drawing Rev,
// not a replace.
//
// Built on the shared ConfirmDialog (its message slot carries the fields, the
// same way Route Card → Move to Trash asks for its reason). A thrown error is
// shown inside the dialog, so a 409 "changed by someone else" or a refused
// right never closes it. Sends the record's updatedAt as loaded (§20.4).

import type { ItemRevision } from '@innovic/shared';
import { useState } from 'react';
import { useSession } from '@/lib/session';
import { uploadFile } from '@/lib/storage';
import { ConfirmDialog } from '@/ui/feedback';
import { FormField } from '@/ui/forms';
import { useReplaceItemRevisionDrawing } from '../api';

/** Storage folder every register drawing is filed under. */
export const ITEM_REVISION_DRAWING_FOLDER = 'item-revision-drawings';
const MIN_REASON = 5;

export function ReplaceDrawingDialog({
  revision,
  onDone,
  onCancel,
}: {
  revision: ItemRevision;
  /** Called with the new file path once the server accepted the replace. */
  onDone: (path: string) => void;
  onCancel: () => void;
}): React.JSX.Element {
  const { data: me } = useSession();
  const replace = useReplaceItemRevisionDrawing(revision.id);
  const [path, setPath] = useState<string | null>(null);
  const [drawingNo, setDrawingNo] = useState(revision.drawingNo ?? '');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function onPick(file: File | null): Promise<void> {
    if (!file) return;
    if (!me?.companyId) {
      setErr('No company on session');
      return;
    }
    setErr(null);
    setBusy(true);
    try {
      setPath(await uploadFile(file, me.companyId, { folder: ITEM_REVISION_DRAWING_FOLDER }));
    } catch (e) {
      setPath(null);
      setErr(e instanceof Error ? e.message : 'Could not upload file. Try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <ConfirmDialog
      title={`Replace drawing of ${revision.label}?`}
      tone="primary"
      confirmLabel="Replace drawing"
      pendingLabel="Replacing…"
      message={
        <div style={{ display: 'grid', gap: 'var(--sp-2)', marginTop: 'var(--sp-2)' }}>
          <span>
            The old file stays in this drawing&apos;s history. For a new revision of the drawing,
            use a new Drawing Rev instead.
          </span>
          <FormField label="New drawing file" required htmlFor="ir-replace-file" error={err ?? undefined}>
            <input
              id="ir-replace-file"
              type="file"
              className="innovic-input"
              accept="image/*,.pdf"
              disabled={busy}
              onChange={(e) => void onPick(e.target.files?.[0] ?? null)}
            />
          </FormField>
          <FormField label="Drawing No." htmlFor="ir-replace-dno">
            <input
              id="ir-replace-dno"
              className="innovic-input fw-sm"
              maxLength={64}
              autoComplete="off"
              value={drawingNo}
              onChange={(e) => setDrawingNo(e.target.value)}
            />
          </FormField>
          <FormField label="Replace Reason" required htmlFor="ir-replace-reason">
            <textarea
              id="ir-replace-reason"
              className="innovic-input"
              rows={2}
              maxLength={500}
              placeholder="Why the drawing is being replaced (at least 5 characters)"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </FormField>
        </div>
      }
      onCancel={onCancel}
      onConfirm={async () => {
        // Thrown, not returned: ConfirmDialog shows it and stays open.
        if (busy) throw new Error('Wait for the file to finish uploading.');
        if (!path) throw new Error('Choose the new drawing file.');
        if (reason.trim().length < MIN_REASON) {
          throw new Error('Reason is required (at least 5 characters).');
        }
        await replace.mutateAsync({
          drawingFilePath: path,
          drawingNo: drawingNo.trim() || null,
          reason: reason.trim(),
          expectedUpdatedAt: revision.updatedAt,
        });
        onDone(path);
      }}
    />
  );
}
