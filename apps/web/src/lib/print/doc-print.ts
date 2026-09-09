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
import { letterheadFooterHtml, letterheadHeaderHtml, letterheadLogoHtml } from './letterhead';

// The company PAN, printed on outward documents. There is NO `pan` column on
// `companies`, so it lives here as one named constant rather than as a literal
// buried in the markup. It BELONGS in the company record — putting it there is
// a schema change, deliberately not made here.
export const COMPANY_PAN = 'AQKPM4121A';

// ── escaping ──
export function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
// Exported so the challan renderer (./challan-print) escapes and breaks
// template text exactly the way this builder does.
export function nl2br(s: string): string {
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
  // Per-line remarks, printed as a third line "Description: ..." under the item
  // name. Only the approved PO layout (`docLayout: 'v10'`) renders it; the
  // delivery challans and the GRN never set it, so their table is unchanged.
  description?: string | null;
}
// One label + value row inside a party box on the approved PO layout. `mono`
// puts the value in the document's monospace face — codes, GSTINs and phone
// numbers — leaving names, addresses and e-mail in the sans face.
export interface DocPartyRow {
  label: string;
  value: string;
  mono?: boolean;
}
// A party box (Vendor / Supplier, Ship To) on the approved PO layout: a heading,
// the party name, then label/value rows on one baseline.
export interface DocPartyBlock {
  label: string;
  name: string;
  rows: DocPartyRow[];
}
export interface DocAddressBlock {
  label: string; // "Supplier (Bill from)" / "Recipient"
  name: string;
  lines: string[]; // address / GSTIN / contact lines (plain text)
}
export interface DocMetaCell {
  label: string;
  value: string;
  // Approved PO layout only: false prints the value in the sans face (a
  // person's name), the default prints it monospaced (codes and dates).
  mono?: boolean;
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
  blocks: Record<string, string>; // special_notes/terms/footer/signature
  data: Record<string, string>; // {var} substitution bag
  company: DocCompany;
  recipient: DocAddressBlock;
  meta: DocMetaCell[];
  lines: DocLine[];
  totals?: DocTotals; // PO only
  // When true, a priced doc (PO / Service PO) is rendered WITHOUT the Rate,
  // Amount and totals columns — for viewers whose access hides prices. The
  // table falls back to the qty-only layout the delivery challans use.
  hideMoney?: boolean;
  // A block the DOCUMENT computes for itself, printed under the goods table
  // with its own heading. Distinct from `blocks`, which is user-authored text
  // from Settings -> Print Templates: folding computed status into
  // `special_notes` would file it under a heading that does not describe it,
  // and would glue it to whatever the user had typed there.
  extraSection?: { title: string; body: string };
  // A document whose lines do not fit the goods table supplies its own table
  // here and keeps ALL the surrounding chrome -- letterhead, title bar, the
  // party/meta row, and the five template blocks in print order. The GRN needs
  // this: its columns are received / accepted / rejected / QC status, which the
  // qty-and-money goods table cannot express. Without it a GRN could only be
  // built on the internal Job Card layout, which is a grid of info boxes and
  // looks nothing like the document its own print template describes.
  tableHtml?: string;
  // Opt-in APPROVED PURCHASE ORDER FORMAT (sample signed off 2026-09-08).
  // Absent = the layout every document has printed until now, byte for byte —
  // which is how the OSP DC, the JW DC, the GRN and the Service PO keep their
  // current output while the PO moves to the new one. When set, the document
  // gets: a letterhead that repeats at the top of every printed page, a
  // five-cell document row under the title bar, two labelled party boxes
  // (supplier + ship-to), and the combined "Item Code & Description" column.
  docLayout?: 'v10';
  // The two side-by-side party boxes of the approved layout. Ignored unless
  // `docLayout` is set.
  parties?: [DocPartyBlock, DocPartyBlock];
  opts?: { testBanner?: boolean };
}

const DOC_TITLE: Record<PrintDocType, string> = {
  PO: 'PURCHASE ORDER',
  'SERVICE PO': 'SERVICE PURCHASE ORDER',
  'OSP DC': 'OSP DELIVERY CHALLAN',
  'JW DC': 'JOB WORK DELIVERY CHALLAN',
  // The GRN DOES render through this builder, like the other four -- it just
  // supplies its own `tableHtml`, because its columns are received / accepted /
  // rejected / QC status rather than qty and money. It was briefly built on the
  // internal Job Card layout instead, which prints facts as a grid of info-box
  // tiles; that looked nothing like the document its own print template
  // describes, which is what this entry and `tableHtml` exist to avoid.
  GRN: 'GOODS RECEIPT NOTE',
};

