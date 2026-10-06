// Excel import for the Item / Customer / Vendor masters — the web half of the
// ERPNext Data Import behaviour (packages/shared/src/schemas/master-import.ts).
//
// The three module parsers (modules/{clients,vendors,items}/lib/import-export.ts)
// turn a sheet into RAW row objects and do only the structural checks (a blank
// name, a Code repeated in the file, a label that cannot be turned into a code).
// Every field rule — email, GSTIN, lengths, duplicates against the master, the
// master rules — is the server's, answered per row by the dryRun preview, so
// the screen and the server run ONE rule set.
//
// This file holds what the three parsers and the shared dialog
// (components/shared/master-import-dialog.tsx) have in common.

import type { MasterImportMode } from '@innovic/shared';
import * as XLSX from 'xlsx';

/** One sheet row that will be sent to the server. */
export interface ParsedImportRow {
  /** Sheet row number (1 = header row, so the first data row is 2). */
  rowNum: number;
  /** What goes on the wire. In Update mode a blank cell is ABSENT, never ''. */
  payload: Record<string, unknown>;
  /** Code as typed (for the preview table). */
  code: string | null;
  /** Name as typed (for the preview table). */
  name: string;
  /** Things the parser adjusted (e.g. rating "AB" stored as "A"). */
  warnings: string[];
}

/** One sheet row the parser left out before anything was sent. */
export interface ParsedImportSkip {
  rowNum: number;
  code: string | null;
  name: string;
  reason: string;
}

export interface MasterImportParse {
  rows: ParsedImportRow[];
  skipped: ParsedImportSkip[];
  /** The workbook could not be read at all. */
  fatal?: string;
  /** Sheet-level notes (e.g. which tab was read). */
  notes: string[];
}

export type MasterImportParser = (file: File, mode: MasterImportMode) => Promise<MasterImportParse>;

/** Set `key` only when the cell has a value — Update mode must OMIT a blank
 *  cell (absent = keep the current value), and Insert mode gains nothing from
 *  sending '' either. */
export function putIfFilled(
  target: Record<string, unknown>,
  key: string,
  value: string | undefined | null,
): void {
  const v = (value ?? '').trim();
  if (v !== '') target[key] = v;
}

/** A days cell ("30", "30.0", " 45 ") → whole number. Blank → undefined.
 *  Anything else → an error message for the preview. */
export function parseWholeDays(raw: string, label: string): { value?: number; error?: string } {
  const s = raw.trim();
  if (s === '') return {};
  const n = Number(s);
  if (!Number.isFinite(n) || !Number.isInteger(n)) {
    return { error: `${label} "${s}" is not a whole number of days` };
  }
  return { value: n };
}

/** One row of the "Download errors" workbook. */
export interface ImportErrorRow {
  rowNum: number;
  code: string | null;
  name: string;
  reason: string;
}

/** The skipped rows, with their reasons, as an .xlsx the user can fix from. */
export function downloadImportErrors(
  fileName: string,
  codeLabel: string,
  nameLabel: string,
  rows: readonly ImportErrorRow[],
): void {
  const aoa: (string | number)[][] = [['Sheet Row', codeLabel, nameLabel, 'Reason']];
  for (const r of rows) aoa.push([r.rowNum, r.code ?? '', r.name, r.reason]);
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws['!cols'] = [10, 16, 30, 80].map((wch) => ({ wch }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Errors');
  XLSX.writeFile(wb, fileName);
}
