// Job Card → Excel export. Unlike the print document (no log), the Excel file
// carries the full data INCLUDING the production log, across three sheets:
// "Job Card" (header), "Operations" (routing + live qty/QC), "Production Log".
// Uses the SheetJS dep already in the app (see items/lib/import-export.ts).

import type { JcOpEnriched, JobCardListItem, MachineSplit, OpLog } from '@innovic/shared';
import * as XLSX from 'xlsx';

// The op's CURRENT machine — where the REMAINING qty runs, not who made the
// completed qty (ADR-126). See machineSplitCell for the honest breakdown.
const machine = (o: JcOpEnriched): string =>
  o.opType === 'qc' ? 'QC' : o.opType === 'outsource' ? 'Outsource' : (o.machineCode ?? o.machineCodeText ?? '');

// Per-machine production split (0095 / ADR-126), from the correlated LATERAL
// over v_op_machine_output in the op-entry service. Empty for a single-machine
// op, so the cell is simply blank there.
const machineSplit = (o: JcOpEnriched): MachineSplit => o.machines ?? [];

// Blank for the ordinary never-re-routed op; "CNC-01 5 · CNC-02 5" for a split.
const machineSplitCell = (o: JcOpEnriched): string => {
  const split = machineSplit(o);
  if (split.length <= 1) return '';
  // "CNC-01: 5 pcs" — never "CNC-01 5", which reads as one blob in a cell.
  return split.map((m) => `${m.machineCode}: ${m.qty} pcs`).join(' · ');
};

// Per-log machine (0095): the machine stamped on THIS entry at log time, so it
// survives a later machine change on the operation. The live master code wins
// over the machine_code_text snapshot, which can drift from the master.
const logMachine = (l: OpLog): string => l.machineCode ?? l.machineCodeText ?? '';

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
    // The item code is kept CLEAN here — no `/REV` suffix — and the customer's
    // drawing revision gets its own row. This sheet is read in Excel, not looked
    // at as a picture of the screen: the code is the value people filter on and
    // VLOOKUP against the Items master, and writing "IN-IT-0007/B" into it would
    // break every one of those lookups. A separate cell keeps both usable, and
    // stays blank for a JW-sourced or standalone card that has no SO line behind
    // it (rather than printing a dash into a column someone will sort).
    ['Item Code', jc.itemCode],
    ['Drawing Rev', jc.itemRevision ?? ''],
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
    // Who actually made "Done", per machine (ADR-126). Blank unless the op ran
    // on more than one machine.
    'Machine Split',
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
      machineSplitCell(o),
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
  // One row per log entry, and since 0095 every entry carries its OWN machine —
  // so this sheet is the honest machine-wise production history: no aggregation,
  // no "current machine" label standing in for machines that did the work.
  const logCols = [
    'Date',
    'Shift',
    'Op #',
    'Operation',
    'Type',
    'Machine',
    'Qty',
    'Reject Qty',
    'Operator',
    'Remarks',
  ];
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
        logMachine(l),
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
