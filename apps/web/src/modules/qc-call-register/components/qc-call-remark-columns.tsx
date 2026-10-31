// QC Call Register — the Completed view's two remark columns (NAMING.md):
// QC Remarks (op QC `remarks`; GRN / Party GRN `qcRemarks`) and Deviation
// Reason (a Party GRN line's `rejectReason`; "—" on every other kind of call).
// Split out of qc-call-completed-columns.tsx to keep it under 400 lines.

import type { DataTableColumn } from '@/ui/data';
import type { CompletedVM } from './qc-call-completed-columns';

/** QC Remarks the inspector typed; null when blank. */
export function qcRemarksOf(vm: CompletedVM): string | null {
  return (vm.kind === 'op' ? vm.row.remarks : vm.row.qcRemarks)?.trim() || null;
}

/** Deviation Reason — Party GRN lines only; null elsewhere. */
export function deviationReasonOf(vm: CompletedVM): string | null {
  return vm.kind === 'pgrn' ? vm.row.rejectReason?.trim() || null : null;
}

export function remarkColumns(): DataTableColumn<CompletedVM>[] {
  return [
    {
      id: 'remarks',
      sortFilterField: 'remarks',
      header: 'QC Remarks',
      align: 'left',
      ellipsis: true,
      render: (vm) => qcRemarksOf(vm) ?? '—',
      title: (vm) => qcRemarksOf(vm) ?? '',
    },
    {
      id: 'deviation_reason',
      sortFilterField: 'deviationReason',
      header: 'Deviation Reason',
      align: 'left',
      ellipsis: true,
      render: (vm) => deviationReasonOf(vm) ?? '—',
      title: (vm) => deviationReasonOf(vm) ?? '',
    },
  ];
}
