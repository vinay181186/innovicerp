// ADR-310 (owner 18-11-2026) — the ONE "Export" on every list.
//
// A list hands ListHeader an `exportSpec`; the header draws this button in
// its tools slot. On click it fetches EVERY row matching the screen's search /
// filters / sort (never just the 25 on screen), writes the columns the user
// SEES in their order (Columns ▾ — hidden ones left out, action / control
// columns left out, money left out for a no-price user), and saves
// "<list title> <DD-MM-YYYY>.xlsx". A document list may add a second "Lines"
// sheet holding the lines of exactly the documents on the first sheet.
// After the file is made, one Activity Log row (action EXPORT) is sent.
//
//   <ListHeader … exportSpec={{ fileName: 'JWSO Master', tableKey, columns, fetchPage }} />

import { LIST_EXPORT_CAP, type TableLayout } from '@innovic/shared';
import { Loader2 } from 'lucide-react';
import { useCallback, useRef, useState } from 'react';

import { fmtDate, fmtTime12 } from '@/lib/date';
import { type ExcelCell, type ExcelSheet, postExportLog, writeWorkbook } from '@/lib/excel-export';
import { fetchAllPagesCounted } from '@/lib/list-paging';
import {
  type TableLayoutDefaults,
  useTableLayoutReader,
  visibleColumnIds,
} from '@/lib/use-table-layout';

import { Icon } from '../core';
import { useToast } from '../feedback';
import { colId, colKind, defaultRowKey, nodeText } from './data-table-cells';
import type { DataTableColumn } from './data-table-types';
import { lockedLeadIds } from './lead-columns';
import { cellText } from './sort-filter/cell-text';

export type ExportPageFetcher<R> = (
  limit: number,
  offset: number,
) => Promise<{ items: R[]; total: number }>;

/** The second sheet of a document list: one row per line. */
export interface ListExportLinesSheet<T, L> {
  /** Tab name, e.g. "JWSO Lines". */
  name: string;
  header: string[];
  /** Same search / filters as the main sheet. */
  fetchPage: ExportPageFetcher<L>;
  /** The document a main-sheet row is (e.g. the JWSO id). */
  docKey: (row: T) => string;
  /** The document a line belongs to — same value as `docKey`. */
  lineDocKey: (line: L) => string;
  toRow: (line: L) => ExcelCell[];
  /** Order of a line inside its document (POL / line no.); default fetch order. */
  lineOrder?: ((line: L) => number) | undefined;
}

export interface ListExportSpec<T, L = unknown> {
  /** The list's own title — file name, first tab and the Activity Log line. */
  fileName: string;
  /** The DataTable's tableKey: the user's Columns ▾ layout decides the columns. */
  tableKey?: string | undefined;
  /** The SAME column array given to the DataTable. */
  columns: DataTableColumn<T>[];
  /** The DataTable's `defaultHidden`, when it passes one. */
  defaultHidden?: string[] | undefined;
  /** Server-paged lists: one page of the list with the screen's current filters. */
  fetchPage?: ExportPageFetcher<T> | undefined;
  /** Lists already holding every row in the browser. */
  rows?: T[] | undefined;
  /** The DataTable's rowKey (de-duplicates rows); default `row.id`. */
  rowKey?: ((row: T, index: number) => string | number) | undefined;
  /** Rows per request while exporting. Default 200. */
  pageSize?: number | undefined;
  /** No-price user: money columns are LEFT OUT (sheet-print hideMoney rule). */
  hideMoney?: boolean | undefined;
  /** Extra column ids that are money although not marked `money: true`. */
  moneyColumns?: string[] | undefined;
  /** Plain words for the search / filters, for the Activity Log. */
  filterSummary?: string | undefined;
  linesSheet?: ListExportLinesSheet<T, L> | undefined;
}

// any: ListHeader only passes the spec through; each list types its own rows.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyListExportSpec = ListExportSpec<any, any>;

// ── pure parts (unit-tested) ────────────────────────────────────────────────

const fmtCount = (n: number): string => n.toLocaleString('en-IN');

