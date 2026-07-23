// Job Card print (Print Templates P3, ADR-034). Mirrors legacy `printJobCard`
// (`legacy/InnovicERP_v82_12_3_DataLossFix_29-04-2026.html` L10582): a
// fixed-layout document (NOT a template-editor doc) rendered via the shared
// `printWindow` util. Builds the body HTML from the JC list row
// (`JobCardListItem`, from `v_jc_status`) + its enriched ops
// (`JcOpEnriched[]`, from `/op-entry/jc-ops`) + company.
//
// DATA GAPS vs legacy printJobCard (rendered as "—" / omitted — these fields
// are not surfaced by any existing job-cards / jc-ops read; per task scope we
// do NOT add an endpoint for them):
//   - Drawing No. + Material: live on `items` (items.drawing / items.material),
//     not on the JC list row (which only carries drawingFilePath). Rendered "—".
//   - Drawing image + Material/Drawing No.: drawing lives in Storage (needs an
//     async signed URL) and Material/Drawing No. live on `items`; both omitted.
//   - Production Log: intentionally NOT printed (the print is a shop-floor
//     document). The production log is available via the ⬇ Excel export instead.

import type { Company, ComputedJcOpStatus, JcOpEnriched, JobCardListItem } from '@innovic/shared';
import { esc } from '@/lib/print/doc-print';
import { printWindow, printedMeta } from '@/lib/print/print-window';

// Legacy printable op status → label + badge class. Legacy printJobCard used a
// 3-tone heuristic (green=Complete, amber=In Progress, grey=otherwise) over the
// calc-engine status string (L10598). We carry the richer 12-state enriched
// status here but keep the same green / amber / grey tone buckets.
const OP_STATUS_LABEL: Record<ComputedJcOpStatus, string> = {
  waiting: 'Waiting',
  available: 'Available',
  in_progress: 'In Progress',
  running: 'Running',
  qc_pending: 'QC Pending',
  complete: 'Complete',
  pr_raised: 'PR Raised',
  po_created: 'PO Created',
  at_vendor: 'Processing',
  received: 'Incoming QC',
  ready_for_pr: 'Ready for PR',
  outsource: 'Outsource',
};

function opStatusBadgeClass(status: ComputedJcOpStatus): string {
  if (status === 'complete') return 'b-green';
  if (status === 'waiting' || status === 'available' || status === 'outsource') return 'b-grey';
  return 'b-amber';
}

// machLabel equivalent: machine code (or machineCodeText fallback). OSP / QC
// ops have no machine — the enriched row's machineCode is null there.
function machineLabel(op: JcOpEnriched): string {
  return op.machineCode ?? op.machineCodeText ?? '—';
}

// dd-MM-yyyy with no TZ shift; null-safe (mirrors legacy fmt()).
function fmt(d: string | null | undefined): string {
  if (!d) return '—';
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(d);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : d;
}

