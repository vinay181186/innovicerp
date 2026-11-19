// ADR-310 — the ONE Excel writer behind the shared list Export.
//
//   writeWorkbook('JWSO Master', [{ name, header, rows }, …])
//     → saves "JWSO Master 2026-11-18.xlsx" (todayIst, YYYY-MM-DD) via the native Save-As
//       dialog where the browser has one, else a plain download.
//   postExportLog({ listTitle, rowCount, … })
//     → POST /activity-log/export, AFTER the file is made. Never throws: the
//       log line must never spoil a download that already happened.
//
// SheetJS is imported on demand (op-log/lib/export.ts pattern), so the
// ~400 kB library never loads with the app — only on the first Export click.

import type { ListExportLogInput } from '@innovic/shared';

import { apiFetch } from './api';
import { todayIst } from './date';

export type ExcelCell = string | number | null;

export interface ExcelSheet {
  /** Tab name — cleaned and cut to Excel's 31 characters. */
  name: string;
  header: string[];
  rows: ExcelCell[][];
}

type SaveFilePicker = (opts: {
  suggestedName: string;
  types: { description: string; accept: Record<string, string[]> }[];
}) => Promise<{
  createWritable: () => Promise<{ write: (b: Blob) => Promise<void>; close: () => Promise<void> }>;
}>;

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/** Excel refuses `[]:*?/\` in a tab name and anything past 31 characters. */
export function safeSheetName(name: string, taken: ReadonlySet<string> = new Set()): string {
  const base =
    name
      .replace(/[[\]:*?/\\]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim() || 'Sheet';
  let out = base.slice(0, 31);
  for (let n = 2; taken.has(out.toLowerCase()); n++) {
    const tail = ` (${n})`;
    out = base.slice(0, 31 - tail.length) + tail;
  }
  return out;
}

/** The file name the user sees: "<list title> <YYYY-MM-DD>.xlsx". */
export function exportFileName(fileName: string): string {
  const clean =
    fileName
      .replace(/[\\/:*?"<>|]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim() || 'Export';
  return `${clean} ${todayIst()}.xlsx`;
}

/**
 * Build the workbook and hand it to the user. Resolves to the saved file name,
 * or `null` when the user cancelled the Save-As dialog (nothing written).
 */
export async function writeWorkbook(
  fileName: string,
  sheets: ExcelSheet[],
): Promise<string | null> {
  const XLSX = await import('xlsx');
  const wb = XLSX.utils.book_new();
  const taken = new Set<string>();
  for (const s of sheets) {
    const name = safeSheetName(s.name, taken);
    taken.add(name.toLowerCase());
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([s.header, ...s.rows]), name);
  }
  const filename = exportFileName(fileName);
  const buffer = XLSX.write(wb, { bookType: 'xlsx', type: 'array' }) as ArrayBuffer;
  const blob = new Blob([buffer], { type: XLSX_MIME });

  // Chrome / Edge: the native Save-As dialog (the user picks the folder).
  const picker = (window as unknown as { showSaveFilePicker?: SaveFilePicker }).showSaveFilePicker;
  if (typeof picker === 'function') {
    try {
      const handle = await picker({
        suggestedName: filename,
        types: [{ description: 'Excel Workbook', accept: { [XLSX_MIME]: ['.xlsx'] } }],
      });
      const writable = await handle.createWritable();
      await writable.write(blob);
      await writable.close();
      return filename;
    } catch (e) {
      // Cancelled → stop quietly. Any other picker failure → plain download.
      if (e instanceof DOMException && e.name === 'AbortError') return null;
    }
  }

  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
  return filename;
}

/** One Activity Log row (action EXPORT) for a file just made. Never throws. */
export async function postExportLog(
  input: Omit<ListExportLogInput, 'capped'> & { capped?: boolean },
): Promise<void> {
  try {
    await apiFetch('/activity-log/export', { method: 'POST', json: { capped: false, ...input } });
  } catch {
    // The file is already with the user; a lost log line is not their problem.
  }
}
