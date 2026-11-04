// In-app preview of a print sheet — the same box a drawing previews in
// (file-preview-modal.tsx: the shared Modal, lg), with 🖨 Print and
// ⬇ Download beside ✕. The sheet is built from data, so the preview is the
// sheet itself in an iframe and Download makes the PDF at the click
// (@/lib/print/sheet-pdf). The box opens at once; until the sheet is ready
// it says "Loading preview…" (`html` null), exactly as a drawing does.
// Every document print reaches it through lib/print/preview-host.tsx.

import { Download, Loader2, Printer } from 'lucide-react';
import { useRef, useState } from 'react';
import { downloadHtmlPdf } from '@/lib/print/sheet-pdf';
import { Modal } from '@/ui/feedback';

export function SheetPreviewModal(props: {
  title: string;
  /** Saved as `<fileName>.pdf` — the document number. */
  fileName: string;
  /** The whole print document; null while the data is still loading. */
  html: string | null;
  /** The load failed: said in the box instead of the sheet. */
  error?: string | null;
  onClose: () => void;
}): React.JSX.Element {
  const { title, fileName, html, onClose } = props;
  const frame = useRef<HTMLIFrameElement>(null);
  const [saving, setSaving] = useState(false);
  const [saveErr, setSaveErr] = useState<string | null>(null);
  const err = props.error ?? saveErr;

  const onDownload = async (): Promise<void> => {
    if (!html) return;
    setSaving(true);
    setSaveErr(null);
    try {
      await downloadHtmlPdf(html, fileName);
    } catch (e) {
      setSaveErr(e instanceof Error ? e.message : 'Could not download the PDF. Try again.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      title={`${title} — ${fileName}`}
      size="lg"
      onClose={onClose}
      closeLabel="Close preview"
      confirmExit={false}
      elevated
      bodyStyle={{ padding: 0, background: 'var(--bg1, var(--bg3))' }}
      headerActions={
        <>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            disabled={!html}
            onClick={() => frame.current?.contentWindow?.print()}
          >
            <Printer size={13} /> Print
          </button>
          <button
            type="button"
            className="btn btn-primary btn-sm"
            onClick={() => void onDownload()}
            disabled={!html || saving}
          >
            {saving ? (
              <Loader2 size={13} className="inline animate-spin" />
            ) : (
              <Download size={13} />
            )}{' '}
            Download
          </button>
        </>
      }
    >
      {err ? (
        <div className="empty-state" style={{ color: 'var(--red2)', padding: 40 }}>
          {err}
        </div>
      ) : !html ? (
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
    </Modal>
  );
}
