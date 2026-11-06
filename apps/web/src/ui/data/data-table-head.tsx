// Header + cell class helpers shared by the classic DataTable, the fit engine
// and its hidden measuring table (ADR-199) — one place, so the measured cell
// and the drawn cell can never disagree about classes or content.

import type { CSSProperties, ReactNode } from 'react';

import { columnAlign, type ColumnAlign } from '@innovic/shared';

import { colKind, cx, nodeText } from './data-table-cells';
import type { DataTableColumn } from './data-table-types';
import { SortHeader, ariaSortValue, type SortDir } from './SortHeader';

export interface SortProps {
  sortBy?: string | undefined;
  sortDir?: SortDir | undefined;
  onSort?: ((field: string) => void) | undefined;
}

/** THE alignment rule (ADR-277): the column's kind and heading decide, never the
 *  screen. */
function alignOf<T>(c: DataTableColumn<T>): ColumnAlign {
  const kind = colKind(c);
  return columnAlign({
    heading: c.label ?? nodeText(c.header),
    numeric: kind === 'num',
    money: c.money === true,
    fixed: kind === 'date' || kind === 'badge' || kind === 'actions' || kind === 'control',
  });
}

const ALIGN_SUFFIX: Record<ColumnAlign, string> = { left: 'left', center: 'ctr', right: 'money' };

export function thClass<T>(c: DataTableColumn<T>, extra?: string): string | undefined {
  return cx(`th-${ALIGN_SUFFIX[alignOf(c)]}`, c.headClassName, extra);
}

export function tdClass<T>(c: DataTableColumn<T>, extra?: string): string | undefined {
  return cx(c.className, `td-${ALIGN_SUFFIX[alignOf(c)]}`, extra);
}

export function thStyle<T>(c: DataTableColumn<T>): CSSProperties | undefined {
  return c.headColor === undefined ? undefined : { color: c.headColor };
}

export function thAriaSort<T>(c: DataTableColumn<T>, s: SortProps) {
  const field = c.sortField;
  if (s.onSort === undefined || field === undefined) return undefined;
  return ariaSortValue(s.sortBy === field, s.sortDir);
}

/** The header cell's content — a SortHeader button when the column sorts. */
export function headContent<T>(c: DataTableColumn<T>, s: SortProps): ReactNode {
  const field = c.sortField;
  const onSort = s.onSort;
  if (onSort === undefined || field === undefined) return c.header;
  return (
    <SortHeader
      label={c.header}
      active={s.sortBy === field}
      dir={s.sortDir ?? 'asc'}
      onSort={() => onSort(field)}
    />
  );
}
