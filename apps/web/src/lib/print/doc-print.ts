// Shared document print-window builder for template-consuming prints
// (Print Templates P2, ADR-034). Generalises P1's sample-only test-print
// builder to accept REAL line items, meta rows, a recipient address block and
// PO tax totals + amount-in-words. Reuses `substituteTemplateVars` from
// `@innovic/shared` (the single source of truth for {var} injection).
//
// Presentation-only per ADR-034 DELTA #2 — NO business logic lives here. The
// per-doc callers (PO / OSP DC / JW DC) assemble a `DocPrintModel` from their
// API data + the effective templates, then call `openDocPrintWindow`.
//
// Number format + amount-in-words ported verbatim from legacy `printPO`
// (`legacy/InnovicERP_v82_12_3_DataLossFix_29-04-2026.html` L25933 / L25950).

import {
  type EffectivePrintTemplate,
  type PrintDocType,
  substituteTemplateVars,
} from '@innovic/shared';

// ── escaping ──
export function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
function nl2br(s: string): string {
  return esc(s).replace(/\r?\n/g, '<br>');
}

// ── Date format: YYYY-MM-DD (or ISO) → dd-MM-yyyy, no timezone shift ──
export function fmtDate(d: string | null | undefined): string {
  if (!d) return '';
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(d);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : d;
}

// ── Indian number format (1,00,000.00) ──
export function inrFormat(num: number): string {
  return num.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// ── Amount in words, Indian system (legacy numWords L25950, verbatim) ──
const ONES = [
  '', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven',
  'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen',
];
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];

function numWords(num: number): string {
  if (num === 0) return 'Zero';
  let s = '';
  if (Math.floor(num / 10000000) > 0) {
    s += numWords(Math.floor(num / 10000000)) + ' Crore ';
    num %= 10000000;
  }
  if (Math.floor(num / 100000) > 0) {
    s += numWords(Math.floor(num / 100000)) + ' Lakh ';
    num %= 100000;
  }
  if (Math.floor(num / 1000) > 0) {
    s += numWords(Math.floor(num / 1000)) + ' Thousand ';
    num %= 1000;
  }
  if (Math.floor(num / 100) > 0) {
    s += numWords(Math.floor(num / 100)) + ' Hundred ';
    num %= 100;
  }
  if (num > 0) {
    if (num < 20) s += ONES[num] ?? '';
    else s += (TENS[Math.floor(num / 10)] ?? '') + (num % 10 > 0 ? ' ' + (ONES[num % 10] ?? '') : '');
  }
  return s.trim();
}

export function amountInWords(grand: number): string {
  let words = 'Indian Rupees ' + numWords(Math.floor(grand));
  const paise = Math.round((grand - Math.floor(grand)) * 100);
  if (paise > 0) words += ' and ' + numWords(paise) + ' Paise';
  return words + ' Only';
}

// ── Model ──
export interface DocLine {
  itemCode: string;
  itemName?: string | null;
  qty: string;
  uom?: string;
  rate?: string; // PO only, pre-formatted
  amount?: string; // PO only, pre-formatted
}
export interface DocAddressBlock {
  label: string; // "Supplier (Bill from)" / "Recipient"
  name: string;
  lines: string[]; // address / GSTIN / contact lines (plain text)
}
export interface DocMetaCell {
  label: string;
  value: string;
}
export interface DocTotals {
  subtotal: string; // pre-formatted
  taxRows: DocMetaCell[]; // [{label:'SGST @ 9%', value:'…'}]
  grand: string; // pre-formatted
  amountInWords: string;
}
export interface DocCompany {
  name: string;
  addressLines: string[];
  gstin?: string;
  email?: string;
  phone?: string;
}
export interface DocPrintModel {
  doc: PrintDocType;
  blocks: Record<string, string>; // header_note/special_notes/terms/footer/signature
  data: Record<string, string>; // {var} substitution bag
  company: DocCompany;
  recipient: DocAddressBlock;
  meta: DocMetaCell[];
  lines: DocLine[];
  totals?: DocTotals; // PO only
  opts?: { testBanner?: boolean };
}

const DOC_TITLE: Record<PrintDocType, string> = {
  PO: 'PURCHASE ORDER',
  'OSP DC': 'OSP DELIVERY CHALLAN',
  'JW DC': 'JOB WORK DELIVERY CHALLAN',
};

