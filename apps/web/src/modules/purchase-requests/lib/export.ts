// ADR-310 — Purchase Requests' shared Export (copies the JWSO Master pilot).
// One sheet: a PR is one item, and the API has no PR lines endpoint.

import type { ListPurchaseRequestsQuery, PurchaseRequestListItem } from '@innovic/shared';
import type { DataTableColumn, ListExportSpec } from '@/ui/data';
import { fetchPurchaseRequestsPage } from '../api';
import { prOrderBalance } from './pr-balance';
import { PR_STATUS_LABELS } from './pr-labels';

/** exportValue for the PR columns whose shown text is a component or decorated. */
function withPrExportValues(
  columns: DataTableColumn<PurchaseRequestListItem>[],
  draftIds: Set<string> | undefined,
): DataTableColumn<PurchaseRequestListItem>[] {
  const values: Record<string, (pr: PurchaseRequestListItem) => string | number | null> = {
    // The cell prefixes "⚠ " when more is ordered than requested.
    pending: (pr) => prOrderBalance(pr).balance,
    pr_status: (pr) => (draftIds?.has(pr.id) ? 'Draft' : PR_STATUS_LABELS[pr.status]),
  };
  return columns.map((c) => {
    const fn = c.id ? values[c.id] : undefined;
    return fn ? { ...c, exportValue: fn } : c;
  });
}

export interface PrExportArgs {
  columns: DataTableColumn<PurchaseRequestListItem>[];
  draftIds: Set<string> | undefined;
  tableKey: string;
  search: string | undefined;
  status: ListPurchaseRequestsQuery['status'];
  sfParam: string | undefined;
  hideMoney: boolean;
}

export function prExportSpec(a: PrExportArgs): ListExportSpec<PurchaseRequestListItem> {
  const statusWord = a.status
    ? ((PR_STATUS_LABELS as Record<string, string>)[String(a.status)] ?? String(a.status))
    : null;
  const words = [
    a.search ? `search "${a.search}"` : null,
    statusWord ? `PR Status ${statusWord}` : null,
    a.sfParam ? 'column sort / filter applied' : null,
  ].filter((w): w is string => w !== null);
  return {
    fileName: 'Purchase Requests',
    tableKey: a.tableKey,
    columns: withPrExportValues(a.columns, a.draftIds),
    rowKey: (pr) => pr.id,
    hideMoney: a.hideMoney,
    filterSummary: words.join(' · ') || undefined,
    fetchPage: (limit, offset) =>
      fetchPurchaseRequestsPage({
        search: a.search,
        status: a.status,
        sf: a.sfParam,
        limit,
        offset,
      }),
  };
}
