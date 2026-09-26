// Job Card print — the shop-floor TRAVELLER (form PRD-F-004, reference doc
// `04_Job_Card_Route_Card_Traveller.docx`), printed on the Innovic Sheet: the
// same paper, Times New Roman, sizes and letterhead as the Purchase Order and
// the challans (sheet-print.ts), so every printed document reads as one family.
//
// What it prints, from the JC list row (`JobCardListItem`, v_jc_status) + its
// enriched ops (`JcOpEnriched[]`, /op-entry/jc-ops) + the company:
//   • Letterhead — logo + company name only (an internal document: no address,
//     no GSTIN), the brand rule, the title JOB CARD.
//   • Two columns of facts, each on its own full-width rule: JC No, SO No, SO
//     line, part, route card on the left (no client — user 2026-09-16, it is a
//     shop-floor sheet); date, due, qty, item, drawing
//     on the right. The last row of each column has no rule — the box closes it.
//   • The operation table: Op · Operation · Plan Machine · Actual Machine ·
//     Operator · Start · Finish · Accepted · Rejected · QC/Report · Logged By.
//     Plan is jc_ops.machine_id; Actual is who made the pieces (ADR-164).
//     "Logged By" is the SYSTEM user who booked the entries — the person
//     accountable for the record — not the shop-floor operator, who has his
//     own column. Blank rows follow for hand entries.
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
import { buildDocCompany } from '@/lib/print/company';
import { esc } from '@/lib/print/doc-print';
import { openSheetHtmlWindow, sheetLetterheadHtml } from '@/lib/print/sheet-print';

// The sheet's goods table spans 6 columns; every block row here spans the same
// so the outer border and the letterhead line up exactly as on the PO.
const COLS = 6;
// Hand-entry rows under the system's own operations, so the traveller has
// room on paper for a step added on the floor.
const BLANK_OP_ROWS = 4;

