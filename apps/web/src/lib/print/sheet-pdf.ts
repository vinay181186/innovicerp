// ⬇ Download PDF for a print sheet (owner 2026-10-17: "direct symbol for
// download"). A drawing downloads because a stored file exists; a print sheet
// is built from data, so it is turned into an A4 PDF here, in the browser, at
// the click. jsPDF + html2canvas load only on that click (dynamic import), so
// they never weigh on the app's own load.

import { buildSheetHtml, sheetDocumentHtml, type SheetPrintModel } from './sheet-print';

/** Screen-only chrome the preview and the PDF must not carry: the window's
 *  buttons, the page padding, and the sheet's on-screen shadow, border and
 *  padding (the print side padding instead, as on paper). */
export const SHEET_EMBED_STYLE =
  '.no-print{display:none!important}body{margin:0;padding:0;background:#fff}' +
  '.sheet{margin:0 auto;box-shadow:none;border:none;padding:0 9mm}';

/** The sheet as a full HTML document for an iframe (preview and PDF). */
export function sheetEmbedHtml(model: SheetPrintModel): string {
  return sheetDocumentHtml(model.windowTitle, buildSheetHtml(model), SHEET_EMBED_STYLE);
}

const PAGE_W = 210;
const PAGE_H = 297;
const MARGIN = 9;

/** Render the sheet off-screen and save it as `<fileName>.pdf`. */
export async function downloadSheetPdf(model: SheetPrintModel, fileName: string): Promise<void> {
  const [{ jsPDF }, { default: html2canvas }] = await Promise.all([
    import('jspdf'),
    import('html2canvas'),
  ]);
  const frame = document.createElement('iframe');
  // Off-screen at paper width; not display:none, which would give it no layout.
  frame.style.cssText = 'position:fixed;left:-10000px;top:0;width:210mm;height:297mm;border:0';
  // onload + srcdoc BEFORE the iframe joins the page, so the about:blank load
  // some browsers fire on insert can never be mistaken for the sheet's.
  const loaded = new Promise<void>((resolve) => {
    frame.onload = () => resolve();
  });
  frame.srcdoc = sheetEmbedHtml(model);
  document.body.appendChild(frame);
  try {
    await loaded;
    const doc = frame.contentDocument;
    if (!doc?.querySelector('.sheet'))
      throw new Error('Could not prepare the document. Try again.');
    await doc.fonts?.ready;

    // The paginator split the rows into one `.page` per sheet of paper (each
    // with its own letterhead); each one becomes one PDF page, so no row is cut
    // and the count matches the "1 of N" in the Order box. An un-paginated
    // document (paginator skipped) is one page: the whole sheet.
    const pages = [...doc.querySelectorAll<HTMLElement>('.page')];
    const parts = pages.length > 0 ? pages : [doc.querySelector<HTMLElement>('.sheet')!];
    const pdf = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' });
    for (let i = 0; i < parts.length; i++) {
      const canvas = await html2canvas(parts[i]!, { scale: 2, backgroundColor: '#ffffff' });
      const maxW = PAGE_W - 2 * MARGIN;
      const maxH = PAGE_H - 2 * MARGIN;
      const ratio = Math.min(maxW / canvas.width, maxH / canvas.height);
      if (i > 0) pdf.addPage();
      pdf.addImage(
        canvas.toDataURL('image/jpeg', 0.95),
        'JPEG',
        MARGIN,
        MARGIN,
        canvas.width * ratio,
        canvas.height * ratio,
      );
    }
    pdf.save(`${fileName}.pdf`);
  } finally {
    frame.remove();
  }
}
