// ADR-310 — the Machine Loading Operations tab's shared Export.
//
// One sheet "Machine Loading": the Operations table's own columns as the user
// sees them, every op matching the machine pick, the search and the column
// Sort & Filter. JC No. is a link component and Op Status a badge, so both get
// their plain word; Available and Pending Hrs go out as plain numbers.

import type { MachineLoadOp, MachineLoadingQuery } from '@innovic/shared';
import type { DataTableColumn, ListExportSpec } from '@/ui/data';
import { OP_STATUS } from '@/modules/job-cards/lib/jc-op-labels';
import { fetchMachineLoading } from '../api';

const opStatusWord = (s: string): string => OP_STATUS[s]?.label ?? s.replaceAll('_', ' ');

export function withMachineLoadingExportValues(
  columns: DataTableColumn<MachineLoadOp>[],
): DataTableColumn<MachineLoadOp>[] {
  const values: Record<string, (op: MachineLoadOp) => string | number | null> = {
    jc_code: (op) => op.jobCardCode,
    available: (op) => op.available,
    pending_hrs: (op) => op.pendingHrs,
    op_status: (op) => opStatusWord(op.computedStatus),
  };
  return columns.map((c) => {
    const fn = c.id ? values[c.id] : undefined;
    return fn ? { ...c, exportValue: fn } : c;
  });
}

export interface MachineLoadingExportArgs {
  columns: DataTableColumn<MachineLoadOp>[];
  tableKey: string;
  machineId: string | undefined;
  machineCode: string | undefined;
  search: string | undefined;
  sfParam: string | undefined;
}

export function machineLoadingExportSpec(
  a: MachineLoadingExportArgs,
): ListExportSpec<MachineLoadOp> {
  const words = [
    a.machineCode ? `Machine ${a.machineCode}` : null,
    a.search ? `search "${a.search}"` : null,
    a.sfParam ? 'column sort / filter applied' : null,
  ].filter((w): w is string => w !== null);
  const base: MachineLoadingQuery = { machineId: a.machineId, search: a.search, sf: a.sfParam };
  return {
    fileName: 'Machine Loading',
    tableKey: a.tableKey,
    columns: withMachineLoadingExportValues(a.columns),
    rowKey: (op) => op.jcOpId,
    filterSummary: words.join(' · ') || undefined,
    fetchPage: async (limit, offset) => {
      const res = await fetchMachineLoading({ ...base, limit, offset });
      return { items: res.ops, total: res.total ?? res.ops.length };
    },
  };
}
