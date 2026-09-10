// THE PRINTED SHEET — one layout for the outward documents.
//
// The Delivery Challan proof approved on 2026-09-08 is the master: on the
// user's instruction (2026-09-09) the Purchase Order now prints on THIS file
// too, so the two documents share one letterhead, one type scale, one set of
// rules and one outer border. Anything that changes here changes both, which
// is the point — the PO drifting away from the challan is what this replaces.
//
// ONE SKIN, FIVE DOCUMENTS (user, 2026-09-10). The purchase order was given
// its own look — Times New Roman, tight vertical spacing, no rule under the
// box headings, the item code as the bold line — behind a scoped CSS class.
// The user has seen it and asked for it on ALL FIVE: Purchase Order, OSP
// Delivery Challan, JW Delivery Challan, GRN and JW Invoice. Every one of
// those declarations has been folded into the shared rule it overrode and the
// scoped block deleted, so there is one style here and not two that can drift.
//
// Two column sets, one sheet:
//   'challan'  Sr · Item detail · UOM · HSN · Qty · Remarks
//   'po'       Sr · Item detail · UOM · Qty · Rate · Amount   (+ money totals)
//   'grn'      Sr · Item detail · Received · Accepted · Rejected · QC status
//              (no UOM: a GRN line does not carry one, so the column was blank
//               on every row of every GRN)
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
export interface SheetField {
  label: string;
  /** Plain text. Blank prints a dotted rule — never the word "null". */
  value: string;
  /** Extra lines printed under `value` (an address runs to two or three). */
  extra?: string[];
  /** `mono` = document numbers and dates, `name` = the vendor's name. */
  variant?: 'mono' | 'name';
  strong?: boolean;
}

export interface SheetLine {
  itemCode: string;
  itemName?: string | null;
  uom?: string | null;
  /** From the item master. Blank on almost every line today — the column stays,
   *  the cell prints an empty dotted rule. Challan columns only. */
  hsn?: string | null;
  /** Pre-formatted, e.g. "120.00". */
  qty: string;
  /** Challan columns only. */
  remarks?: string | null;
  /** PO columns only — pre-formatted rupees. */
  rate?: string | null;
  amount?: string | null;
  /** PO columns only: the line's own remarks, printed under the item name. */
  description?: string | null;
  /** The bold word in front of `description`. Defaults to "Description"; a GRN
   *  uses it for the line's DC reference, where that word would be wrong. */
  descLabel?: string;
  /** GRN columns only. `qty` carries the RECEIVED quantity; these two carry
   *  what survived inspection. A GRN is the only document here whose line has
   *  three quantities, which is why it needs its own column set rather than
   *  being squeezed into the challan's. */
  acceptedQty?: string | null;
  rejectedQty?: string | null;
  /** GRN columns only — pending / in progress / completed. */
  qcStatus?: string | null;
}

/** The money block a Purchase Order carries under its quantity total. */
export interface SheetMoney {
  /** Pre-formatted. */
  subtotal: string;
  taxRows: { label: string; value: string }[];
  grand: string;
  /** Blank when the viewer may not see prices — then no words row prints. */
  amountInWords: string;
}

export type SheetColumns = 'challan' | 'po' | 'grn';

export interface SheetPrintModel {
  /** Title printed on the sheet — "Delivery Challan" / "Purchase Order". The
   *  stylesheet upper-cases it, so pass it in ordinary case. */
  title: string;
  /** Print-window / PDF-file title, so the documents stay distinguishable. */
  windowTitle: string;
  /** Which column set the goods table uses. Defaults to the challan's. */
  columns?: SheetColumns;
  /** special_notes / terms / footer / signature. */
  blocks: Record<string, string>;
  /** {placeholder} substitution bag for those blocks. */
  data: Record<string, string>;
  company: DocCompany;
  recipient: { label: string; fields: SheetField[] };
  /** An optional SECOND section inside the recipient (left) box, under a rule.
   *  The Purchase Order uses it for "Ship to": where the goods must actually be
   *  delivered. It lives in the left column on purpose — the right-hand Order
   *  box keeps its own fields and its alignment, and the two boxes stay the
   *  same two boxes. Documents that do not set it render exactly as before. */
  shipTo?: { label: string; fields: SheetField[] };
  document: { label: string; fields: SheetField[] };
  lines: SheetLine[];
  /** Pre-formatted total, e.g. "3563.00". */
  totalQty: string;
  /** Printed beside the total when every line shares one unit. */
  totalUom: string;
  /** PO only. Subtotal / tax / grand rows under the quantity total. */
  money?: SheetMoney;
  /** GRN only — the accepted / rejected columns of the total row. */
  totalAccepted?: string;
  totalRejected?: string;
  /** The third foot panel — whoever signs for the goods on arrival. The
   *  challans print one; a purchase order has no such party, so its signature
   *  strip is two panels wide. Defaults to the challan's wording. */
  receiverCell?: string;
  opts?: { testBanner?: boolean };
}

