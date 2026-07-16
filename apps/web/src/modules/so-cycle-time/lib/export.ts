// Client-side Excel export for SO Cycle Time (legacy _sctExport L18260).
// Builds an .xlsx of the full phase + duration matrix from the already-loaded
// rows using SheetJS (xlsx — an existing dependency). Verified against legacy:
// same 27 columns in the same order, one sheet named 'SO Cycle Time' (L18281).
// No dataset is re-derived here — every value is projected straight from the
// server's /so-cycle-time rows (legacy instead recomputed _soPhaseData over the
// in-memory db, which is exactly what we must not port).
//
// Known divergences from legacy _sctExport (behaviour, not markup — left as-is):
//   • Scope: legacy exports ALL SOs regardless of the on-screen filter; we
//     export the caller's `rows` (the filtered set actually on screen).
//   • Dates: legacy wraps each phase in fmt() ("29 Apr 26"); we emit the raw
//     ISO string from the API.
//   • stamp() below uses toISOString() = the UTC date. Legacy uses today()
//     (L1485-87), which is LOCAL. Between 00:00-05:29 IST our filename carries
//     the previous day. Filename only — no figure is affected.

import type { SoCycleTimeRow } from '@innovic/shared';
import * as XLSX from 'xlsx';

function stamp(): string {
  return new Date().toISOString().slice(0, 10);
}

export function exportSoCycleTime(rows: SoCycleTimeRow[]): void {
  const out = rows.map((r) => ({
    'SO No': r.soNo,
    Customer: r.customer ?? '',
    Type: r.type ?? '',
    Status: r.status,
    'Order Qty': r.orderQty,
    'SO Created': r.phases.soCreated ?? '',
    'Design Assigned': r.phases.designAssigned ?? '',
    'Design Approved': r.phases.designApproved ?? '',
    'BOM Linked': r.phases.bomLinked ?? '',
    'Plan Created': r.phases.planCreated ?? '',
    'JC Created': r.phases.jcCreated ?? '',
    'PR Raised': r.phases.prRaised ?? '',
    'GRN Received': r.phases.grnReceived ?? '',
    'First Op': r.phases.firstOpStart ?? '',
    'Last Op': r.phases.lastOpEnd ?? '',
    'First QC': r.phases.firstQcStart ?? '',
    'Last QC': r.phases.lastQcEnd ?? '',
    'Assembly Start': r.phases.assemblyStarted ?? '',
    'Assembly Done': r.phases.assemblyDone ?? '',
    Dispatched: r.phases.dispatched ?? '',
    Invoiced: r.phases.invoiced ?? '',
    'Design Days': r.durations.design ?? '',
    'Material Days': r.durations.materialProc ?? '',
    'Production Days': r.durations.production ?? '',
    'QC Days': r.durations.qc ?? '',
    'Assembly Days': r.durations.assembly ?? '',
    'Dispatch Days': r.durations.assemblyToDispatch ?? '',
    'Total Cycle': r.durations.total ?? '',
  }));
  const ws = XLSX.utils.json_to_sheet(out);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'SO Cycle Time');
  XLSX.writeFile(wb, `so-cycle-time-${stamp()}.xlsx`);
}
