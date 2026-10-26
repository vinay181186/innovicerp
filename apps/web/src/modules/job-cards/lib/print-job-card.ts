// Job Card print — the shop-floor TRAVELLER (form PRD-F-004, reference doc
// `04_Job_Card_Route_Card_Traveller.docx`), printed on the Innovic Sheet: the
// same paper, Times New Roman, sizes and letterhead as the Purchase Order and
// the challans (sheet-print.ts), so every printed document reads as one family.
//
// What it prints, from the JC list row (`JobCardListItem`, v_jc_status) + its
// enriched ops (`JcOpEnriched[]`, /op-entry/jc-ops) + the company:
//   • Letterhead — logo + company name only (an internal document: no address,
//     no GSTIN), the brand rule, the title JOB CARD.
//   • Two columns of facts, each on its own full-width rule: JC No, Production
//     Order No, SO No, SO line, POL, route card on the left (no client — user
//     2026-09-16, it is a shop-floor sheet); date, due, qty, then Item Code
//     directly above Item Name on the right (owner 2026-10-22). The last row
//     of each column has no rule — the box closes it.
//   • The operation table: Op · Operation · Plan Machine · Actual Machine ·
//     Start · Finish · Accepted · Deviated · Logged By.
//     Plan is jc_ops.machine_id; Actual is who made the pieces (ADR-164).
//     "Logged By" is the SYSTEM user who booked the entries — the person
//     accountable for the record. The shop-floor Operator is NOT printed
//     (owner 2026-10-22); the JC screen and the ⬇ Excel export still carry it.
//     Blank rows follow for hand entries.
//   • Material / traceability and NCR / rework lines for hand entry — the
//     grade, and (ADR-182) the ACTUAL SIZE the store really cut, passed in
//     from the Production Order that built the card.
//   • Prepared / Checked / QC release sign-off.
//
// The production log is NOT printed (the ⬇ Excel export carries it).

import type { Company, JcOpEnriched, JobCardListItem } from '@innovic/shared';
import { opSrNo } from '@innovic/shared';
import { resolveActualMachine } from '@/components/shared/machine-split';
import { itemCodeWithRev } from '@/lib/item-code';
import { fmtDate } from '@/lib/date';
import { buildDocCompany } from '@/lib/print/company';
import { esc } from '@/lib/print/doc-print';
import { openSheetHtmlWindow, sheetLetterheadHtml } from '@/lib/print/sheet-print';

// The sheet's goods table spans 6 columns; every block row here spans the same
// so the outer border and the letterhead line up exactly as on the PO.
const COLS = 6;
// Hand-entry rows under the system's own operations, so the traveller has
// room on paper for a step added on the floor.
const BLANK_OP_ROWS = 4;
// Columns of the operation table (see its <thead>); a hand-entry row fills them.
const OP_COLS = 9;
// Widths of those columns; '' = Operation, which takes what is left.
const OP_COL_WIDTHS = ['8mm', '', '17mm', '17mm', '20mm', '20mm', '15mm', '15mm', '24mm'];

// The one shared DD-MMM-YYYY format. Blank, not a dash, on the traveller: an
// empty cell is where a hand writes the date.
function fmt(d: string | null | undefined): string {
  return fmtDate(d, '');
}

/** One label / value row. The rule under it runs the full column width — from
 *  the box's outer border to the centre divider — which is what `.jf` does
 *  through the column's zero padding (see JC_STYLE). */
function fact(label: string, value: string, opts?: { strong?: boolean; last?: boolean }): string {
  const cls = ['jf', opts?.last ? 'last' : '', opts?.strong ? 'strong' : '']
    .filter(Boolean)
    .join(' ');
  return `<div class="${cls}"><span class="lab">${esc(label)}</span><span class="val">${esc(value)}</span></div>`;
}

function opRow(o: JcOpEnriched): string {
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
  const actualLabel = actual === '' ? '' : actual.label;
  const actualCls = actual !== '' && actual.differs ? ' dev' : '';
  const okQty = isQc ? o.qcAcceptedQty : o.completedQty;
  const rej = isQc ? o.qcRejectedQty : 0;
  return `<tr>
    <td class="c b">${opSrNo(o.opSeq)}</td>
    <td>${esc(o.operation)}${isQc ? ' (QC)' : ''}</td>
    <td class="c b">${esc(planned)}</td>
    <td class="c b${actualCls}">${esc(actualLabel)}</td>
    <td class="c">${fmt(o.firstLogDate)}</td>
    <td class="c">${fmt(o.lastLogDate)}</td>
    <td class="c b">${okQty > 0 ? okQty : ''}</td>
    <td class="c">${rej > 0 ? rej : ''}</td>
    <td>${esc(o.entryDoneBy ?? '')}</td>
  </tr>`;
}

