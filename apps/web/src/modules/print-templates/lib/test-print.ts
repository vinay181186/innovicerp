// Test-print window for the Print Templates editor. Mirrors legacy
// _ptSampleData (L14619) + _pteTestPrint (L15034): renders the selected
// document with the currently-effective template blocks + sample data, in a
// new window with a "TEST PRINT" banner. Real-data prints (P2) reuse the same
// substitution but feed live PO/DC data instead of this sample.

import {
  type EffectivePrintTemplate,
  type PrintDocType,
  substituteTemplateVars,
} from '@innovic/shared';
import { format } from 'date-fns';

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function nl2br(s: string): string {
  return esc(s).replace(/\r?\n/g, '<br>');
}

export function sampleDataFor(doc: PrintDocType): Record<string, string> {
  const today = format(new Date(), 'dd-MM-yyyy');
  const common: Record<string, string> = {
    companyName: 'Innovic Technology',
    companyAddress: 'V.U. Nagar, Anand, Gujarat, India',
    companyGSTIN: '24AQKPM4121A1Z5',
    companyPhone: '+91 98XXX XXXXX',
    companyEmail: 'innovic.technology@gmail.com',
    date: today,
    currentUser: 'Admin User',
  };
  if (doc === 'PO') {
    return {
      ...common,
      poNo: 'IN-PO-99999',
      poDate: today,
      paymentTerms: '30 days from invoice',
      deliveryTerms: 'Within 15 days at our works',
      vendorName: 'Sample Vendor Pvt Ltd',
      vendorAddress: 'Industrial Area, Phase 2, Vadodara',
      vendorGSTIN: '24AAACS1234D1Z5',
      vendorContact: 'Mr. Sample, +91 90000 00000',
      totalValue: '1,00,000.00',
      totalQty: '200',
    };
  }
  return {
    ...common,
    dcNo: doc === 'OSP DC' ? 'OSP-99999' : 'JWDC-99999',
    dcDate: today,
    purpose: doc === 'OSP DC' ? 'Phosphate coating' : 'Plating process',
    recipientName: 'Sample Process House',
    recipientAddress: 'GIDC, Vadodara, Gujarat',
    vehicleNo: 'GJ-05-XX-9999',
    driverName: 'Sample Driver',
    linkedPONo: 'IN-PO-99999',
    totalQty: '200',
  };
}

const DOC_TITLE: Record<PrintDocType, string> = {
  PO: 'PURCHASE ORDER',
  'OSP DC': 'OSP DELIVERY CHALLAN',
  'JW DC': 'JOB WORK DELIVERY CHALLAN',
};

