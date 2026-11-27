// SO / JWSO status by day (ADR-325) — the table columns. The 11 figure columns
// are built once here and used by the days list and both day tables.

import {
  type OrderStatusFigures,
  type OrderStatusRow,
  ORDER_STATUS_FIGURE_KEYS,
  ORDER_STATUS_FIGURE_LABELS,
} from '@innovic/shared';
import { fmtDate } from '@/lib/date';
import { fmtQty } from '@/lib/qty-format';
import { type DataTableColumn, srNoColumn } from '@/ui/data';
import { type DayRow, dayNote, figureText, figureValue, sumFigure } from '../lib/days';

/** The 11 figures, in contract order. `withTotals` adds each column's sum. */
export function figureColumns<T>(
  get: (r: T) => OrderStatusFigures | null,
  withTotals = false,
): DataTableColumn<T>[] {
  return ORDER_STATUS_FIGURE_KEYS.map((k) => ({
    id: k,
    header: ORDER_STATUS_FIGURE_LABELS[k],
    kind: 'num' as const,
    nowrap: true,
    render: (r: T) => figureText(get(r), k),
    filterValue: (r: T) => figureValue(get(r), k),
    exportValue: (r: T) => figureValue(get(r), k),
    total: withTotals ? (rows: T[]) => fmtQty(sumFigure(rows, get, k)) : undefined,
  }));
}

/** Days list: Date | Type | Orders | 11 figures. The SO row's Date opens the
 *  day; the JWSO row's Date cell is the weekday and where the figures came from. */
export function daysColumns(): DataTableColumn<DayRow>[] {
  return [
    {
      id: 'date',
      header: 'Date',
      kind: 'date',
      nowrap: true,
      opensRow: true,
      render: (r) =>
        r.kind === 'SO' ? fmtDate(r.date) : <span className="sjs-note">{dayNote(r.day)}</span>,
      title: (r) => (r.kind === 'SO' ? `Open ${fmtDate(r.date)}` : dayNote(r.day)),
    },
    { id: 'type', header: 'Type', kind: 'code', nowrap: true, render: (r) => r.kind },
    {
      id: 'orders',
      header: 'Orders',
      kind: 'num',
      nowrap: true,
      render: (r) => (r.summary ? fmtQty(r.summary.orders) : '—'),
    },
    ...figureColumns<DayRow>((r) => r.summary),
  ];
}

/** One day's table: Sr No | SO No. (or JWSO No.) | 11 figures, with a Total row. */
export function orderColumns(noHead: 'SO No.' | 'JWSO No.'): DataTableColumn<OrderStatusRow>[] {
  return [
    srNoColumn<OrderStatusRow>(1),
    {
      id: 'order_code',
      header: noHead,
      key: 'orderCode',
      kind: 'code',
      nowrap: true,
      opensRow: true,
    },
    ...figureColumns<OrderStatusRow>((r) => r, true),
  ];
}
