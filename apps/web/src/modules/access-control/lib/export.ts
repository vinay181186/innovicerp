// ADR-310 — the Access Control list's shared Export (copies the JWSO pilot).
//
// One sheet "Access Control": the list's own columns as the admin sees them.
// Departments / Extras draw ✅ and badge chips, so they get plain words.

import type { ListUserAccessQuery, UserAccessListItem } from '@innovic/shared';
import type { DataTableColumn, ListExportSpec } from '@/ui/data';
import { fetchUserAccessPage } from '../api';

function extrasText(u: UserAccessListItem): string {
  const words = [u.fullAccess ? 'All' : `${u.formCount}/${u.totalForms}`];
  if (u.fullAccess || u.drawingDownload) words.push('Drawings');
  if (u.fullAccess || u.drawingPrint) words.push('Drawing print');
  return words.join(' · ');
}

function withAccessExportValues(
  columns: DataTableColumn<UserAccessListItem>[],
): DataTableColumn<UserAccessListItem>[] {
  return columns.map((c) => {
    if (c.id === 'departments') {
      return {
        ...c,
        exportValue: (u: UserAccessListItem) =>
          u.fullAccess || u.auditor ? 'All' : `${u.deptCount}/${u.totalDepts}`,
      };
    }
    if (c.id === 'extras') return { ...c, exportValue: extrasText };
    return c;
  });
}

export interface AccessExportArgs {
  columns: DataTableColumn<UserAccessListItem>[];
  tableKey: string;
  search: string | undefined;
  sfParam: string | undefined;
}

export function accessExportSpec(a: AccessExportArgs): ListExportSpec<UserAccessListItem> {
  const words = [
    a.search ? `search "${a.search}"` : null,
    a.sfParam ? 'column sort / filter applied' : null,
  ].filter((w): w is string => w !== null);
  const base: Omit<ListUserAccessQuery, 'limit' | 'offset'> = {
    ...(a.search ? { search: a.search } : {}),
    ...(a.sfParam ? { sf: a.sfParam } : {}),
  };
  return {
    fileName: 'Access Control',
    tableKey: a.tableKey,
    columns: withAccessExportValues(a.columns),
    defaultHidden: ['enforcement_warning'],
    rowKey: (u) => u.userId,
    filterSummary: words.join(' · ') || undefined,
    fetchPage: (limit, offset) => fetchUserAccessPage({ ...base, limit, offset }),
  };
}
