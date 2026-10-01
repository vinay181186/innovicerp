// Cell helpers shared by the classic DataTable renderer and the fit engine
// (ADR-199). Pure functions — no React state.

import { Children, isValidElement } from 'react';
import type { MouseEvent, ReactNode } from 'react';

import type { DataTableColumn, DataTableColumnKind } from './data-table-types';

/** Stop a click on an in-row control from also firing the row's `onRowClick`. */
export function stopRowClick(e: MouseEvent): void {
  e.stopPropagation();
}

/**
 * Semantic row-tint classes (ADR-199 Wave A). Return one of these from the
 * EXISTING `rowClassName` prop to wash a whole row in a soft status colour —
 * the CSS lives beside .row-selected in innovic-theme.css (ROW STATES). Example:
 *   rowClassName={(r) => r.overdue ? ROW_TINT.late : undefined}
 * Hover and selection always win over the tint.
 */
export const ROW_TINT = {
  late: 'row-late',
  done: 'row-done',
  pending: 'row-pending',
  cancelled: 'row-cancelled',
} as const;

export function cx(...parts: Array<string | false | undefined | null>): string | undefined {
  const out = parts.filter(Boolean).join(' ');
  return out.length > 0 ? out : undefined;
}

export function readField<T>(row: T, key: string): unknown {
  return (row as unknown as Record<string, unknown>)[key];
}

export function cellValue<T>(col: DataTableColumn<T>, row: T, index: number): ReactNode {
  if (col.render) return col.render(row, index);
  if (col.key === undefined) return null;
  const v = readField(row, col.key);
  if (v === null || v === undefined) return null;
  if (typeof v === 'string' || typeof v === 'number') return v;
  // React renders a boolean as nothing — say so, rather than printing "false".
  if (typeof v === 'boolean') return null;
  if (isValidElement(v)) return v;
  // A Date or a plain object handed in as a column value would throw "Objects
  // are not valid as a React child" and take the page down; show its text.
  return String(v);
}

export function cellTitle<T>(col: DataTableColumn<T>, row: T): string | undefined {
  if (col.title) return col.title(row);
  if (!col.ellipsis || col.key === undefined) return undefined;
  const v = readField(row, col.key);
  return typeof v === 'string' || typeof v === 'number' ? String(v) : undefined;
}

export function defaultRowKey<T>(row: T, index: number): string | number {
  const id = row !== null && typeof row === 'object' ? readField(row, 'id') : undefined;
  return typeof id === 'string' || typeof id === 'number' ? id : index;
}

/** The id the saved layout knows this column by: `id`, then `key`, then its slot. */
export function colId<T>(col: DataTableColumn<T>, index: number): string {
  return col.id ?? col.key ?? `col-${index}`;
}

/** The engine's column kind — explicit, else derived from align / ellipsis. */
export function colKind<T>(col: DataTableColumn<T>): DataTableColumnKind {
  if (col.kind) return col.kind;
  if (col.align === 'right') return 'num';
  if (col.ellipsis) return 'text';
  return 'code';
}

/** Plain text of a header node, for the Columns picker and the ▸ detail labels. */
export function nodeText(node: ReactNode): string {
  if (node === null || node === undefined || typeof node === 'boolean') return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map((n) => nodeText(n as ReactNode)).join('');
  if (isValidElement(node)) {
    const props = node.props as { children?: ReactNode };
    return Children.toArray(props.children)
      .map((n) => nodeText(n))
      .join('');
  }
  return '';
}

export function colLabel<T>(col: DataTableColumn<T>, index: number): string {
  const text = col.label ?? nodeText(col.header).trim();
  return text.length > 0 ? text : `Column ${index + 1}`;
}