export function printJobCard(args: {
  jc: JobCardListItem;
  ops: JcOpEnriched[];
  company: Company | null | undefined;
}): boolean {
  const { jc, company } = args;
  // Order by op_seq so the routing prints in process order (the enriched read
  // is not guaranteed ordered).
  const ops = [...args.ops].sort((a, b) => a.opSeq - b.opSeq);

  const qtyDone = jc.lastOpCompletedQty;
  const pending = Math.max(0, jc.orderQty - qtyDone);

  const opRows = ops
    .map(
      (o) => `<tr>
      <td style="width:30px;text-align:center;font-weight:700">${o.opSeq}</td>
      <td>${esc(machineLabel(o))}</td>
      <td>${esc(o.operation)}</td>
      <td style="text-align:center">${Number(o.cycleTimeMin) || '—'}</td>
      <td style="font-family:monospace">${esc(o.program || '—')}</td>
      <td>${esc(o.toolNo || '—')}</td>
      <td style="text-align:center">${o.inputAvail}</td>
      <td style="text-align:center;color:#16a34a;font-weight:700">${o.completedQty}</td>
      <td style="text-align:center;font-weight:700;color:${o.available > 0 ? '#d97706' : '#9ca3af'}">${o.available}</td>
      <td><span class="badge ${opStatusBadgeClass(o.computedStatus)}">${esc(OP_STATUS_LABEL[o.computedStatus])}</span></td>
    </tr>`,
    )
    .join('');

  // SO/WO No. from the source link (so/jw code); "—" for source-less JCs.
  const soWoNo = jc.sourceLink?.code ?? '—';
  const priorityHigh = jc.priority === 'high';

  // JC status → badge (mirrors legacy: green for Complete/Closed, cyan otherwise).
  const jcStatusBadge =
    jc.computedStatus === 'complete' || jc.computedStatus === 'closed' ? 'b-green' : 'b-cyan';
  const jcStatusLabel = jc.computedStatus.replaceAll('_', ' ');

  const body = `
    <div class="doc-title"><h1>JOB CARD — ${esc(jc.code)}</h1><span class="print-meta">${printedMeta()}</span></div>
    <div class="info-grid">
      <div class="info-box"><div class="info-lbl">Item Code</div><div class="info-val" style="color:#7c3aed">${esc(jc.itemCode)}</div></div>
      <div class="info-box"><div class="info-lbl">Item Name</div><div class="info-val">${esc(jc.itemName || '—')}</div></div>
      <div class="info-box"><div class="info-lbl">SO / WO No.</div><div class="info-val" style="font-family:monospace;font-size:12px">${esc(soWoNo)}</div></div>
      <div class="info-box"><div class="info-lbl">Client PO Line</div><div class="info-val" style="color:#7c3aed;font-weight:700">${esc(jc.clientPoLineNo || '—')}</div></div>
      <div class="info-box"><div class="info-lbl">Date</div><div class="info-val">${fmt(jc.jcDate)}</div></div>
      <div class="info-box"><div class="info-lbl">Order Qty</div><div class="info-val">${jc.orderQty}</div></div>
      <div class="info-box"><div class="info-lbl">Completed</div><div class="info-val" style="color:#16a34a">${qtyDone}</div></div>
      <div class="info-box"><div class="info-lbl">Pending</div><div class="info-val" style="color:${pending > 0 ? '#dc2626' : '#16a34a'}">${pending}</div></div>
      <div class="info-box"><div class="info-lbl">Due Date</div><div class="info-val">${fmt(jc.dueDate)}</div></div>
      <div class="info-box"><div class="info-lbl">Priority</div><div class="info-val"><span class="badge ${priorityHigh ? 'b-amber' : 'b-grey'}">${priorityHigh ? 'High' : 'Normal'}</span></div></div>
      <div class="info-box"><div class="info-lbl">Drawing No.</div><div class="info-val" style="font-family:monospace">—</div></div>
      <div class="info-box"><div class="info-lbl">Material</div><div class="info-val">—</div></div>
      <div class="info-box"><div class="info-lbl">Status</div><div class="info-val"><span class="badge ${jcStatusBadge}">${esc(jcStatusLabel)}</span></div></div>
    </div>
    <h2>Operation Routing</h2>
    <table><thead><tr><th>#</th><th>Machine</th><th>Operation</th><th>Cycle(h)</th><th>Program</th><th>Tool No.</th><th>Order</th><th>Done</th><th>Avail</th><th>Status</th></tr></thead>
    <tbody>${opRows || '<tr><td colspan="10" style="text-align:center;color:#aaa">No operations</td></tr>'}</tbody></table>
    <div class="sign-row">
      <div class="sign-box">Prepared By</div>
      <div class="sign-box">Checked By</div>
      <div class="sign-box">Approved By</div>
    </div>`;

  return printWindow({ title: `Job Card ${jc.code}`, body, company });
}
