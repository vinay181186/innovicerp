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
//   • Dates: legacy wraps each phase in fmt() ("29 Apr 26"); we write each
//     phase through the app's shared fmtDate (dd-mm-yyyy, the date part of the
//     API's ISO value, no timezone shift).
//   • stamp() below uses toISOString() = the UTC date. Legacy uses today()
//     (L1485-87), which is LOCAL. Between 00:00-05:29 IST our filename carries
//     the previous day. Filename only — no figure is affected.

import type { SoCycleTimeRow } from '@innovic/shared';
import * as XLSX from 'xlsx';
import { todayIst } from '@/lib/date';
import { fmtDate } from '@/lib/print/doc-print';

/** A phase timestamp as the IST calendar day (dd-mm-yyyy). The phases are
 *  stored as UTC timestamps, so the plain date part would show the previous
 *  day for anything logged between 00:00 and 05:30 IST. */
function istDate(v: string | null | undefined): string {
  if (!v) return '';
  if (!v.includes('T')) return fmtDate(v);
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return fmtDate(v);
  return fmtDate(
    new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Kolkata',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(d),
  );
}
import { soStatusLabel } from '@/modules/sales-orders/lib/so-status-label';

// SO type code → the word the SO Cycle Time screen shows (routes/page.tsx).
const TYPE_LABEL: Record<string, string> = {
  component_manufacturing: 'Component',
  equipment: 'Equipment',
  with_material: 'With Material',
};

function stamp(): string {
  return todayIst();
}

export function exportSoCycleTime(rows: SoCycleTimeRow[]): void {
  const out = rows.map((r) => ({
    'SO No.': r.soNo,
    Customer: r.customer ?? '',
    'SO Type': r.type ? (TYPE_LABEL[r.type] ?? r.type) : '',
    'SO Status': soStatusLabel(r.status),
    'Order Qty': r.orderQty,
    'SO Created': istDate(r.phases.soCreated),
    'Design Assigned': istDate(r.phases.designAssigned),
    'Design Approved': istDate(r.phases.designApproved),
    'BOM Linked': istDate(r.phases.bomLinked),
    'Plan Created': istDate(r.phases.planCreated),
    'JC Created': istDate(r.phases.jcCreated),
    'PR Raised': istDate(r.phases.prRaised),
    'GRN Received': istDate(r.phases.grnReceived),
    'First Op': istDate(r.phases.firstOpStart),
    'Last Op': istDate(r.phases.lastOpEnd),
    'First QC': istDate(r.phases.firstQcStart),
    'Last QC': istDate(r.phases.lastQcEnd),
    'Assembly Start': istDate(r.phases.assemblyStarted),
    'Assembly Completed': istDate(r.phases.assemblyDone),
    Dispatched: istDate(r.phases.dispatched),
    Invoiced: istDate(r.phases.invoiced),
    'Design Days': r.durations.design ?? '',
    'Material Days': r.durations.materialProc ?? '',
    'Production Days': r.durations.production ?? '',
    'QC Days': r.durations.qc ?? '',
    'Assembly Days': r.durations.assembly ?? '',
    'Dispatch Days': r.durations.assemblyToDispatch ?? '',
    'Total Cycle Days': r.durations.total ?? '',
  }));
  const ws = XLSX.utils.json_to_sheet(out);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'SO Cycle Time');
  XLSX.writeFile(wb, `SO Cycle Time Export ${stamp()}.xlsx`);
}
