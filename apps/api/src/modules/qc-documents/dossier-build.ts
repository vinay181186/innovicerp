// ADR-252 — QC Dossier: the pure part. Turns the rows dossier-sql.ts reads into
// lines -> report folders -> QC entries -> files, and the per-op index the QC
// Matrix and SO QC Status read, so all three screens count the same way.
//
// The rules (owner decisions D1–D8):
//   - A line's folders are the Report Types its job cards' QC steps produce
//     (QC op -> QC Process Master -> Report Type). Steps whose process has no
//     report type add no folder.
//   - A report belongs to its QC ENTRY. An entry (accepted qty > 0) with no
//     file is MISSING unless it was stamped report_required = false
//     (entryReportMissing below). A step with no entry yet is "QC not done" — grey, not
//     missing. Reversed entries never reach here (the SQL drops them).
//   - Several files on one entry: newest is current, older ones are earlier
//     revisions (D4).
//   - Line state: no_jc -> no_qc_steps -> report_missing -> qc_pending ->
//     complete (D2: complete only when every step has entries and every entry
//     with accepted qty has its report).

import {
  QC_OTHER_FOLDER,
  type QcDossierEntry,
  type QcDossierFile,
  type QcDossierFolder,
  type QcDossierLine,
  type QcDossierResponse,
  qcProcessKey,
} from '@innovic/shared';
import type {
  DossierDocRow,
  DossierEntryRow,
  DossierRaw,
  DossierReportTypeRow,
  DossierStepRow,
} from './dossier-types';

/** Per QC op: what the Matrix / SO QC Status cell reads. */
export interface DossierOpIndex {
  /** Entries with accepted qty > 0. */
  entries: number;
  /** Of those, without a report (only counted when the op produces one). */
  missing: number;
  /** Every file on the op, newest first. */
  files: QcDossierFile[];
}

export interface DossierBuilt {
  lines: QcDossierLine[];
  unlinked: QcDossierFile[];
  totals: QcDossierResponse['totals'];
  opIndex: Map<string, DossierOpIndex>;
}

/**
 * THE missing-report rule (ADR-252), used for the entry state, the folder /
 * line counts and the Matrix / SO QC Status op index alike. An entry is
 * missing its report only when ALL hold:
 *   - its step produces a report (QC process -> Report Type),
 *   - it accepted pieces (qty > 0),
 *   - no file is on it,
 *   - report_required is not false — true, or NULL = saved before ADR-252
 *     (D8: red here). A system-carried entry (Incoming QC mirror, NC
 *     re-entry) is stamped false: nothing is owed on it.
 * The home dashboard's "Reports to upload" list (rows-qc.ts) is the same rule
 * with report_required = true only — the one intended difference (D8).
 */
export function entryReportMissing(
  e: Pick<DossierEntryRow, 'qty' | 'reportRequired'>,
  step: Pick<DossierStepRow, 'reportTypeId'>,
  hasFile: boolean,
): boolean {
  return !!step.reportTypeId && e.qty > 0 && !hasFile && e.reportRequired !== false;
}

const OTHER = '__other';
const newestFirst = (a: QcDossierFile, b: QcDossierFile) =>
  b.uploadedAt.localeCompare(a.uploadedAt) || a.key.localeCompare(b.key);

interface FolderAcc {
  folder: QcDossierFolder;
  order: number;
  notDone: boolean;
}