// Builds the printable HTML for a doc given the 5 effective block contents
// (keyed by block name) and a data bag (sample or real). Exported so the P2
// real-data prints can reuse it.
export function buildDocHtml(
  doc: PrintDocType,
  blocks: Record<string, string>,
  data: Record<string, string>,
  opts: { testBanner?: boolean } = {},
): string {
  const isPo = doc === 'PO';
  const sub = (key: string): string => nl2br(substituteTemplateVars(blocks[key] ?? '', data));

  const headerNote = sub('header_note');
  const specialNotes = sub('special_notes');
  const terms = sub('terms');
  const footer = sub('footer');
  const signature = sub('signature');

  const metaRow = isPo
    ? `<div class="section"><b>PO No.:</b> ${esc(data.poNo ?? '')} &nbsp; <b>Date:</b> ${esc(data.poDate ?? '')} &nbsp; <b>Vendor:</b> ${esc(data.vendorName ?? '')}</div>`
    : `<div class="section"><b>DC No.:</b> ${esc(data.dcNo ?? '')} &nbsp; <b>Date:</b> ${esc(data.dcDate ?? '')} &nbsp; <b>Recipient:</b> ${esc(data.recipientName ?? '')}</div>`;

  const itemHead = isPo
    ? '<th>#</th><th>Item</th><th style="text-align:right">Qty</th><th style="text-align:right">Rate</th><th style="text-align:right">Amount</th>'
    : '<th>#</th><th>Item</th><th style="text-align:right">Qty</th><th>UOM</th>';
  const itemRow = (n: number, name: string): string =>
    isPo
      ? `<tr><td>${n}</td><td>${name}</td><td style="text-align:right">100</td><td style="text-align:right">500.00</td><td style="text-align:right">50,000.00</td></tr>`
      : `<tr><td>${n}</td><td>${name}</td><td style="text-align:right">100</td><td>NOS</td></tr>`;
  const totalRow = isPo
    ? `<tr style="background:#f8fafc"><td colspan="4" style="text-align:right;font-weight:700">TOTAL</td><td style="text-align:right;font-weight:800">₹ ${esc(data.totalValue ?? '')}</td></tr>`
    : '';

  return `
  ${opts.testBanner ? '<div class="no-print test-banner">ⓘ TEST PRINT — Sample data shown. Real data will be substituted on actual prints.</div>' : ''}
  <div class="no-print" style="text-align:right;margin-bottom:10px">
    <button onclick="window.print()" style="padding:8px 24px;background:#1E4DB3;color:#fff;border:0;border-radius:5px;cursor:pointer">🖨 Print</button>
    <button onclick="window.close()" style="padding:8px 16px;background:#f3f4f6;border:1px solid #d1d5db;border-radius:5px;cursor:pointer">✕ Close</button>
  </div>
  <div class="doc-border">
    <div class="doc-hdr">
      <div style="font-size:28px;font-weight:900;color:#1E4DB3;margin-right:18px">INNOVIC</div>
      <div style="flex:1;text-align:center">
        <div style="font-size:18px;font-weight:800;color:#1E4DB3">${esc(data.companyName ?? '')}</div>
        <div style="font-size:10px;color:#475569">${esc(data.companyAddress ?? '')}</div>
        <div style="font-size:10px;color:#475569">GSTIN: ${esc(data.companyGSTIN ?? '')}</div>
        <div style="font-size:10px;color:#475569">E-Mail: ${esc(data.companyEmail ?? '')}</div>
      </div>
    </div>
    <div class="title-bar">${DOC_TITLE[doc]}</div>
    ${metaRow}
    ${headerNote ? `<div class="section"><div class="note-block">${headerNote}</div></div>` : ''}
    <div class="section"><table><thead><tr>${itemHead}</tr></thead><tbody>
      ${itemRow(1, 'Sample Item — Steel Plate 6mm')}
      ${itemRow(2, 'Sample Item — Bearings 6203')}
      ${totalRow}
    </tbody></table></div>
    ${specialNotes ? `<div class="section" style="background:#fffbeb"><b style="font-size:10px;color:#92400e;text-transform:uppercase">Special Notes</b><br><div class="note-block">${specialNotes}</div></div>` : ''}
    ${terms ? `<div class="section"><b style="font-size:10px;text-transform:uppercase">Terms &amp; Conditions</b><br><div class="note-block">${terms}</div></div>` : ''}
    ${footer ? `<div class="section" style="text-align:center;font-size:10px;color:#666">${footer}</div>` : ''}
    <div class="sign-row">
      <div style="padding:14px;font-size:10px;flex:1">PAN: AQKPM4121A<br><span style="font-style:italic;color:#666">E. &amp; O.E.</span></div>
      <div style="flex:1;padding:14px;text-align:right"><div class="note-block">${signature}</div></div>
    </div>
  </div>`;
}

const DOC_STYLE = `
  @media print{@page{margin:10mm}.no-print{display:none!important}}
  body{font-family:Arial,sans-serif;font-size:12px;color:#1e293b;margin:20px}
  .doc-border{border:2px solid #333;padding:0}
  .doc-hdr{display:flex;align-items:center;padding:14px;border-bottom:2px solid #333}
  .title-bar{text-align:center;padding:10px;border-bottom:2px solid #333;font-size:18px;font-weight:900;letter-spacing:3px;background:#f8fafc}
  .section{padding:10px 14px;border-bottom:1px solid #999;font-size:11px}
  .note-block{white-space:pre-wrap;line-height:1.6}
  table{width:100%;border-collapse:collapse;font-size:11px}
  th{background:#f1f5f9;padding:6px;border:1px solid #cbd5e1;font-size:10px;text-align:left}
  td{padding:5px 8px;border:1px solid #cbd5e1}
  .sign-row{display:flex;justify-content:space-between;border-top:1px solid #999}
  .test-banner{background:#fef3c7;border:2px dashed #d97706;padding:10px;text-align:center;margin-bottom:14px;border-radius:6px;color:#92400e;font-weight:700}
`;

// Opens a print window for a doc. `blocks` is keyed by block name
// (header_note/special_notes/terms/footer/signature). Returns false if the
// popup was blocked.
export function openDocPrintWindow(
  doc: PrintDocType,
  blocks: Record<string, string>,
  data: Record<string, string>,
  opts: { testBanner?: boolean } = {},
): boolean {
  const w = window.open('', '_blank', 'width=820,height=900');
  if (!w) return false;
  const title = opts.testBanner ? `Test Print — ${DOC_TITLE[doc]}` : DOC_TITLE[doc];
  w.document.write(
    `<!DOCTYPE html><html><head><title>${esc(title)}</title><style>${DOC_STYLE}</style></head><body>${buildDocHtml(doc, blocks, data, opts)}</body></html>`,
  );
  w.document.close();
  return true;
}

// Convenience: test-print the given effective templates for a doc with sample
// data. `templates` is the full effective list; we filter to this doc.
export function openTestPrint(doc: PrintDocType, templates: EffectivePrintTemplate[]): boolean {
  const blocks: Record<string, string> = {};
  for (const t of templates) {
    if (t.doc === doc) blocks[t.block] = t.content;
  }
  return openDocPrintWindow(doc, blocks, sampleDataFor(doc), { testBanner: true });
}
