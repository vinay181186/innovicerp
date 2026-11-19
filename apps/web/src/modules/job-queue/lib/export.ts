// ADR-310 — the Job Queue list's shared Export (copies the JWSO pilot).
//
// One sheet "Job Queue": the list's own columns as the user sees them, the
// page's machine buckets flattened exactly as the table does. JC No. (a link),
// Queue No. / Available (coloured), Op Status / Priority badges and Due Date
// (red + ⚠) are components, so they get their plain values.

import type { JobQueueQuery } from '@innovic/shared';
import { fmtDate } from '@/lib/date';
import { OP_STATUS } from '@/modules/job-cards/lib/jc-op-labels';
import type { DataTableColumn, ListExportSpec } from '@/ui/data';
import { fetchJobQueuePage } from '../api';
import { type JobQueueSheetRow, flattenQueue } from '../components/job-queue-columns';

const opStatusWord = (s: string): string =>
  OP_STATUS[s.toLowerCase()]?.label ?? s.replace(/_/g, ' ');

const EXPORT_VALUE: Record<string, (r: JobQueueSheetRow) => string | number | null> = {
  jc_no: (r) => r.jcCode,
  queue_no: (r) => r.queuePos + 1,
  available: (r) => r.available,
  op_status: (r) => opStatusWord(r.isRunning ? 'running' : r.status),
  due_date: (r) => fmtDate(r.dueDate ?? null, ''),
  priority: (r) => (r.priority === 'High' ? 'High' : 'Normal'),
};

export function withJobQueueExportValues(
  columns: DataTableColumn<JobQueueSheetRow>[],
): DataTableColumn<JobQueueSheetRow>[] {
  return columns.map((c) => {
    const ev = c.id ? EXPORT_VALUE[c.id] : undefined;
    return ev ? { ...c, exportValue: ev } : c;
  });
}

export interface JobQueueExportArgs {
  columns: DataTableColumn<JobQueueSheetRow>[];
  tableKey: string;
  defaultHidden?: string[] | undefined;
  /** The picked machine's id + code; while its id is still unknown the list
   *  shows nothing, so `blocked` exports nothing too. */
  machineId: string | undefined;
  machineCode: string | undefined;
  blocked: boolean;
  search: string | undefined;
  orderCode: string | undefined;
}

export function jobQueueExportSpec(a: JobQueueExportArgs): ListExportSpec<JobQueueSheetRow> {
  const words = [
    a.machineCode ? `Machine: ${a.machineCode}` : null,
    a.orderCode ? `Order: ${a.orderCode}` : null,
    a.search ? `search "${a.search}"` : null,
  ].filter((w): w is string => w !== null);
  const base: Omit<JobQueueQuery, 'limit' | 'offset'> = {
    machineId: a.machineId,
    search: a.search,
    orderCode: a.orderCode,
  };
  return {
    fileName: 'Job Queue',
    tableKey: a.tableKey,
    columns: a.columns,
    defaultHidden: a.defaultHidden,
    rowKey: (r) => `${r.queueMachine.machineId}:${r.jcOpId}`,
    filterSummary: words.join(' · ') || undefined,
    ...(a.blocked
      ? { rows: [] }
      : {
          fetchPage: async (limit: number, offset: number) => {
            const res = await fetchJobQueuePage({ ...base, limit, offset });
            const machines = a.machineCode
              ? res.machines.filter((m) => m.machineCode === a.machineCode)
              : res.machines;
            const items = flattenQueue(machines);
            return { items, total: res.total ?? items.length };
          },
        }),
  };
}