function blankRow(seq: number): string {
  return `<tr class="hand"><td class="c">${opSrNo(seq)}</td>${'<td></td>'.repeat(OP_COLS - 1)}</tr>`;
}

// Everything the traveller needs beyond SHEET_STYLE. Sizes follow the sheet:
// 9.5pt in the table, 10.5pt values, 9pt/8.5pt labels, Times throughout.
const JC_STYLE = `
  .jsplit{display:grid;grid-template-columns:1fr 1fr}
  .jsplit > div{padding:0}
  .jsplit > div:first-child{border-right:1px solid var(--paper-rule)}
  .jf{display:flex;align-items:flex-end;gap:2mm;border-bottom:1px solid var(--paper-rule);
      min-height:6.8mm;padding:0 3mm .6mm}
  .jf.last{border-bottom:none}
  .jf .lab{flex:0 0 32mm;font-family:var(--f-label);font-size:8.5pt;letter-spacing:.06em;
           text-transform:uppercase;color:#3A3A3A}
  .jf .val{flex:1;text-align:center;font-size:10.5pt}
  .jf.strong .val{font-weight:700}
  table.ops{width:100%;border-collapse:collapse;font-size:9.5pt;table-layout:fixed}
  table.ops td{overflow-wrap:anywhere}
  table.ops th{border:1px solid var(--paper-rule);border-top:none;padding:1.3mm 1.2mm;
               font-family:var(--f-label);font-size:8pt;letter-spacing:.06em;text-align:center;
               background:var(--paper-band)}
  table.ops th:first-child,table.ops td:first-child{border-left:none}
  table.ops th:last-child,table.ops td:last-child{border-right:none}
  table.ops td{border:1px solid var(--paper-rule);padding:1.4mm 1.2mm;height:9.5mm;vertical-align:middle}
  /* Each ops row is its own one-row table inside a sheet row whose border
     already draws the rule above and below — so the inner cells draw only the
     column dividers, or every rule would print double. */
  table.ops th,table.ops td{border-top:none;border-bottom:none}
  table.ops td.c{text-align:center;white-space:nowrap}
  table.ops td.b{font-weight:700}
  table.ops td.dev{color:#a15c00}
  table.ops tr.hand td{color:#3A3A3A}
  .jsec{padding:1.3mm 3mm;font-family:var(--f-label);font-size:8.5pt;letter-spacing:.08em;
        text-transform:uppercase;font-weight:700;color:#3A3A3A}
  .jtrace{display:grid;grid-template-columns:1fr 1fr}
  .jtrace > div{padding:1.5mm 3mm 1mm}
  .jtrace .jf,.jsign .jf{border-bottom:none;min-height:0;padding:0;margin:0 0 2mm}
  .jtrace .jf .val,.jsign .jf .val{border-bottom:1px solid var(--paper-rule);text-align:left;
                                    min-height:5.2mm;padding:0 1mm .5mm}
  .jsign{display:grid;grid-template-columns:1fr 1fr 1fr}
  .jsign > div{padding:2.5mm 3mm 1.5mm}
  .jsign > div + div{border-left:1px solid var(--paper-rule)}
  .jsign .jf .lab{flex:0 0 27mm}
  .jfoot{display:flex;justify-content:space-between;gap:6mm;padding:1.2mm 3mm;font-size:8pt;color:#3A3A3A}
`;

function sectionRow(html: string): string {
  return `<tr><td class="block" colspan="${COLS}">${html}</td></tr>`;
}

