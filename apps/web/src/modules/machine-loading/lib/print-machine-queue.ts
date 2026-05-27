// Machine Queue print (Print Templates P3, ADR-034). Mirrors legacy
// `printMachineQueue` (L10661): a fixed-layout document (NOT a template-editor
// doc) rendered via the shared `printWindow` util. Renders a per-machine job
// queue table from the Machine Loading board data (MachineLoadCard +
// MachineLoadOp). Supports a single machine or all machines.
//
// DATA GAP vs legacy: the /machine-loading endpoint does not expose the SO
// customer name (legacy showed it under the SO No.) nor the live "▶ Running"
// flag. Those columns are omitted rather than invented. Everything else maps
// 1:1 to the board.

import type { Company, MachineLoadCard, MachineLoadOp } from '@innovic/shared';
import { esc } from '@/lib/print/doc-print';
import { printWindow, printedMeta } from '@/lib/print/print-window';

// Legacy priority/status → badge class.
function priorityBadge(priority: MachineLoadOp['priority']): string {
  const cls = priority === 'high' ? 'b-amber' : 'b-grey';
  const label = priority === 'high' ? 'High' : 'Normal';
  return `<span class="badge ${cls}">${label}</span>`;
}

function statusBadge(status: string): string {
  const s = status.replaceAll('_', ' ');
  const lower = s.toLowerCase();
  const cls = lower.includes('progress') ? 'b-amber' : lower.includes('available') ? 'b-blue' : 'b-grey';
  // Title-case the computed status for the print.
  const label = s.replace(/\b\w/g, (c) => c.toUpperCase());
  return `<span class="badge ${cls}">${esc(label)}</span>`;
}

function machineSection(machine: MachineLoadCard, ops: MachineLoadOp[]): string {
  const head = `<h2>${esc(machine.machineCode)} — ${esc(machine.name)}</h2>`;
  if (ops.length === 0) {
    return `${head}<p style="color:#aaa;font-size:11px;margin-bottom:10px">✓ No pending jobs for this machine</p>`;
  }
  const rows = ops
    .map(
      (o, i) => `<tr>
      <td style="text-align:center;font-weight:700">${i + 1}</td>
      <td style="font-family:monospace;font-weight:700">${esc(o.jobCardCode)}</td>
      <td style="color:#7c3aed">${esc(o.itemCode ?? '')}</td>
      <td>${esc(o.itemName ?? '')}</td>
      <td>${esc(o.soCode ?? '—')}</td>
      <td style="text-align:center">${o.opSeq}</td>
      <td>${esc(o.operation)}</td>
      <td>${priorityBadge(o.priority)}</td>
      <td style="text-align:center">${esc(o.dueDate ?? '—')}</td>
      <td style="text-align:center">${o.orderQty}</td>
      <td style="text-align:center;color:#16a34a;font-weight:700">${o.completedQty}</td>
      <td style="text-align:center;font-weight:700;color:${o.available > 0 ? '#d97706' : '#9ca3af'}">${o.available}</td>
      <td style="text-align:center;font-weight:700;color:#dc2626">${o.pendingHrs}h</td>
      <td>${statusBadge(o.computedStatus)}</td>
    </tr>`,
    )
    .join('');
  return `${head}<table><thead><tr>
      <th>#</th><th>JC No.</th><th>Item Code</th><th>Item Name</th><th>SO/WO</th>
      <th>Op</th><th>Operation</th><th>Priority</th><th>Due Date</th>
      <th>Order</th><th>Done</th><th>Avail</th><th>Pend Hrs</th><th>Status</th>
    </tr></thead><tbody>${rows}</tbody></table>`;
}

export function printMachineQueue(args: {
  machines: MachineLoadCard[];
  ops: MachineLoadOp[];
  company: Company | null | undefined;
  /** When set, prints a single machine's queue; otherwise all machines. */
  machineId?: string | null;
}): boolean {
  const { machines, ops, company, machineId } = args;

  const selectedMachines = machineId ? machines.filter((m) => m.machineId === machineId) : machines;
  const headingScope = machineId
    ? (selectedMachines[0]?.machineCode ?? 'MACHINE')
    : 'ALL MACHINES';

  const sections = selectedMachines
    .map((m) => machineSection(m, ops.filter((o) => o.machineId === m.machineId)))
    .join('');

  const body = `
    <div class="doc-title"><h1>MACHINE QUEUE REPORT — ${esc(headingScope)}</h1><span class="print-meta">${printedMeta()}</span></div>
    ${sections || '<p style="color:#aaa;font-size:11px">No machines configured.</p>'}
    <div class="sign-row">
      <div class="sign-box">Prepared By</div>
      <div class="sign-box">Production Supervisor</div>
      <div class="sign-box">Approved By</div>
    </div>`;

  return printWindow({ title: 'Machine Queue Report', body, company });
}
