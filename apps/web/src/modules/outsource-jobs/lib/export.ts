// ADR-310 — the Outsource Jobs list's shared Export (copies the JWSO pilot).
//
// One sheet "Outsource Jobs": the tab's own columns as the user sees them.
// Est. Rate is money (₹ text) — a plain number here, and left out for a
// no-price user. There is no Lines sheet: every row already is one OSP request.
// Rows come from the PR list's own fetcher with this tab's query.

import type { ListPurchaseRequestsQuery, PurchaseRequestListItem } from '@innovic/shared';
import { fetchPurchaseRequestsPage } from '@/modules/purchase-requests/api';
import type { DataTableColumn, ListExportSpec } from '@/ui/data';

export function withOspExportValues(
  columns: DataTableColumn<PurchaseRequestListItem>[],
): DataTableColumn<PurchaseRequestListItem>[] {
  return columns.map((c) =>
    c.id === 'est_rate'
      ? { ...c, exportValue: (pr) => (Number(pr.estCost) > 0 ? Number(pr.estCost) : null) }
      : c,
  );
}

export interface OspExportArgs {
  columns: DataTableColumn<PurchaseRequestListItem>[];
  tableKey: string;
  /** The tab's own query (OSP type, band, JC, search, sf). */
  query: ListPurchaseRequestsQuery;
  bandLabel: string | undefined;
  hideMoney: boolean;
}

export function ospExportSpec(a: OspExportArgs): ListExportSpec<PurchaseRequestListItem> {
  const q = a.query;
  const words = [
    q.search ? `search "${q.search}"` : null,
    a.bandLabel ? `Status ${a.bandLabel}` : null,
    q.sourceJcCode ? `JC No. ${q.sourceJcCode}` : null,
    q.sf ? 'column sort / filter applied' : null,
  ].filter((w): w is string => w !== null);
  return {
    fileName: 'Outsource Jobs',
    tableKey: a.tableKey,
    columns: a.columns,
    rowKey: (pr) => pr.id,
    hideMoney: a.hideMoney,
    moneyColumns: ['est_rate'],
    filterSummary: words.join(' · ') || undefined,
    fetchPage: (limit, offset) => fetchPurchaseRequestsPage({ ...q, limit, offset }),
  };
}
