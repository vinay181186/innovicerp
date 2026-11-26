// Inline drawing viewer for the drawing page — the file shown IN the page
// (pdf in a frame, image as an image) through a VIEW link minted by the server
// (`@/lib/drawing-url`, source 'item_revision'), so every look is logged and no
// download link is ever minted just to render it.

import { Loader2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { fileNameFromPath, pdfFitUrl } from '@/components/shared/file-preview-modal';
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
  boxRef,
  fullscreen,
}: {
  path: string;
  url: string | null;
  error: string | null;
  label: string;
  /** The box the page's ⛶ Full screen button puts into full screen. */
  boxRef?: React.RefObject<HTMLDivElement>;
  fullscreen?: boolean;
}): React.JSX.Element {
  const kind = drawingFileKind(path);
  // The frame fills the panel (flex 1, no fixed minimum) so the page itself
  // never scrolls to reach the bottom of the drawing.
  const inner = error ? (
    <div className="empty-state" style={{ color: 'var(--red2)' }}>
      {error}
    </div>
  ) : kind === 'none' ? (
    <div className="empty-state">{fileNameFromPath(path)} cannot be shown in the page.</div>
  ) : !url ? (
    <div className="empty-state">
      <Loader2 size={14} className="inline animate-spin" /> Opening drawing…
    </div>
  ) : kind === 'pdf' ? (
    <iframe
      title={`Drawing ${label}`}
      src={pdfFitUrl(url)}
      style={{ flex: 1, width: '100%', minHeight: 0, border: 0, display: 'block' }}
    />
  ) : (
    <div
      style={{
        flex: 1,
        minHeight: 0,
        overflow: 'auto',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <img
        src={url}
        alt={`Drawing ${label}`}
        style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }}
      />
    </div>
  );
  return (
    <div
      ref={boxRef}
      style={{
        flex: 1,
        minHeight: 0,
        display: 'flex',
        flexDirection: 'column',
        ...(fullscreen ? { width: '100%', height: '100%', background: 'var(--text)' } : {}),
      }}
    >
      {inner}
    </div>
  );
}