/** The column ids and layout defaults exactly as FitDataTable derives them. */
export function exportLayoutInputs<T>(
  columns: DataTableColumn<T>[],
  defaultHidden?: string[],
): { ids: string[]; defaults: TableLayoutDefaults } {
  const ids = columns.map((c, i) => colId(c, i));
  const locked = columns[0]?.lead ? lockedLeadIds(columns, ids) : [];
  const hideable = locked.filter((id, i) => id !== ids[0] && columns[i]?.leadHideable);
  const own = columns.flatMap((c, i) => (c.hiddenByDefault ? [ids[i] ?? `col-${i}`] : []));
  return {
    ids,
    defaults: { hidden: [...(defaultHidden ?? []), ...own], locked, hideable },
  };
}

export interface ExportColumn<T> {
  id: string;
  col: DataTableColumn<T>;
  header: string;
}

/** The user's visible columns in order, minus actions / controls / money. */
export function selectExportColumns<T>(
  columns: DataTableColumn<T>[],
  visibleIds: string[],
  opts: { hideMoney?: boolean | undefined; moneyColumns?: string[] | undefined } = {},
): ExportColumn<T>[] {
  const byId = new Map(columns.map((c, i) => [colId(c, i), c]));
  const out: ExportColumn<T>[] = [];
  for (const id of visibleIds) {
    const col = byId.get(id);
    if (!col) continue;
    const kind = colKind(col);
    if (kind === 'actions' || kind === 'control') continue;
    if (opts.hideMoney && (col.money === true || (opts.moneyColumns ?? []).includes(id))) continue;
    const header = (col.label ?? nodeText(col.header)).replace(/\s+/g, ' ').trim();
    out.push({ id, col, header });
  }
  return out;
}

const NUMERIC = /^-?(?:₹\s*)?[\d,]*\.?\d+$/;
const ISO_DAY = /^\d{4}-\d{2}-\d{2}(?:[T ][\d:.]+(?:Z|[+-]\d{2}:?\d{2})?)?$/;

/** One Excel cell: exportValue, else the words the cell shows. */
export function exportCell<T>(c: ExportColumn<T>, row: T, index: number): ExcelCell {
  if (c.col.exportValue) return c.col.exportValue(row);
  // Sr No counts down the whole file, not the page it was drawn on.
  if (c.id === 'sr_no') return index + 1;
  const text = cellText(c.col, row, index);
  if (text === null) return null;
  const kind = colKind(c.col);
  if (kind === 'num' && NUMERIC.test(text)) {
    const n = Number(text.replace(/[₹,\s]/g, ''));
    if (Number.isFinite(n)) return n;
  }
  // A raw ISO date (a filterValue such as Created On) reads as on screen.
  if (kind === 'date' && ISO_DAY.test(text)) {
    const time = text.length > 10 ? fmtTime12(text, '') : '';
    return time ? `${fmtDate(text, '')} ${time}` : fmtDate(text, '');
  }
  return text;
}

