// Job Card print — the shop-floor TRAVELLER (form PRD-F-004), printed on the
// Innovic Sheet: the same paper, Times New Roman and letterhead as the Purchase
// Order (sheet-print.ts). Everything specific to the Job Card lives in THIS file;
// the owner's rule (2026-11-04) is that this layout never reaches another print.
//
// What it prints, from the JC row (`JobCardListItem`) + enriched ops
// (`JcOpEnriched[]`) + the per-op quantities the JC screen shows (`OpFlowRow[]`)
// + the company:
//   • The top block, repeated on EVERY page (it sits in the <thead>, which the
//     paginator clones per page): letterhead, then four columns read top to
//     bottom — Item · Material · Job Card · Source — then Remarks and the note.
//   • The operation table: Op · Operation · Planned Machine · Actual Machine ·
//     Start · End · Accepted · Deviated · Reworked · Done By · Sign, then blank
//     rows for hand entries. Quantities are the JC screen's own figures (ADR-212).
//     The shop-floor Operator is NOT printed (owner 2026-10-22).
//   • Prepared By / Checked / Approved By / QC Release.
//
// The production log is NOT printed (the ⬇ Excel export carries it).

import type { Company, JcOpEnriched, JobCardListItem } from '@innovic/shared';
import { opSrNo } from '@innovic/shared';
import { resolveActualMachine } from '@/components/shared/machine-split';
import { itemCodeWithRev, docDrawingRev } from '@/lib/item-code';
import { fmtDate } from '@/lib/date';
import { fmtQty } from '@/lib/qty-format';
import { buildDocCompany } from '@/lib/print/company';
import { esc } from '@/lib/print/doc-print';
import { openSheetHtmlWindow, sheetLetterheadHtml } from '@/lib/print/sheet-print';
import type { OpFlowRow } from '@/modules/flow-views/types';

// The sheet's table spans 6 columns; every block row here spans the same so the
// outer border and the letterhead line up exactly as on the PO.
const COLS = 6;
// Hand-entry rows under the system's own operations, so the traveller has room
// on paper for a step added on the floor.
const BLANK_OP_ROWS = 2;
// Widths of the operation table's columns; '' = Operation, which takes the rest.
const OP_COL_WIDTHS = [
  '8mm',
  '',
  '16mm',
  '16mm',
  '18mm',
  '18mm',
  '16mm',
  '16mm',
  '18mm',
  '15mm',
  '11mm',
];
const OP_COLS = OP_COL_WIDTHS.length;
const WORD_JOINER = '\u2060';

const PRIORITY_LABEL: Record<JobCardListItem['priority'], string> = {
  normal: 'Normal',
  high: 'High',
};

// Blank, not a dash, on the traveller: an empty cell is where a hand writes it.
function fmt(d: string | null | undefined): string {
  return fmtDate(d, '');
}

/** A quantity cell's text: blank when nothing has been booked. */
function qtyCell(n: number | undefined): string {
  return n ? fmtQty(n) : '';
}

/** One label / value row of a header column. `key` = the few values a reader
 *  looks for first; bold, same size. */
function field(label: string, value: string | null | undefined, key = false): string {
  return `<div class="jr"><span class="jl">${esc(label)}</span><span class="jv${key ? ' k' : ''}">${esc(value ?? '')}</span></div>`;
}

function column(title: string, labelWidth: string, rows: string[]): string {
  return `<div class="jg" style="--jlw:${labelWidth}"><div class="jt">${esc(title)}</div>${rows.join('')}</div>`;
}

/** Machine codes as cells print them. A word joiner (no width) after each hyphen
 *  and before the ✱ stops the line breaking there, so VMC-01✱ stays whole when it
 *  fits; a code too long for the column still breaks (overflow-wrap) rather than
 *  running into the next one. A split op wraps between codes (CNC-01 + CNC-02). */
function machineHtml(label: string, changed = false): string {
  const codes = label
    .split(' + ')
    .map((code) => esc(code).replace(/-/g, `-${WORD_JOINER}`))
    .map((code) => (changed ? `<span class="chg">${code}</span>` : code));
  return codes.join(' + ') + (changed ? `${WORD_JOINER}✱` : '');
}

