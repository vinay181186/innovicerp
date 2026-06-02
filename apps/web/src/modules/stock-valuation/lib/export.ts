// Client-side Excel export for Stock Valuation (legacy _svExportExcel L21065).
// Detail + category-summary sheets, items with stock only.

import type { StockValuationRow } from '@innovic/shared';
import * as XLSX from 'xlsx';

export function exportStockValuation(rows: StockValuationRow[]): void {
  const detail = rows
    .filter((r) => r.stockQty > 0)
    .map((r) => ({
      Category: r.category,
      'Item Code': r.code,
      'Item Name': r.name,
      UOM: r.uom,
      'Stock Qty': r.stockQty,
      Rate: r.rate,
      'Stock Value': r.value,
      'Last GRN Date': r.lastGrnDate ?? '',
    }));
  const catMap = new Map<string, { Category: string; Items: number; 'Total Value': number }>();
  for (const r of detail) {
    const c = catMap.get(r.Category) ?? { Category: r.Category, Items: 0, 'Total Value': 0 };
    c.Items += 1;
    c['Total Value'] += r['Stock Value'];
    catMap.set(r.Category, c);
  }
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(detail), 'Stock Detail');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet([...catMap.values()]), 'Category Summary');
  XLSX.writeFile(wb, `stock-valuation-${new Date().toISOString().slice(0, 10)}.xlsx`);
}
