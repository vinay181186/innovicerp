// ADR-310 — JW Invoices (Labour)'s shared Export (copy of the JWSO Master
// pilot, job-work-orders/lib/export-lines.ts).
//
// One sheet: the register's own columns as the user sees them. Each row is
// already one invoiced JWSO line, and the API has no per-line list endpoint,
// so there is no Lines sheet. The Invoice No. cell adds a ⚠ (Place of Supply
// unknown), so it gets a plain `exportValue`. No-price user: Taxable and
// Total are left out (Taxable is not flagged `money`, hence moneyColumns).

import type { JwInvoiceListItem } from '@innovic/shared';
import type { DataTableColumn, ListExportSpec } from '@/ui/data';
import { fetchJwInvoicesPage } from '../api';

const JW_INVOICE_MONEY_COLUMNS = ['taxable', 'total'];

/** exportValue for the JW invoice columns whose shown text is decorated. */
export function withJwInvoiceExportValues(
  columns: DataTableColumn<JwInvoiceListItem>[],
): DataTableColumn<JwInvoiceListItem>[] {
  return columns.map((c) =>
    c.id === 'invoice_code' ? { ...c, exportValue: (r: JwInvoiceListItem) => r.code } : c,
  );
}

export interface JwInvoiceExportArgs {
  columns: DataTableColumn<JwInvoiceListItem>[];
  tableKey: string;
  search: string | undefined;
  sfParam: string | undefined;
  hideMoney: boolean;
}

export function jwInvoiceExportSpec(a: JwInvoiceExportArgs): ListExportSpec<JwInvoiceListItem> {
  const words = [
    a.search ? `search "${a.search}"` : null,
    a.sfParam ? 'column sort / filter applied' : null,
  ].filter((w): w is string => w !== null);
  return {
    fileName: 'JW Invoices (Labour)',
    tableKey: a.tableKey,
    columns: a.columns,
    rowKey: (r) => r.id,
    hideMoney: a.hideMoney,
    moneyColumns: JW_INVOICE_MONEY_COLUMNS,
    filterSummary: words.join(' · ') || undefined,
    fetchPage: (limit, offset) =>
      fetchJwInvoicesPage({
        ...(a.search ? { search: a.search } : {}),
        ...(a.sfParam ? { sf: a.sfParam } : {}),
        limit,
        offset,
      }),
  };
}