const DOC_STYLE = `
  @media print{@page{margin:10mm}.no-print{display:none!important}}
  body{font-family:Arial,sans-serif;font-size:12px;color:#1e293b;margin:20px}
  .doc-border{border:2px solid #333;padding:0}
  .doc-hdr{display:flex;align-items:center;padding:14px;border-bottom:2px solid #333}
  .title-bar{text-align:center;padding:10px;border-bottom:2px solid #333;font-size:18px;font-weight:900;letter-spacing:3px;background:#f8fafc}
  .addr-row{display:flex;border-bottom:1px solid #999}
  .addr-box{flex:1;padding:10px 14px;font-size:10px;line-height:1.45}
  .addr-box:first-child{border-right:1px solid #999}
  .addr-lbl{font-weight:700;color:#333;text-decoration:underline;margin-bottom:3px}
  .addr-name{font-weight:700;font-size:11px}
  .meta-row{display:flex;border-bottom:1px solid #999;font-size:10px}
  .meta-cell{flex:1;padding:5px 10px;border-right:1px solid #999}
  .meta-cell:last-child{border-right:none}
  .meta-lbl{color:#666}
  .section{padding:10px 14px;border-bottom:1px solid #999;font-size:11px}
  .note-block{white-space:pre-wrap;line-height:1.6}
  table{width:100%;border-collapse:collapse;font-size:11px}
  th{background:#f1f5f9;padding:6px;border:1px solid #cbd5e1;font-size:10px;text-align:left}
  td{padding:5px 8px;border:1px solid #cbd5e1}
  .amt-words{padding:8px 14px;border-bottom:1px solid #999;font-size:10px}
  .sign-row{display:flex;justify-content:space-between;border-top:1px solid #999}
  .test-banner{background:#fef3c7;border:2px dashed #d97706;padding:10px;text-align:center;margin-bottom:14px;border-radius:6px;color:#92400e;font-weight:700}
`;

