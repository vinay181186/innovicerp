// Compact drawing-file upload for a single SO line, sized to live inside an
// ~11%-wide table cell. Mirrors items/DrawingUploadField's logic (upload via the
// shared @/lib/storage helper, view in the shared file-preview modal) but trades
// the full-width layout for tiny inline controls. Reads companyId from session.

import { Loader2 } from 'lucide-react';
import { useState } from 'react';
import { FilePreviewModal } from '@/components/shared/file-preview-modal';
import { useSession } from '@/lib/session';
import { uploadFile } from '@/lib/storage';

export function SoLineDrawingCell({
  value,
  onChange,
}: {
  value: string | null | undefined;
  onChange: (path: string | undefined) => void;
}): React.JSX.Element {
  const { data: me } = useSession();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  // Viewing opens the in-app preview instead of handing the file to the
  // browser: `window.open` on a signed URL let Chrome's "download PDFs" setting
  // save the drawing to disk when the user only wanted to look at it.
  const [previewOpen, setPreviewOpen] = useState(false);

  async function onPick(file: File | null): Promise<void> {
    if (!file) return;
    if (!me?.companyId) {
      setErr('No company on session');
      return;
    }
    setErr(null);
    setBusy(true);
    try {
      const path = await uploadFile(file, me.companyId, { folder: 'so-line-drawings' });
      onChange(path);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Upload failed');
    } finally {
      setBusy(false);
    }
  }

  if (busy) {
    return (
      <span className="text3" style={{ fontSize: 11, whiteSpace: 'nowrap' }}>
        <Loader2 size={12} className="inline animate-spin" /> …
      </span>
    );
  }

  if (value) {
    return (
      <div style={{ display: 'flex', gap: 4, alignItems: 'center', whiteSpace: 'nowrap' }}>
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          style={{ padding: '2px 6px', fontSize: 11 }}
          onClick={() => setPreviewOpen(true)}
          title="Preview drawing"
        >
          📎 view
        </button>
        <button
          type="button"
          className="btn btn-sm"
          style={{ padding: '2px 6px', fontSize: 11, background: 'transparent', color: 'var(--red)', border: '1px solid var(--red)' }}
          onClick={() => onChange(undefined)}
          title="Clear drawing"
          aria-label="Clear drawing"
        >
          ✕
        </button>
        {previewOpen ? (
          <FilePreviewModal storagePath={value} onClose={() => setPreviewOpen(false)} />
        ) : null}
      </div>
    );
  }

  return (
    <div style={{ whiteSpace: 'nowrap' }}>
      <input
        type="file"
        className="innovic-input"
        style={{ fontSize: 11, padding: '2px' }}
        accept="image/*,.pdf"
        onChange={(e) => void onPick(e.target.files?.[0] ?? null)}
      />
      {err ? (
        <div className="form-error" style={{ fontSize: 10 }}>
          {err}
        </div>
      ) : null}
    </div>
  );
}
