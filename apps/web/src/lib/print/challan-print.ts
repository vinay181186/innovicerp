// Delivery-challan print layout (approved proof, 2026-09-08).
//
// The two challans — OSP DC and JW DC — print on THIS layout. PO, Service PO
// and GRN keep rendering through `buildDocHtml` in ./doc-print, which is
// untouched: this file is a second, challan-only renderer so a change to the
// challan sheet can never move a purchase order.
//
// Why one <table> carries the whole document
// ------------------------------------------
// The letterhead has to repeat at the top of EVERY page. `position: fixed` was
// tried and does not do it reliably — Chrome clipped it on the last page and
// dropped the block into the middle of the sheet. A real <thead> with
// `display: table-header-group` is the only mechanism that repeats.
//
// The <thead> holds the letterhead and the document title and NOTHING else.
// The recipient/document boxes and the column-heading row are ordinary <tbody>
// rows on purpose: a header group as tall as those boxes is silently dropped by
// Chrome and then stops repeating altogether. The trade-off — letterhead on
// every page, column headings once on page 1 — is the accepted behaviour, not a
// bug to fix.

import { substituteTemplateVars } from '@innovic/shared';
import { addMonths, format, parseISO } from 'date-fns';
import { COMPANY_PAN, type DocCompany, esc, nl2br } from './doc-print';
import { INNOVIC_LOGO_DATA_URI } from './letterhead-logo';

// How long the material may stay with the job worker. There is no stored
// "challan end date" field anywhere in the contract, so it is computed:
// challan date + 3 months, which is what the printed conditions promise.
const CHALLAN_VALIDITY_MONTHS = 3;

// ── Model ──────────────────────────────────────────────────────────────────

/** One label/value pair inside the Recipient or Document box. */
export interface ChallanField {
  label: string;
  /** Plain text. Blank prints a dotted rule — never the word "null". */
  value: string;
  /** Extra lines printed under `value` (an address runs to two or three). */
  extra?: string[];
  /** `mono` = document numbers and dates, `name` = the vendor's name. */
  variant?: 'mono' | 'name';
  strong?: boolean;
}

export interface ChallanPrintLine {
  itemCode: string;
  itemName?: string | null;
  uom?: string | null;
  /** From the item master. Blank on almost every line today — the column stays,
   *  the cell prints an empty dotted rule. */
  hsn?: string | null;
  /** Pre-formatted, e.g. "120.00". */
  qty: string;
  remarks?: string | null;
}

export interface ChallanPrintModel {
  /** Title printed on the sheet — "Delivery Challan" on the approved proof. */
  title: string;
  /** Print-window / PDF-file title, so the two challans stay distinguishable. */
  windowTitle: string;
  /** header_note / special_notes / terms / footer / signature. */
  blocks: Record<string, string>;
  /** {placeholder} substitution bag for those blocks. */
  data: Record<string, string>;
  company: DocCompany;
  recipient: { label: string; fields: ChallanField[] };
  document: { label: string; fields: ChallanField[] };
  lines: ChallanPrintLine[];
  /** Pre-formatted total, e.g. "3563.00". */
  totalQty: string;
  /** Printed beside the total when every line shares one unit. */
  totalUom: string;
  /** A block the DOCUMENT computes for itself (the OSP DC's return status),
   *  printed under the goods table with its own heading — never folded into
   *  `special_notes`, which is text the user authored in Settings. */
  extraSection?: { title: string; body: string };
  opts?: { testBanner?: boolean };
}

/** Challan date + 3 months, in the sheet's date format. Blank in, blank out. */
export function challanEndDate(dcDate: string | null | undefined): string {
  const d = parseChallanDate(dcDate);
  return d ? format(addMonths(d, CHALLAN_VALIDITY_MONTHS), 'dd MMM yyyy') : '';
}

/** The sheet's date format: 06 Sep 2026. */
export function challanDate(dcDate: string | null | undefined): string {
  const d = parseChallanDate(dcDate);
  return d ? format(d, 'dd MMM yyyy') : '';
}

