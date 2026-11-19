// ADR-310 — the SO Overview list's shared Export (copies the JWSO pilot).
//
// One sheet "SO Overview": the list's own columns as the user sees them, every
// SO matching the search, SO Status, Overall Status and column sort / filter.
// Progress (a bar) and Alerts (icon flags) are components, so they get plain
// words. No money on this list.

import type { SoOverviewQuery, SoOverviewRow } from '@innovic/shared';
import type { DataTableColumn, ListExportSpec } from '@/ui/data';
import { fetchSoOverviewPage } from '../api';

function alertsText(r: SoOverviewRow): string {
  const out = [
    r.alerts.delayedLines > 0 ? `${r.alerts.delayedLines} lines past due` : null,
    r.alerts.atVendorQty > 0 ? `${r.alerts.atVendorQty} qty at vendor` : null,
    r.alerts.qcPendingOps > 0 ? `${r.alerts.qcPendingOps} ops awaiting QC` : null,
    r.stageCounts.hold > 0 ? `${r.stageCounts.hold} lines blocked` : null,
  ].filter((w): w is string => w !== null);
  return out.join(', ') || '—';
}

export function withSoOverviewExportValues(
  columns: DataTableColumn<SoOverviewRow>[],
): DataTableColumn<SoOverviewRow>[] {
  return columns.map((c) => {
    if (c.id === 'progress') return { ...c, exportValue: (r: SoOverviewRow) => `${r.overallPct}%` };
    if (c.id === 'alerts') return { ...c, exportValue: alertsText };
    return c;
  });
}

export interface SoOverviewExportArgs {
  columns: DataTableColumn<SoOverviewRow>[];
  tableKey: string;
  defaultHidden: string[];
  query: Omit<SoOverviewQuery, 'limit' | 'offset'>;
}

export function soOverviewExportSpec(a: SoOverviewExportArgs): ListExportSpec<SoOverviewRow> {
  const q = a.query;
  const words = [
    q.status ? `SO status ${q.status}` : null,
    q.overall ? `overall ${q.overall}` : null,
    q.search ? `search "${q.search}"` : null,
    q.sf ? 'column sort / filter applied' : null,
  ].filter((w): w is string => w !== null);
  return {
    fileName: 'SO Overview',
    tableKey: a.tableKey,
    columns: a.columns,
    defaultHidden: a.defaultHidden,
    rowKey: (r) => r.id,
    filterSummary: words.join(' · ') || undefined,
    fetchPage: async (limit, offset) => {
      const res = await fetchSoOverviewPage({ ...q, limit, offset });
      return { items: res.rows, total: res.total };
    },
  };
}
