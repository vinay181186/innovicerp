// ADR-310 — the Raw Material Master's shared Export (copies the JWSO pilot).
//
// One sheet per tab ("Raw Material Master - Grade" / "… - Size"): the tab's
// own columns as the user sees them. The name cell carries an "edit pending"
// chip, so it exports the bare name; Active already words itself through its
// filterValue. No money on this master. Each tab hands the panel a fetcher
// built from the SAME query its list hook sends.

import type { ListMaterialGradesQuery, ListMaterialSizesQuery } from '@innovic/shared';
import type { DataTableColumn, ListExportSpec } from '@/ui/data';
import { fetchMaterialGradesPage, fetchMaterialSizesPage } from '../api';
import type { MaterialMasterRow } from '../components/material-master-panel';

export type MaterialExportFetcher = NonNullable<ListExportSpec<MaterialMasterRow>['fetchPage']>;

/** Grade tab: every grade matching the screen's search / Active / ▾. */
export function gradeExportPage(q: ListMaterialGradesQuery): MaterialExportFetcher {
  return async (limit, offset) => {
    const r = await fetchMaterialGradesPage({ ...q, limit, offset });
    return { items: r.grades, total: r.total };
  };
}

/** Size tab: every size matching the screen's search / Active / ▾. */
export function sizeExportPage(q: ListMaterialSizesQuery): MaterialExportFetcher {
  return async (limit, offset) => {
    const r = await fetchMaterialSizesPage({ ...q, limit, offset });
    return { items: r.sizes, total: r.total };
  };
}

export interface MaterialExportArgs {
  noun: string;
  columns: DataTableColumn<MaterialMasterRow>[];
  tableKey: string;
  search: string;
  status: string;
  sfParam: string | undefined;
  fetchPage: MaterialExportFetcher;
}

export function materialExportSpec(a: MaterialExportArgs): ListExportSpec<MaterialMasterRow> {
  const words = [
    a.search ? `search "${a.search}"` : null,
    a.status === 'all' ? null : a.status === 'inactive' ? 'Inactive only' : 'Active only',
    a.sfParam ? 'column sort / filter applied' : null,
  ].filter((w): w is string => w !== null);
  return {
    fileName: `Raw Material Master - ${a.noun}`,
    tableKey: a.tableKey,
    columns: a.columns.map((c) =>
      c.id === 'name' ? { ...c, exportValue: (row: MaterialMasterRow) => row.name } : c,
    ),
    rowKey: (r) => r.id,
    filterSummary: words.join(' · ') || undefined,
    fetchPage: a.fetchPage,
  };
}
