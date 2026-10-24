// ADR-252 QC Dossier — the pure part: state → chip, the file sheet's rows, and
// the ZIP folder names. No React, no fetch, so it is unit-tested on its own
// (dossier-model.test.ts).

import {
  QC_OTHER_FOLDER,
  type QcDossierEntry,
  type QcDossierFile,
  type QcDossierFileSource,
  type QcDossierFolder,
  type QcDossierLine,
  type QcFolderState,
} from '@innovic/shared';
import { fmtDate } from '@/lib/date';
import type { BadgeTone } from '@/ui/core';

export interface Chip {
  tone: BadgeTone;
  text: string;
  title: string;
}

/** The POL row's chip in the folder tree (owner decision, ADR-252 D2). */
export function lineChip(line: Pick<QcDossierLine, 'state' | 'missingCount' | 'fileCount'>): Chip {
  switch (line.state) {
    case 'no_jc':
      return { tone: 'grey', text: 'No JC yet', title: 'No job card on this line yet' };
    case 'no_qc_steps':
      return {
        tone: 'grey',
        text: 'No QC steps',
        title: 'The job card route has no QC step — no report is required',
      };
    case 'qc_pending':
      return { tone: 'grey', text: 'QC not done', title: 'QC has not been entered yet' };
    case 'report_missing':
      return {
        // Some reports in → orange; none in yet → red.
        tone: line.fileCount > 0 ? 'orange' : 'red',
        text: `${line.missingCount} missing`,
        title: `${line.missingCount} QC entries saved without their report`,
      };
    case 'complete':
      return { tone: 'green', text: '✓', title: 'Every required report is in' };
  }
}

/** The report folder's marker in the tree. */
export function folderChip(folder: Pick<QcDossierFolder, 'state'>, fileCount: number): Chip {
  const states: Record<QcFolderState, Chip> = {
    qc_not_done: { tone: 'grey', text: '⏳', title: 'QC not done yet' },
    report_missing: { tone: 'red', text: 'missing', title: 'Report missing' },
    report_in: { tone: 'green', text: String(fileCount), title: 'Report in' },
    no_step: { tone: 'grey', text: String(fileCount), title: 'Extra files (no QC step)' },
  };
  return states[folder.state];
}

/** Every file in a folder, entry files first. */
export function folderFiles(folder: QcDossierFolder): QcDossierFile[] {
  return [...folder.entries.flatMap((e) => e.files), ...folder.files];
}

export const SOURCE_LABEL: Record<QcDossierFileSource, string> = {
  qc_entry: 'Op Entry / TPI',
  qc_document: 'QC Documents',
  job_card: 'Job Card',
};

/** "18-Oct" — the day and month of a stored date. */
export function shortDate(v: string | null): string {
  const d = fmtDate(v, '');
  return d.length >= 6 ? d.slice(0, 6) : d;
}

/** "Accepted 25 · 18-Oct" for a QC entry. */
export function entryLabel(e: Pick<QcDossierEntry, 'acceptedQty' | 'inspectedOn'>): string {
  const d = shortDate(e.inspectedOn);
  return d ? `Accepted ${e.acceptedQty} · ${d}` : `Accepted ${e.acceptedQty}`;
}

export interface DossierFileRow {
  kind: 'file';
  key: string;
  reportName: string;
  folder: QcDossierFolder | null;
  entry: QcDossierEntry | null;
  file: QcDossierFile;
}
export interface DossierMissingRow {
  kind: 'missing';
  key: string;
  reportName: string;
  folder: QcDossierFolder;
  entry: QcDossierEntry;
}
export type DossierRow = DossierFileRow | DossierMissingRow;

/** The file sheet for one POL (or one folder of it). A QC entry with no report
 *  becomes one red "no report" row so the gap sits where the file would. */
export function lineRows(line: QcDossierLine, folderName?: string): DossierRow[] {
  const rows: DossierRow[] = [];
  for (const folder of line.folders) {
    if (folderName && folder.reportName !== folderName) continue;
    for (const entry of folder.entries) {
      if (entry.files.length === 0) {
        if (entry.state === 'report_missing') {
          rows.push({
            kind: 'missing',
            key: `missing:${entry.opLogId}`,
            reportName: folder.reportName,
            folder,
            entry,
          });
        }
        continue;
      }
      for (const file of entry.files) {
        rows.push({
          kind: 'file',
          key: file.key,
          reportName: folder.reportName,
          folder,
          entry,
          file,
        });
      }
    }
    for (const file of folder.files) {
      rows.push({
        kind: 'file',
        key: file.key,
        reportName: folder.reportName,
        folder,
        entry: null,
        file,
      });
    }
  }
  return rows;
}

