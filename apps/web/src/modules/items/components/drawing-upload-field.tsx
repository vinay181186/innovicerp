// Drawing-file upload field for the item form. Uploads the chosen file to
// Storage via the shared @/lib/storage helper (folder `item-drawings`) and
// reports the resulting path back to the form's `drawingFilePath`. View opens a
// short-lived signed URL. Self-contained — reads companyId from the session.

import { Loader2 } from 'lucide-react';
import { useState } from 'react';
import { useSession } from '@/lib/session';
import { signedUrl, uploadFile } from '@/lib/storage';

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

  async function view(): Promise<void> {
    if (!value) return;
    try {
      const url = await signedUrl(value);
      window.open(url, '_blank', 'noopener');
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not open file');
    }
  }

  const fileName = value ? (value.split('/').pop() ?? value) : null;

  return (
    <div className="form-grp">
      <label className="form-label">Drawing File</label>
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
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => void view()}>
            📎 {fileName}
          </button>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            style={{ color: 'var(--red)' }}
            onClick={() => onChange(undefined)}
          >
            ✕ Remove
          </button>
        </div>
      ) : (
        <div className="form-help">PDF or image. Stored privately; opened via a short-lived link.</div>
      )}
      {err ? <div className="form-error">{err}</div> : null}
    </div>
  );
}