export function buildDocHtml(model: DocPrintModel): string {
  const { doc, blocks, data, company, recipient, meta, lines, totals, opts } = model;
  const isPo = doc === 'PO';
  const sub = (key: string): string => nl2br(substituteTemplateVars(blocks[key] ?? '', data));

  const headerNote = sub('header_note');
  const specialNotes = sub('special_notes');
  const terms = sub('terms');
  const footer = sub('footer');
  const signature = sub('signature');

  const companyAddr = company.addressLines
    .filter(Boolean)
    .map((l) => `<div style="font-size:10px;color:#475569">${esc(l)}</div>`)
    .join('');

  const recipientLines = recipient.lines
    .filter(Boolean)
    .map((l) => `<div>${esc(l)}</div>`)
    .join('');

  const itemHead = isPo
    ? '<th>#</th><th>Description of Goods</th><th style="text-align:right">Qty</th><th>UOM</th><th style="text-align:right">Rate</th><th style="text-align:right">Amount</th>'
    : '<th>#</th><th>Item</th><th style="text-align:right">Qty</th><th>UOM</th>';

  const itemRows = lines
    .map((l, i) => {
      const name = l.itemName
        ? `<br><span style="font-size:10px;color:#666">${esc(l.itemName)}</span>`
        : '';
      return isPo
        ? `<tr><td style="text-align:center">${i + 1}</td><td>${esc(l.itemCode)}${name}</td><td style="text-align:right">${esc(l.qty)}</td><td style="text-align:center">${esc(l.uom ?? 'NOS')}</td><td style="text-align:right">${esc(l.rate ?? '')}</td><td style="text-align:right;font-weight:600">${esc(l.amount ?? '')}</td></tr>`
        : `<tr><td style="text-align:center">${i + 1}</td><td>${esc(l.itemCode)}${name}</td><td style="text-align:right">${esc(l.qty)}</td><td style="text-align:center">${esc(l.uom ?? 'NOS')}</td></tr>`;
    })
    .join('');

  let totalsHtml = '';
  if (isPo && totals) {
    const span = 5; // columns left of Amount
    const taxRows = totals.taxRows
      .map(
        (t) =>
          `<tr><td colspan="${span}" style="text-align:right">${esc(t.label)}</td><td style="text-align:right">${esc(t.value)}</td></tr>`,
      )
      .join('');
    totalsHtml = `
      <tr style="background:#f8fafc"><td colspan="${span}" style="text-align:right;font-weight:600">Subtotal</td><td style="text-align:right;font-weight:600">${esc(totals.subtotal)}</td></tr>
      ${taxRows}
      <tr style="background:#f1f5f9"><td colspan="${span}" style="text-align:right;font-weight:800">TOTAL</td><td style="text-align:right;font-weight:800">₹ ${esc(totals.grand)}</td></tr>`;
  }

  const amtWordsHtml =
    isPo && totals
      ? `<div class="amt-words"><b>Amount Chargeable (in words)</b><br><i>${esc(totals.amountInWords)}</i></div>`
      : '';

  return `
  ${opts?.testBanner ? '<div class="no-print test-banner">ⓘ TEST PRINT — Sample data shown. Real data is substituted on actual prints.</div>' : ''}
  <div class="no-print" style="text-align:right;margin-bottom:10px">
    <button onclick="window.print()" style="padding:8px 24px;background:#1E4DB3;color:#fff;border:0;border-radius:5px;cursor:pointer">🖨 Print</button>
    <button onclick="window.close()" style="padding:8px 16px;background:#f3f4f6;border:1px solid #d1d5db;border-radius:5px;cursor:pointer">✕ Close</button>
  </div>
  <div class="doc-border">
    <div class="doc-hdr">
      <div style="font-size:28px;font-weight:900;color:#1E4DB3;margin-right:18px">INNOVIC</div>
      <div style="flex:1;text-align:center">
        <div style="font-size:18px;font-weight:800;color:#1E4DB3">${esc(company.name)}</div>
        ${companyAddr}
        ${company.gstin ? `<div style="font-size:10px;color:#475569">GSTIN: ${esc(company.gstin)}</div>` : ''}
        ${company.phone ? `<div style="font-size:10px;color:#475569">Phone: ${esc(company.phone)}</div>` : ''}
        ${company.email ? `<div style="font-size:10px;color:#475569">E-Mail: ${esc(company.email)}</div>` : ''}
      </div>
    </div>
    <div class="title-bar">${esc(DOC_TITLE[doc])}</div>
    <div class="addr-row">
      <div class="addr-box">
        <div class="addr-lbl">${esc(recipient.label)}</div>
        <div class="addr-name">${esc(recipient.name)}</div>
        ${recipientLines}
      </div>
      <div class="addr-box">
        <div class="meta-row" style="border:0;display:block">
          ${meta.map((m) => `<div style="margin-bottom:4px"><span class="meta-lbl">${esc(m.label)}:</span> <b>${esc(m.value)}</b></div>`).join('')}
        </div>
      </div>
    </div>
    ${headerNote ? `<div class="section" style="background:#fafafa"><div class="note-block">${headerNote}</div></div>` : ''}
    <div class="section"><table><thead><tr>${itemHead}</tr></thead><tbody>
      ${itemRows}
      ${totalsHtml}
    </tbody></table></div>
    ${amtWordsHtml}
    ${specialNotes ? `<div class="section" style="background:#fffbeb"><b style="font-size:10px;color:#92400e;text-transform:uppercase">Special Notes</b><br><div class="note-block">${specialNotes}</div></div>` : ''}
    ${terms ? `<div class="section"><b style="font-size:10px;text-transform:uppercase">Terms &amp; Conditions</b><br><div class="note-block">${terms}</div></div>` : ''}
    ${footer ? `<div class="section" style="text-align:center;font-size:10px;color:#666">${footer}</div>` : ''}
    <div class="sign-row">
      <div style="padding:14px;font-size:10px;flex:1">Company's PAN: <b>AQKPM4121A</b><br><span style="font-style:italic;color:#666">E. &amp; O.E.</span></div>
      <div style="flex:1;padding:14px;text-align:right"><div class="note-block">${signature || 'For ' + esc(company.name) + '<br><br><br>Authorised Signatory'}</div></div>
    </div>
  </div>`;
}

// Opens the print window. Returns false if the popup was blocked.
export function openDocPrintWindow(model: DocPrintModel): boolean {
  const w = window.open('', '_blank', 'width=860,height=920');
  if (!w) return false;
  const title = model.opts?.testBanner
    ? `Test Print — ${DOC_TITLE[model.doc]}`
    : DOC_TITLE[model.doc];
  w.document.write(
    `<!DOCTYPE html><html><head><title>${esc(title)}</title><style>${DOC_STYLE}</style></head><body>${buildDocHtml(model)}</body></html>`,
  );
  w.document.close();
  return true;
}

// Filter the full effective-template list down to one doc's 5 blocks, keyed by
// block name (header_note/special_notes/terms/footer/signature).
export function templatesToBlocks(
  doc: PrintDocType,
  templates: EffectivePrintTemplate[],
): Record<string, string> {
  const blocks: Record<string, string> = {};
  for (const t of templates) {
    if (t.doc === doc) blocks[t.block] = t.content;
  }
  return blocks;
}
