// ADR-310 — the Store Inventory and Reorder List shared Export (copies the
// JWSO pilot).
//
// Store Inventory: one sheet, every Item + Drawing Rev row matching the Stock
// filter, search and column sort / filter. The Item Code cell is a link
// component, so it gets the server's itemLabel. Neither list shows a rate or
// a stock value, so there is no money to hold back for a no-price user.
//
// Reorder List: every row matching the column sort / filter, narrowed by the
// box (which matches in the browser, as on screen). The Raise-PR tick, PR Qty
// and vendor picker are controls and stay out.

import type { ListStoreInventoryQuery, ReorderListRow, StoreInventoryRow } from '@innovic/shared';
import { matchesSearchTerm } from '@/components/shared/search-match';
import type { DataTableColumn, ListExportSpec } from '@/ui/data';
import { fetchReorderPage, fetchStoreInventoryPage } from '../api';

export function withStoreInventoryExportValues(
  columns: DataTableColumn<StoreInventoryRow>[],
): DataTableColumn<StoreInventoryRow>[] {
  return columns.map((c) =>
    c.id === 'item_code' ? { ...c, exportValue: (r: StoreInventoryRow) => r.itemLabel } : c,
  );
}

export interface StoreInventoryExportArgs {
  columns: DataTableColumn<StoreInventoryRow>[];
  tableKey: string;
  defaultHidden: string[];
  filter: ListStoreInventoryQuery['filter'];
  filterLabel: string | undefined;
  search: string | undefined;
  sfParam: string | undefined;
}

export function storeInventoryExportSpec(
  a: StoreInventoryExportArgs,
): ListExportSpec<StoreInventoryRow> {
  const words = [
    a.filterLabel ? `stock ${a.filterLabel}` : null,
    a.search ? `search "${a.search}"` : null,
    a.sfParam ? 'column sort / filter applied' : null,
  ].filter((w): w is string => w !== null);
  return {
    fileName: 'Store Inventory',
    tableKey: a.tableKey,
    columns: a.columns,
    defaultHidden: a.defaultHidden,
    rowKey: (r) => r.rowKey,
    filterSummary: words.join(' · ') || undefined,
    fetchPage: async (limit, offset) => {
      const res = await fetchStoreInventoryPage({
        filter: a.filter,
        ...(a.search ? { search: a.search } : {}),
        ...(a.sfParam ? { sf: a.sfParam } : {}),
        limit,
        offset,
      });
      return { items: res.rows, total: res.total };
    },
  };
}

/** The Reorder List box's match — the list and its Export share it. */
export function reorderRowMatches(r: ReorderListRow, term: string): boolean {
  return matchesSearchTerm(
    [
      r.itemCode,
      r.itemName,
      r.uom,
      r.itemType,
      r.suggestedVendor?.code,
      r.suggestedVendor?.name,
      ...r.openPrs.map((p) => p.code),
    ],
    term,
  );
}

export function withReorderExportValues(
  columns: DataTableColumn<ReorderListRow>[],
): DataTableColumn<ReorderListRow>[] {
  return columns.map((c) => {
    if (c.id === 'item_code') return { ...c, exportValue: (r: ReorderListRow) => r.itemCode };
    if (c.id === 'open_pr')
      return {
        ...c,
        exportValue: (r: ReorderListRow) => r.openPrs.map((p) => p.code).join(', ') || '—',
      };
    return c;
  });
}

/** Every Reorder List row (column sort / filter on the server, the box in the
 *  browser — the server has no search here), then handed out page by page. */
export function reorderExportSpec(a: {
  columns: DataTableColumn<ReorderListRow>[];
  tableKey: string;
  sfParam: string | undefined;
  term: string;
}): ListExportSpec<ReorderListRow> {
  let all: Promise<ReorderListRow[]> | null = null;
  const loadAll = async (): Promise<ReorderListRow[]> => {
    const out: ReorderListRow[] = [];
    for (let offset = 0; ; offset += 200) {
      const res = await fetchReorderPage({ sf: a.sfParam, limit: 200, offset });
      out.push(...res.items);
      if (res.items.length < 200 || out.length >= res.total) break;
    }
    return a.term ? out.filter((r) => reorderRowMatches(r, a.term)) : out;
  };
  const words = [
    a.term ? `search "${a.term}"` : null,
    a.sfParam ? 'column sort / filter applied' : null,
  ].filter((w): w is string => w !== null);
  return {
    fileName: 'Reorder List',
    tableKey: a.tableKey,
    columns: a.columns,
    rowKey: (r) => r.itemId,
    filterSummary: words.join(' · ') || undefined,
    fetchPage: async (limit, offset) => {
      // A fresh read on every export (page 0), reused only within that export.
      if (offset === 0 || !all) all = loadAll();
      const rows = await all;
      return { items: rows.slice(offset, offset + limit), total: rows.length };
    },
  };
}
