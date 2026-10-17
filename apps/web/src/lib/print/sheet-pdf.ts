// ⬇ Download PDF for a print sheet (owner 2026-10-17: "direct symbol for
// download"). A drawing downloads because a stored file exists; a print sheet
// is built from data, so it is turned into an A4 PDF here, in the browser, at
// the click. jsPDF + html2canvas load only on that click (dynamic import), so
// they never weigh on the app's own load.

import { buildSheetHtml, sheetDocumentHtml, type SheetPrintModel } from './sheet-print';

/** Screen-only chrome the PDF must not carry: the window's buttons and the
 *  sheet's on-screen shadow and margin. */
export const SHEET_EMBED_STYLE =
  '.no-print{display:none!important}body{margin:0;background:#fff}' +
  '.sheet{margin:0 auto;box-shadow:none}';

/** The sheet as a full HTML document for an iframe (preview and PDF). */
export function sheetEmbedHtml(model: SheetPrintModel): string {
  return sheetDocumentHtml(model.windowTitle, buildSheetHtml(model), SHEET_EMBED_STYLE);
}

/** Render the sheet off-screen and save it as `<fileName>.pdf`. */
export async function downloadSheetPdf(model: SheetPrintModel, fileName: string): Promise<void> {
  const [{ jsPDF }, { default: html2canvas }] = await Promise.all([
    import('jspdf'),
    import('html2canvas'),
  ]);
  const frame = document.createElement('iframe');
  // Off-screen at paper width; not display:none, which would give it no layout.
  frame.style.cssText = 'position:fixed;left:-10000px;top:0;width:210mm;height:297mm;border:0';
  document.body.appendChild(frame);
  try {
    const loaded = new Promise<void>((resolve) => {
      frame.onload = () => resolve();
    });
    frame.srcdoc = sheetEmbedHtml(model);
    await loaded;
    const doc = frame.contentDocument;
    const sheet = doc?.querySelector<HTMLElement>('.sheet');
    if (!doc || !sheet) throw new Error('Could not prepare the document. Try again.');
    await doc.fonts?.ready;

    const canvas = await html2canvas(sheet, { scale: 2, backgroundColor: '#ffffff' });
    const pdf = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' });
    const pageW = 210;
    const pageH = 297;
    const imgH = (canvas.height * pageW) / canvas.width;
    const img = canvas.toDataURL('image/jpeg', 0.95);
    // One tall image, shown a page at a time by shifting it up.
    for (let y = 0, page = 0; y < imgH - 0.5; y += pageH, page++) {
      if (page > 0) pdf.addPage();
      pdf.addImage(img, 'JPEG', 0, -y, pageW, imgH);
    }
    pdf.save(`${fileName}.pdf`);
  } finally {
    frame.remove();
  }
}
