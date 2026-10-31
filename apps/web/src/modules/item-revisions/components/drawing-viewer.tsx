// Inline drawing viewer for the drawing page — the file shown IN the page
// (pdf in a frame, image as an image) through a VIEW link minted by the server
// (`@/lib/drawing-url`, source 'item_revision'), so every look is logged and no
// download link is ever minted just to render it.

import { Loader2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { fileNameFromPath } from '@/components/shared/file-preview-modal';
import { drawingViewUrl } from '@/lib/drawing-url';

export type DrawingFileKind = 'pdf' | 'image' | 'none';

export function drawingFileKind(path: string): DrawingFileKind {
  const n = path.toLowerCase();
  if (n.endsWith('.pdf')) return 'pdf';
  if (/\.(png|jpe?g|gif|webp|bmp|svg)$/.test(n)) return 'image';
  return 'none';
}

/** The view URL for one drawing, or the error that stopped it. */
export function useDrawingViewUrl(
  path: string | null | undefined,
  refCode: string,
): { url: string | null; error: string | null } {
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    setUrl(null);
    setError(null);
    if (!path) return;
    void (async () => {
      try {
        const u = await drawingViewUrl({ path, source: 'item_revision', refCode });
        if (alive) setUrl(u);
      } catch (e) {
        if (alive) setError(e instanceof Error ? e.message : 'Could not open the drawing');
      }
    })();
    return () => {
      alive = false;
    };
  }, [path, refCode]);
  return { url, error };
}

export function DrawingViewer({
  path,
  url,
  error,
  label,
}: {
  path: string;
  url: string | null;
  error: string | null;
  label: string;
}): React.JSX.Element {
  const kind = drawingFileKind(path);
  if (error) {
    return (
      <div className="empty-state" style={{ color: 'var(--red2)' }}>
        {error}
      </div>
    );
  }
  if (kind === 'none') {
    return (
      <div className="empty-state">
        {fileNameFromPath(path)} cannot be shown in the page.
      </div>
    );
  }
  if (!url) {
    return (
      <div className="empty-state">
        <Loader2 size={14} className="inline animate-spin" /> Opening drawing…
      </div>
    );
  }
  return kind === 'pdf' ? (
    <iframe
      title={`Drawing ${label}`}
      src={url}
      style={{ width: '100%', height: '100%', minHeight: 480, border: 0 }}
    />
  ) : (
    <div style={{ textAlign: 'center', height: '100%', overflow: 'auto' }}>
      <img
        src={url}
        alt={`Drawing ${label}`}
        style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }}
      />
    </div>
  );
}
