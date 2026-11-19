// ADR-310 — the Customer Master list's shared Export (copies the JWSO pilot).
//
// One sheet "Customer Master": the list's own columns as the user sees them.
// The Active chip is a component, so it exports its plain word.

import type { Client, ListClientsQuery } from '@innovic/shared';
import type { DataTableColumn, ListExportSpec } from '@/ui/data';
import { fetchClientsPage } from '../api';

function withClientExportValues(columns: DataTableColumn<Client>[]): DataTableColumn<Client>[] {
  return columns.map((c) =>
    c.id === 'is_active'
      ? { ...c, exportValue: (r: Client) => (r.isActive ? 'Active' : 'Inactive') }
      : c,
  );
}

export interface ClientExportArgs {
  columns: DataTableColumn<Client>[];
  tableKey: string;
  /** The SAME query the list sends (its limit / offset are replaced). */
  query: ListClientsQuery;
}

export function clientExportSpec(a: ClientExportArgs): ListExportSpec<Client> {
  const q = a.query;
  const words = [
    q.search ? `search "${q.search}"` : null,
    q.isActive === undefined ? null : q.isActive ? 'Active only' : 'Inactive only',
    q.sf ? 'column sort / filter applied' : null,
  ].filter((w): w is string => w !== null);
  return {
    fileName: 'Customer Master',
    tableKey: a.tableKey,
    columns: withClientExportValues(a.columns),
    rowKey: (r) => r.id,
    filterSummary: words.join(' · ') || undefined,
    fetchPage: async (limit, offset) => {
      const res = await fetchClientsPage({ ...q, limit, offset });
      return { items: res.clients, total: res.total };
    },
  };
}
