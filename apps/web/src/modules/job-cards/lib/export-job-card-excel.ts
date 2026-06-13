// Job Card → Excel export. Unlike the print document (no log), the Excel file
// carries the full data INCLUDING the production log, across three sheets:
// "Job Card" (header), "Operations" (routing + live qty/QC), "Production Log".
// Uses the SheetJS dep already in the app (see items/lib/import-export.ts).

import type { JcOpEnriched, JobCardListItem, OpLog } from '@innovic/shared';
import * as XLSX from 'xlsx';

const machine = (o: JcOpEnriched): string =>
  o.opType === 'qc' ? 'QC' : o.opType === 'outsource' ? 'Outsource' : (o.machineCode ?? o.machineCodeText ?? '');

export function exportJobCardExcel(args: {
  jc: JobCardListItem;
  ops: JcOpEnriched[];
  logs: OpLog[];
}): void {
  const { jc } = args;
  const ops = [...args.ops].sort((a, b) => a.opSeq - b.opSeq);
  const opById = new Map(ops.map((o) => [o.id, o]));
  const completed = jc.lastOpCompletedQty;
  const pending = Math.max(0, jc.orderQty - completed);

  // ── Sheet 1: Job Card header (key/value rows) ──
  const headerAoa: (string | number)[][] = [
    ['JOB CARD', jc.code],
    ['Date', jc.jcDate],
    ['Item Code', jc.itemCode],
    ['Item Name', jc.itemName || ''],
    ['SO / WO', jc.sourceLink?.code ?? ''],
    ['SO / WO Line', jc.sourceLink?.lineNo ?? ''],
    ['Client PO Line', jc.clientPoLineNo ?? ''],
    ['Order Qty', jc.orderQty],
    ['Completed Qty', completed],
    ['Pending Qty', pending],
    ['Due Date', jc.dueDate ?? ''],
    ['Priority', jc.priority === 'high' ? 'High' : 'Normal'],
    ['Status', jc.computedStatus.replaceAll('_', ' ')],
  ];
  const wsHeader = XLSX.utils.aoa_to_sheet(headerAoa);
  wsHeader['!cols'] = [{ wch: 18 }, { wch: 36 }];

  // ── Sheet 2: Operations ──
  const opCols = [
    'Op #',
    'Machine',
    'Operation',
    'Cycle (min)',
    'Program',
    'Tool No.',
    'Order',
    'Input',
    'Done',
    'Avail',
    'QC Accepted',
    'QC Rejected',
    'QC Pending',
    'Status',
  ];
  const opAoa: (string | number)[][] = [
    opCols,
    ...ops.map((o) => [
      o.opSeq,
      machine(o),
      o.operation,
      Number(o.cycleTimeMin) || 0,
      o.program ?? '',
      o.toolNo ?? '',
      jc.orderQty,
      o.inputAvail,
      o.opType === 'qc' ? o.qcAcceptedQty : o.completedQty,
      o.opType === 'qc' ? o.qcPending : o.available,
      o.qcAcceptedQty,
      o.qcRejectedQty,
      o.qcPending,
      o.computedStatus.replaceAll('_', ' '),
    ]),
  ];
  const wsOps = XLSX.utils.aoa_to_sheet(opAoa);
  wsOps['!cols'] = opCols.map((c) => ({ wch: Math.max(10, c.length + 2) }));

  // ── Sheet 3: Production Log (the log the print omits) ──
  const logCols = ['Date', 'Shift', 'Op #', 'Operation', 'Type', 'Qty', 'Reject Qty', 'Operator', 'Remarks'];
  const logsSorted = [...args.logs].sort((a, b) =>
    (a.logDate + (a.startTime ?? '')).localeCompare(b.logDate + (b.startTime ?? '')),
  );
  const logAoa: (string | number)[][] = [
    logCols,
    ...logsSorted.map((l) => {
      const op = opById.get(l.jcOpId);
      return [
        l.logDate,
        l.shift,
        op?.opSeq ?? '',
        op?.operation ?? '',
        l.logType,
        l.qty,
        l.rejectQty,
        l.operatorName ?? '',
        l.remarks ?? '',
      ];
    }),
  ];
  const wsLog = XLSX.utils.aoa_to_sheet(logAoa);
  wsLog['!cols'] = logCols.map((c) => ({ wch: Math.max(10, c.length + 2) }));

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, wsHeader, 'Job Card');
  XLSX.utils.book_append_sheet(wb, wsOps, 'Operations');
  XLSX.utils.book_append_sheet(wb, wsLog, 'Production Log');
  XLSX.writeFile(wb, `JobCard_${jc.code}.xlsx`);
}
