// CSV serialiser for the saved-reports module. Mirrors reports/lib/csv.ts
// but typed against AdHocColumn / AdHocRow shapes.

import type { AdHocColumn, AdHocRow } from '@innovic/shared';

function escapeCsvField(value: unknown): string {
  if (value === null || value === undefined) return '';
  const s = String(value);
  if (s.includes('"') || s.includes(',') || s.includes('\n') || s.includes('\r')) {
    return `"${s.replaceAll('"', '""')}"`;
  }
  return s;
}

export function rowsToCsv(columns: AdHocColumn[], rows: AdHocRow[]): string {
  const header = columns.map((c) => escapeCsvField(c.label)).join(',');
  const body = rows.map((r) => columns.map((c) => escapeCsvField(r[c.key])).join(',')).join('\n');
  return `${header}\n${body}\n`;
}

export function downloadCsv(filename: string, csv: string): void {
  const blob = new Blob(['﻿', csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
