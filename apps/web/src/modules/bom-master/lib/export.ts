// ADR-310 — the BOM Master list's shared Export (copies the JWSO pilot).
//
// One sheet "BOM Master": the list's own columns as the user sees them. The
// Linked SO Lines cell draws "—" for none, so it exports the number.
// No Lines sheet: masters export their own rows only.

import type { BomMasterListItem, BomStatus, ListBomMastersQuery } from '@innovic/shared';
import { statusText } from '@/lib/status-text';
import type { DataTableColumn, ListExportSpec } from '@/ui/data';
import { fetchBomMastersPage } from '../api';

function withBomExportValues(
  columns: DataTableColumn<BomMasterListItem>[],
): DataTableColumn<BomMasterListItem>[] {
  return columns.map((c) => {
    if (c.id === 'linked_so_count') {
      return { ...c, exportValue: (b: BomMasterListItem) => b.linkedSoCount };
    }
    if (c.id === 'status') {
      return { ...c, exportValue: (b: BomMasterListItem) => statusText(b.status, 'bom') };
    }
    return c;
  });
}

export interface BomExportArgs {
  columns: DataTableColumn<BomMasterListItem>[];
  tableKey: string;
  search: string | undefined;
  status: BomStatus | undefined;
  sfParam: string | undefined;
}

export function bomExportSpec(a: BomExportArgs): ListExportSpec<BomMasterListItem> {
  const words = [
    a.search ? `search "${a.search}"` : null,
    a.status ? `BOM Status ${statusText(a.status, 'bom')}` : null,
    a.sfParam ? 'column sort / filter applied' : null,
  ].filter((w): w is string => w !== null);
  const base: Omit<ListBomMastersQuery, 'limit' | 'offset'> = {
    ...(a.search ? { search: a.search } : {}),
    ...(a.status ? { status: a.status } : {}),
    ...(a.sfParam ? { sf: a.sfParam } : {}),
  };
  return {
    fileName: 'BOM Master',
    tableKey: a.tableKey,
    columns: withBomExportValues(a.columns),
    rowKey: (b) => b.id,
    filterSummary: words.join(' · ') || undefined,
    fetchPage: (limit, offset) => fetchBomMastersPage({ ...base, limit, offset }),
  };
}
