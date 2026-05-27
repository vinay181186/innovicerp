// Daily Production Report print (Print Templates P3, ADR-034). Mirrors legacy
// `printDailyReport` (L10918): a fixed-layout document (NOT a template-editor
// doc) rendered via the shared `printWindow` util. Renders the per-machine
// op-log summary for the selected date from the data the page already loads
// (DailyReportResponse: summary + per-machine groups + rows). Full field parity
// with legacy — no data gaps.

import type { Company, DailyReportResponse } from '@innovic/shared';
import { esc, fmtDate } from '@/lib/print/doc-print';
import { printWindow, printedMeta } from '@/lib/print/print-window';

function machineSection(group: DailyReportResponse['groups'][number]): string {
  const rows = group.rows
    .map(
      (r) => `<tr>
      <td style="font-family:monospace">${esc(r.jcCode)}</td>
      <td style="color:#7c3aed">${esc(r.itemCode ?? '')}</td>
      <td>${esc(r.itemName ?? '')}</td>
      <td style="text-align:center">${r.opSeq}</td>
      <td>${esc(r.operation)}</td>
      <td style="text-align:center">${esc(r.shift)}</td>
      <td style="text-align:center;font-weight:700;color:#16a34a">${r.qty}</td>
      <td>${esc(r.operator ?? '—')}</td>
      <td style="font-size:10px">${esc(r.remarks ?? '')}</td>
    </tr>`,
    )
    .join('');
  return `<h2>${esc(group.machineCode)} — ${esc(group.machineName ?? group.machineCode)} &nbsp; <span style="color:#16a34a">${group.totalQty} pcs produced</span></h2>
    <table><thead><tr>
      <th>JC No.</th><th>Item Code</th><th>Item Name</th><th>Op</th><th>Operation</th>
      <th>Shift</th><th>Qty</th><th>Operator</th><th>Remarks</th>
    </tr></thead><tbody>${rows}</tbody></table>`;
}

export function printDailyReport(args: {
  report: DailyReportResponse;
  machineLabel: string;
  company: Company | null | undefined;
}): boolean {
  const { report, machineLabel, company } = args;
  const { summary, groups, date } = report;

  const sections = groups.map(machineSection).join('');

  const body = `
    <div class="doc-title"><h1>DAILY PRODUCTION REPORT &nbsp;|&nbsp; ${esc(fmtDate(date) || date)} &nbsp;|&nbsp; ${esc(machineLabel)}</h1><span class="print-meta">${printedMeta()}</span></div>
    <div class="info-grid">
      <div class="info-box"><div class="info-lbl">Total Pieces Produced</div><div class="info-val" style="color:#16a34a;font-size:22px">${summary.totalPieces}</div></div>
      <div class="info-box"><div class="info-lbl">Log Entries</div><div class="info-val">${summary.logEntries}</div></div>
      <div class="info-box"><div class="info-lbl">Machines Active</div><div class="info-val">${summary.machinesActive}</div></div>
      <div class="info-box"><div class="info-lbl">JCs Active</div><div class="info-val">${summary.jcsActive}</div></div>
    </div>
    ${sections || '<p style="color:#aaa;margin-top:20px">No production entries for this date/machine combination.</p>'}
    <div class="sign-row">
      <div class="sign-box">Shift In-Charge</div>
      <div class="sign-box">Production Supervisor</div>
      <div class="sign-box">Quality Control</div>
    </div>`;

  return printWindow({ title: `Daily Production Report — ${date}`, body, company });
}