export function printJobCard(args: {
  jc: JobCardListItem;
  ops: JcOpEnriched[];
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

  const so = jc.sourceLink?.type === 'so' ? jc.sourceLink : null;
  const soNo = jc.sourceLink?.code ?? '';
  // Two different line numbers, never one. `Ln` is OUR line on the sales
  // order; `POL` is the line number on the CUSTOMER'S purchase order, which
  // does not have to match (our line 11 can be their line 20).
  const soLine = so ? String(so.lineNo) : '';
  const pol = jc.clientPoLineNo ?? '';
  const routeCard = jc.routeCardCode
    ? `${jc.routeCardCode}${jc.routeCardRevision != null ? ` / ${jc.routeCardRevision}` : ''}`
    : '';

  const left = [
    fact('JC No.', jc.code, { strong: true }),
    fact('Production Order No.', args.productionOrderCode ?? '', { strong: true }),
    fact(jc.sourceLink?.type === 'jw' ? 'JWSO No.' : 'SO No.', soNo, { strong: true }),
    // ADR-207 — the Internal SO No. on its own labelled line, only when set.
    so?.internalSoNo ? fact('Internal SO No.', so.internalSoNo, { strong: true }) : '',
    fact('Ln', soLine),
    fact('POL', pol),
    fact('RC No. / Route Card Rev', routeCard, { last: true }),
  ].join('');
  const right = [
    fact('JC Date', fmt(jc.jcDate)),
    fact('Due Date', fmt(jc.dueDate)),
    fact('JC Qty', `${jc.orderQty} pcs`, { strong: true }),
    // The item code with the customer's revision from the SO / JWSO line,
    // written CODE/REV like every other document (ADR-177). Printed ONCE: a
    // second "CODE/REV" row used to repeat this exact value. Item Name sits
    // directly under it (owner 2026-10-22: code first, then name).
    fact('Item Code', itemCodeWithRev(jc.itemCode, jc.itemRevision), { strong: true }),
    fact('Item Name', jc.itemName, { last: true }),
  ].join('');

  // Each operation is its OWN body row of the sheet (a one-row table inside),
  // so the paginator can break the page between two operations. With the
  // whole table in one row, a long route jumped to page 2 as a block and left
  // page 1 empty under the header. Fixed column widths (`table-layout:fixed`
  // + one <colgroup>) keep the separate tables' columns in line, and the
  // heading row is marked to repeat at the top of every continuation page.
  const colgroup = `<colgroup>${OP_COL_WIDTHS.map((w) => (w ? `<col style="width:${w}">` : '<col>')).join('')}</colgroup>`;
  const opsHead = `<table class="ops">${colgroup}
    <thead><tr>
      <th>Op</th>
      <th>Operation</th>
      <th>Planned<br>Machine</th>
      <th>Actual<br>Machine</th>
      <th>Start<br>Date</th>
      <th>End<br>Date</th>
      <th>Accepted</th>
      <th>Deviated</th>
      <th>Logged By</th>
    </tr></thead>
  </table>`;
  const opRows = [
    ...ops.map(opRow),
    ...Array.from({ length: BLANK_OP_ROWS }, (_, i) => blankRow(ops.length + i + 1)),
  ]
    .map(
      (r) =>
        `<tr data-carry-head="ops"><td class="block" colspan="${COLS}"><table class="ops">${colgroup}<tbody>${r}</tbody></table></td></tr>`,
    )
    .join('');

  const trace = `<div class="jsec">Material / Traceability &nbsp;·&nbsp; NC / Rework References</div>
    <div class="jtrace">
      <div>${fact('Material Grade', jc.rawMaterialGradeText ?? '')}${fact('Actual Size', args.actualSize ?? '')}${fact('Heat / Lot No.', '')}</div>
      <div>${fact('NC No.', jc.parentNcCode ?? '')}</div>
    </div>`;

  const signs = `<div class="jsign">
      <div>${fact('Prepared By', '')}${fact('Sign Date', '')}</div>
      <div>${fact('Checked / Approved By', '')}${fact('Sign Date', '')}</div>
      <div>${fact('QC Release', '')}${fact('Sign Date', '')}</div>
    </div>`;

  const foot = `<div class="jfoot">
      <span>Use released drawing only.</span>
      <span>Page <span data-pglast>1</span></span>
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
      <thead><tr><th class="lh" colspan="${COLS}">${letterhead}</th></tr></thead>
      <tfoot><tr><td class="pgfoot" colspan="${COLS}"><div></div></td></tr></tfoot>
      <tbody>
        ${sectionRow(`<div class="jsplit"><div>${left}</div><div>${right}</div></div>`)}
        <tr data-head-for="ops"><td class="block" colspan="${COLS}">${opsHead}</td></tr>
        ${opRows}
        ${sectionRow(trace)}
        ${sectionRow(signs)}
        ${sectionRow(foot)}
      </tbody>
    </table>
  </article>`;

  return openSheetHtmlWindow(`Job Card ${jc.code}`, html, JC_STYLE, undefined, jc.code);
}
