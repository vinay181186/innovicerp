// In-app preview of a print sheet — the same box a drawing previews in
// (file-preview-modal.tsx: .overlay / .modal.modal-lg), with 🖨 Print and
// ⬇ Download beside ✕. The sheet is built from data, so the preview is the
// sheet itself in an iframe and Download makes the PDF at the click
// (@/lib/print/sheet-pdf). The box opens at once; until the sheet is ready
// it says "Loading preview…" (`model` null), exactly as a drawing does.

import { Download, Loader2, Printer, X } from 'lucide-react';
import { useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { downloadSheetPdf, sheetEmbedHtml } from '@/lib/print/sheet-pdf';
import type { SheetPrintModel } from '@/lib/print/sheet-print';

export function SheetPreviewModal(props: {
  title: string;
  /** Saved as `<fileName>.pdf` — the document number. */
  fileName: string;
  /** Null while the data is still loading. */
  model: SheetPrintModel | null;
  /** The load failed: said in the box instead of the sheet. */
  error?: string | null;
  onClose: () => void;
}): React.JSX.Element {
  const { title, fileName, model, onClose } = props;
  const frame = useRef<HTMLIFrameElement>(null);
  const [saving, setSaving] = useState(false);
  const [saveErr, setSaveErr] = useState<string | null>(null);
  const html = useMemo(() => (model ? sheetEmbedHtml(model) : ''), [model]);
  const err = props.error ?? saveErr;

  const onDownload = async (): Promise<void> => {
    if (!model) return;
    setSaving(true);
    setSaveErr(null);
    try {
      await downloadSheetPdf(model, fileName);
    } catch (e) {
      setSaveErr(e instanceof Error ? e.message : 'Could not download the PDF. Try again.');
    } finally {
      setSaving(false);
    }
  };

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
            {title} — {fileName}
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              disabled={!model}
              onClick={() => frame.current?.contentWindow?.print()}
            >
              <Printer size={13} /> Print
            </button>
            <button
              type="button"
              className="btn btn-primary btn-sm"
              onClick={() => void onDownload()}
              disabled={!model || saving}
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
            <div className="empty-state" style={{ color: 'var(--red2)', padding: 40 }}>
              {err}
            </div>
          ) : !model ? (
            <div className="empty-state" style={{ padding: 40 }}>
              <Loader2 className="inline animate-spin" size={16} /> Loading preview…
            </div>
          ) : (
            <iframe
              ref={frame}
              srcDoc={html}
              title={`${title} ${fileName}`}
              style={{ width: '100%', height: '78vh', border: 0, display: 'block' }}
            />
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