function opRow(o: JcOpEnriched, flow: OpFlowRow | undefined): string {
  const isQc = o.opType === 'qc';
  const isOsp = o.opType === 'outsource';
  const planned = isQc ? 'QC' : isOsp ? 'OSP' : (o.machineCode ?? o.machineCodeText ?? '');
  // Actual: the session's machine, else who made the pieces, else the plan
  // (nothing disagrees). QC and OSP carry no machine.
  const actual =
    isQc || isOsp
      ? ''
      : resolveActualMachine({
          planned,
          activeRunningMachineCode: o.activeRunningMachineCode,
          machines: o.machines,
        });
  const actualHtml = actual === '' ? '' : machineHtml(actual.label, actual.differs);
  return `<tr>
    <td class="c">${opSrNo(o.opSeq)}</td>
    <td>${esc(o.operation)}${isQc ? ' (QC)' : ''}</td>
    <td class="m b">${machineHtml(planned)}</td>
    <td class="m">${actualHtml}</td>
    <td class="c d">${fmt(o.firstLogDate)}</td>
    <td class="c d">${fmt(o.lastLogDate)}</td>
    <td class="n b">${qtyCell(flow ? flow.acceptedQty : isQc ? o.qcAcceptedQty : o.completedQty)}</td>
    <td class="n">${qtyCell(flow ? flow.deviatedQty : o.qcRejectedQty)}</td>
    <td class="n">${qtyCell(flow?.reworkedQty)}</td>
    <td class="by">${esc(o.entryDoneBy ?? '')}</td>
    <td></td>
  </tr>`;
}

function blankRow(seq: number): string {
  return `<tr class="hand"><td class="c">${opSrNo(seq)}</td>${'<td></td>'.repeat(OP_COLS - 1)}</tr>`;
}

// Everything the traveller needs beyond SHEET_STYLE. One label style and one
// value style throughout (owner 2026-11-04): labels bold dark grey, values one
// size in print black. The block is in a <th>, hence the explicit weight/align.
const JC_STYLE = `
  .jh{border:1px solid var(--paper-rule);margin:0 -.5px -.5px;text-align:left;font-weight:400}
  .jcols{display:grid;grid-template-columns:48mm 39mm 53mm minmax(0,1fr)}
  .jg{display:flex;flex-direction:column;border-left:1px solid var(--paper-rule);min-width:0}
  .jg:first-child{border-left:none}
  .jt{background:var(--paper-band);border-bottom:1px solid var(--paper-rule);padding:.9mm 1.6mm;
      font-family:var(--f-label);font-weight:700;font-size:8.5pt;letter-spacing:.1em;
      text-transform:uppercase;color:var(--paper-ink);line-height:1.1}
  .jr{flex:1 1 auto;display:grid;grid-template-columns:var(--jlw) minmax(0,1fr);column-gap:1mm;
      align-items:center;padding:.35mm 1.6mm;border-bottom:1px solid #D2D2D2;min-height:4.3mm;line-height:1.1}
  .jr:last-child{border-bottom:none}
  .jl{font-family:var(--f-label);font-weight:700;font-size:8pt;color:#3A3A3A;white-space:nowrap}
  .jv{font-size:9pt;color:var(--paper-ink);overflow-wrap:anywhere}
  .jv.k{font-weight:700}
  .jrem{display:grid;grid-template-columns:16.5mm minmax(0,1fr);column-gap:1mm;align-items:center;
        border-top:1px solid var(--paper-rule);padding:.7mm 1.6mm;min-height:4.6mm;line-height:1.15}
  .jnote{border-top:1px solid var(--paper-rule);padding:.7mm 1.6mm;text-align:center;font-size:8.5pt;
         color:#3A3A3A;line-height:1.15}
  table.ops{width:100%;border-collapse:collapse;font-size:9.5pt;table-layout:fixed}
  table.ops td{overflow-wrap:anywhere}
  table.ops th{border:1px solid var(--paper-rule);border-top:none;padding:1.3mm 1mm;line-height:1.15;
               font-family:var(--f-label);font-size:7.5pt;letter-spacing:0;text-align:center;
               text-transform:uppercase;background:var(--paper-band)}
  table.ops th.l{text-align:left}
  table.ops th:first-child,table.ops td:first-child{border-left:none}
  table.ops th:last-child,table.ops td:last-child{border-right:none}
  table.ops td{border:1px solid var(--paper-rule);padding:1.1mm 1.4mm;height:6.6mm;vertical-align:middle}
  /* Each ops row is its own one-row table inside a sheet row whose border
     already draws the rule above and below — so the inner cells draw only the
     column dividers, or every rule would print double. */
  table.ops th,table.ops td{border-top:none;border-bottom:none}
  table.ops td.c{text-align:center;white-space:nowrap}
  table.ops td.m{padding-left:.5mm;padding-right:.5mm}
  table.ops td.by{font-size:8.5pt;padding-left:.8mm;padding-right:.8mm}
  table.ops td.d{font-size:9pt;padding-left:.5mm;padding-right:.5mm}
  table.ops td.n{text-align:center;font-variant-numeric:tabular-nums}
  table.ops td.b{font-weight:700}
  table.ops .chg{font-weight:700;font-size:9pt;text-decoration:underline}
  .page{position:relative;box-sizing:border-box;min-height:279mm;padding-bottom:8mm}
  .page + .page{padding-top:0;border-top:0}
  @media print{.page{min-height:296mm;padding-bottom:9mm}}
  .jpgno{position:absolute;right:0;bottom:3.5mm;font-size:9pt;line-height:1;color:var(--paper-ink)}
  .jpgno b{font-family:var(--f-label);color:#3A3A3A}
  .jlegend{padding:1.4mm 1.6mm;font-size:8.5pt;color:#2A2A2A}
  .signs > div{padding:1.6mm 1.6mm 11mm}
  .signs .jsn{display:block;text-transform:none;letter-spacing:0;font-size:9pt;color:var(--paper-ink)}
`;

