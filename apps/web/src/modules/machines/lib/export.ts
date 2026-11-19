// ADR-310 — the Machine Master's shared Export, both tabs (copies the JWSO pilot).
//
// Machines tab: one sheet "Machine Master" with the list's own columns. The
// Hour Rate is money — a no-price user (or a page the server sent without
// prices) gets the file without it. Machine Group tab: one sheet "Machine
// Groups"; the Active chip and the "edit pending" tag export as plain words.

import type {
  ListMachineGroupsQuery,
  ListMachinesQuery,
  Machine,
  MachineGroup,
} from '@innovic/shared';
import type { DataTableColumn, ListExportSpec } from '@/ui/data';
import { fetchMachineGroupsPage, fetchMachinesPage } from '../api';

const joinWords = (w: (string | null)[]): string | undefined =>
  w.filter((x): x is string => x !== null).join(' · ') || undefined;

export interface MachineExportArgs {
  columns: DataTableColumn<Machine>[];
  tableKey: string;
  /** The SAME query the list sends (its limit / offset are replaced). */
  query: ListMachinesQuery;
  hideMoney: boolean;
}

export function machineExportSpec(a: MachineExportArgs): ListExportSpec<Machine> {
  const q = a.query;
  return {
    fileName: 'Machine Master',
    tableKey: a.tableKey,
    columns: a.columns.map((c) =>
      c.id === 'hour_rate' ? { ...c, exportValue: (m: Machine) => m.hourRate ?? null } : c,
    ),
    rowKey: (m) => m.id,
    hideMoney: a.hideMoney,
    moneyColumns: ['hour_rate'],
    filterSummary: joinWords([
      q.search ? `search "${q.search}"` : null,
      q.status ? `Machine Status ${q.status}` : null,
      q.sf ? 'column sort / filter applied' : null,
    ]),
    fetchPage: async (limit, offset) => {
      const res = await fetchMachinesPage({ ...q, limit, offset });
      return { items: res.machines, total: res.total };
    },
  };
}

export interface MachineGroupExportArgs {
  columns: DataTableColumn<MachineGroup>[];
  tableKey: string;
  /** The SAME query the tab sends (its limit / offset are replaced). */
  query: ListMachineGroupsQuery;
}

export function machineGroupExportSpec(a: MachineGroupExportArgs): ListExportSpec<MachineGroup> {
  const q = a.query;
  return {
    fileName: 'Machine Groups',
    tableKey: a.tableKey,
    columns: a.columns.map((c) => {
      if (c.id === 'is_active') {
        return { ...c, exportValue: (g: MachineGroup) => (g.isActive ? 'Active' : 'Inactive') };
      }
      if (c.id === 'description') {
        return { ...c, exportValue: (g: MachineGroup) => g.description || null };
      }
      return c;
    }),
    rowKey: (g) => g.id,
    filterSummary: joinWords([
      q.search ? `search "${q.search}"` : null,
      q.isActive === undefined ? null : q.isActive ? 'Active only' : 'Inactive only',
      q.sf ? 'column sort / filter applied' : null,
    ]),
    fetchPage: async (limit, offset) => {
      const res = await fetchMachineGroupsPage({ ...q, limit, offset });
      return { items: res.groups, total: res.total };
    },
  };
}
