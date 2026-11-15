// ADR-290 — "+ New Drawing Rev" on the Drawing Register. A customer's new Rev
// that no order names yet (ABC/2 arriving while the SO line still runs on
// ABC/1) is added here so Design can review and release it before work moves
// to it. It starts "Not released". Drawing Register Entry right.
//
// Built on the shared ConfirmDialog, like Replace drawing and Set Rev: a thrown
// error stays inside the dialog, so the server's 409 ("ABC/2 already exists")
// is shown in full and the dialog stays open. The file goes up through the same
// uploadFile flow as the drawing control (drawing-rev-field.tsx), into the
// register's drawing folder.

import { itemRevLabel, type ItemRevision } from '@innovic/shared';
import { useEffect, useState } from 'react';
import { fileNameFromPath } from '@/components/shared/file-preview-modal';
import { useSession } from '@/lib/session';
import { uploadFile } from '@/lib/storage';
import { useSaveKey } from '@/lib/use-save-key';
import { useItemsList } from '@/modules/items/api';
import { ConfirmDialog, FilePreview, filePreviewKind, useToast } from '@/ui/feedback';
import { FileField, FormField, SearchableSelect } from '@/ui/forms';
import { cleanDrawingRev, useCreateDrawingRev } from '../api';
import { ITEM_REVISION_DRAWING_FOLDER } from './replace-drawing-dialog';

export function NewDrawingRevDialog({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  /** Called with the new record once the server saved it. */
  onCreated: (rev: ItemRevision) => void;
}): React.JSX.Element {
  const { data: me } = useSession();
  const saveKey = useSaveKey();
  const create = useCreateDrawingRev(saveKey);
  const toast = useToast();

  // Item — the same master-only server-search picker as the Route Card form,
  // narrowed to make items (only they carry a Drawing Rev).
  const [itemSearch, setItemSearch] = useState('');
  const { data: itemsList, isFetching: itemsFetching } = useItemsList({
    ...(itemSearch.trim() ? { search: itemSearch.trim() } : {}),
    procurementType: 'make',
    excludePartyOwned: true,
    limit: 50,
    offset: 0,
  });
  const [itemId, setItemId] = useState<string | null>(null);
  const [itemCode, setItemCode] = useState('');
  const [rev, setRev] = useState('');
  const [drawingNo, setDrawingNo] = useState('');
  const [changeNote, setChangeNote] = useState('');
  const [path, setPath] = useState<string | null>(null);
  const [localFile, setLocalFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [fileErr, setFileErr] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  // The preview shows the user's own picked file (not yet in the register, so
  // there is no server view link for it). Free the object URL on close.
  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  async function onPick(file: File): Promise<void> {
    if (!me?.companyId) {
      setFileErr('No company on session');
      return;
    }
    setFileErr(null);
    setBusy(true);
    try {
      setPath(await uploadFile(file, me.companyId, { folder: ITEM_REVISION_DRAWING_FOLDER }));
      setLocalFile(file);
    } catch (e) {
      setPath(null);
      setLocalFile(null);
      setFileErr(e instanceof Error ? e.message : 'Could not upload file. Try again.');
    } finally {
      setBusy(false);
    }
  }

  const cleaned = cleanDrawingRev(rev);
  const label = itemCode && cleaned ? itemRevLabel(itemCode, cleaned) : null;

  return (
    <>
      <ConfirmDialog
        title="New Drawing Rev"
        tone="primary"
        confirmLabel="Save Drawing Rev"
        pendingLabel="Saving…"
        // Not over another modal; at the plain layer the file preview opens above it.
        elevated={false}
        message={
          <div style={{ display: 'grid', gap: 'var(--sp-2)', marginTop: 'var(--sp-2)' }}>
            <span>
              The new Drawing Rev starts Not released. Send it for review, then release it, before
              Plan, PRO or Job Card use it.
            </span>
            <FormField label="Item Code" required htmlFor="ndr-item">
              <SearchableSelect
                id="ndr-item"
                value={itemId}
                onChange={(id) => {
                  setItemId(id);
                  // Dependent field: the code follows the pick, clears with it.
                  setItemCode(itemsList?.items.find((i) => i.id === id)?.code ?? '');
                }}
                onSearch={setItemSearch}
                loading={itemsFetching}
                options={(itemsList?.items ?? []).map((i) => ({
                  id: i.id,
                  code: i.code,
                  name: i.name,
                }))}
                placeholder="🔍 Search item code or name…"
                valueLabel={itemCode || undefined}
                selectedLabel={(o) => o.code ?? o.name}
              />
            </FormField>
            <FormField label="Drawing Rev" required htmlFor="ndr-rev">
              <input
                id="ndr-rev"
                className="innovic-input mono"
                style={{ maxWidth: '12ch' }}
                maxLength={32}
                autoComplete="off"
                value={rev}
                onChange={(e) => setRev(e.target.value)}
              />
            </FormField>
            <FormField label="Drawing No." htmlFor="ndr-dno">
              <input
                id="ndr-dno"
                className="innovic-input fw-sm"
                maxLength={64}
                autoComplete="off"
                value={drawingNo}
                onChange={(e) => setDrawingNo(e.target.value)}
              />
            </FormField>
            <FileField
              variant="drawing"
              id="ndr-file"
              busy={busy}
              error={fileErr ?? undefined}
              fileName={path ? fileNameFromPath(path) : null}
              onPick={(f) => void onPick(f)}
              onRemove={() => {
                setPath(null);
                setLocalFile(null);
              }}
              onView={() => {
                if (localFile) setPreviewUrl(URL.createObjectURL(localFile));
              }}
            />
            <FormField label="What changed" htmlFor="ndr-note">
              <textarea
                id="ndr-note"
                className="innovic-input"
                rows={2}
                maxLength={500}
                placeholder="What changed in this Rev"
                value={changeNote}
                onChange={(e) => setChangeNote(e.target.value)}
              />
            </FormField>
          </div>
        }
        onCancel={onClose}
        onConfirm={async () => {
          // Thrown, not returned: ConfirmDialog shows it and stays open.
          if (busy) throw new Error('Wait for the file to finish uploading.');
          if (!itemId) throw new Error('Item Code is required.');
          if (!cleaned) {
            throw new Error('Drawing Rev is required (letters, digits, . - / only).');
          }
          const created = await create.mutateAsync({
            itemId,
            rev: cleaned,
            drawingNo: drawingNo.trim() || null,
            drawingFilePath: path,
            changeNote: changeNote.trim() || null,
          });
          toast.ok(`${created.label || label || 'Drawing Rev'} saved`);
          onCreated(created);
        }}
      />
      {previewUrl && localFile ? (
        <FilePreview
          fileName={localFile.name}
          kind={filePreviewKind(localFile.name, localFile.type)}
          src={previewUrl}
          canDownload={false}
          onClose={() => setPreviewUrl(null)}
        />
      ) : null}
    </>
  );
}
