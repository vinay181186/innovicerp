// Job Queue Export (owner 23-11-2026): Planned Machine + Machine Name from the
// group heading, the ▸ detail facts always written, Actual Machine in words.
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/api', () => ({ ApiError: class {}, apiFetch: vi.fn() }));
vi.mock('@/lib/env', () => ({ env: {} }));
vi.mock('@/lib/supabase', () => ({ supabase: {} }));
vi.mock('@/lib/session', () => ({ useSession: vi.fn() }));

import type { JobQueueMachine, JobQueueRow } from '@innovic/shared';
import { buildMainSheet } from '@/ui/data/list-export';
import {
  JOB_QUEUE_HIDDEN_IDS,
  type JobQueueSheetRow,
  flattenQueue,
  jobQueueColumns,
} from '../components/job-queue-columns';
import { jobQueueExportSpec, withJobQueueExportValues } from './export';

const ROW: JobQueueRow = {
  jcOpId: '00000000-0000-4000-8000-000000000001',
  jcId: '00000000-0000-4000-8000-000000000002',
  jcCode: 'IN-JC-00012',
  jcDate: '2026-11-20',
  itemCode: 'SH-101',
  itemRevision: 'B',
  clientPoLineNo: '20',
  itemName: 'Shaft',
  soCode: 'SO-12',
  soInternalNo: null,
  createdAt: '2026-11-20T09:05:00Z',
  createdByName: 'Jinal Rao',
  soCustomer: 'Acme',
  opSeq: 1,
  operation: 'Turning',
  priority: 'High',
  dueDate: '2026-11-30',
  orderQty: 10,
  completed: 8,
  machines: [],
  available: 2,
  status: 'in_progress',
  isRunning: false,
  queuePosition: 1,
  queueIndex: 0,
};

const machine = (code: string, name: string | null, rows: JobQueueRow[]): JobQueueMachine => ({
  machineId: `00000000-0000-4000-8000-0000000000${code === 'VMC-1' ? '10' : '11'}`,
  machineCode: code,
  machineName: name,
  machineType: null,
  pendingHrs: 3,
  runningCount: 0,
  pendingCount: rows.length,
  rows,
});

function sheet(rows: JobQueueSheetRow[]) {
  const columns = withJobQueueExportValues(jobQueueColumns({ today: '2026-11-23', firstRowNo: 1 }));
  const spec = jobQueueExportSpec({
    columns,
    tableKey: 'job-queue',
    defaultHidden: JOB_QUEUE_HIDDEN_IDS,
    machineId: undefined,
    machineCode: undefined,
    blocked: true,
    search: undefined,
    orderCode: undefined,
  });
  return buildMainSheet(spec, rows, undefined);
}

describe('Job Queue Export', () => {
  const split = {
    ...ROW,
    jcOpId: '00000000-0000-4000-8000-000000000003',
    machines: [
      { machineCode: 'VMC-1', qty: 5 },
      { machineCode: 'VMC-2', qty: 3 },
    ],
  } as JobQueueRow;
  const rows = flattenQueue([
    machine('VMC-1', 'Haas VF-2', [ROW]),
    machine('VMC-2', null, [split]),
  ]);
  const s = sheet(rows);
  const col = (h: string): number => s.header.indexOf(h);

  it('writes the machine after the lead block and the ▸ detail facts', () => {
    expect(s.header).toEqual([
      'Sr No',
      'JC No.',
      'Created On',
      'SO No.',
      'POL',
      'Item Code',
      'Item Name',
      'Planned Machine',
      'Machine Name',
      'JC Date',
      'Queue No.',
      'Op',
      'Operation',
      'Available',
      'Op Status',
      'Due Date',
      'Customer',
      'Priority',
      'Order Qty',
      'Completed',
      'Actual Machine',
      'Created By',
    ]);
  });

  it('gives every row its own machine; a machine with no name is blank', () => {
    expect(s.rows.map((r) => r[col('Planned Machine')])).toEqual(['VMC-1', 'VMC-2']);
    expect(s.rows.map((r) => r[col('Machine Name')])).toEqual(['Haas VF-2', null]);
  });

  it('Actual Machine: the queued machine when nothing is split, else qty per machine', () => {
    expect(s.rows[0]?.[col('Actual Machine')]).toBe('VMC-1');
    expect(s.rows[1]?.[col('Actual Machine')]).toBe('VMC-1: 5 pcs · VMC-2: 3 pcs');
  });

  it('writes the detail facts as values', () => {
    expect(s.rows[0]?.[col('Customer')]).toBe('Acme');
    expect(s.rows[0]?.[col('Priority')]).toBe('High');
    expect(s.rows[0]?.[col('Order Qty')]).toBe(10);
    expect(s.rows[0]?.[col('Completed')]).toBe(8);
  });
});