const DOC_STYLE = `
  @media print{@page{size:A4 portrait;margin:10mm}.no-print{display:none!important}}
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

// APPROVED PURCHASE ORDER FORMAT (sample signed off 2026-09-08).
//
// Appended AFTER `DOC_STYLE` and every rule is scoped to `body.v10`, which only
// a model carrying `docLayout: 'v10'` puts on the document. Nothing here can
// reach the OSP DC, the JW DC, the GRN or the Service PO.
//
// The letterhead has to appear at the top of EVERY printed sheet. `window.print()`
// lays body content out once, wherever the page break happens to fall, so a
// plain block letterhead prints on page 1 only. The one mechanism the browser
// repeats per page is a table header, so the whole document is wrapped in a
// one-column table whose `<thead>` holds the letterhead and whose `<tbody>`
// holds the document. `break-inside` therefore has to be set carefully: the
// frame's single body row MUST be allowed to break or the document would never
// paginate at all, while the goods-table rows inside it must not.
const DOC_STYLE_V10 = `
  body.v10{margin:0;padding:12px;font-size:9.5pt;font-family:'DejaVu Sans',Verdana,Geneva,sans-serif}
  @media print{body.v10{padding:0}}
  body.v10 td,body.v10 th,body.v10 .section,body.v10 .note-block,body.v10 .addr-box,
  body.v10 .addr-name,body.v10 .addr-lbl,body.v10 .meta-row,body.v10 .meta-cell,
  body.v10 .amt-words,body.v10 .sign-row,body.v10 .title-bar{font-family:'DejaVu Sans',Verdana,Geneva,sans-serif}

  /* page frame — the repeating letterhead */
  body.v10 table.page-frame{width:100%;border-collapse:collapse}
  body.v10 table.page-frame>thead{display:table-header-group}
  body.v10 table.page-frame>thead>tr>td{padding:0 0 8px;border:0}
  body.v10 table.page-frame>tbody>tr>td{padding:0;border:0}
  body.v10 table.page-frame>tbody>tr{break-inside:auto;page-break-inside:auto}
  body.v10 .letterhead{display:flex;align-items:center;border-bottom:2px solid #1E4DB3;padding:6px 2px 8px}
  body.v10 .lh-right{margin-left:auto;text-align:right}
  body.v10 .lh-name{font-size:15pt;font-weight:700;color:#1E4DB3;line-height:1.25;letter-spacing:.2px}
  body.v10 .lh-sub{font-size:7.5pt;color:#334155;line-height:1.45}

  /* title bar + the five-cell document row under it */
  body.v10 .title-bar{font-size:12.5pt;letter-spacing:3.2px}
  body.v10 .meta-lbl{font-size:8.5pt;letter-spacing:.09em;color:#666}
  body.v10 .meta-cell b{font-size:9pt;font-family:'DejaVu Sans Mono',Consolas,'Courier New',monospace}
  body.v10 .meta-cell b.txt{font-family:'DejaVu Sans',Verdana,Geneva,sans-serif}

  /* the two party boxes — label column + value column on one baseline */
  body.v10 .addr-lbl{font-size:8pt;letter-spacing:.11em}
  body.v10 .addr-name{font-size:11pt;margin-bottom:4px}
  body.v10 .addr-box{font-size:9.5pt}
  body.v10 .addr-box>div{display:flex;gap:10px;margin-top:3px}
  body.v10 .addr-box>div.addr-lbl,body.v10 .addr-box>div.addr-name{display:block;margin-top:0}
  body.v10 .addr-box b{flex:0 0 88pt;font-size:8.5pt;letter-spacing:.07em;font-weight:600;color:#475569}
  body.v10 .addr-box .v,body.v10 .addr-box .vm{flex:1;min-width:0}
  body.v10 .addr-box .vm{font-family:'DejaVu Sans Mono',Consolas,'Courier New',monospace;font-size:9pt}

  /* goods table */
  body.v10 .doc-border th{font-size:8.5pt;letter-spacing:.09em;text-align:center}
  body.v10 .doc-border td{font-size:9.5pt}
  /* item code + name are set to match the approved challan sheet exactly
     (challan-print.ts .icode/.iname): the code is the quiet grey line, the
     name is the one the eye lands on. */
  body.v10 .icode{display:block;font-family:'DejaVu Sans Mono',Consolas,'Courier New',monospace;font-weight:400;font-size:8.5pt;color:#3A3A3A}
  body.v10 .iname{display:block;font-size:9.5pt;font-weight:600;color:#1e293b}
  body.v10 .idesc{display:block;font-size:8.5pt;color:#475569;margin-top:2px;line-height:1.35}
  body.v10 .idesc b{color:#334155}
  /* qty / UOM / rate / amount are short values — they never wrap, so a long
     grand total cannot push the rupee sign onto a line of its own */
  body.v10 td.c,body.v10 td.r{font-size:9pt;font-family:'DejaVu Sans Mono',Consolas,'Courier New',monospace;white-space:nowrap}
  body.v10 td.c{text-align:center}
  body.v10 td.r{text-align:right}
  body.v10 td.b{font-weight:700}
  body.v10 .muted{color:#94a3b8}
  body.v10 .amt-words,body.v10 .sign-row{font-size:9pt}

  /* pagination: keep rows and text blocks whole, but let the section that
     wraps the goods table break, or a long PO could never paginate */
  body.v10 .doc-border thead{display:table-header-group}
  body.v10 .doc-border tr{break-inside:avoid;page-break-inside:avoid}
  body.v10 .section,body.v10 .amt-words,body.v10 .sign-row,body.v10 .note-block{break-inside:avoid}
  body.v10 .section.sec-table{break-inside:auto}
  body.v10 .addr-row,body.v10 .title-bar,body.v10 .meta-row{break-inside:avoid;break-after:avoid}
`;

// Company PAN for the letterhead. The `companies` row has no PAN column, but a
// 15-character GSTIN contains it: characters 3-12 ARE the PAN. Falls back to
// the same literal the signature block has printed since the first version.
const FALLBACK_PAN = 'AQKPM4121A';
function panOf(company: DocCompany): string {
  const g = (company.gstin ?? '').trim().toUpperCase();
  return /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][0-9A-Z]{3}$/.test(g) ? g.slice(2, 12) : FALLBACK_PAN;
}

// The repeating letterhead band: logo left, company name / address / GSTIN +
// PAN right, 2px blue rule under it.
function v10LetterheadHtml(company: DocCompany): string {
  const addr = company.addressLines.filter(Boolean).join(', ');
  const ids = [
    company.gstin ? `<b>GSTIN:</b> ${esc(company.gstin)}` : '',
    `<b>PAN:</b> ${esc(panOf(company))}`,
  ].filter(Boolean);
  return `<div class="letterhead">
      ${letterheadLogoHtml(34)}
      <div class="lh-right">
        <div class="lh-name">${esc(company.name)}</div>
        ${addr ? `<div class="lh-sub">${esc(addr)}</div>` : ''}
        <div class="lh-sub">${ids.join(' &nbsp;&middot;&nbsp; ')}</div>
      </div>
    </div>`;
}

// A party box: heading, party name, then one label/value row per fact.
function v10PartyHtml(p: DocPartyBlock): string {
  const rows = p.rows
    .map((r) => {
      const cls = r.mono ? 'vm' : 'v';
      const val = r.value ? esc(r.value) : '<span class="muted">&mdash;</span>';
      return `<div><b>${esc(r.label)}</b> <span class="${cls}">${val}</span></div>`;
    })
    .join('');
  return `<div class="addr-box">
        <div class="addr-lbl">${esc(p.label)}</div>
        <div class="addr-name">${esc(p.name)}</div>
        ${rows}
      </div>`;
}

export function buildDocHtml(model: DocPrintModel): string {
  const { doc, blocks, data, company, recipient, meta, lines, totals, opts } = model;
  // PO + Service PO both render the priced goods table, totals, and amount in
  // words. The two DC docs render a qty-only table without amounts.
  const isPo = doc === 'PO' || doc === 'SERVICE PO';
  // A priced doc drops to the qty-only table when the viewer may not see money.
  const priced = isPo && !model.hideMoney;
  // Approved Purchase Order format, opted into by the caller. Every branch on
  // this flag below is additive — with it unset the markup is exactly what the
  // OSP DC / JW DC / GRN / Service PO have always produced.
  const v10 = model.docLayout === 'v10';
  const sub = (key: string): string => nl2br(substituteTemplateVars(blocks[key] ?? '', data));

  const specialNotes = sub('special_notes');
  const terms = sub('terms');
  const footer = sub('footer');
  const signature = sub('signature');

  const recipientLines = recipient.lines
    .filter(Boolean)
    .map((l) => `<div>${esc(l)}</div>`)
    .join('');

  // On the challans and the GRN, Sr No. / Item Code / Item Name are three
  // COLUMNS: a long name wrapping under its own code shoves the row height
  // around and gives the eye no column to run the names down.
  // The approved PO format goes the other way ON PURPOSE — one wide "Item Code
  // & Description" column, because a PO line also has to carry its remarks, and
  // three stacked lines of different sizes read better there than a fourth
  // column would.
  const itemHead = v10
    ? '<th style="width:40px">Sr No.</th><th style="text-align:left">Item Code &amp; Description</th>' +
      '<th style="width:52px">Qty</th><th style="width:46px">UOM</th>' +
      (priced ? '<th style="width:82px">Rate</th><th style="width:96px">Amount</th>' : '')
    : priced
      ? '<th style="width:44px">Sr No.</th><th style="width:130px">Item Code</th><th>Item Name</th><th style="text-align:right">Qty</th><th>UOM</th><th style="text-align:right">Rate</th><th style="text-align:right">Amount</th>'
      : '<th style="width:44px">Sr No.</th><th style="width:130px">Item Code</th><th>Item Name</th><th style="text-align:right">Qty</th><th>UOM</th>';

  // Approved format: ONE column stacks the item code, the item name, and — only
  // when the line carries remarks — a "Description:" line under it.
  const v10Rows = lines
    .map((l, i) => {
      const desc = (l.description ?? '').trim();
      const cell =
        `<span class="icode">${esc(l.itemCode)}</span>` +
        `<span class="iname">${l.itemName ? esc(l.itemName) : '&mdash;'}</span>` +
        (desc ? `<span class="idesc"><b>Description:</b> ${esc(desc)}</span>` : '');
      const lead =
        `<tr><td class="c">${i + 1}</td><td>${cell}</td>` +
        `<td class="c">${esc(l.qty)}</td><td class="c">${esc(l.uom ?? 'NOS')}</td>`;
      return priced
        ? `${lead}<td class="r">${esc(l.rate ?? '')}</td><td class="r b">${esc(l.amount ?? '')}</td></tr>`
        : `${lead}</tr>`;
    })
    .join('');

  const legacyRows = lines
    .map((l, i) => {
      // An empty cell on a printed document reads as something gone wrong. A
      // dash reads as "this line has no name", which is what is actually true.
      const name = l.itemName ? esc(l.itemName) : '&mdash;';
      const lead =
        `<tr><td style="text-align:center">${i + 1}</td>` +
        `<td>${esc(l.itemCode)}</td>` +
        `<td>${name}</td>` +
        `<td style="text-align:right">${esc(l.qty)}</td>` +
        `<td style="text-align:center">${esc(l.uom ?? 'NOS')}</td>`;
      return priced
        ? `${lead}<td style="text-align:right">${esc(l.rate ?? '')}</td><td style="text-align:right;font-weight:600">${esc(l.amount ?? '')}</td></tr>`
        : `${lead}</tr>`;
    })
    .join('');
  const itemRows = v10 ? v10Rows : legacyRows;

  let totalsHtml = '';
  if (priced && totals) {
    // Columns left of Amount. Legacy: Sr No, Item Code, Item Name, Qty, UOM,
    // Rate. Approved format merges code + name into one column, so it is five.
    const span = v10 ? 5 : 6;
    // The money cells carry the `r` class on the approved format so they pick
    // up its monospace face and never wrap — without it a long grand total
    // broke the rupee sign onto a line of its own.
    const amt = v10 ? ' class="r"' : '';
    const taxRows = totals.taxRows
      .map(
        (t) =>
          `<tr><td colspan="${span}" style="text-align:right">${esc(t.label)}</td><td${amt} style="text-align:right">${esc(t.value)}</td></tr>`,
      )
      .join('');
    totalsHtml = `
      <tr style="background:#f8fafc"><td colspan="${span}" style="text-align:right;font-weight:600">Subtotal</td><td${amt} style="text-align:right;font-weight:600">${esc(totals.subtotal)}</td></tr>
      ${taxRows}
      <tr style="background:#f1f5f9"><td colspan="${span}" style="text-align:right;font-weight:800">TOTAL</td><td${amt} style="text-align:right;font-weight:800">₹ ${esc(totals.grand)}</td></tr>`;
  }

  // Plain text in, so newlines have to become breaks; escaped because the
  // caller computed this from data, not from a template the user authored.
  const extraHtml = model.extraSection
    ? `<div class="section"><b style="font-size:10px;text-transform:uppercase">${esc(
        model.extraSection.title,
      )}</b><br><div class="note-block">${esc(model.extraSection.body).replace(
        /\n/g,
        '<br>',
      )}</div></div>`
    : '';

  const amtWordsHtml =
    priced && totals
      ? `<div class="amt-words"><b>Amount Chargeable (in words)</b><br><i>${esc(totals.amountInWords)}</i></div>`
      : '';

  // Approved format: the document row (PO No. / PO Date / Due Date / PR Ref. /
  // Contact Person) runs full width under the title bar, and the two party
  // boxes sit side by side beneath it. Legacy: recipient on the left, the meta
  // facts stacked on the right.
  const headBlocks = v10
    ? `<div class="meta-row">
      ${meta
        .map(
          (m) =>
            `<div class="meta-cell"><span class="meta-lbl">${esc(m.label)}</span><br><b${
              m.mono === false ? ' class="txt"' : ''
            }>${esc(m.value)}</b></div>`,
        )
        .join('')}
    </div>
    <div class="addr-row">
      ${(model.parties ?? []).map(v10PartyHtml).join('')}
    </div>`
    : `<div class="addr-row">
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
    </div>`;

  const tableHtml =
    model.tableHtml ??
    `<div class="section${v10 ? ' sec-table' : ''}"><table><thead><tr>${itemHead}</tr></thead><tbody>
      ${itemRows}
      ${totalsHtml}
    </tbody></table></div>`;

  const docHtml = `<div class="doc-border">
    ${v10 ? '' : letterheadHeaderHtml({ name: company.name, gstin: company.gstin })}
    <div class="title-bar">${esc(DOC_TITLE[doc])}</div>
    ${headBlocks}
    ${tableHtml}
    ${extraHtml}
    ${amtWordsHtml}
    ${specialNotes ? `<div class="section" style="background:#fffbeb"><b style="font-size:10px;color:#92400e;text-transform:uppercase">Special Notes</b><br><div class="note-block">${specialNotes}</div></div>` : ''}
    ${terms ? `<div class="section"><b style="font-size:10px;text-transform:uppercase">Terms &amp; Conditions</b><br><div class="note-block">${terms}</div></div>` : ''}
    ${footer ? `<div class="section" style="text-align:center;font-size:10px;color:#666">${footer}</div>` : ''}
    <div class="sign-row">
      <div style="padding:14px;font-size:10px;flex:1">Company's PAN: <b>${COMPANY_PAN}</b><br><span style="font-style:italic;color:#666">E. &amp; O.E.</span></div>
      <div style="flex:1;padding:14px;text-align:right"><div class="note-block">${signature || 'For ' + esc(company.name) + '<br><br><br>Authorised Signatory'}</div></div>
    </div>
    ${letterheadFooterHtml({ addressLines: company.addressLines, email: company.email, phone: company.phone })}
  </div>`;

  // On the approved format the whole document travels inside a one-column
  // table so the letterhead in its `<thead>` is repeated by the browser at the
  // top of every printed page.
  const framed = v10
    ? `<table class="page-frame"><thead><tr><td>${v10LetterheadHtml(company)}</td></tr></thead><tbody><tr><td>${docHtml}</td></tr></tbody></table>`
    : docHtml;

  return `
  ${opts?.testBanner ? '<div class="no-print test-banner">ⓘ TEST PRINT — Sample data shown. Real data is substituted on actual prints.</div>' : ''}
  <div class="no-print" style="text-align:right;margin-bottom:10px">
    <button onclick="window.print()" style="padding:8px 24px;background:#1E4DB3;color:#fff;border:0;border-radius:5px;cursor:pointer">🖨 Print</button>
    <button onclick="window.close()" style="padding:8px 16px;background:#f3f4f6;border:1px solid #d1d5db;border-radius:5px;cursor:pointer">✕ Close</button>
  </div>
  ${framed}`;
}

// Opens the print window. Returns false if the popup was blocked.
export function openDocPrintWindow(model: DocPrintModel): boolean {
  const w = window.open('', '_blank', 'width=860,height=920');
  if (!w) return false;
  const title = model.opts?.testBanner
    ? `Test Print — ${DOC_TITLE[model.doc]}`
    : DOC_TITLE[model.doc];
  // The approved-format rules are appended AFTER the common stylesheet and are
  // all scoped to `body.v10`, so a document that has not opted in is styled by
  // exactly the same CSS it was before.
  const v10 = model.docLayout === 'v10';
  w.document.write(
    `<!DOCTYPE html><html><head><title>${esc(title)}</title><style>${DOC_STYLE}${
      v10 ? DOC_STYLE_V10 : ''
    }</style></head><body${v10 ? ' class="v10"' : ''}>${buildDocHtml(model)}</body></html>`,
  );
  w.document.close();
  return true;
}

// Filter the full effective-template list down to one doc's 4 blocks, keyed by
// block name (special_notes/terms/footer/signature).
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
