// Shared file PREVIEW modal — the app's answer to "show me the file" as
// distinct from "save the file".
//
// Before this, every 📎 button did `window.open(signedUrl)`, which handed the
// file to the browser and let the browser decide. Chrome with "Download PDFs
// instead of automatically opening them" turned on (the default on many
// machines) downloads instead of showing — so a click meant to be a look
// became a file on disk. Anything the browser cannot render (.eml, .xlsx)
// downloaded unconditionally.
//
// So: viewing happens HERE, inside the app, in an iframe/img fed by an INLINE
// signed URL. Saving happens only when the user presses Download, which mints
// a second, separate signed URL carrying `Content-Disposition: attachment`
// (see `download` on @/lib/storage signedUrl). Two actions, two links, no
// browser-setting roulette.
//
// Styling is the existing .overlay / .modal.modal-lg / .modal-hdr theme —
// nothing invented.

import { Download, Loader2, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { signedUrl } from '@/lib/storage';

/** What we can render in-page. Driven by extension first (always present) and
 *  the registry's stored MIME type second (present for file_registry rows,
 *  absent for a bare drawing path). */
type PreviewKind = 'pdf' | 'image' | 'none';

function previewKind(fileName: string, fileType?: string | null): PreviewKind {
  const n = fileName.toLowerCase();
  const t = (fileType ?? '').toLowerCase();
  if (n.endsWith('.pdf') || t.includes('pdf')) return 'pdf';
  if (/\.(png|jpe?g|gif|webp|bmp|svg)$/.test(n) || t.startsWith('image/')) return 'image';
  return 'none';
}

/** Last path segment, minus the `${Date.now()}-` prefix uploadFile stamps on. */
export function fileNameFromPath(storagePath: string): string {
  const last = storagePath.split('/').pop() ?? storagePath;
  return last.replace(/^\d{10,}-/, '');
}

export function FilePreviewModal({
  storagePath,
  fileName,
  fileType,
  bucket,
  onClose,
}: {
  storagePath: string;
  /** Shown in the header and used as the saved-as name. Defaults to the path's
   *  own file name. */
  fileName?: string;
  fileType?: string | null;
  bucket?: string;
  onClose: () => void;
}): React.JSX.Element {
  const name = fileName ?? fileNameFromPath(storagePath);
  const kind = previewKind(name, fileType);

  const [url, setUrl] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Inline URL for the viewer. 10 minutes, not the 2-minute default: a PDF
  // viewer re-requests byte ranges while the reader scrolls, and an expired
  // link mid-read shows a blank frame.
  useEffect(() => {
    let alive = true;
    if (kind === 'none') return;
    void (async () => {
      try {
        const u = await signedUrl(storagePath, { expiresIn: 600, ...(bucket ? { bucket } : {}) });
        if (alive) setUrl(u);
      } catch (e) {
        if (alive) setErr(e instanceof Error ? e.message : 'Could not open file');
      }
    })();
    return () => {
      alive = false;
    };
  }, [storagePath, bucket, kind]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [onClose]);

  /** The only path that writes to disk. A SECOND signed URL, minted with
   *  `download` so Supabase answers with an attachment disposition; the
   *  anchor click keeps the current page put instead of navigating away. */
  async function onDownload(): Promise<void> {
    setSaving(true);
    setErr(null);
    try {
      const u = await signedUrl(storagePath, {
        download: name,
        ...(bucket ? { bucket } : {}),
      });
      const a = document.createElement('a');
      a.href = u;
      a.download = name;
      a.rel = 'noopener';
      document.body.appendChild(a);
      a.click();
      a.remove();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Download failed');
    } finally {
      setSaving(false);
    }
  }

  return createPortal(
    <div
      className="overlay"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="modal modal-lg" onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal-hdr">
          <div className="modal-title" style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>
            📎 {name}
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <button
              type="button"
              className="btn btn-primary btn-sm"
              onClick={() => void onDownload()}
              disabled={saving}
            >
              {saving ? (
                <Loader2 size={13} className="inline animate-spin" />
              ) : (
                <Download size={13} />
              )}{' '}
              Download
            </button>
            <button
              type="button"
              className="btn btn-ghost btn-sm btn-icon"
              onClick={onClose}
              aria-label="Close preview"
            >
              <X size={14} />
            </button>
          </div>
        </div>

        <div className="modal-body" style={{ padding: 0, background: 'var(--bg1, var(--bg3))' }}>
          {err ? (
            <div className="empty-state" style={{ color: 'var(--red)' }}>
              {err}
            </div>
          ) : kind === 'none' ? (
            // Nothing the browser renders in-page (.eml, .xlsx, .docx …).
            // Say so plainly rather than silently downloading it.
            <div className="empty-state" style={{ padding: 40, textAlign: 'center' }}>
              <div style={{ fontSize: 30, marginBottom: 8 }}>📁</div>
              <div className="text2">This file type cannot be previewed in the browser.</div>
              <div className="text3" style={{ fontSize: 11, marginTop: 4 }}>
                Use Download above to save it and open it on your computer.
              </div>
            </div>
          ) : !url ? (
            <div className="empty-state" style={{ padding: 40 }}>
              <Loader2 className="inline animate-spin" size={16} /> Loading preview…
            </div>
          ) : kind === 'pdf' ? (
            <iframe
              src={url}
              title={name}
              style={{ width: '100%', height: '78vh', border: 0, display: 'block' }}
            />
          ) : (
            <div
              style={{
                display: 'flex',
                justifyContent: 'center',
                alignItems: 'center',
                minHeight: '60vh',
                padding: 16,
              }}
            >
              <img
                src={url}
                alt={name}
                style={{ maxWidth: '100%', maxHeight: '78vh', objectFit: 'contain' }}
              />
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
