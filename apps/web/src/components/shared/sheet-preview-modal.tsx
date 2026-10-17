// In-app preview of a print sheet — the same box a drawing previews in
// (file-preview-modal.tsx: .overlay / .modal.modal-lg), with 🖨 Print and
// ⬇ Download beside ✕. The sheet is built from data, so the preview is the
// sheet itself in an iframe and Download makes the PDF at the click
// (@/lib/print/sheet-pdf).

import { Download, Loader2, Printer, X } from 'lucide-react';
import { useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { downloadSheetPdf, sheetEmbedHtml } from '@/lib/print/sheet-pdf';
import type { SheetPrintModel } from '@/lib/print/sheet-print';

export function SheetPreviewModal(props: {
  model: SheetPrintModel;
  /** Saved as `<fileName>.pdf` — the document number. */
  fileName: string;
  onClose: () => void;
}): React.JSX.Element {
  const { model, fileName, onClose } = props;
  const frame = useRef<HTMLIFrameElement>(null);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const onDownload = async (): Promise<void> => {
    setSaving(true);
    setErr(null);
    try {
      await downloadSheetPdf(model, fileName);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not download the PDF. Try again.');
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
            {model.title} — {fileName}
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => frame.current?.contentWindow?.print()}
            >
              <Printer size={13} /> Print
            </button>
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
        {err ? (
          <div className="text3" style={{ color: 'var(--red2)', padding: '6px 16px' }}>
            {err}
          </div>
        ) : null}
        <div className="modal-body" style={{ padding: 0, background: 'var(--bg1, var(--bg3))' }}>
          <iframe
            ref={frame}
            srcDoc={sheetEmbedHtml(model)}
            title={`${model.title} ${fileName}`}
            style={{ width: '100%', height: '78vh', border: 0, display: 'block' }}
          />
        </div>
      </div>
    </div>,
    document.body,
  );
}
