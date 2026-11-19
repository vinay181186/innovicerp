// ADR-310 — the Route Card Master's shared Export (copies the JWSO pilot).
//
// One sheet "Route Card Master": the list's own columns as the user sees
// them. The RC Status chip is a component, so it gets its plain word. No
// Lines sheet (the operations live on the card, not on this list's API).

import {
  ROUTE_CARD_APPROVAL_LABEL,
  type ListRouteCardsQuery,
  type RouteCardListItem,
} from '@innovic/shared';
import type { DataTableColumn, ListExportSpec } from '@/ui/data';
import { fetchRouteCardsPage } from '../api';

export function withRouteCardExportValues(
  columns: DataTableColumn<RouteCardListItem>[],
): DataTableColumn<RouteCardListItem>[] {
  return columns.map((c) =>
    c.id === 'approval_status'
      ? { ...c, exportValue: (rc) => ROUTE_CARD_APPROVAL_LABEL[rc.approvalStatus] }
      : c,
  );
}

export interface RouteCardExportArgs {
  columns: DataTableColumn<RouteCardListItem>[];
  tableKey: string;
  search: string | undefined;
  sfParam: string | undefined;
}

export function routeCardExportSpec(a: RouteCardExportArgs): ListExportSpec<RouteCardListItem> {
  const words = [
    a.search ? `search "${a.search}"` : null,
    a.sfParam ? 'column sort / filter applied' : null,
  ].filter((w): w is string => w !== null);
  const base: Omit<ListRouteCardsQuery, 'limit' | 'offset'> = {
    ...(a.search ? { search: a.search } : {}),
    ...(a.sfParam ? { sf: a.sfParam } : {}),
  };
  return {
    fileName: 'Route Card Master',
    tableKey: a.tableKey,
    columns: a.columns,
    rowKey: (r) => r.id,
    filterSummary: words.join(' · ') || undefined,
    fetchPage: (limit, offset) => fetchRouteCardsPage({ ...base, limit, offset }),
  };
}