// Date-only strings parse as LOCAL midnight through parseISO, so no timezone
// shift can move a challan a day backwards the way `new Date(iso)` would.
function parseChallanDate(d: string | null | undefined): Date | null {
  if (!d) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(d);
  if (!m) return null;
  const parsed = parseISO(`${m[1]}-${m[2]}-${m[3]}`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

// ── Stylesheet ─────────────────────────────────────────────────────────────
//
// Ported from the approved proof. The proof loaded Archivo Narrow / Source
// Sans 3 / Source Code Pro from Google Fonts; a print popup must not wait on a
// network font, so each keeps only its system fallback chain.

const CHALLAN_STYLE = `
  :root{
    --paper:#FFFFFF;--paper-ink:#1A1A1A;--paper-rule:#1A1A1A;--paper-rule-soft:#8A8A8A;
    --paper-band:#F1F1F1;--brand:#1E4DB3;
    --f-label:"Arial Narrow",Arial,sans-serif;
    --f-body:"Segoe UI",system-ui,Arial,sans-serif;
    --f-mono:ui-monospace,Consolas,"Courier New",monospace;
    --f-head:Verdana,Geneva,"DejaVu Sans",sans-serif;
  }
  *{box-sizing:border-box}
  body{background:#E9ECEF;color:var(--paper-ink);font-family:var(--f-body);margin:0;
       padding:20px 16px 60px}
  .sheet{width:210mm;margin:0 auto;background:var(--paper);color:var(--paper-ink);
         padding:11mm 10mm;border:1px solid #CDD4DD;box-shadow:0 2px 14px rgba(20,28,40,.14);
         font-size:10.5pt}

  table.doc{width:100%;border-collapse:collapse;font-size:9.5pt}
  table.doc > thead > tr > th,
  table.doc > tbody > tr > td{border:1px solid var(--paper-rule);vertical-align:top}

  .lh{padding:0!important;border-bottom:none!important}
  .lh-in{padding:3.5mm 5mm 2.5mm}
  .lh-top{display:flex;align-items:flex-end;justify-content:space-between;gap:6mm}
  .lh-logo{height:13mm;width:auto;flex:none}
  .lh-co{text-align:right;font-weight:400}
  .co-name{font-family:var(--f-head);font-weight:700;font-size:15pt;line-height:1.1;
           margin:0 0 1mm;color:var(--brand);letter-spacing:-.01em}
  .co-addr{font-family:var(--f-head);font-size:7.5pt;line-height:1.35;margin:0 0 .8mm;
           color:var(--paper-ink)}
  .co-ids{font-family:var(--f-head);font-size:7.5pt;margin:0;color:var(--paper-ink)}
  .co-ids b{font-weight:700}
  .lh-rule{height:1.1mm;background:var(--brand);margin:2mm 0 2.5mm}
  .doc-title{font-family:var(--f-label);font-weight:700;font-size:12.5pt;letter-spacing:.15em;
             text-transform:uppercase;margin:0;text-align:center}

  .colh{font-family:var(--f-label);font-weight:700;font-size:8.5pt;letter-spacing:.08em;
        text-transform:uppercase;background:var(--paper-band);padding:2mm 2.5mm!important;
        vertical-align:middle}

  td.block{padding:0}
  .split{display:grid;grid-template-columns:1fr 1fr}
  .split > div{padding:3.5mm 5mm}
  .split > div:first-child{border-right:1px solid var(--paper-rule)}
  .bt{font-family:var(--f-label);font-weight:700;font-size:8pt;letter-spacing:.13em;
      text-transform:uppercase;color:#3A3A3A;margin:0 0 2mm;padding-bottom:1mm;
      border-bottom:1px solid var(--paper-rule-soft)}
  .kv{display:grid;grid-template-columns:28mm 1fr;gap:1.2mm 3mm;font-size:9.5pt;margin:0}
  .kv dt{font-family:var(--f-label);font-weight:700;font-size:8.5pt;letter-spacing:.05em;
         text-transform:uppercase;color:#3A3A3A}
  .kv dd{margin:0}
  .kv dd.mono{font-family:var(--f-mono);font-size:9pt}
  .kv dd.vname{font-weight:700;font-size:11pt;line-height:1.2}

  tbody td{padding:2.2mm 2.5mm}
  .num{text-align:center;font-variant-numeric:tabular-nums;font-family:var(--f-mono);font-size:9pt}
  .ctr{text-align:center}
  .qty{text-align:right;font-weight:600;font-variant-numeric:tabular-nums;
       font-family:var(--f-mono);font-size:9pt}
  .icode{font-family:var(--f-mono);font-size:8.5pt;display:block;color:#3A3A3A}
  .iname{display:block;font-weight:600;line-height:1.25;margin-top:.5mm}
  .rem{font-size:8.5pt;line-height:1.4;color:#2A2A2A}
  .blank{display:inline-block;width:12mm;border-bottom:1px dotted var(--paper-rule-soft)}
  .gap{display:inline-block;min-width:32mm;border-bottom:1px dotted var(--paper-rule-soft)}
  tr.total td{background:var(--paper-band);font-family:var(--f-label);font-weight:700;
              font-size:10pt;letter-spacing:.04em;padding:2.4mm 2.5mm}

  .terms{padding:3mm 5mm;font-size:8.5pt;line-height:1.5;color:#2A2A2A}
  .terms b{font-family:var(--f-label);letter-spacing:.06em;text-transform:uppercase;font-size:8pt}
  .foot{padding:2.5mm 5mm;text-align:center;font-size:8pt;color:#3A3A3A}
  .signs{display:grid;grid-template-columns:1fr 1fr 1fr}
  .signs > div{padding:3mm 5mm 13mm;font-family:var(--f-label);font-size:8.5pt;
               letter-spacing:.07em;text-transform:uppercase;color:#3A3A3A}
  .signs > div + div{border-left:1px solid var(--paper-rule)}

  .test-banner{background:#fef3c7;border:2px dashed #d97706;padding:10px;text-align:center;
               margin:0 auto 14px;max-width:210mm;border-radius:6px;color:#92400e;font-weight:700}
  .toolbar{max-width:210mm;margin:0 auto 10px;text-align:right}

  @media print{
    body{background:#fff;padding:0}
    .no-print{display:none!important}
    .sheet{width:auto;margin:0;border:none;box-shadow:none;padding:0}
    @page{size:A4 portrait;margin:10mm}
    /* The letterhead repeats; nothing splits mid-row. */
    thead{display:table-header-group}
    tr{break-inside:avoid;page-break-inside:avoid}
    .split,.split > div,.terms,.signs,.kv,.lh-in{break-inside:avoid;page-break-inside:avoid}
  }
`;

// ── Rendering ──────────────────────────────────────────────────────────────

const COLS = 6;

function fieldHtml(f: ChallanField): string {
  const cls = f.variant === 'mono' ? ' class="mono"' : f.variant === 'name' ? ' class="vname"' : '';
  const body = f.value
    ? [f.value, ...(f.extra ?? [])]
        .filter(Boolean)
        .map((l) => esc(l))
        .join('<br>')
    : // Nothing captured for this field. A dotted rule says so on paper; an
      // empty cell reads as something gone wrong, and "null" reads worse.
      '<span class="gap"></span>';
  const inner = f.strong && f.value ? `<strong>${body}</strong>` : body;
  return `<dt>${esc(f.label)}</dt><dd${cls}>${inner}</dd>`;
}

function boxHtml(box: { label: string; fields: ChallanField[] }): string {
  return `<p class="bt">${esc(box.label)}</p><dl class="kv">${box.fields
    .map(fieldHtml)
    .join('')}</dl>`;
}

function sectionRow(html: string): string {
  return `<tr><td class="block" colspan="${COLS}">${html}</td></tr>`;
}

export function buildChallanHtml(model: ChallanPrintModel): string {
  const { blocks, data, company, lines } = model;
  const sub = (key: string): string => nl2br(substituteTemplateVars(blocks[key] ?? '', data));

  const headerNote = sub('header_note');
  const specialNotes = sub('special_notes');
  const terms = sub('terms');
  const footer = sub('footer');
  const signature = sub('signature');

  const addressHtml = company.addressLines
    .filter(Boolean)
    .map((l) => `<p class="co-addr">${esc(l)}</p>`)
    .join('');
  // e-mail / phone kept on the letterhead: the old challan carried them in a
  // footer strip that this layout does not have, and dropping a vendor-facing
  // contact line off the document would be a loss, not a redesign.
  const contact = [
    company.email ? `e-mail: ${company.email}` : '',
    company.phone ? `M: ${company.phone}` : '',
  ].filter(Boolean);
  const contactHtml = contact.length ? `<p class="co-addr">${esc(contact.join('  ·  '))}</p>` : '';
  const ids = [
    company.gstin ? `<b>GSTIN:</b> ${esc(company.gstin)}` : '',
    `<b>PAN:</b> ${esc(COMPANY_PAN)}`,
  ].filter(Boolean);

  const letterhead = `<div class="lh-in">
    <div class="lh-top">
      <img class="lh-logo" src="${INNOVIC_LOGO_DATA_URI}" alt="INNOVIC">
      <div class="lh-co">
        <p class="co-name">${esc(company.name)}</p>
        ${addressHtml}
        ${contactHtml}
        <p class="co-ids">${ids.join(' &nbsp;&middot;&nbsp; ')}</p>
      </div>
    </div>
    <div class="lh-rule"></div>
    <p class="doc-title">${esc(model.title)}</p>
  </div>`;

  const itemRows = lines
    .map((l, i) => {
      const name = l.itemName ? `<span class="iname">${esc(l.itemName)}</span>` : '';
      const hsn = l.hsn ? esc(l.hsn) : '<span class="blank"></span>';
      const remarks = l.remarks ? nl2br(l.remarks) : '';
      return (
        `<tr><td class="num">${i + 1}</td>` +
        `<td><span class="icode">${esc(l.itemCode)}</span>${name}</td>` +
        `<td class="ctr">${esc(l.uom ?? '')}</td>` +
        `<td class="ctr">${hsn}</td>` +
        `<td class="qty">${esc(l.qty)}</td>` +
        `<td class="rem">${remarks}</td></tr>`
      );
    })
    .join('');

  const totalRow =
    `<tr class="total"><td colspan="4" style="text-align:right">Total quantity &mdash; ${lines.length} line${lines.length === 1 ? '' : 's'}</td>` +
    `<td class="qty">${esc(model.totalQty)}</td><td>${esc(model.totalUom)}</td></tr>`;

  const extraHtml = model.extraSection
    ? sectionRow(
        `<div class="terms"><b>${esc(model.extraSection.title)}</b><br>${esc(
          model.extraSection.body,
        ).replace(/\r?\n/g, '<br>')}</div>`,
      )
    : '';

  return `
  ${model.opts?.testBanner ? '<div class="no-print test-banner">ⓘ TEST PRINT — Sample data shown. Real data is substituted on actual prints.</div>' : ''}
  <div class="no-print toolbar">
    <button onclick="window.print()" style="padding:8px 24px;background:#1E4DB3;color:#fff;border:0;border-radius:5px;cursor:pointer">🖨 Print</button>
    <button onclick="window.close()" style="padding:8px 16px;background:#f3f4f6;border:1px solid #d1d5db;border-radius:5px;cursor:pointer">✕ Close</button>
  </div>
  <article class="sheet">
    <table class="doc">
      <thead><tr><th class="lh" colspan="${COLS}">${letterhead}</th></tr></thead>
      <tbody>
        ${sectionRow(
          `<div class="split"><div>${boxHtml(model.recipient)}</div><div>${boxHtml(
            model.document,
          )}</div></div>`,
        )}
        ${headerNote ? sectionRow(`<div class="terms">${headerNote}</div>`) : ''}
        <tr>
          <td class="colh ctr" style="width:11mm">Sr</td>
          <td class="colh">Item detail</td>
          <td class="colh ctr" style="width:14mm">UOM</td>
          <td class="colh ctr" style="width:19mm">HSN</td>
          <td class="colh ctr" style="width:20mm">Qty</td>
          <td class="colh" style="width:62mm">Remarks</td>
        </tr>
        ${itemRows}
        ${totalRow}
        ${extraHtml}
        ${specialNotes ? sectionRow(`<div class="terms"><b>Special notes</b><br>${specialNotes}</div>`) : ''}
        ${terms ? sectionRow(`<div class="terms"><b>Conditions</b><br>${terms}</div>`) : ''}
        ${sectionRow(
          `<div class="signs"><div>Prepared by</div><div>${
            signature || `Authorised signatory<br>for ${esc(company.name)}`
          }</div><div>Received by &mdash; job worker<br>Name, sign &amp; date</div></div>`,
        )}
        ${footer ? sectionRow(`<div class="foot">${footer}</div>`) : ''}
      </tbody>
    </table>
  </article>`;
}

/** Opens the challan print window. Returns false if the popup was blocked. */
export function openChallanPrintWindow(model: ChallanPrintModel): boolean {
  const w = window.open('', '_blank', 'width=900,height=920');
  if (!w) return false;
  const title = model.opts?.testBanner ? `Test Print — ${model.windowTitle}` : model.windowTitle;
  w.document.write(
    `<!DOCTYPE html><html><head><title>${esc(title)}</title><style>${CHALLAN_STYLE}</style></head><body>${buildChallanHtml(model)}</body></html>`,
  );
  w.document.close();
  return true;
}
