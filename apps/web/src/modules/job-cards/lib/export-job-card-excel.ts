// Job Card → Excel export. Unlike the print document (no log), the Excel file
// carries the full data INCLUDING the production log, across three sheets:
// "Job Card" (header), "Operations" (routing + live qty/QC), "Production Log".
// Uses the SheetJS dep already in the app (see items/lib/import-export.ts).

import type { JcOpEnriched, JobCardListItem, MachineSplit, OpLog } from '@innovic/shared';
import { opSrNo } from '@innovic/shared';
import * as XLSX from 'xlsx';
import { resolveActualMachine } from '@/components/shared/machine-split';
import { itemCodeWithRev } from '@/lib/item-code';

// The op's PLANNED machine — where the REMAINING qty runs, not who made the
// completed qty (ADR-126). See actualMachine / machineSplitCell for the rest.
const machine = (o: JcOpEnriched): string =>
  o.opType === 'qc'
    ? 'QC'
    : o.opType === 'outsource'
      ? 'Outsource'
      : (o.machineCode ?? o.machineCodeText ?? '');

// The op's ACTUAL machine (ADR-164): the open session's machine, else the
// machine(s) that made the done qty, else the plan itself. Same name as the
// planned column when nothing changed. Blank for QC / OSP ops (no machine).
const actualMachine = (o: JcOpEnriched): string =>
  o.opType !== 'process'
    ? ''
    : resolveActualMachine({
        planned: o.machineCode ?? o.machineCodeText,
        activeRunningMachineCode: o.activeRunningMachineCode,
        machines: o.machines,
      }).label;

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
    // The item code is written `CODE/REV` here, the same way it reads on every
    // screen and print for a row that traces back to a Sales Order line (user
    // rule 2026-09-23) — a job card is always made against one order's drawing,
    // so the code must never appear without that revision.
    // The separate "Drawing Rev" row below STAYS: this sheet is read in Excel,
    // and keeping the bare revision in its own cell leaves it sortable and
    // filterable. It stays blank for a JW-sourced or standalone card that has
    // no SO line behind it, and `itemCodeWithRev` then leaves the code bare
    // rather than printing a trailing slash.
    ['Item Code', itemCodeWithRev(jc.itemCode, jc.itemRevision)],
    ['Drawing Rev', jc.itemRevision ?? ''],
    ['Item Name', jc.itemName || ''],
    ['SO / WO', jc.sourceLink?.code ?? ''],
    ['SO / WO Line', jc.sourceLink?.lineNo ?? ''],
    ['POL', jc.clientPoLineNo ?? ''],
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
    'Op Sr No',
    'Machine',
    // The machine the pieces were / are being made on (ADR-164); equals
    // "Machine" (the plan) unless the operator ran the op elsewhere.
    'Actual Machine',
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
      opSrNo(o.opSeq), // display rule, see opSrNo
      machine(o),
      actualMachine(o),
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
    'Op Sr No',
    'Operation',
    'Type',
    'Machine',
    // The op's PLANNED machine beside the one this entry was actually made on
    // (ADR-164). Same name unless the op was run elsewhere.
    'Planned Machine',
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
        op ? opSrNo(op.opSeq) : '',
        op?.operation ?? '',
        l.logType,
        logMachine(l),
        l.plannedMachineCode ?? '',
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
