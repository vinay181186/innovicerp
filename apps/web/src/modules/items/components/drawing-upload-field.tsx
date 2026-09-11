// Drawing-file upload field for the item form. Uploads the chosen file to
// Storage via the shared @/lib/storage helper (folder `item-drawings`) and
// reports the resulting path back to the form's `drawingFilePath`.
//
// Viewing goes through the shared preview modal in `drawing` mode: the link is
// minted by the server, the look is logged, and Download only appears for people
// holding the drawing-download tick. It used to be `window.open(signedUrl)`,
// which both skipped that check and let Chrome's "download PDFs" setting save
// the file. Self-contained — reads companyId from the session.

import { Loader2 } from 'lucide-react';
import { useState } from 'react';
import { FilePreviewModal } from '@/components/shared/file-preview-modal';
import { useSession } from '@/lib/session';
import { uploadFile } from '@/lib/storage';

export function DrawingUploadField({
  value,
  onChange,
}: {
  value: string | null | undefined;
  onChange: (path: string | undefined) => void;
}): React.JSX.Element {
  const { data: me } = useSession();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);

  async function onPick(file: File | null): Promise<void> {
    if (!file) return;
    if (!me?.companyId) {
      setErr('No company on the current session.');
      return;
    }
    setErr(null);
    setBusy(true);
    try {
      const path = await uploadFile(file, me.companyId, { folder: 'item-drawings' });
      onChange(path);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Upload failed');
    } finally {
      setBusy(false);
    }
  }

  const fileName = value ? (value.split('/').pop() ?? value) : null;

  return (
    <div className="form-grp form-full">
      <label className="form-label">
        Drawing File <span className="form-help">(Image/PDF)</span>
      </label>
      <input
        type="file"
        className="innovic-input"
        accept="image/*,.pdf"
        disabled={busy}
        onChange={(e) => void onPick(e.target.files?.[0] ?? null)}
      />
      {busy ? (
        <div className="form-help">
          <Loader2 size={12} className="inline animate-spin" /> Uploading…
        </div>
      ) : value ? (
        <div className="form-help" style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => setPreviewOpen(true)}
          >
            📎 {fileName}
          </button>
          <button type="button" className="btn btn-danger btn-sm" onClick={() => onChange(undefined)}>
            Remove
          </button>
        </div>
      ) : (
        <div className="form-help">Stored privately; opened via a short-lived link.</div>
      )}
      {err ? <div className="form-error">{err}</div> : null}
      {previewOpen && value ? (
        <FilePreviewModal
          storagePath={value}
          kind="drawing"
          source="item"
          onClose={() => setPreviewOpen(false)}
        />
      ) : null}
    </div>
  );
}
