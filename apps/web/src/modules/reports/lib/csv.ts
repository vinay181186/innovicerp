// Minimal CSV serialiser for the reports module. Handles strings (with
// embedded quotes / commas / newlines), numbers, and nulls. Values are written
// raw — date columns arrive as ISO date strings already (the report engine
// formats Date columns server-side) — except status / type codes, which are
// written as the same words the grid shows (csvValue, ADR-199 Phase 4).

import type { ReportColumn, ReportRow } from '@innovic/shared';
import { csvValue } from './report-format';

function escapeCsvField(value: unknown): string {
  if (value === null || value === undefined) return '';
  const s = String(value);
  if (s.includes('"') || s.includes(',') || s.includes('\n') || s.includes('\r')) {
    return `"${s.replaceAll('"', '""')}"`;
  }
  return s;
}

export function rowsToCsv(columns: ReportColumn[], rows: ReportRow[]): string {
  const header = columns.map((c) => escapeCsvField(c.label)).join(',');
  const body = rows
    .map((r) => columns.map((c) => escapeCsvField(csvValue(c, r[c.key]))).join(','))
    .join('\n');
  return `${header}\n${body}\n`;
}

export function downloadCsv(filename: string, csv: string): void {
  // BOM so Excel opens UTF-8 cleanly on Windows.
  const blob = new Blob(['\uFEFF', csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
