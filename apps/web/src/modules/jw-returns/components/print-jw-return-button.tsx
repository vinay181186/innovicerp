// Preview · ⬇ Download PDF of the return challan for one JW Return — on the
// New Return popup right after Save. The loading lives in usePrintJwReturn
// (the register ⋯ uses the same hook): the one return and its client are read
// on the click; Preview opens the in-app box at once, Download saves the PDF.

import { Download, Eye, Loader2 } from 'lucide-react';
import { useState } from 'react';
import { usePrintJwReturn } from './use-print-jw-return';

export function PrintJwReturnButton({
  returnId,
  code,
  primary = false,
}: {
  returnId: string;
  /** The return's number — names the preview box and the PDF. */
  code: string;
  primary?: boolean;
}): React.JSX.Element {
  const { preview, download } = usePrintJwReturn();
  const [busy, setBusy] = useState<'preview' | 'download' | null>(null);
  const run = (action: 'preview' | 'download'): void => {
    setBusy(action);
    const go = action === 'preview' ? preview : download;
    void go({ id: returnId, code }).finally(() => setBusy(null));
  };

  return (
    <>
      <button
        type="button"
        className={primary ? 'btn btn-primary' : 'btn btn-ghost btn-sm'}
        onClick={(e) => {
          e.stopPropagation();
          run('preview');
        }}
        disabled={busy !== null}
        title="Preview the return challan"
        style={{ whiteSpace: 'nowrap' }}
      >
        {busy === 'preview' ? (
          <Loader2 size={13} className="inline animate-spin" />
        ) : (
          <Eye size={13} />
        )}{' '}
        Preview
      </button>
      <button
        type="button"
        className="btn btn-ghost"
        onClick={(e) => {
          e.stopPropagation();
          run('download');
        }}
        disabled={busy !== null}
        title="Download the return challan as a PDF"
        style={{ whiteSpace: 'nowrap' }}
      >
        {busy === 'download' ? (
          <Loader2 size={13} className="inline animate-spin" />
        ) : (
          <Download size={13} />
        )}{' '}
        Download PDF
      </button>
    </>
  );
}
