// Compact drawing-file upload for a single JWSO line, sized to live inside an
// ~11%-wide table cell.
//
// A copy of sales-orders/components/so-line-drawing-cell.tsx rather than an
// import of it: that component hard-codes its Storage folder ('so-line-drawings')
// and takes no prop to change it, and the sales-orders module is owned by another
// session, so it could not be generalised. The only difference here is the folder
// — JWSO drawings land in 'jw-line-drawings', so a job-work drawing is never
// filed among the sales-order ones. Everything else (upload via the shared
// @/lib/storage helper, view in the shared file-preview modal, companyId off the
// session) is identical, deliberately.

import { Loader2 } from 'lucide-react';
import { useState } from 'react';
import { FilePreviewModal } from '@/components/shared/file-preview-modal';
import { useSession } from '@/lib/session';
import { uploadFile } from '@/lib/storage';

export function JwLineDrawingCell({
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
      const path = await uploadFile(file, me.companyId, { folder: 'jw-line-drawings' });
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
      <div style={{ display: 'flex', gap: 4, alignItems: 'center', justifyContent: 'center', whiteSpace: 'nowrap' }}>
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
          /* kind="drawing" routes the link through the server, which checks
             the download permission and logs the access. Without it the modal
             would sign the link in the browser and show Download to everyone. */
          <FilePreviewModal
            storagePath={value}
            kind="drawing"
            source="jw_line"
            onClose={() => setPreviewOpen(false)}
          />
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
