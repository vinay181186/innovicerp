// Workbook builder for report exports (T-045).
//
// Mirrors legacy `_rbGenExcel` (legacy HTML L17638-17671) — 3 sheets:
//   1. Report Data — header + rows + total row for numeric columns
//   2. Summary    — only when groupBy is set (group / count / aggregate)
//   3. Report Info — metadata (slug, generatedAt, filters, generatedBy)
//
// Returns a Node Buffer ready for `reply.send()`. Content-type is set
// by the caller via reply.type().

import ExcelJS from 'exceljs';

export interface ExcelColumn {
  key: string;
  label: string;
  type: 'text' | 'number' | 'date' | 'datetime';
}

export interface ExcelRow {
  [key: string]: string | number | null;
}

export interface ExcelSummaryRow {
  group: string;
  count: number;
  aggregate: string | null;
}

export interface BuildWorkbookInput {
  /** Report slug or saved-report id — used in the Info sheet. */
  id: string;
  title: string;
  columns: ExcelColumn[];
  rows: ExcelRow[];
  /** Optional summary section (mirrors legacy "Summary" sheet). */
  summary?: ExcelSummaryRow[];
  summaryFunction?: string | null;
  summaryColumn?: string | null;
  /** Filters echoed back in the Info sheet. */
  filters?: Record<string, string>;
  /** Email of the user who triggered the export. */
  generatedBy?: string | null;
  generatedAt: string;
}

export async function buildWorkbookBuffer(input: BuildWorkbookInput): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Innovic ERP';
  wb.created = new Date(input.generatedAt);

  // ─── Sheet 1: Report Data ──────────────────────────────────────────────
  const data = wb.addWorksheet('Report Data');
  data.columns = input.columns.map((c) => ({
    header: c.label,
    key: c.key,
    width: c.type === 'number' ? 14 : Math.max(12, Math.min(30, c.label.length + 6)),
  }));
  data.getRow(1).font = { bold: true };

  for (const r of input.rows) {
    data.addRow(
      Object.fromEntries(
        input.columns.map((c) => {
          const v = r[c.key];
          if (v === null || v === undefined) return [c.key, ''];
          if (c.type === 'number') return [c.key, Number(v)];
          return [c.key, v];
        }),
      ),
    );
  }

  // Totals row for numeric columns + a count tag in column 0.
  if (input.rows.length > 0) {
    const totalsRow: Record<string, string | number> = {};
    let firstWritten = false;
    for (const c of input.columns) {
      if (c.type === 'number') {
        const total = input.rows.reduce((s, r) => s + Number(r[c.key] ?? 0), 0);
        totalsRow[c.key] = total;
      } else if (!firstWritten) {
        totalsRow[c.key] = `TOTAL (${input.rows.length})`;
        firstWritten = true;
      }
    }
    const row = data.addRow(totalsRow);
    row.font = { bold: true };
  }

  // Right-align numeric columns + number format.
  input.columns.forEach((c, i) => {
    if (c.type === 'number') {
      const col = data.getColumn(i + 1);
      col.alignment = { horizontal: 'right' };
      col.numFmt = '#,##0.00';
    }
  });

  // ─── Sheet 2: Summary (only when groupBy is set) ───────────────────────
  if (input.summary && input.summary.length > 0) {
    const summary = wb.addWorksheet('Summary');
    const aggLabel = input.summaryColumn
      ? `${input.summaryFunction ?? 'SUM'} of ${input.summaryColumn}`
      : null;
    summary.columns = [
      { header: 'Group', key: 'group', width: 24 },
      { header: 'Count', key: 'count', width: 14 },
      ...(aggLabel ? [{ header: aggLabel, key: 'aggregate', width: 20 }] : []),
    ];
    summary.getRow(1).font = { bold: true };

    let groupTotal = 0;
    let aggTotal = 0;
    for (const s of input.summary) {
      const aggValue = s.aggregate != null ? Number(s.aggregate) : null;
      summary.addRow({
        group: s.group,
        count: s.count,
        ...(aggLabel ? { aggregate: aggValue ?? 0 } : {}),
      });
      groupTotal += s.count;
      if (aggValue != null) aggTotal += aggValue;
    }
    const totalsRow = summary.addRow({
      group: 'TOTAL',
      count: groupTotal,
      ...(aggLabel ? { aggregate: aggTotal } : {}),
    });
    totalsRow.font = { bold: true };

    if (aggLabel) {
      summary.getColumn(3).alignment = { horizontal: 'right' };
      summary.getColumn(3).numFmt = '#,##0.00';
    }
    summary.getColumn(2).alignment = { horizontal: 'right' };
  }

  // ─── Sheet 3: Report Info ──────────────────────────────────────────────
  const info = wb.addWorksheet('Report Info');
  info.columns = [
    { header: 'Field', key: 'k', width: 22 },
    { header: 'Value', key: 'v', width: 50 },
  ];
  info.getRow(1).font = { bold: true };

  info.addRow({ k: 'Report', v: input.title });
  info.addRow({ k: 'Id / slug', v: input.id });
  info.addRow({ k: 'Records', v: input.rows.length });
  info.addRow({
    k: 'Columns',
    v: input.columns.map((c) => c.label).join(', '),
  });
  if (input.summary && input.summary.length > 0) {
    info.addRow({
      k: 'Summary',
      v: input.summaryColumn
        ? `${input.summaryFunction ?? 'SUM'} of ${input.summaryColumn} grouped`
        : 'Group count only',
    });
  }
  info.addRow({ k: '', v: '' });
  info.addRow({ k: 'Filters', v: '' });
  if (input.filters && Object.keys(input.filters).length > 0) {
    for (const [k, v] of Object.entries(input.filters)) {
      info.addRow({ k, v });
    }
  } else {
    info.addRow({ k: '(none)', v: '' });
  }
  info.addRow({ k: '', v: '' });
  info.addRow({ k: 'Generated by', v: input.generatedBy ?? 'system' });
  info.addRow({ k: 'Generated at', v: input.generatedAt });

  const arrayBuffer = await wb.xlsx.writeBuffer();
  return Buffer.from(arrayBuffer);
}

export const XLSX_CONTENT_TYPE =
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

export function xlsxFilename(prefix: string, generatedAt: string): string {
  const stamp = generatedAt.slice(0, 19).replaceAll(':', '-');
  const safe = prefix.replace(/[^a-z0-9-]/gi, '_').toLowerCase();
  return `${safe}-${stamp}.xlsx`;
}