/** Rows for files that trace to no line. */
export function unlinkedRows(files: QcDossierFile[]): DossierRow[] {
  return files.map((file) => ({
    kind: 'file',
    key: file.key,
    reportName: QC_OTHER_FOLDER,
    folder: null,
    entry: null,
    file,
  }));
}

/** The text a row is searched by — every column the sheet shows. */
export function rowSearchFields(r: DossierRow): Array<string | number | null> {
  const qcEntry = r.entry ? entryLabel(r.entry) : null;
  if (r.kind === 'missing') return [r.reportName, r.entry.jcCode, qcEntry, 'no report'];
  return [
    r.reportName,
    r.file.fileName,
    r.file.jcCode ?? r.entry?.jcCode ?? null,
    qcEntry,
    r.file.uploadedByName,
    SOURCE_LABEL[r.file.source],
  ];
}

// ─── ZIP paths (owner decision D3) ─────────────────────────────────────────

/** Strip what a file system refuses in one path segment. `/` in an item code
 *  turns into `-` (VB-2210/C → VB-2210-C). */
export function zipSegment(s: string): string {
  return s
    .replace(/\//g, '-')
    .replace(/[\\:*?"<>|]+/g, '_')
    .trim();
}

/** `<SO code>[_<Internal SO No.>]` — the ZIP's top folder and file name. */
export function zipRootName(order: { code: string; internalSoNo: string | null }): string {
  return zipSegment(order.internalSoNo ? `${order.code}_${order.internalSoNo}` : order.code);
}

/** `POL-<pol>_<item code>` — one folder per order line. */
export function zipLineFolder(
  line: Pick<QcDossierLine, 'clientPoLineNo' | 'lineNo' | 'itemCode' | 'itemRevision'>,
): string {
  const pol = line.clientPoLineNo ?? String(line.lineNo);
  const code = line.itemCode
    ? line.itemRevision
      ? `${line.itemCode}/${line.itemRevision}`
      : line.itemCode
    : 'NO-ITEM';
  return zipSegment(`POL-${pol}_${code}`);
}

/** Full path of one file inside the ZIP. Earlier revisions get `earlier_`. */
export function zipFilePath(root: string, folders: string[], file: QcDossierFile): string {
  const name = zipSegment(file.current ? file.fileName : `earlier_${file.fileName}`);
  return [root, ...folders.map(zipSegment), name].join('/');
}

export interface ZipItem {
  path: string;
  storagePath: string;
  fileName: string;
}

/** Every file of the order (or of one line) with its place in the ZIP. Two
 *  files that would land on the same path get ` (2)`, ` (3)` … */
export function zipPlan(
  order: { code: string; internalSoNo: string | null },
  lines: QcDossierLine[],
  unlinked: QcDossierFile[],
): ZipItem[] {
  const root = zipRootName(order);
  const items: ZipItem[] = [];
  for (const line of lines) {
    const lf = zipLineFolder(line);
    for (const folder of line.folders) {
      for (const f of folderFiles(folder)) {
        items.push({
          path: zipFilePath(root, [lf, folder.reportName], f),
          storagePath: f.storagePath,
          fileName: f.fileName,
        });
      }
    }
  }
  for (const f of unlinked) {
    items.push({
      path: zipFilePath(root, ['Unlinked'], f),
      storagePath: f.storagePath,
      fileName: f.fileName,
    });
  }
  // Every FINAL path goes into `used` — a renamed one too — so "report.pdf" ×2
  // next to a real "report (2).pdf" still gives three distinct entries.
  const used = new Set<string>();
  return items.map((it) => {
    let path = it.path;
    if (used.has(path)) {
      const dot = it.path.lastIndexOf('.');
      const slash = it.path.lastIndexOf('/');
      const withN = (n: number): string =>
        dot > slash ? `${it.path.slice(0, dot)} (${n})${it.path.slice(dot)}` : `${it.path} (${n})`;
      let n = 2;
      while (used.has(withN(n))) n += 1;
      path = withN(n);
    }
    used.add(path);
    return path === it.path ? it : { ...it, path };
  });
}
