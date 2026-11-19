// ADR-310 — the Item Master list's shared Export (copies the JWSO pilot).
//
// One sheet "Item Master": the list's own columns as the user sees them. The
// Thumbnail is a picture, so its cell is left blank. The list shows no rate
// or price, so there is no money column to drop.

import {
  ITEM_PROCUREMENT_TYPE_LABEL,
  ITEM_TYPE_RULES,
  type Item,
  type ListItemsQuery,
} from '@innovic/shared';
import type { DataTableColumn, ListExportSpec } from '@/ui/data';
import { fetchItemsList } from '../api';

function withItemExportValues(columns: DataTableColumn<Item>[]): DataTableColumn<Item>[] {
  return columns.map((c) => (c.id === 'thumbnail' ? { ...c, exportValue: () => null } : c));
}

export interface ItemExportArgs {
  columns: DataTableColumn<Item>[];
  tableKey: string;
  /** The SAME query the list sends (its limit / offset are replaced). */
  query: ListItemsQuery;
}

export function itemExportSpec(a: ItemExportArgs): ListExportSpec<Item> {
  const q = a.query;
  const words = [
    q.search ? `search "${q.search}"` : null,
    q.itemType ? `Item type ${ITEM_TYPE_RULES[q.itemType].label}` : null,
    q.procurementType ? `Source ${ITEM_PROCUREMENT_TYPE_LABEL[q.procurementType]}` : null,
    q.sf ? 'column sort / filter applied' : null,
  ].filter((w): w is string => w !== null);
  return {
    fileName: 'Item Master',
    tableKey: a.tableKey,
    columns: withItemExportValues(a.columns),
    rowKey: (r) => r.id,
    filterSummary: words.join(' · ') || undefined,
    fetchPage: (limit, offset) => fetchItemsList({ ...q, limit, offset }),
  };
}
