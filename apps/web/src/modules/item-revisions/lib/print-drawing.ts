// Drawing print (Item + Drawing Rev register) on the Innovic Sheet — the same
// paper, letterhead and paginator as the Job Card and ML BOM prints
// (sheet-print.ts). One box: the letterhead, a header block (Item Code, Item
// Name, Drawing Rev as ABC/1, Drawing No.), then the drawing itself.
//
// An image drawing is printed on the sheet. A PDF cannot be laid inside an
// HTML sheet reliably, so the sheet says so and the PDF is printed from the
// viewer on the drawing page.

import type { Company, ItemRevision } from '@innovic/shared';
import { buildDocCompany } from '@/lib/print/company';
import { esc } from '@/lib/print/doc-print';
import { openSheetHtmlWindow, sheetLetterheadHtml } from '@/lib/print/sheet-print';

const DRAWING_STYLE = `
  .dw-f{display:grid;grid-template-columns:1fr 1fr}
  .dw-f .f{display:flex;align-items:flex-end;gap:2mm;border-bottom:1px solid var(--paper-rule);
           min-height:6.4mm;padding:0 3mm .6mm}
  .dw-f .f:nth-child(odd){border-right:1px solid var(--paper-rule)}
  .dw-f .lab{flex:0 0 30mm;font-family:var(--f-label);font-size:8.5pt;letter-spacing:.06em;
             text-transform:uppercase}
  .dw-f .val{flex:1;font-size:10.5pt;font-weight:700}
  .dw-img{padding:3mm;text-align:center}
  .dw-img img{max-width:100%;max-height:230mm;object-fit:contain}
  .dw-note{padding:6mm 3mm;text-align:center;font-size:10pt}
`;

export function printDrawing(args: {
  revision: ItemRevision;
  company: Company | null | undefined;
  /** Inline (view) signed URL of the file, or null when none. */
  fileUrl: string | null;
  fileKind: 'pdf' | 'image' | 'none';
}): boolean {
  const { revision: r, fileUrl, fileKind } = args;
  const company = buildDocCompany(args.company);
  const letterhead = sheetLetterheadHtml({ name: company.name, title: 'Drawing' });
  const fact = (label: string, value: string): string =>
    `<div class="f"><span class="lab">${esc(label)}</span><span class="val">${esc(value)}</span></div>`;
  const facts =
    fact('Item Code', r.itemCode ?? '—') +
    fact('Item Name', r.itemName ?? '—') +
    fact('Drawing Rev', r.label) +
    fact('Drawing No.', r.drawingNo ?? '—');
  const drawing = !r.drawingFilePath
    ? '<div class="dw-note">Drawing not uploaded.</div>'
    : fileKind === 'image' && fileUrl
      ? `<div class="dw-img"><img src="${esc(fileUrl)}" alt="${esc(r.label)}"></div>`
      : '<div class="dw-note">The drawing is a PDF file — print it from the viewer on the drawing page.</div>';
  const html = `
  <article class="sheet">
    <table class="doc">
      <thead><tr><th class="lh">${letterhead}</th></tr></thead>
      <tfoot><tr><td class="pgfoot"><div></div></td></tr></tfoot>
      <tbody>
        <tr><td class="block"><div class="dw-f">${facts}</div></td></tr>
        <tr><td class="block">${drawing}</td></tr>
      </tbody>
    </table>
  </article>`;
  const title = `Drawing ${r.label}`;
  return openSheetHtmlWindow(title, html, DRAWING_STYLE, undefined, r.label.replace(/\//g, '-'));
}
