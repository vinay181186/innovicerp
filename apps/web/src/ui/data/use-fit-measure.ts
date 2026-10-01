// Measuring side of the fit engine (ADR-199): the wrapper's available width,
// the measured column widths, and the inputs of the hidden ColumnMeasurer.
// Split out of FitDataTable.tsx to keep each file under 400 lines.

import {
  isValidElement,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import { MEASURE_ROWS, ACTIONS_ID, type Measured } from './ColumnMeasurer';
import { cellTitle, nodeText, readField } from './data-table-cells';
import type { DataTableColumn, DataTableColumnKind } from './data-table-types';
import { columnWidth, type ColumnWidth } from './fit-layout';

/** Rows beyond the measured sample with the longest value, per column. */
const OUTLIERS_PER_COLUMN = 5;

function sameMeasured(a: Measured | null, b: Measured): boolean {
  if (!a) return false;
  const eq = (x: Record<string, number>, y: Record<string, number>) => {
    const kx = Object.keys(x);
    return kx.length === Object.keys(y).length && kx.every((k) => x[k] === y[k]);
  };
  return eq(a.head, b.head) && eq(a.content, b.content);
}

/** Plain-text length of one cell, without rendering it to the DOM. */
function textLength<T>(col: DataTableColumn<T>, row: T, index: number): number {
  if (col.key !== undefined && !col.render) {
    const v = readField(row, col.key);
    return v === null || v === undefined ? 0 : String(v).length;
  }
  if (col.render) {
    const node = col.render(row, index);
    if (typeof node === 'string' || typeof node === 'number') return String(node).length;
    if (isValidElement(node) || Array.isArray(node)) return nodeText(node).length;
  }
  return cellTitle(col, row)?.length ?? 0;
}

/**
 * The rows past the first MEASURE_ROWS that hold the longest value of any
 * never-cut column (code / num / date / badge), so the measured width covers
 * ALL rows, not just the sample. Text columns are cut anyway and skipped.
 */
export function pickOutlierRows<T>(
  rows: T[],
  columns: DataTableColumn<T>[],
  kinds: DataTableColumnKind[],
): T[] {
  if (rows.length <= MEASURE_ROWS) return [];
  const picked = new Set<number>();
  columns.forEach((col, ci) => {
    if (kinds[ci] === 'text') return;
    const top: Array<[number, number]> = [];
    for (let ri = MEASURE_ROWS; ri < rows.length; ri += 1) {
      const row = rows[ri];
      if (row === undefined) continue;
      const len = textLength(col, row, ri);
      if (top.length < OUTLIERS_PER_COLUMN || len > (top[top.length - 1]?.[1] ?? 0)) {
        top.push([ri, len]);
        top.sort((a, b) => b[1] - a[1]);
        if (top.length > OUTLIERS_PER_COLUMN) top.pop();
      }
    }
    for (const [ri] of top) picked.add(ri);
  });
  return [...picked]
    .sort((a, b) => a - b)
    .flatMap((ri) => (rows[ri] === undefined ? [] : [rows[ri] as T]));
}

/** A number that changes only when the rows really change (not on a new
 *  array holding the same row objects). */
function useRowsVersion<T>(rows: T[]): number {
  const ref = useRef<{ rows: T[]; v: number }>({ rows, v: 0 });
  if (ref.current.rows !== rows) {
    const prev = ref.current.rows;
    const same = prev.length === rows.length && rows.every((r, i) => r === prev[i]);
    ref.current = { rows, v: same ? ref.current.v : ref.current.v + 1 };
  }
  return ref.current.v;
}

export interface FitMeasureInput<T> {
  columns: DataTableColumn<T>[];
  ids: string[];
  kinds: Record<string, DataTableColumnKind>;
  rows: T[];
  hasActions: boolean;
  /** Density + table classes + sort — anything that changes how cells draw. */
  styleKey: string;
}

export function useFitMeasure<T>({
  columns,
  ids,
  kinds,
  rows,
  hasActions,
  styleKey,
}: FitMeasureInput<T>) {
  // ---- available width: re-layout on every wrapper resize ----
  const wrapRef = useRef<HTMLDivElement>(null);
  const [avail, setAvail] = useState(0);
  useLayoutEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    let frame = 0;
    // Our own layout never changes the wrapper's width (the table is sized
    // to it), so a resize can only come from outside. Read it in a frame and
    // only when it really moved — no observe → set → observe loop.
    const read = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const w = Math.floor(el.clientWidth);
        setAvail((prev) => (prev === w ? prev : w));
      });
    };
    setAvail(Math.floor(el.clientWidth));
    const ro = new ResizeObserver(read);
    ro.observe(el);
    return () => {
      cancelAnimationFrame(frame);
      ro.disconnect();
    };
  }, []);

  const [fontsTick, setFontsTick] = useState(0);
  useEffect(() => {
    let live = true;
    void document.fonts?.ready.then(() => live && setFontsTick(1));
    return () => {
      live = false;
    };
  }, []);

  const [measured, setMeasured] = useState<Measured | null>(null);
  const onMeasured = useCallback((m: Measured) => {
    setMeasured((prev) => (sameMeasured(prev, m) ? prev : m));
  }, []);

  const rowsVersion = useRowsVersion(rows);
  const idsKey = ids.join('|');
  const extraRows = useMemo(
    () =>
      pickOutlierRows(
        rows,
        columns,
        ids.map((id) => kinds[id] ?? 'code'),
      ),
    // Keyed on the rows' version and the column ids, not on identities.
    [rowsVersion, idsKey],
  );
  const signature = [rowsVersion, idsKey, hasActions ? 'a' : '', styleKey, fontsTick, avail].join(
    '§',
  );

  const widths = useMemo(() => {
    if (!measured) return null;
    const out: Record<string, ColumnWidth> = {};
    columns.forEach((c, i) => {
      const id = ids[i] ?? `col-${i}`;
      out[id] = columnWidth(
        kinds[id] ?? 'code',
        measured.head[id] ?? 0,
        measured.content[id] ?? 0,
        c.minWidth ?? 0,
      );
    });
    return out;
  }, [measured, idsKey]);
  const actionsW =
    hasActions && measured
      ? Math.max(measured.head[ACTIONS_ID] ?? 0, measured.content[ACTIONS_ID] ?? 0)
      : 0;

  return { wrapRef, avail, widths, actionsW, signature, extraRows, onMeasured };
}
