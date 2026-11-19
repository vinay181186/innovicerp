// ADR-310 — the Cost Centre Master list's shared Export (copies the JWSO pilot).
//
// One sheet "Cost Centre Master": the list's own columns as the user sees
// them. The Active chip is a component, so it exports its plain word. The
// list shows no rate or price, so there is no money column to drop.

import type { CostCenter, ListCostCentersQuery } from '@innovic/shared';
import type { DataTableColumn, ListExportSpec } from '@/ui/data';
import { fetchCostCentersPage } from '../api';

function withCcExportValues(columns: DataTableColumn<CostCenter>[]): DataTableColumn<CostCenter>[] {
  return columns.map((c) =>
    c.id === 'is_active'
      ? { ...c, exportValue: (r: CostCenter) => (r.isActive ? 'Active' : 'Inactive') }
      : c,
  );
}

export interface CcExportArgs {
  columns: DataTableColumn<CostCenter>[];
  tableKey: string;
  /** The SAME query the list sends (its limit / offset are replaced). */
  query: ListCostCentersQuery;
}

export function ccExportSpec(a: CcExportArgs): ListExportSpec<CostCenter> {
  const q = a.query;
  const words = [
    q.search ? `search "${q.search}"` : null,
    q.isActive === undefined ? null : q.isActive ? 'Active only' : 'Inactive only',
    q.department ? `Department ${q.department}` : null,
    q.type ? `Cost Centre Type ${q.type}` : null,
    q.sf ? 'column sort / filter applied' : null,
  ].filter((w): w is string => w !== null);
  return {
    fileName: 'Cost Centre Master',
    tableKey: a.tableKey,
    columns: withCcExportValues(a.columns),
    rowKey: (r) => r.id,
    filterSummary: words.join(' · ') || undefined,
    fetchPage: (limit, offset) => fetchCostCentersPage({ ...q, limit, offset }),
  };
}
