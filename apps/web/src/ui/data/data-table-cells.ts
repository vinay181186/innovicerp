// Cell helpers shared by the classic DataTable renderer and the fit engine
// (ADR-199). Pure functions — no React state.

import { Children, createElement, isValidElement } from 'react';
import type { HTMLAttributes, KeyboardEvent, MouseEvent, ReactNode } from 'react';

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
  approved: 'row-approved',
  /** Day Log: a working day with no entry (orange). */
  notEntered: 'row-not-entered',
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

/** Plain text of a header node, for the Columns picker. */
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

/** ADR-296 — the column whose cell opens the row: the one marked `opensRow`,
 *  else the first code / text column after Sr No (the own No., or a master's
 *  Code). -1 when the table has none: the caller then falls back to the
 *  whole-row click, so no list is ever left with rows that cannot open. */
export function openerIndex<T>(cols: readonly (DataTableColumn<T> | undefined)[]): number {
  const marked = cols.findIndex((c) => c?.opensRow === true);
  if (marked >= 0) return marked;
  return cols.findIndex((c, i) => {
    if (!c || c.stopRowClick || isSrNo(c, i)) return false;
    const k = colKind(c);
    return k === 'code' || k === 'text';
  });
}

/** The row counter, whatever a screen called its id (`sr_no`, `srNo`). */
function isSrNo<T>(c: DataTableColumn<T>, i: number): boolean {
  const id = colId(c, i).toLowerCase().replace(/_/g, '');
  return id === 'srno' || c.label === 'Sr No' || c.header === 'Sr No';
}

/** The opener cell's content (ADR-296): the number itself is the link — blue,
 *  bold, no underline, hand cursor on the number only; Tab reaches it, Enter
 *  opens it. A cell that already renders its own link keeps it, and an empty
 *  cell ("—") gets nothing to click. */
export function openCell(content: ReactNode, open: () => void): ReactNode {
  if (isValidElement(content)) {
    const props = content.props as { to?: unknown; href?: unknown };
    if (props.to !== undefined || props.href !== undefined) return content;
  }
  // Only a plain blank / dash is "no number". A component (<Cell value=…/>) has
  // no text children to read, so it is never taken for empty.
  if (content === null || content === undefined || content === false) return content;
  if (typeof content === 'string' && (content.trim() === '' || content.trim() === '—')) {
    return content;
  }
  return createElement(
    'span',
    {
      className: 'dt-open',
      role: 'link',
      tabIndex: 0,
      onClick: (e: MouseEvent) => {
        e.stopPropagation();
        // A link drawn inside the cell navigates by itself; open once, not twice.
        if (e.target instanceof Element && e.target.closest('a')) return;
        open();
      },
      onKeyDown: (e: KeyboardEvent) => {
        // Only the number itself: Enter on a control inside it stays theirs.
        if (e.key !== 'Enter' || e.target !== e.currentTarget) return;
        e.preventDefault();
        open();
      },
    },
    content,
  );
}

/** The `<tr>` of a row that opens on click (`wholeRowClick` only): a pointer, Tab reaches it, Enter opens it.
 *  Only the row itself takes Enter: on the ⋯ or a link inside, the key stays theirs. */
export function rowOpenProps(
  clickable: boolean,
  open: () => void,
): HTMLAttributes<HTMLTableRowElement> {
  if (!clickable) return {};
  return {
    onClick: open,
    tabIndex: 0,
    onKeyDown: (e) => {
      if (e.key === 'Enter' && e.target === e.currentTarget) open();
    },
    style: { cursor: 'pointer' },
  };
}