/** First occurrence of each row key wins (a row shifting between pages). */
export function dedupeRows<T>(rows: T[], keyOf: (row: T, index: number) => string | number): T[] {
  const seen = new Set<string | number>();
  return rows.filter((r, i) => {
    const k = keyOf(r, i);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

export function capMessage(kept: number, total: number, sheet?: string): string {
  const where = sheet ? ` on “${sheet}”` : '';
  return `Exported the first ${fmtCount(kept)} of ${fmtCount(total)} rows${where}. Narrow the filter to export the rest.`;
}

/** Only the lines of documents on the main sheet, in main-sheet order. */
export function linesForDocs<L>(
  lines: L[],
  docOrder: ReadonlyMap<string, number>,
  lineDocKey: (line: L) => string,
  lineOrder?: (line: L) => number,
): L[] {
  return lines
    .map((line, i) => ({ line, i, doc: docOrder.get(lineDocKey(line)) }))
    .filter((x): x is { line: L; i: number; doc: number } => x.doc !== undefined)
    .sort(
      (a, b) =>
        a.doc - b.doc || (lineOrder ? lineOrder(a.line) - lineOrder(b.line) : 0) || a.i - b.i,
    )
    .map((x) => x.line);
}

/** The main sheet for rows already fetched. */
export function buildMainSheet<T>(
  spec: ListExportSpec<T, unknown>,
  rows: T[],
  saved: TableLayout | null | undefined,
): ExcelSheet {
  const { ids, defaults } = exportLayoutInputs(spec.columns, spec.defaultHidden);
  const cols = selectExportColumns(spec.columns, visibleColumnIds(saved, ids, defaults), spec);
  return {
    name: spec.fileName,
    header: cols.map((c) => c.header),
    rows: rows.map((r, i) => cols.map((c) => exportCell(c, r, i))),
  };
}

// ── hook + button ───────────────────────────────────────────────────────────

export interface ListExportProgress {
  done: number;
  total: number;
}

export function useListExport<T, L>(
  spec: ListExportSpec<T, L>,
): { run: () => Promise<void>; progress: ListExportProgress | null } {
  const readLayout = useTableLayoutReader();
  const toast = useToast();
  const [progress, setProgress] = useState<ListExportProgress | null>(null);
  // A second click while running does nothing (the button is disabled too).
  const busy = useRef(false);

  const run = useCallback(async () => {
    if (busy.current) return;
    busy.current = true;
    setProgress({ done: 0, total: 0 });
    const onProgress = (done: number, total: number): void =>
      setProgress({ done, total: Math.min(total, LIST_EXPORT_CAP) });
    try {
      const chunk = spec.pageSize ?? 200;
      let rows: T[];
      let total: number;
      if (spec.fetchPage) {
        const res = await fetchAllPagesCounted(spec.fetchPage, chunk, onProgress, LIST_EXPORT_CAP);
        rows = res.items;
        total = res.total;
      } else {
        const all = spec.rows ?? [];
        total = all.length;
        rows = all.slice(0, LIST_EXPORT_CAP);
      }
      rows = dedupeRows(rows, spec.rowKey ?? defaultRowKey);
      if (rows.length === 0) {
        toast.info('Nothing to export for the current filter.');
        return;
      }
      const capped = total > LIST_EXPORT_CAP;
      const notes: string[] = capped ? [capMessage(rows.length, total)] : [];
      const main = buildMainSheet(
        spec as ListExportSpec<T, unknown>,
        rows,
        spec.tableKey ? readLayout(spec.tableKey) : undefined,
      );
      const sheets: ExcelSheet[] = [main];

      let lineCount: number | undefined;
      let linesCapped = false;
      const ls = spec.linesSheet;
      if (ls) {
        const res = await fetchAllPagesCounted(ls.fetchPage, chunk, onProgress, LIST_EXPORT_CAP);
        const docOrder = new Map(rows.map((r, i) => [ls.docKey(r), i] as const));
        const lines = linesForDocs(res.items, docOrder, ls.lineDocKey, ls.lineOrder);
        linesCapped = res.total > LIST_EXPORT_CAP;
        if (linesCapped) notes.push(capMessage(lines.length, res.total, ls.name));
        lineCount = lines.length;
        sheets.push({ name: ls.name, header: ls.header, rows: lines.map((l) => ls.toRow(l)) });
      }

      const saved = await writeWorkbook(spec.fileName, sheets);
      if (saved === null) return; // Save-As cancelled: no file, no log.
      toast.ok(`Exported ${fmtCount(rows.length)} rows to “${saved}”`);
      for (const n of notes) toast.info(n, { durationMs: 0 });
      const summary = spec.filterSummary?.trim().slice(0, 500);
      void postExportLog({
        listTitle: spec.fileName,
        rowCount: rows.length,
        capped: capped || linesCapped,
        ...(lineCount !== undefined ? { lineCount } : {}),
        ...(capped ? { totalCount: total } : {}),
        ...(summary ? { filterSummary: summary } : {}),
      });
    } catch {
      toast.error('Could not export. Try again.');
    } finally {
      busy.current = false;
      setProgress(null);
    }
  }, [spec, readLayout, toast]);

  return { run, progress };
}

/** The shared Export button — the SO Master look (`btn btn-ghost`, ⬇ / spinner). */
export function ListExportButton<T, L>({
  spec,
}: {
  spec: ListExportSpec<T, L>;
}): React.JSX.Element {
  const { run, progress } = useListExport(spec);
  const running = progress !== null;
  return (
    <button
      type="button"
      className="btn btn-ghost"
      disabled={running}
      title="Export the current (filtered) list to Excel"
      onClick={() => void run()}
    >
      {running ? (
        <Loader2 className="inline h-3 w-3 animate-spin" />
      ) : (
        <Icon name="download" className="inline h-3 w-3" />
      )}{' '}
      {running
        ? progress.total > 0
          ? `Exporting… ${fmtCount(progress.done)} of ${fmtCount(progress.total)}`
          : 'Exporting…'
        : 'Export'}
    </button>
  );
}
