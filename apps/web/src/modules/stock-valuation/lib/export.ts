// Client-side Excel export for Stock Valuation (legacy _svExportExcel L21065).
// Detail + category-summary sheets, items with stock only.

import type { StockValuationRow } from '@innovic/shared';
import * as XLSX from 'xlsx';
import { todayIst } from '@/lib/date';

/** Screen word for a stored category code (`component` → `Component`). */
export function categoryLabel(c: string): string {
  return c ? c.charAt(0).toUpperCase() + c.slice(1).replace(/_/g, ' ') : '—';
}

export function exportStockValuation(rows: StockValuationRow[]): void {
  // Money hidden for L1 Viewers: the API nulls rate/value, so the exported
  // sheet drops the Rate + Stock Value columns and the Category Summary sheet.
  const priceHidden = rows.some((r) => r.value == null);
  const withStock = rows.filter((r) => r.stockQty > 0);
  const detail = withStock.map((r) => ({
    Category: categoryLabel(r.category),
    'Item Code': r.code,
    'Item Name': r.name,
    UOM: r.uom,
    Physical: r.stockQty,
    ...(priceHidden ? {} : { Rate: r.rate ?? 0, 'Stock Value': r.value ?? 0 }),
    'Last GRN Date': r.lastGrnDate ?? '',
  }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(detail), 'Stock Detail');
  if (!priceHidden) {
    const catMap = new Map<string, { Category: string; Items: number; 'Total Value': number }>();
    for (const r of withStock) {
      const c = catMap.get(r.category) ?? {
        Category: categoryLabel(r.category),
        Items: 0,
        'Total Value': 0,
      };
      c.Items += 1;
      c['Total Value'] += r.value ?? 0;
      catMap.set(r.category, c);
    }
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet([...catMap.values()]), 'Category Summary');
  }
  XLSX.writeFile(wb, `stock-valuation-${todayIst()}.xlsx`);
}
