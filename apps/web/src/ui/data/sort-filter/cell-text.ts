// Sort & Filter (ADR-200) — the text a cell SHOWS, without mounting it.
// Most columns draw a node (`render`) rather than naming a field, so the
// filter reads the same words the user reads: a column's own `filterValue`
// first, then the field (`key`), then the rendered node's text. A component
// with no text children (a status chip) is read from its `label` / `status`
// prop the way StatusBadge words it.

import { Children, isValidElement } from 'react';
import type { ReactNode } from 'react';

import { statusText } from '@/lib/status-text';

import { readField } from '../data-table-cells';
import type { DataTableColumn } from '../data-table-types';
import { normText } from './filter-model';

const IST_DAY = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Kolkata',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

const PROP_TEXT = ['label', 'value', 'text', 'name', 'code'] as const;

function nodeWords(node: ReactNode, depth = 0): string {
  if (node === null || node === undefined || typeof node === 'boolean') return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map((n) => nodeWords(n as ReactNode, depth)).join('');
  if (!isValidElement(node) || depth > 12) return '';
  const props = node.props as Record<string, unknown> & { children?: ReactNode };
  const inner = Children.toArray(props.children)
    .map((n) => nodeWords(n, depth + 1))
    .join('');
  if (inner.trim() !== '') return inner;
  // A component that words itself (StatusBadge, Badge, ItemBadge …).
  if (typeof props.status === 'string' && props.status.trim() !== '') {
    const kind = typeof props.kind === 'string' ? props.kind : null;
    return typeof props.label === 'string' && props.label
      ? props.label
      : statusText(props.status, kind);
  }
  for (const k of PROP_TEXT) {
    const v = props[k];
    if (typeof v === 'string' || typeof v === 'number') return String(v);
  }
  return '';
}

function valueText(v: unknown): string | null {
  if (v === null || v === undefined || typeof v === 'boolean') return null;
  if (typeof v === 'string' || typeof v === 'number') return String(v);
  // The India-time day, like every date on screen (not the UTC day).
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : IST_DAY.format(v);
  return null;
}

/** The displayed text of one cell, blank → null. */
export function cellText<T>(col: DataTableColumn<T>, row: T, index: number): string | null {
  if (col.filterValue) return normText(valueText(col.filterValue(row)));
  if (!col.render && col.key !== undefined) return normText(valueText(readField(row, col.key)));
  if (col.render) {
    const words = nodeWords(col.render(row, index));
    if (words.trim() !== '') return normText(words);
  }
  if (col.title) return normText(col.title(row));
  return null;
}

/** Columns that never get a ▾: row numbers, actions, in-cell controls. */
export function isFilterableColumn<T>(col: DataTableColumn<T>, id: string, label: string): boolean {
  if (col.filterable === false) return false;
  if (col.kind === 'actions' || col.kind === 'control') return false;
  // A picture column has nothing to read.
  if (
    /^(image|photo|picture|thumbnail)$/i.test(id) ||
    /^(image|photo|picture)$/i.test(label.trim())
  )
    return false;
  if (/^(sr|sl|s)[_.-]?no$/i.test(id) || /^(sr\.?|sl\.?|s\.?)\s*no\.?$|^#$/i.test(label.trim()))
    return false;
  return true;
}
