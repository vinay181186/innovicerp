// ADR-310 — the Operator Master list's shared Export (copies the JWSO pilot).
//
// One sheet "Operator Master": the list's own columns as the user sees them.
// The Active chip is a component, so it exports its plain word.

import type { ListOperatorsQuery, Operator } from '@innovic/shared';
import type { DataTableColumn, ListExportSpec } from '@/ui/data';
import { fetchOperatorsPage } from '../api';

function withOperatorExportValues(
  columns: DataTableColumn<Operator>[],
): DataTableColumn<Operator>[] {
  return columns.map((c) =>
    c.id === 'is_active'
      ? { ...c, exportValue: (r: Operator) => (r.isActive ? 'Active' : 'Inactive') }
      : c,
  );
}

export interface OperatorExportArgs {
  columns: DataTableColumn<Operator>[];
  tableKey: string;
  /** The SAME query the list sends (its limit / offset are replaced). */
  query: ListOperatorsQuery;
}

export function operatorExportSpec(a: OperatorExportArgs): ListExportSpec<Operator> {
  const q = a.query;
  const words = [
    q.search ? `search "${q.search}"` : null,
    q.isActive === undefined ? null : q.isActive ? 'Active only' : 'Inactive only',
    q.sf ? 'column sort / filter applied' : null,
  ].filter((w): w is string => w !== null);
  return {
    fileName: 'Operator Master',
    tableKey: a.tableKey,
    columns: withOperatorExportValues(a.columns),
    rowKey: (r) => r.id,
    filterSummary: words.join(' · ') || undefined,
    fetchPage: async (limit, offset) => {
      const res = await fetchOperatorsPage({ ...q, limit, offset });
      return { items: res.operators, total: res.total };
    },
  };
}