/** Challan date + 3 months, in the sheet's date format. Blank in, blank out. */
export function challanEndDate(dcDate: string | null | undefined): string {
  const d = parseSheetDate(dcDate);
  return d ? format(addMonths(d, CHALLAN_VALIDITY_MONTHS), 'dd MMM yyyy') : '';
}

/** The sheet's date format: 06 Sep 2026. */
export function challanDate(dcDate: string | null | undefined): string {
  const d = parseSheetDate(dcDate);
  return d ? format(d, 'dd MMM yyyy') : '';
}

// Date-only strings parse as LOCAL midnight through parseISO, so no timezone
// shift can move a document a day backwards the way `new Date(iso)` would.
function parseSheetDate(d: string | null | undefined): Date | null {
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

const SHEET_STYLE = `
  /* TIMES NEW ROMAN THROUGHOUT, ON ALL FIVE DOCUMENTS (user, 2026-09-10).
     This began as the purchase order's own skin and the user has now asked for
     it everywhere, so the four font tokens are redefined once, here, instead of
     each rule being rewritten -- every element that already asks for a token
     comes out Times without being named.

     THE MONO TOKEN GOES TO TIMES TOO. It carries the codes and the figures,
     where column alignment matters -- but Times New Roman's digits are all one
     width, and every numeric cell already sets font-variant-numeric:tabular-nums
     and is right- or centre-aligned, so the rupee columns stay in line. Leaving
     mono as Consolas would have left half the document in a different typeface
     from the rest, which is not what "Times New Roman throughout" means.

     The four names stay distinct even though they now resolve to one family:
     the rules below still say WHICH role each piece of text plays, so a future
     change back to separate faces is a four-line edit here and nowhere else. */
  :root{
    --paper:#FFFFFF;--paper-ink:#1A1A1A;--paper-rule:#1A1A1A;--paper-rule-soft:#8A8A8A;
    --paper-band:#F1F1F1;--brand:#1E4DB3;
    --f-label:"Times New Roman",Times,serif;
    --f-body:"Times New Roman",Times,serif;
    --f-mono:"Times New Roman",Times,serif;
    --f-head:"Times New Roman",Times,serif;
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

  /* The letterhead <th> is borderless: its frame is drawn by .lh-in instead, so
     that .lh-pad can put blank paper ABOVE the border on every printed page.
     A border on the <th> would sit hard against the paper edge (see @page). */
  .lh{padding:0!important;border:none!important}
  .lh-pad{padding:0}
  /* The box CLOSES at the bottom. It used to carry border-bottom:none and lean on
     the first tbody row's top border for its lower edge -- two different elements, so
     the left and right verticals ended in mid-air and the corners did not meet. The
     row below still draws its own top border; both are 1px of --paper-rule and sit
     flush, so the join reads as one line. */
  /* THE LETTERHEAD, TIGHTENED (user, 2026-09-10). The sizes below are a step
     UP from the original proof because Times has a smaller x-height than the
     Verdana / Arial Narrow this was drawn in, and the old 7.5pt address lines
     were hard to read on paper. The space BETWEEN the lines comes down instead
     -- the padding, the paragraph margins and the line heights -- so the block
     reads exactly as before and simply starts the goods table higher up. */
  .lh-in{padding:1.6mm 5mm 1.1mm;border:1px solid var(--paper-rule);margin:0 -.5px -.5px}
  .lh-top{display:flex;align-items:flex-end;justify-content:space-between;gap:6mm}
  .lh-logo{height:13mm;width:auto;flex:none}
  .lh-co{text-align:right;font-weight:400}
  .co-name{font-family:var(--f-head);font-weight:700;font-size:16pt;line-height:1.1;
           margin:0 0 .4mm;color:var(--brand);letter-spacing:-.01em}
  .co-addr{font-family:var(--f-head);font-size:8.5pt;line-height:1.15;margin:0 0 .15mm;
           color:var(--paper-ink)}
  .co-ids{font-family:var(--f-head);font-size:8.5pt;line-height:1.15;margin:0;
          color:var(--paper-ink)}
  .co-ids b{font-weight:700}
  .lh-rule{height:1.1mm;background:var(--brand);margin:.9mm 0 1mm}
  .doc-title{font-family:var(--f-label);font-weight:700;font-size:13pt;letter-spacing:.12em;
             line-height:1.05;text-transform:uppercase;margin:0;text-align:center}

  .colh{font-family:var(--f-label);font-weight:700;font-size:9pt;letter-spacing:.08em;
        text-transform:uppercase;background:var(--paper-band);padding:1.3mm 2.5mm!important;
        vertical-align:middle}

  td.block{padding:0}
  .split{display:grid;grid-template-columns:1fr 1fr}
  .split > div{padding:1.6mm 5mm}
  .split > div:first-child{border-right:1px solid var(--paper-rule)}
  /* NO RULE UNDER THE BOX HEADINGS, on any of the five documents (user,
     2026-09-10). VENDOR / SUPPLIER, RECIPIENT, SUPPLIER, BILL TO, SHIP TO,
     ORDER, DOCUMENT and INVOICE all carry .bt, so the underline goes from all
     of them at once, and the padding that held it goes with it -- the heading
     now sits directly above its own fields. */
  .bt{font-family:var(--f-label);font-weight:700;font-size:8.5pt;letter-spacing:.13em;
      text-transform:uppercase;color:#3A3A3A;margin:0 0 .8mm}
  /* THE ONE RULE LEFT INSIDE A BOX: the line that separates a box's own fields
     from a second section under them (the PO's Ship to, under the vendor's
     GSTIN). It runs the FULL width of the left column, from the box's left
     BORDER to the centre divider. width:auto plus a negative margin on BOTH
     sides is what makes it touch: each -5mm cancels one side of the column's
     5mm padding, so the rule starts exactly on the box's left border and ends
     exactly on the divider. */
  .boxdiv{border-top:1px solid var(--paper-rule);width:auto;margin:1.6mm -5mm;height:0}
  /* The label column is 33mm, not the proof's 28mm: Times is a wider face than
     the Arial Narrow the labels were drawn in, and at 28mm "CONTACT PERSON"
     wrapped onto a second line and cost more height than the 5mm buys back.
     The value column keeps the rest of the box. */
  .kv{display:grid;grid-template-columns:33mm 1fr;gap:.35mm 3mm;font-size:9.5pt;margin:0}
  .kv dt{font-family:var(--f-label);font-weight:700;font-size:9pt;letter-spacing:.05em;
         text-transform:uppercase;color:#3A3A3A}
  .kv dd{margin:0}
  .kv dd.mono{font-family:var(--f-mono);font-size:9.5pt}
  .kv dd.vname{font-weight:700;font-size:11pt;line-height:1.15}

  tbody td{padding:1.4mm 2.5mm}
  .num{text-align:center;font-variant-numeric:tabular-nums;font-family:var(--f-mono);font-size:9.5pt}
  .ctr{text-align:center}
  .qty{text-align:right;font-weight:600;font-variant-numeric:tabular-nums;
       font-family:var(--f-mono);font-size:9.5pt}
  .money{text-align:right;font-variant-numeric:tabular-nums;font-family:var(--f-mono);
         font-size:9.5pt;white-space:nowrap}
  /* THE ITEM CODE IS THE BOLD LINE and the name and the description are plain
     (user, 2026-09-10) -- buyer and vendor match the document on the code, so
     that is the line the eye should land on. .idesc b is the small uppercase
     label in front of the description and stays bold: it is a label, not the
     description text. */
  .icode{font-family:var(--f-mono);font-size:9pt;font-weight:700;display:block;color:#3A3A3A}
  .iname{display:block;font-weight:400;line-height:1.15;margin-top:.2mm}
  /* A purchase-order or invoice line carries its own remarks under the item
     name. The challan lines never set it, so their cell is unchanged. */
  .idesc{display:block;font-size:9pt;font-weight:400;line-height:1.25;color:#3A3A3A;
         margin-top:.3mm}
  .idesc b{font-family:var(--f-label);letter-spacing:.05em;text-transform:uppercase;font-size:9pt}
  .rem{font-size:8.5pt;line-height:1.4;color:#2A2A2A}
  .blank{display:inline-block;width:12mm;border-bottom:1px dotted var(--paper-rule-soft)}
  .gap{display:inline-block;min-width:32mm;border-bottom:1px dotted var(--paper-rule-soft)}
  .sumlbl{text-align:right;font-family:var(--f-label);font-weight:700;font-size:9pt;
          letter-spacing:.08em;text-transform:uppercase;color:#3A3A3A}
  tr.total td{background:var(--paper-band);font-family:var(--f-label);font-weight:700;
              font-size:10pt;letter-spacing:.04em;padding:1.5mm 2.5mm}
  tr.total .sumlbl{font-size:10pt;color:var(--paper-ink)}
  tr.total .money{font-size:10pt;font-weight:700}

  .terms{padding:1.8mm 5mm;font-size:9pt;line-height:1.3;color:#2A2A2A}
  .terms b{font-family:var(--f-label);letter-spacing:.06em;text-transform:uppercase;font-size:9pt}
  .words i{font-style:italic}
  .foot{padding:1.6mm 5mm;text-align:center;font-size:8.5pt;color:#3A3A3A}
  .signs{display:grid}
  /* 13mm of blank under the signature strip was room for a signature; 11mm
     still is. Any less and there is nowhere to sign. */
  .signs > div{padding:2mm 5mm 11mm;font-family:var(--f-label);font-size:9pt;
               letter-spacing:.07em;text-transform:uppercase;color:#3A3A3A}
  .signs > div + div{border-left:1px solid var(--paper-rule)}

  /* The repeating bottom spacer. It carries no border and no content: its only
     job is to reserve the foot margin on every printed page (see @page below).
     It is REMOVED by the paginator, which supplies its own foot on each page --
     it stays in the markup so a document whose script never ran still prints
     with a bottom margin, just without the page numbers. */
  .pgfoot{border:0!important;padding:0!important}
  .pgfoot div{height:9mm}

  /* One .page per printed sheet, built by the paginator. */
  .page + .page{margin-top:8mm;border-top:1px dashed #CDD4DD;padding-top:8mm}

  .test-banner{background:#fef3c7;border:2px dashed #d97706;padding:10px;text-align:center;
               margin:0 auto 14px;max-width:210mm;border-radius:6px;color:#92400e;font-weight:700}
  .toolbar{max-width:210mm;margin:0 auto 10px;text-align:right}

  @media print{
    body{background:#fff;padding:0}
    .no-print{display:none!important}
    /* THE PAGE MARGIN IS ZERO ON PURPOSE.
       Chrome draws its own header and footer — "about:blank", the date, the
       page number — inside the @page margin box. With no margin box there is
       nowhere to draw them and they do not print. The document supplies its
       own margins instead, and each one has to be a rule that repeats on EVERY
       page, not just the first:
         left/right → .sheet side padding (a box's side edges repeat by nature)
         top        → the letterhead's own top padding, and the letterhead is
                      the repeating <thead>
         bottom     → the empty <tfoot> spacer, repeated by table-footer-group  */
    @page{size:A4 portrait;margin:0}
    .sheet{width:auto;margin:0;border:none;box-shadow:none;padding:0 9mm}
    .lh-pad{padding-top:9mm}
    thead{display:table-header-group}
    tfoot{display:table-footer-group}
    /* The paginator put exactly one page's worth of rows in each .page. The
       break is declared BEFORE each page after the first, never AFTER: a
       break-after on the last one spills a blank sheet out of the printer. */
    .page + .page{break-before:page;page-break-before:always;
                  margin-top:0;border-top:0;padding-top:0}
    /* the foot margin, on every page, now that there is no footer element */
    .page{padding-bottom:9mm}
    /* The letterhead repeats; nothing splits mid-row. */
    tr{break-inside:avoid;page-break-inside:avoid}
    .split,.split > div,.terms,.signs,.kv,.lh-in{break-inside:avoid;page-break-inside:avoid}
  }
`;

// ── The paginator ───────────────────────────────────────────────────────────
//
// "Page 1 of 3" cannot be done in CSS here. Chrome does not implement the
// `@page` margin boxes that `counter(page)` lives in, and the ONE thing that
// does print a page number -- the browser's own header/footer strip -- is
// exactly what `@page{margin:0}` removes, along with the `about:blank` line the
// user asked to be rid of. So the document paginates itself.
//
// It runs in the print window after load, and it is deliberately best-effort:
// everything is inside a try/catch and the un-paginated document (one table,
// repeating <thead>, <tfoot> spacer) is left exactly as it was if anything
// goes wrong. A sheet without page numbers still prints correctly; a sheet
// that throws halfway through would not.
//
// Measuring is the whole trick. Row heights on screen are the WRONG heights --
// the window is not 210mm wide and the screen rules apply -- so before
// measuring it turns the `@media print` block on (mediaText 'print' -> 'all')
// and forces the sheet to paper width, then puts both back.
const PAGINATE_SCRIPT = `
(function(){
  function run(){
    try{
      var MM = 96/25.4, PAGE_H = 297*MM;
      var art = document.querySelector('.sheet');
      var table = art && art.querySelector('table.doc');
      if(!art || !table || !table.tHead || !table.tBodies[0]) return;
      var thead = table.tHead, tbody = table.tBodies[0], tfoot = table.tFoot;
      var rows = [].slice.call(tbody.rows);
      if(!rows.length) return;

      // Measuring is done with the PRINT rules switched on and the sheet forced
      // to paper width. Both MUST be put back whatever happens: leaving the
      // print rules live would hide the window's own Print and Close buttons,
      // which carry .no-print. Hence try/finally, not a plain sequence -- an
      // exception here has to cost the page numbers, not the buttons.
      var flipped = [], prevW = art.style.width, footH = 9 * MM, headH = 0, hs = [];
      try {
        for (var i=0;i<document.styleSheets.length;i++){
          var rr;
          try { rr = document.styleSheets[i].cssRules; } catch(e){ continue; }
          for (var j=0;j<rr.length;j++){
            if (rr[j].media && rr[j].media.mediaText === 'print'){
              rr[j].media.mediaText = 'all';
              flipped.push(rr[j]);
            }
          }
        }
        art.style.width = '210mm';
        if (tfoot) tfoot.style.display = 'none';
        headH = thead.getBoundingClientRect().height;
        hs = rows.map(function(r){ return r.getBoundingClientRect().height; });
      } finally {
        art.style.width = prevW;
        if (tfoot) tfoot.style.display = '';
        flipped.forEach(function(r){
          try { r.media.mediaText = 'print'; } catch(e){ /* nothing left to do */ }
        });
      }
      if (!hs.length) return;

      var avail = PAGE_H - headH - footH;
      if (!(avail > 0)) return;

      var pages = [[]], used = 0;
      for (var k=0;k<rows.length;k++){
        if (used > 0 && used + hs[k] > avail){ pages.push([]); used = 0; }
        pages[pages.length-1].push(rows[k]);
        used += hs[k];
      }
      var total = pages.length;
      if (tfoot && tfoot.parentNode) tfoot.parentNode.removeChild(tfoot);

      var frag = document.createDocumentFragment();
      for (var pi=0; pi<total; pi++){
        var t = document.createElement('table');
        t.className = 'doc';
        t.appendChild(thead.cloneNode(true));
        var tb = document.createElement('tbody');
        for (var ri=0; ri<pages[pi].length; ri++) tb.appendChild(pages[pi][ri]);
        t.appendChild(tb);
        var pg = document.createElement('div');
        pg.className = 'page';
        pg.appendChild(t);
        frag.appendChild(pg);
      }
      art.innerHTML = '';
      art.appendChild(frag);
      // The count goes in the Order / Document box, which prints on page 1 only
      // (it is a body row, not part of the repeating letterhead). Every clone of
      // the box is updated so the rule holds wherever the box ends up. Reaching
      // here means the page count is REAL -- until now the box said just "1".
      var slots = document.querySelectorAll('[data-pgof]');
      for (var si=0; si<slots.length; si++) slots[si].textContent = '1 of ' + total;
    } catch(e) { /* un-paginated document stands */ }
  }
  if (document.readyState === 'complete') run();
  else window.addEventListener('load', run);
})();
`;

// ── Rendering ──────────────────────────────────────────────────────────────

const COLS = 6;

function fieldHtml(f: SheetField): string {
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

function boxHtml(
  box: { label: string; fields: SheetField[] },
  extraRows = '',
  section?: { label: string; fields: SheetField[] },
): string {
  // A second section closes the first list and opens its own, separated by the
  // half-width rule, so the two read as one box with two parts rather than one
  // long run of fields. The heading reuses `.bt`, so it is the same label
  // treatment as the box's own title.
  const sectionHtml = section
    ? `<div class="boxdiv"></div><p class="bt">${esc(section.label)}</p>` +
      `<dl class="kv">${section.fields.map(fieldHtml).join('')}</dl>`
    : '';
  return `<p class="bt">${esc(box.label)}</p><dl class="kv">${box.fields
    .map(fieldHtml)
    .join('')}${extraRows}</dl>${sectionHtml}`;
}

// "Page 1 of 4", inside the Order / Document box, on the user's instruction
// (2026-09-09). That box is a BODY row, so it prints on page one and nowhere
// else -- the user was told and chose this over a per-page footer.
//
// The total is not known until the sheet has been laid out at paper width, so
// the markup ships just the "1" and the paginator turns it into "1 of 4".
//
// The bare "1" is the placeholder ON PURPOSE. If the paginator ever bails --
// and it bails rather than throws, by design -- the sheet still prints, and a
// reader sees "Page 1", which is TRUE. Shipping "1 of 1" instead would have
// been a lie on any document that then printed as four sheets, and a plausible
// enough one that nobody would catch it.
const PAGE_OF_ROW = '<dt>Page</dt><dd class="mono" data-pgof>1</dd>';

function sectionRow(html: string): string {
  return `<tr><td class="block" colspan="${COLS}">${html}</td></tr>`;
}

// The item cell is identical on both column sets: the code as the quiet grey
// line, the name as the one the eye lands on, and — purchase orders only — the
// line's own remarks under it.
function itemCellHtml(l: SheetLine): string {
  const name = l.itemName ? `<span class="iname">${esc(l.itemName)}</span>` : '';
  const desc = (l.description ?? '').trim();
  const descHtml = desc
    ? `<span class="idesc"><b>${esc(l.descLabel ?? 'Description')}</b> ${esc(desc)}</span>`
    : '';
  return `<span class="icode">${esc(l.itemCode)}</span>${name}${descHtml}`;
}

export function buildSheetHtml(model: SheetPrintModel): string {
  const { blocks, data, company, lines } = model;
  const po = model.columns === 'po';
  const grn = model.columns === 'grn';
  const sub = (key: string): string => nl2br(substituteTemplateVars(blocks[key] ?? '', data));

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
  // GSTIN and PAN sit on ONE line, joined by the middle dot, on every document
  // (user, 2026-09-10). The purchase order briefly broke them onto two lines
  // (2026-09-09); the user has changed their mind and that branch is gone, so
  // there is one letterhead again rather than one per document.
  const idsHtml = ids.join(' &nbsp;&middot;&nbsp; ');

  const letterhead = `<div class="lh-pad"><div class="lh-in">
    <div class="lh-top">
      <img class="lh-logo" src="${INNOVIC_LOGO_DATA_URI}" alt="INNOVIC">
      <div class="lh-co">
        <p class="co-name">${esc(company.name)}</p>
        ${addressHtml}
        ${contactHtml}
        <p class="co-ids">${idsHtml}</p>
      </div>
    </div>
    <div class="lh-rule"></div>
    <p class="doc-title">${esc(model.title)}</p>
  </div></div>`;

  const columnHeads = po
    ? '<td class="colh ctr" style="width:11mm">Sr</td>' +
      '<td class="colh">Item detail</td>' +
      '<td class="colh ctr" style="width:14mm">UOM</td>' +
      '<td class="colh ctr" style="width:20mm">Qty</td>' +
      '<td class="colh ctr" style="width:26mm">Rate</td>' +
      '<td class="colh ctr" style="width:30mm">Amount</td>'
    : grn
      ? '<td class="colh ctr" style="width:11mm">Sr</td>' +
        '<td class="colh">Item detail</td>' +
        '<td class="colh ctr" style="width:24mm">Received</td>' +
        '<td class="colh ctr" style="width:22mm">Accepted</td>' +
        '<td class="colh ctr" style="width:22mm">Rejected</td>' +
        '<td class="colh ctr" style="width:24mm">QC status</td>'
      : '<td class="colh ctr" style="width:11mm">Sr</td>' +
      '<td class="colh">Item detail</td>' +
      '<td class="colh ctr" style="width:14mm">UOM</td>' +
      '<td class="colh ctr" style="width:19mm">HSN</td>' +
      '<td class="colh ctr" style="width:20mm">Qty</td>' +
      '<td class="colh" style="width:62mm">Remarks</td>';

  const itemRows = lines
    .map((l, i) => {
      const lead =
        `<tr><td class="num">${i + 1}</td>` +
        `<td>${itemCellHtml(l)}</td>` +
        // The GRN has no UOM column -- its lines do not carry one.
        (grn ? '' : `<td class="ctr">${esc(l.uom ?? '')}</td>`);
      if (po) {
        return (
          `${lead}<td class="qty">${esc(l.qty)}</td>` +
          `<td class="money">${esc(l.rate ?? '')}</td>` +
          `<td class="money">${esc(l.amount ?? '')}</td></tr>`
        );
      }
      if (grn) {
        return (
          `${lead}<td class="qty">${esc(l.qty)}</td>` +
          `<td class="qty">${esc(l.acceptedQty ?? '')}</td>` +
          `<td class="qty">${esc(l.rejectedQty ?? '')}</td>` +
          `<td class="ctr">${esc(l.qcStatus ?? '')}</td></tr>`
        );
      }
      const hsn = l.hsn ? esc(l.hsn) : '<span class="blank"></span>';
      const remarks = l.remarks ? nl2br(l.remarks) : '';
      return (
        `${lead}<td class="ctr">${hsn}</td>` +
        `<td class="qty">${esc(l.qty)}</td>` +
        `<td class="rem">${remarks}</td></tr>`
      );
    })
    .join('');

  // The quantity total closes the goods table on BOTH documents. On a purchase
  // order it is the line the user asked for above the money: how many pieces
  // were ordered, before what they cost.
  const qtyLabel = `Total quantity &mdash; ${lines.length} line${lines.length === 1 ? '' : 's'}`;
  const qtyTotalRow = po
    ? `<tr class="total"><td colspan="3" class="sumlbl">${qtyLabel}</td>` +
      `<td class="qty">${esc(model.totalQty)}</td><td class="ctr">${esc(model.totalUom)}</td><td></td></tr>`
    : grn
      ? // Received / accepted / rejected each get their own total, because the
        // three are the whole point of the document.
        `<tr class="total"><td colspan="2" class="sumlbl">${qtyLabel}</td>` +
        `<td class="qty">${esc(model.totalQty)}</td>` +
        `<td class="qty">${esc(model.totalAccepted ?? '')}</td>` +
        `<td class="qty">${esc(model.totalRejected ?? '')}</td>` +
        `<td></td></tr>`
      : `<tr class="total"><td colspan="4" class="sumlbl">${qtyLabel}</td>` +
      `<td class="qty">${esc(model.totalQty)}</td><td>${esc(model.totalUom)}</td></tr>`;

  const money = model.money;
  const moneyRows = money
    ? `<tr><td colspan="5" class="sumlbl">Subtotal</td><td class="money">${esc(money.subtotal)}</td></tr>` +
      money.taxRows
        .map(
          (t) =>
            `<tr><td colspan="5" class="sumlbl">${esc(t.label)}</td><td class="money">${esc(t.value)}</td></tr>`,
        )
        .join('') +
      `<tr class="total"><td colspan="5" class="sumlbl">Total</td><td class="money">&#8377; ${esc(money.grand)}</td></tr>`
    : '';

  const wordsRow = money?.amountInWords
    ? sectionRow(
        `<div class="terms words"><b>Amount chargeable (in words)</b><br><i>${esc(money.amountInWords)}</i></div>`,
      )
    : '';

  const receiver =
    model.receiverCell ?? (po ? '' : 'Received by &mdash; job worker<br>Name, sign &amp; date');
  const signCells = [
    'Prepared by',
    signature || `Authorised signatory<br>for ${esc(company.name)}`,
    ...(receiver ? [receiver] : []),
  ];

  return `
  ${model.opts?.testBanner ? '<div class="no-print test-banner">ⓘ TEST PRINT — Sample data shown. Real data is substituted on actual prints.</div>' : ''}
  <div class="no-print toolbar">
    <button onclick="window.print()" style="padding:8px 24px;background:#1E4DB3;color:#fff;border:0;border-radius:5px;cursor:pointer">🖨 Print</button>
    <button onclick="window.close()" style="padding:8px 16px;background:#f3f4f6;border:1px solid #d1d5db;border-radius:5px;cursor:pointer">✕ Close</button>
  </div>
  <article class="sheet">
    <table class="doc">
      <thead><tr><th class="lh" colspan="${COLS}">${letterhead}</th></tr></thead>
      <tfoot><tr><td class="pgfoot" colspan="${COLS}"><div></div></td></tr></tfoot>
      <tbody>
        ${sectionRow(
          `<div class="split"><div>${boxHtml(model.recipient, '', model.shipTo)}</div>` +
            `<div>${boxHtml(model.document, PAGE_OF_ROW)}</div></div>`,
        )}
        <tr>${columnHeads}</tr>
        ${itemRows}
        ${qtyTotalRow}
        ${moneyRows}
        ${wordsRow}
        ${specialNotes ? sectionRow(`<div class="terms"><b>Special notes</b><br>${specialNotes}</div>`) : ''}
        ${terms ? sectionRow(`<div class="terms"><b>Conditions</b><br>${terms}</div>`) : ''}
        ${sectionRow(
          `<div class="signs" style="grid-template-columns:repeat(${signCells.length},1fr)">${signCells
            .map((c) => `<div>${c}</div>`)
            .join('')}</div>`,
        )}
        ${footer ? sectionRow(`<div class="foot">${footer}</div>`) : ''}
      </tbody>
    </table>
  </article>`;
}

/** Opens the sheet print window. Returns false if the popup was blocked. */
export function openSheetPrintWindow(model: SheetPrintModel): boolean {
  const w = window.open('', '_blank', 'width=900,height=920');
  if (!w) return false;
  const title = model.opts?.testBanner ? `Test Print — ${model.windowTitle}` : model.windowTitle;
  // The closing tag is split so the bundler never emits the character sequence
  // that would end THIS module early if it were ever inlined into a page.
  const close = '</' + 'script>';
  w.document.write(
    `<!DOCTYPE html><html><head><title>${esc(title)}</title><style>${SHEET_STYLE}</style></head>` +
      `<body>${buildSheetHtml(model)}<script>${PAGINATE_SCRIPT}${close}</body></html>`,
  );
  w.document.close();
  return true;
}
