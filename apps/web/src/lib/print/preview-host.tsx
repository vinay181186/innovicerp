// THE one place a print is shown (owner 2026-10-21: "go A+B" — every document
// print opens the in-app Preview box with 🖨 Print · ⬇ Download · ✕, the box a
// drawing previews in, instead of a pop-up window).
//
// The print builders (print-po.ts, print-grn.ts, …) are unchanged: they still
// end in openSheetPrintWindow / openSheetHtmlWindow / printWindow, and those
// now hand the finished document to `presentPrint` here. Run a builder inside
// `asDownload(...)` and the same document is saved as `<fileName>.pdf`
// instead of shown — that is what a list's ⋯ → Download PDF does.

import { useEffect, useState } from 'react';
import { SheetPreviewModal } from '@/components/shared/sheet-preview-modal';
import { downloadHtmlPdf } from './sheet-pdf';

export interface PrintDocument {
  /** Box title, e.g. "Purchase Order". */
  title: string;
  /** The document number — the box names it and the PDF is saved as it. */
  fileName: string;
  /** The whole document (style + body) as the iframe and the PDF render it. */
  html: string;
}

type HostState =
  | (Omit<PrintDocument, 'html'> & { html: string | null; error?: string | null })
  | null;
let show: ((d: HostState) => void) | null = null;
let downloading: Promise<void> | null = null;
let mode: 'preview' | 'download' = 'preview';

/** Show the document in the Preview box — or, inside asDownload, save it. */
export function presentPrint(d: PrintDocument): boolean {
  if (mode === 'download') {
    downloading = downloadHtmlPdf(d.html, d.fileName);
    return true;
  }
  if (!show) return false; // no host mounted (outside the signed-in shell)
  show(d);
  return true;
}

/** Run a print builder so its document downloads as a PDF instead of opening.
 *  Resolves when the file is saved (the row ⋯ shows busy until then); a
 *  builder that printed nothing (returned false / threw) rejects. */
export function asDownload(build: () => unknown): Promise<void> {
  mode = 'download';
  downloading = null;
  try {
    build();
  } finally {
    mode = 'preview';
  }
  const done = downloading as Promise<void> | null;
  downloading = null;
  return done ?? Promise.reject(new Error('Nothing to download.'));
}

/**
 * The list / detail ⋯ entry point: `load` fetches what the print needs and
 * returns the builder call (e.g. `() => printPurchaseOrder({...})`).
 *  - 'preview': the box opens AT THE CLICK with "Loading preview…", then the
 *    sheet replaces it (a slow server never looks like a dead click);
 *  - 'download': the file is saved; the returned Promise keeps the row ⋯ busy.
 */
export function runPrint(
  action: 'preview' | 'download',
  label: { title: string; fileName: string },
  load: () => Promise<() => unknown>,
): Promise<void> {
  const message = (e: unknown): string =>
    e instanceof Error ? e.message : 'Could not prepare the document. Try again.';
  if (action === 'download') {
    return load()
      .then((build) => asDownload(build))
      .catch((e: unknown) => window.alert(message(e)));
  }
  show?.({ ...label, html: null });
  return load().then(
    (build) => {
      build();
    },
    (e: unknown) => show?.({ ...label, html: null, error: message(e) }),
  );
}

/** Mounted once in the signed-in shell (routes/_authenticated.tsx). */
export function PrintPreviewHost(): React.JSX.Element | null {
  const [doc, setDoc] = useState<HostState>(null);
  useEffect(() => {
    show = setDoc;
    return () => {
      show = null;
    };
  }, []);
  if (!doc) return null;
  return (
    <SheetPreviewModal
      title={doc.title}
      fileName={doc.fileName}
      html={doc.html}
      error={doc.error ?? null}
      onClose={() => setDoc(null)}
    />
  );
}