// Page 1 of N at the end of every sheet (owner 2026-11-05), in this print only.
// The paginator splits the document into one .page per sheet; a MutationObserver
// runs straight after it finishes, whichever way it was started, and before
// anything can capture the page. If the paginator gives up there is no .page and
// the document simply prints without a number.
const PAGE_NUMBER_SCRIPT = `<script>(function(){
  var s=document.querySelector('.sheet');
  if(!s||!window.MutationObserver)return;
  new MutationObserver(function(_,o){
    o.disconnect();
    var p=s.querySelectorAll('.page');
    for(var i=0;i<p.length;i++){
      var f=document.createElement('div');
      f.className='jpgno';
      f.innerHTML='<b>Page</b> '+(i+1)+' of '+p.length;
      p[i].appendChild(f);
    }
  }).observe(s,{childList:true});
})();<${'/'}script>`;

function sectionRow(html: string): string {
  return `<tr><td class="block" colspan="${COLS}">${html}</td></tr>`;
}

export function printJobCard(args: {
  jc: JobCardListItem;
  ops: JcOpEnriched[];
  /** The per-op quantities the JC screen shows (useOpFlow), so the print and the
   *  screen can never disagree. Empty for a Cancelled card: its ops are stamped
   *  deleted, so the flow read has no rows and the op's own figures print. */
  flow: OpFlowRow[];
  company: Company | null | undefined;
  /** ADR-182 — the size really cut, off the Production Order that built this
   *  card. The Job Card wire shape does not carry it, so the caller reads the
   *  order and passes it. Absent / null prints an empty line, which on a
   *  traveller is where a hand writes it. */
  actualSize?: string | null;
  /** The Production Order that built this card (`IN-PRO-…`), read with
   *  `actualSize` from the same order. Null / absent (a rework or manual card)
   *  prints the line blank. */
  productionOrderCode?: string | null;
  /** ADR-202 — the JC has a pending edit; print "Draft — awaiting approval". */
  draft?: boolean | undefined;
  /** ADR-235 — the JC is Cancelled; the sheet carries the CANCELLED stamp. */
  cancelled?: boolean | undefined;
}): boolean {
  const { jc } = args;
  const company = buildDocCompany(args.company);
  // Order by op_seq so the routing prints in process order (the enriched read
  // is not guaranteed ordered).
  const ops = [...args.ops].sort((a, b) => a.opSeq - b.opSeq);
  const lastSeq = Math.max(0, ...ops.map((o) => o.opSeq));
  const flowByOp = new Map(args.flow.map((f) => [f.jcOpId, f]));

  const link = jc.sourceLink;
  // Two different line numbers, never one. `Ln` is OUR line on the sales order;
  // `POL` is the line number on the CUSTOMER'S purchase order (our line 11 can
  // be their line 20).
  const lnPol = [link ? String(link.lineNo) : '', jc.clientPoLineNo ?? '']
    .filter(Boolean)
    .join(' / ');
  const routeCard = jc.routeCardCode
    ? // ADR-282 — the Rev this Job Card was built on, not the card's Rev today.
      `${jc.routeCardCode}${jc.routeCardBuiltRevision != null ? ` / ${jc.routeCardBuiltRevision}` : ''}`
    : '';
  const drawingRev = docDrawingRev(jc);

  const columns = [
    column('Item', '16.5mm', [
      field('Item Code', itemCodeWithRev(jc.itemCode, drawingRev), true),
      field('Item Name', jc.itemName),
      field('Drawing No.', jc.drawingNo),
      field('Drawing Rev', drawingRev),
      field('JC Qty', `${fmtQty(jc.orderQty)} pcs`, true),
    ]),
    column('Material', '15mm', [
      field('RM Item', jc.rawMaterialItemCode),
      field('RM Grade', jc.rawMaterialGradeText),
      field('RM Size', jc.rawMaterialSizeText),
      field('Actual Size', args.actualSize),
    ]),
    column('Job Card', '18mm', [
      field('JC No.', jc.code, true),
      // Dates run in time order: raised → due → goes to the customer.
      field('JC Date', fmt(jc.jcDate)),
      field('Due Date', fmt(jc.dueDate), true),
      field('Dispatch Date', fmt(jc.customerDispatchDate)),
      field('Priority', PRIORITY_LABEL[jc.priority]),
    ]),
    column('Source', '20mm', [
      field(link?.type === 'jw' ? 'JWSO No.' : 'SO No.', link?.code, true),
      // A JWSO has no Internal SO No. (ADR-207).
      link?.type === 'jw'
        ? ''
        : field('Internal SO No.', link?.type === 'so' ? link.internalSoNo : ''),
      field('Ln / POL', lnPol),
      field('PRO No.', args.productionOrderCode),
      field('RC No. / Rev', routeCard),
      jc.parentJobCardCode ? field('Parent JC', jc.parentJobCardCode) : '',
      jc.parentNcCode ? field('NC No.', jc.parentNcCode) : '',
    ]),
  ].join('');

  const topBlock = `<div class="jh">
    <div class="jcols">${columns}</div>
    <div class="jrem"><span class="jl">Remarks</span><span class="jv">${esc(jc.remarks ?? '')}</span></div>
    <div class="jnote">Use released drawing only &nbsp;·&nbsp; PRD-F-004 Rev 00</div>
  </div>`;

  // Each operation is its OWN body row of the sheet (a one-row table inside),
  // so the paginator can break the page between two operations. Fixed column
  // widths (`table-layout:fixed` + one <colgroup>) keep the separate tables'
  // columns in line, and the heading row repeats on every continuation page.
  const colgroup = `<colgroup>${OP_COL_WIDTHS.map((w) => (w ? `<col style="width:${w}">` : '<col>')).join('')}</colgroup>`;
  const opsHead = `<table class="ops">${colgroup}
    <thead><tr>
      <th>Op</th>
      <th class="l">Operation</th>
      <th class="l">Planned<br>Machine</th>
      <th class="l">Actual<br>Machine</th>
      <th>Start<br>Date</th>
      <th>End<br>Date</th>
      <th>Accepted</th>
      <th>Deviated</th>
      <th>Reworked</th>
      <th class="l">Done By</th>
      <th>Sign</th>
    </tr></thead>
  </table>`;
  const opRows = [
    ...ops.map((o) => opRow(o, flowByOp.get(o.id))),
    ...Array.from({ length: BLANK_OP_ROWS }, (_, i) => blankRow(lastSeq + i + 1)),
  ]
    .map(
      (r) =>
        `<tr data-carry-head="ops"><td class="block" colspan="${COLS}"><table class="ops">${colgroup}<tbody>${r}</tbody></table></td></tr>`,
    )
    .join('');

  const legend = `<div class="jlegend">✱ underlined = run on a different machine from the plan. &nbsp;Blank rows = a step added on the floor.</div>`;
  const signs = `<div class="signs" style="grid-template-columns:repeat(3,1fr)">
      <div>Prepared By<span class="jsn">${esc(jc.createdByName ?? '')}</span></div>
      <div>Checked / Approved By</div>
      <div>QC Release</div>
    </div>`;

  const letterhead = sheetLetterheadHtml({
    name: company.name,
    title: 'Job Card',
    draft: args.draft,
  });

  const html = `
  <div class="no-print toolbar">
    <button onclick="window.print()" style="padding:8px 24px;background:#1E4DB3;color:#fff;border:0;border-radius:5px;cursor:pointer">🖨 Print</button>
    <button onclick="window.close()" style="padding:8px 16px;background:#f3f4f6;border:1px solid #d1d5db;border-radius:5px;cursor:pointer">✕ Close</button>
  </div>
  <article class="sheet${args.cancelled ? ' is-cancelled' : ''}">
    <table class="doc">
      <thead><tr><th class="lh" colspan="${COLS}">${letterhead}${topBlock}</th></tr></thead>
      <tfoot><tr><td class="pgfoot" colspan="${COLS}"><div></div></td></tr></tfoot>
      <tbody>
        <tr data-head-for="ops"><td class="block" colspan="${COLS}">${opsHead}</td></tr>
        ${opRows}
        ${sectionRow(legend)}
        ${sectionRow(signs)}
      </tbody>
    </table>
  </article>${PAGE_NUMBER_SCRIPT}`;

  return openSheetHtmlWindow(`Job Card ${jc.code}`, html, JC_STYLE, undefined, jc.code);
}