export function buildDossier(raw: DossierRaw): DossierBuilt {
  const jcById = new Map(raw.jobCards.map((j) => [j.id, j]));
  const lineIds = new Set(raw.lines.map((l) => l.lineId));
  const stepById = new Map(raw.steps.map((s) => [s.jcOpId, s]));
  const rtById = new Map(raw.reportTypes.map((r) => [r.id, r]));
  const rtByKey = new Map<string, DossierReportTypeRow>();
  for (const r of raw.reportTypes)
    if (!rtByKey.has(qcProcessKey(r.name))) rtByKey.set(qcProcessKey(r.name), r);
  const entryById = new Map(raw.entries.map((e) => [e.id, e]));
  const lineOfStep = (s: DossierStepRow) => jcById.get(s.jobCardId)?.lineId ?? null;

  // ── Files, each placed on an entry, an op folder, a line folder or nowhere ──
  const entryFiles = new Map<string, QcDossierFile[]>();
  const opFiles = new Map<string, QcDossierFile[]>();
  const folderFiles = new Map<
    string,
    Map<string, { rt: DossierReportTypeRow | null; files: QcDossierFile[] }>
  >();
  const unlinked: QcDossierFile[] = [];
  const push = <K>(m: Map<K, QcDossierFile[]>, k: K, f: QcDossierFile) => {
    const a = m.get(k);
    if (a) a.push(f);
    else m.set(k, [f]);
  };
  const toFolder = (lineId: string, rt: DossierReportTypeRow | null, f: QcDossierFile) => {
    let byRt = folderFiles.get(lineId);
    if (!byRt) folderFiles.set(lineId, (byRt = new Map()));
    const k = rt?.id ?? OTHER;
    const cur = byRt.get(k);
    if (cur) cur.files.push(f);
    else byRt.set(k, { rt, files: [f] });
  };
  const stepRt = (s: DossierStepRow): DossierReportTypeRow | null =>
    s.reportTypeId
      ? (rtById.get(s.reportTypeId) ?? {
          id: s.reportTypeId,
          name: s.reportName ?? QC_OTHER_FOLDER,
          mandatory: s.mandatory,
        })
      : null;

  for (const e of raw.entries) {
    if (!e.qcReportPath?.trim()) continue;
    const f: QcDossierFile = {
      key: `qc_entry:${e.id}`,
      source: 'qc_entry',
      qcDocumentId: null,
      fileName: e.qcReportName?.trim() || e.qcReportPath.split('/').pop() || e.qcReportPath,
      storagePath: e.qcReportPath,
      uploadedByName: e.createdByName,
      uploadedAt: e.createdAt,
      jcCode: jcCodeOfOp(e.jcOpId),
      current: false,
    };
    placeOnEntry(e, f);
  }

  for (const d of raw.docs) {
    const jc = d.jobCardId ? jcById.get(d.jobCardId) : undefined;
    const f: QcDossierFile = {
      key: `${d.source}:${d.id}`,
      source: d.source,
      qcDocumentId: d.source === 'qc_document' ? d.id : null,
      fileName: d.fileName,
      storagePath: d.storagePath,
      uploadedByName: d.uploadedByName,
      uploadedAt: d.createdAt,
      jcCode: jc?.code ?? d.jcCodeText,
      current: true,
    };
    const entry = d.opLogId ? entryById.get(d.opLogId) : undefined;
    if (entry) {
      placeOnEntry(entry, f);
      continue;
    }
    // A file on a QC op (legacy jc_op_id link, or a JC file named like one of
    // that card's QC steps) is a file of that step's folder.
    let step = d.jcOpId ? stepById.get(d.jcOpId) : undefined;
    if (!step && jc) {
      const names = [d.qcOpName, d.docType].map(qcProcessKey).filter(Boolean);
      step = raw.steps.find(
        (s) =>
          s.jobCardId === jc.id &&
          names.some((n) => n === qcProcessKey(s.operation) || n === qcProcessKey(s.reportName)),
      );
    }
    if (step) {
      push(opFiles, step.jcOpId, f);
      const lineId = lineOfStep(step);
      const rt = stepRt(step) ?? namedRt(d);
      if (lineId) toFolder(lineId, rt, f);
      else unlinked.push(f);
      continue;
    }
    const lineId = d.lineId && lineIds.has(d.lineId) ? d.lineId : (jc?.lineId ?? null);
    if (lineId) toFolder(lineId, namedRt(d), f);
    else unlinked.push(f);
  }

  function namedRt(d: DossierDocRow): DossierReportTypeRow | null {
    if (d.reportTypeId && rtById.has(d.reportTypeId)) return rtById.get(d.reportTypeId)!;
    return rtByKey.get(qcProcessKey(d.docType)) ?? null;
  }
  function jcCodeOfOp(jcOpId: string): string | null {
    const s = stepById.get(jcOpId);
    return s ? (jcById.get(s.jobCardId)?.code ?? null) : null;
  }
  function placeOnEntry(e: DossierEntryRow, f: QcDossierFile) {
    const step = stepById.get(e.jcOpId);
    push(opFiles, e.jcOpId, f);
    // A file on an entry of a step that produces no report, or on an entry
    // that accepted nothing, still shows: as a file of the step's folder.
    if (step?.reportTypeId && e.qty > 0) push(entryFiles, e.id, f);
    else {
      const lineId = step ? lineOfStep(step) : null;
      if (lineId) toFolder(lineId, step ? stepRt(step) : null, f);
      else unlinked.push(f);
    }
  }

  // ── Entries per op, the op index ──
  const entriesByOp = new Map<string, DossierEntryRow[]>();
  for (const e of raw.entries) {
    const a = entriesByOp.get(e.jcOpId);
    if (a) a.push(e);
    else entriesByOp.set(e.jcOpId, [e]);
  }
  const toEntry = (e: DossierEntryRow, s: DossierStepRow): QcDossierEntry => {
    const files = (entryFiles.get(e.id) ?? [])
      .sort(newestFirst)
      .map((f, i) => ({ ...f, current: i === 0 }));
    const jc = jcById.get(s.jobCardId)!;
    return {
      opLogId: e.id,
      logNo: e.logNo,
      jobCardId: jc.id,
      jcCode: jc.code,
      inspectedOn: e.logDate ? e.logDate.slice(0, 10) : null,
      acceptedQty: e.qty,
      rejectedQty: e.rejectQty,
      reportRequired: e.reportRequired,
      state: entryReportMissing(e, s, files.length > 0) ? 'report_missing' : 'report_in',
      files,
    };
  };
  const opIndex = new Map<string, DossierOpIndex>();
  for (const s of raw.steps) {
    const accepted = (entriesByOp.get(s.jcOpId) ?? []).filter((e) => e.qty > 0);
    const missing = accepted.filter((e) =>
      entryReportMissing(e, s, (entryFiles.get(e.id)?.length ?? 0) > 0),
    ).length;
    opIndex.set(s.jcOpId, {
      entries: accepted.length,
      missing,
      files: [...(opFiles.get(s.jcOpId) ?? [])].sort(newestFirst),
    });
  }

  // ── Lines ──
  const stepsByLine = new Map<string, DossierStepRow[]>();
  for (const s of [...raw.steps].sort((a, b) => a.opSeq - b.opSeq)) {
    const lineId = lineOfStep(s);
    if (!lineId) continue;
    const a = stepsByLine.get(lineId);
    if (a) a.push(s);
    else stepsByLine.set(lineId, [s]);
  }
  const jcsByLine = new Map<string, Array<{ id: string; code: string }>>();
  for (const j of raw.jobCards) {
    const a = jcsByLine.get(j.lineId);
    if (a) a.push({ id: j.id, code: j.code });
    else jcsByLine.set(j.lineId, [{ id: j.id, code: j.code }]);
  }

  const totals: QcDossierResponse['totals'] = {
    complete: 0,
    reportMissing: 0,
    qcPending: 0,
    noQc: 0,
    missingReports: 0,
    files: unlinked.length,
  };
  const lines: QcDossierLine[] = [...raw.lines]
    .sort((a, b) => a.lineNo - b.lineNo)
    .map((l) => {
      const accs = new Map<string, FolderAcc>();
      const ensure = (
        rt: DossierReportTypeRow | null,
        isStep: boolean,
        order: number,
      ): FolderAcc => {
        const k = rt?.id ?? OTHER;
        let acc = accs.get(k);
        if (!acc) {
          acc = {
            folder: {
              reportTypeId: rt?.id ?? null,
              reportName: rt?.name ?? QC_OTHER_FOLDER,
              mandatory: rt?.mandatory ?? false,
              isStep,
              state: 'no_step',
              entries: [],
              files: [],
            },
            order,
            notDone: false,
          };
          accs.set(k, acc);
        } else if (isStep && !acc.folder.isStep) {
          acc.folder.isStep = true;
          acc.order = Math.min(acc.order, order);
        }
        return acc;
      };
      for (const s of stepsByLine.get(l.lineId) ?? []) {
        const rt = stepRt(s);
        if (!rt) continue;
        const acc = ensure(rt, true, s.opSeq);
        const all = entriesByOp.get(s.jcOpId) ?? [];
        if (all.length === 0 || !s.opDone) acc.notDone = true;
        for (const e of all) if (e.qty > 0) acc.folder.entries.push(toEntry(e, s));
      }
      for (const { rt, files } of folderFiles.get(l.lineId)?.values() ?? []) {
        ensure(rt, false, Number.MAX_SAFE_INTEGER).folder.files.push(...files.sort(newestFirst));
      }
      let missingCount = 0;
      let fileCount = 0;
      let notDone = false;
      const folders = [...accs.values()]
        .sort((a, b) => {
          const ao = a.folder.reportTypeId === null ? 2 : a.folder.isStep ? 0 : 1;
          const bo = b.folder.reportTypeId === null ? 2 : b.folder.isStep ? 0 : 1;
          if (ao !== bo) return ao - bo;
          if (a.order !== b.order) return a.order - b.order;
          return a.folder.reportName.localeCompare(b.folder.reportName);
        })
        .map(({ folder, notDone: nd }) => {
          const missing = folder.entries.filter((e) => e.state === 'report_missing').length;
          // Current files only: an earlier revision is not another report.
          fileCount +=
            folder.files.length +
            folder.entries.reduce((n, e) => n + e.files.filter((f) => f.current).length, 0);
          if (folder.isStep) {
            missingCount += missing;
            if (nd) notDone = true;
            folder.state = missing > 0 ? 'report_missing' : nd ? 'qc_not_done' : 'report_in';
          }
          return folder;
        });
      const jobCards = (jcsByLine.get(l.lineId) ?? []).sort((a, b) => a.code.localeCompare(b.code));
      const hasSteps = folders.some((f) => f.isStep);
      const state: QcDossierLine['state'] =
        jobCards.length === 0
          ? 'no_jc'
          : !hasSteps
            ? 'no_qc_steps'
            : missingCount > 0
              ? 'report_missing'
              : notDone
                ? 'qc_pending'
                : 'complete';
      if (state === 'complete') totals.complete++;
      else if (state === 'report_missing') totals.reportMissing++;
      else if (state === 'qc_pending') totals.qcPending++;
      else totals.noQc++;
      totals.missingReports += missingCount;
      totals.files += fileCount;
      return { ...l, jobCards, state, missingCount, fileCount, folders };
    });

  return { lines, unlinked: unlinked.sort(newestFirst), totals, opIndex };
}

/** Every storage path the dossier shows — the set a bulk download may sign. */
export function dossierPaths(b: Pick<DossierBuilt, 'lines' | 'unlinked'>): Set<string> {
  const out = new Set<string>();
  for (const f of b.unlinked) out.add(f.storagePath);
  for (const l of b.lines)
    for (const fo of l.folders) {
      for (const f of fo.files) out.add(f.storagePath);
      for (const e of fo.entries) for (const f of e.files) out.add(f.storagePath);
    }
  return out;
}
