// Item drawing print (Print Templates P3, ADR-034). Mirrors legacy
// `printDrawingFile` (`legacy/InnovicERP_v82_12_3_DataLossFix_29-04-2026.html`
// L10490): opens the stored drawing in a print window — `<img>` for images,
// `<iframe>` for PDFs — under a header, with a Print button.
//
// DELTA vs legacy: legacy embedded a base64 `data:` URL held in
// `item.drawingData`. The new model stores the file in the private `qc-docs`
// bucket (path `item.drawingFilePath`); we ask the SERVER for a short-lived
// link (`@/lib/drawing-url`, view mode) and embed that. The link is fetched by
// the new window's own <img>/<iframe>, so the short expiry covers the open. We
// reuse the shared `printWindow` util (company header + Print/Close bar) so the
// printed sheet carries the company letterhead like the other P3 documents.
//
// Print asks for `view`, not `download`: putting the drawing on paper is a look
// at it, not a copy of the file saved to disk, and the log should say so.

import type { Company, Item } from '@innovic/shared';
import { drawingViewUrl } from '@/lib/drawing-url';
import { esc } from '@/lib/print/doc-print';
import { printWindow } from '@/lib/print/print-window';

function isPdfPath(path: string): boolean {
  return /\.pdf(\?|$)/i.test(path);
}

/** Opens a print window embedding the item's drawing. Returns false if the
 *  popup was blocked. Throws if no drawing is attached or the signed URL fails.
 */
export async function printItemDrawing(args: {
  item: Item;
  company: Company | null | undefined;
}): Promise<boolean> {
  const { item, company } = args;
  if (!item.drawingFilePath) {
    throw new Error('No drawing attached to this item');
  }

  const url = await drawingViewUrl({
    path: item.drawingFilePath,
    source: 'item',
    refCode: item.code,
  });
  const isPdf = isPdfPath(item.drawingFilePath);

  const titleLine = `${item.drawingNo ?? item.code} — ${item.name} (Rev ${item.revision})`;

  // `esc` makes the URL safe inside the src attribute. The drawing is centred
  // and constrained to the page; @media print rules in PRINT_STYLE strip the
  // no-print bar.
  const embed = isPdf
    ? `<iframe src="${esc(url)}" style="display:block;width:100%;height:80vh;border:1px solid #e5e7eb;border-radius:4px"></iframe>`
    : `<img src="${esc(url)}" alt="Drawing ${esc(titleLine)}" style="display:block;margin:0 auto;max-width:100%;max-height:80vh;border:1px solid #e5e7eb;border-radius:4px" />`;

  const body = `
    <div class="doc-title"><h1>DRAWING — ${esc(item.drawingNo ?? item.code)}</h1><span class="print-meta">${esc(titleLine)}</span></div>
    <div style="text-align:center">${embed}</div>`;

  return printWindow({ title: `Drawing ${item.drawingNo ?? item.code}`, body, company });
}
