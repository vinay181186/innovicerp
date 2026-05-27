// Route Card print (Print Templates P3, ADR-034). Mirrors legacy
// `printRouteCard` (L10629): a fixed-layout document (NOT a template-editor
// doc) rendered via the shared `printWindow` util. Builds the body HTML from
// the loaded route-card detail + its item (drawing/rev/material) + company.

import type { Company, Item, RouteCardDetail, RouteCardOp } from '@innovic/shared';
import { esc } from '@/lib/print/doc-print';
import { printWindow, printedMeta } from '@/lib/print/print-window';

// Legacy machLabel equivalent for a route-card op: process → machine, QC → 'QC',
// outsource → vendor.
function machineLabel(op: RouteCardOp): string {
  if (op.opType === 'outsource') return op.ospVendorName ?? op.ospVendorCode ?? 'Outsource';
  if (op.opType === 'qc') return op.machineName ?? op.machineCode ?? 'QC';
  return op.machineName ?? op.machineCode ?? '—';
}

export function printRouteCard(args: {
  rc: RouteCardDetail;
  item: Item | null | undefined;
  company: Company | null | undefined;
}): boolean {
  const { rc, item, company } = args;

  const rows = rc.ops
    .map(
      (o, i) => `<tr>
      <td style="text-align:center;font-weight:700">${i + 1}</td>
      <td>${esc(machineLabel(o))}</td>
      <td>${esc(o.operation)}</td>
      <td style="text-align:center">${Number(o.cycleTimeMin) || '—'}</td>
      <td style="font-family:monospace">${esc(o.program ?? '—')}</td>
      <td>${esc(o.toolNo ?? '—')}</td>
      <td>${esc(o.toolDetails ?? '—')}</td>
    </tr>`,
    )
    .join('');

  const itemCode = rc.itemCode ?? '—';
  const drawing = item?.drawingNo ?? '—';
  const rev = item?.revision ?? '—';

  const body = `
    <div class="doc-title"><h1>ROUTE CARD — ${esc(rc.code || itemCode)}</h1><span class="print-meta">${printedMeta()}</span></div>
    <div class="info-grid" style="grid-template-columns:repeat(3,1fr)">
      <div class="info-box"><div class="info-lbl">Item Code</div><div class="info-val" style="color:#7c3aed">${esc(itemCode)}</div></div>
      <div class="info-box"><div class="info-lbl">Item Name</div><div class="info-val">${esc(rc.itemName ?? item?.name ?? '—')}</div></div>
      <div class="info-box"><div class="info-lbl">Drawing / Rev</div><div class="info-val" style="font-family:monospace">${esc(drawing)} Rev ${esc(rev)}</div></div>
      <div class="info-box"><div class="info-lbl">Material</div><div class="info-val">${esc(item?.material ?? '—')}</div></div>
      <div class="info-box"><div class="info-lbl">Total Operations</div><div class="info-val">${rc.ops.length}</div></div>
      <div class="info-box"><div class="info-lbl">Revision</div><div class="info-val">${rc.currentRevision}</div></div>
    </div>
    <h2>Operation Sequence</h2>
    <table><thead><tr><th>#</th><th>Machine</th><th>Operation</th><th>Cycle Time (h)</th><th>Program No.</th><th>Tool No.</th><th>Tool Details / Setup Notes</th></tr></thead>
    <tbody>${rows || '<tr><td colspan="7" style="text-align:center;color:#aaa">No operations</td></tr>'}</tbody></table>
    <div class="sign-row">
      <div class="sign-box">Process Engineer</div>
      <div class="sign-box">Reviewed By</div>
      <div class="sign-box">Approved By</div>
    </div>`;

  return printWindow({ title: `Route Card ${rc.code || itemCode}`, body, company });
}