// dd-MM-yyyy with no TZ shift; null-safe (mirrors legacy fmt()). Blank, not a
// dash, on the traveller: an empty cell is where a hand writes the date.
function fmt(d: string | null | undefined): string {
  if (!d) return '';
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(d);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : d;
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
    <td>${esc(o.operatorNames ?? '')}</td>
    <td class="c">${fmt(o.firstLogDate)}</td>
    <td class="c">${fmt(o.lastLogDate)}</td>
    <td class="c b">${okQty > 0 ? okQty : ''}</td>
    <td class="c">${rej > 0 ? rej : ''}</td>
    <td></td>
    <td>${esc(o.entryDoneBy ?? '')}</td>
  </tr>`;
}

function blankRow(seq: number): string {
  return `<tr class="hand"><td class="c">${opSrNo(seq)}</td>${'<td></td>'.repeat(10)}</tr>`;
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
  table.ops{width:100%;border-collapse:collapse;font-size:9.5pt}
  table.ops th{border:1px solid var(--paper-rule);border-top:none;padding:1.3mm 1.2mm;
               font-family:var(--f-label);font-size:8pt;letter-spacing:.06em;text-align:center;
               background:var(--paper-band)}
  table.ops th:first-child,table.ops td:first-child{border-left:none}
  table.ops th:last-child,table.ops td:last-child{border-right:none}
  table.ops td{border:1px solid var(--paper-rule);padding:1.4mm 1.2mm;height:9.5mm;vertical-align:middle}
  table.ops tr:last-child td{border-bottom:none}
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
}): boolean {
  const { jc } = args;
  const company = buildDocCompany(args.company);
  // Order by op_seq so the routing prints in process order (the enriched read
  // is not guaranteed ordered).
  const ops = [...args.ops].sort((a, b) => a.opSeq - b.opSeq);

  const so = jc.sourceLink?.type === 'so' ? jc.sourceLink : null;
  const soNo = jc.sourceLink?.code ?? '';
  // Two different line numbers, never one. `SO Line` is OUR line on the sales
  // order; `POL` is the line number on the CUSTOMER'S purchase order, which
  // does not have to match (our line 11 can be their line 20).
  const soLine = so ? String(so.lineNo) : '';
  const pol = jc.clientPoLineNo ?? '';
  const routeCard = jc.routeCardCode
    ? `${jc.routeCardCode}${jc.routeCardRevision != null ? ` / ${jc.routeCardRevision}` : ''}`
    : '';
  // The drawing is the item code with the customer's revision from the SO /
  // JWSO line, written CODE/REV like every other document (ADR-177);
  // items.drawing_no is not on the list row.
  const drawing = itemCodeWithRev(jc.itemCode, jc.itemRevision);

  const left = [
    fact('JC No.', jc.code, { strong: true }),
    fact('SO No.', soNo, { strong: true }),
    fact('Ln', soLine),
    fact('POL', pol),
    fact('Item Name', jc.itemName),
    fact('RC No. / Route Card Rev', routeCard, { last: true }),
  ].join('');
  const right = [
    fact('JC Date', fmt(jc.jcDate)),
    fact('Due Date', fmt(jc.dueDate)),
    fact('JC Qty', `${jc.orderQty} pcs`, { strong: true }),
    fact('Item Code', itemCodeWithRev(jc.itemCode, jc.itemRevision), { strong: true }),
    fact('CODE/REV', drawing, { last: true }),
  ].join('');

  const rows =
    ops.map(opRow).join('') +
    Array.from({ length: BLANK_OP_ROWS }, (_, i) => blankRow(ops.length + i + 1)).join('');

  const opsTable = `<table class="ops">
    <thead><tr>
      <th style="width:8mm">Op</th>
      <th>Operation</th>
      <th style="width:17mm">Planned<br>Machine</th>
      <th style="width:17mm">Actual<br>Machine</th>
      <th style="width:20mm">Operator</th>
      <th style="width:16mm">Start<br>Date</th>
      <th style="width:16mm">End<br>Date</th>
      <th style="width:11mm">Accepted</th>
      <th style="width:13mm">Rejected</th>
      <th style="width:20mm">QC / Report</th>
      <th style="width:22mm">Logged By</th>
    </tr></thead>
    <tbody>${rows}</tbody>
  </table>`;

  const trace = `<div class="jsec">Material / Traceability &nbsp;·&nbsp; NC / Rework References</div>
    <div class="jtrace">
      <div>${fact('Material Grade', jc.rawMaterialGradeText ?? '')}${fact('Actual Size', args.actualSize ?? '')}${fact('Heat / Lot No.', '')}</div>
      <div>${fact('NC No.', jc.parentNcCode ?? '')}${fact('Rework JC', '')}</div>
    </div>`;

  const signs = `<div class="jsign">
      <div>${fact('Prepared By', '')}${fact('Sign Date', '')}</div>
      <div>${fact('Checked / Approved By', '')}${fact('Sign Date', '')}</div>
      <div>${fact('QC Release', '')}${fact('Sign Date', '')}</div>
    </div>`;

  const foot = `<div class="jfoot">
      <span>Job card must reference only released drawing / routing revisions. QC hold operations cannot be closed without inspector acceptance.</span>
      <span>Page <span data-pgof>1</span></span>
    </div>`;

  const letterhead = sheetLetterheadHtml({ name: company.name, title: 'Job Card' });

  const html = `
  <div class="no-print toolbar">
    <button onclick="window.print()" style="padding:8px 24px;background:#1E4DB3;color:#fff;border:0;border-radius:5px;cursor:pointer">🖨 Print</button>
    <button onclick="window.close()" style="padding:8px 16px;background:#f3f4f6;border:1px solid #d1d5db;border-radius:5px;cursor:pointer">✕ Close</button>
  </div>
  <article class="sheet">
    <table class="doc">
      <thead><tr><th class="lh" colspan="${COLS}">${letterhead}</th></tr></thead>
      <tfoot><tr><td class="pgfoot" colspan="${COLS}"><div></div></td></tr></tfoot>
      <tbody>
        ${sectionRow(`<div class="jsplit"><div>${left}</div><div>${right}</div></div>`)}
        ${sectionRow(opsTable)}
        ${sectionRow(trace)}
        ${sectionRow(signs)}
        ${sectionRow(foot)}
      </tbody>
    </table>
  </article>`;

  return openSheetHtmlWindow(`Job Card ${jc.code}`, html, JC_STYLE);
}
