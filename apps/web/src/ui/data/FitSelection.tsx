// Row selection for the table engine (ADR-199 Wave B): the derived selection
// state, the select-all + per-row tick-boxes, and the bulk-action strip. Split
// out of FitDataTable.tsx so that file stays well under 400 lines. The CALLER
// owns the selected set (like the server-sort model); this only renders it.

import { useEffect, useRef } from 'react';
import type { ReactElement, ReactNode } from 'react';
import type { TableDensity } from '@innovic/shared';

import { stopRowClick } from './data-table-cells';

/** The leading tick-box column's width, px — density-aware, a constant (it is
 *  never measured, so the fit maths can subtract it up front). */
export function selColWidth(density: TableDensity): number {
  return density === 'compact' ? 30 : 36;
}

const EMPTY_KEYS: ReadonlySet<string | number> = new Set();

export interface RowSelectionModel<T> {
  selectable: boolean;
  selectedKeys: ReadonlySet<string | number>;
  /** Keys of the rows that MAY be selected (the gate let them through). */
  selectableKeys: (string | number)[];
  /** The loaded rows that are selected — handed to `selectionActions`. */
  selectedRows: T[];
  allSelected: boolean;
  someSelected: boolean;
  toggleAll: () => void;
  isSelected: (key: string | number) => boolean;
  canSelect: (row: T, index: number) => boolean;
  toggleRow: (key: string | number, row: T, index: number) => void;
}

export interface UseRowSelectionArgs<T> {
  rows: T[];
  keyOf: (row: T, index: number) => string | number;
  selectable: boolean;
  selectedKeys?: ReadonlySet<string | number> | undefined;
  isRowSelectable?: ((row: T, index: number) => boolean) | undefined;
  onToggleRow?: ((key: string | number, row: T, next: boolean) => void) | undefined;
  onToggleAll?: ((next: boolean, keys: (string | number)[]) => void) | undefined;
}

/** Derive the selection state from the caller-owned set. Cheap — one pass over
 *  the rows, the same the body already makes — so no memo. */
export function useRowSelection<T>(args: UseRowSelectionArgs<T>): RowSelectionModel<T> {
  const { rows, keyOf, selectable } = args;
  const selectedKeys = args.selectedKeys ?? EMPTY_KEYS;
  const canSelect = (row: T, i: number) => args.isRowSelectable?.(row, i) ?? true;

  const selectableKeys: (string | number)[] = [];
  const selectedRows: T[] = [];
  let selectedCount = 0;
  rows.forEach((row, i) => {
    if (!canSelect(row, i)) return;
    const k = keyOf(row, i);
    selectableKeys.push(k);
    if (selectedKeys.has(k)) {
      selectedRows.push(row);
      selectedCount += 1;
    }
  });
  const allSelected = selectableKeys.length > 0 && selectedCount === selectableKeys.length;
  const someSelected = selectedCount > 0 && !allSelected;

  return {
    selectable,
    selectedKeys,
    selectableKeys,
    selectedRows,
    allSelected,
    someSelected,
    toggleAll: () => args.onToggleAll?.(!allSelected, selectableKeys),
    isSelected: (k) => selectedKeys.has(k),
    canSelect,
    toggleRow: (key, row, _index) => args.onToggleRow?.(key, row, !selectedKeys.has(key)),
  };
}

/** The select-all tick in the header — indeterminate when some-but-not-all of
 *  the selectable rows are selected. */
export function SelectAllCheckbox(p: {
  checked: boolean;
  indeterminate: boolean;
  disabled?: boolean;
  onToggle: () => void;
}): ReactElement {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = p.indeterminate;
  }, [p.indeterminate]);
  return (
    <input
      ref={ref}
      type="checkbox"
      className="dt-sel-box"
      checked={p.checked}
      disabled={p.disabled ?? false}
      aria-label="Select all rows"
      onChange={p.onToggle}
      onClick={stopRowClick}
    />
  );
}

/** One row's tick-box. */
export function RowCheckbox(p: {
  checked: boolean;
  disabled?: boolean;
  onToggle: () => void;
}): ReactElement {
  return (
    <input
      type="checkbox"
      className="dt-sel-box"
      checked={p.checked}
      disabled={p.disabled ?? false}
      aria-label="Select row"
      onChange={p.onToggle}
      onClick={stopRowClick}
    />
  );
}

/** The bulk-action strip above the table — shown only when something is
 *  selected. The caller supplies the buttons via `selectionActions`. */
export function SelectionBar<T>(p: {
  selectedCount: number;
  selectedRows: T[];
  actions: (selectedRows: T[]) => ReactNode;
}): ReactElement | null {
  if (p.selectedCount === 0) return null;
  return (
    <div className="dt-sel-bar" role="region" aria-label="Selection actions">
      <span className="dt-sel-count">{p.selectedCount} selected</span>
      <div className="dt-sel-actions">{p.actions(p.selectedRows)}</div>
    </div>
  );
}
