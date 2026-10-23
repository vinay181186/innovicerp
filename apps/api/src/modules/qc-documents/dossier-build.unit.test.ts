// ADR-252 — QC Dossier rules without a database. Run via
// `pnpm --filter @innovic/api test:unit`.

import { qcReportMandatory } from '@innovic/shared';
import { describe, expect, it } from 'vitest';
import { buildDossier, dossierPaths } from './dossier-build';
import type { DossierDocRow, DossierEntryRow, DossierRaw, DossierStepRow } from './dossier-types';

const DIR = { id: 'rt-dir', name: 'DIR', mandatory: true };
const FI = { id: 'rt-fi', name: 'Final Inspection', mandatory: false };
const COC = { id: 'rt-coc', name: 'COC', mandatory: false };

const line = (id: string, lineNo: number) => ({
  lineId: id,
  lineNo,
  clientPoLineNo: `P${lineNo}`,
  itemCode: 'ITM',
  itemRevision: 'A',
  itemName: 'Shaft',
  orderQty: 10,
});
const step = (over: Partial<DossierStepRow>): DossierStepRow => ({
  jcOpId: 'op1',
  jobCardId: 'jc1',
  opSeq: 20,
  operation: 'DIR',
  reportTypeId: DIR.id,
  reportName: DIR.name,
  mandatory: true,
  ...over,
});
const entry = (over: Partial<DossierEntryRow>): DossierEntryRow => ({
  id: 'e1',
  logNo: 'LOG-1',
  jcOpId: 'op1',
  logDate: '2026-10-20',
  qty: 5,
  rejectQty: 0,
  reportRequired: true,
  qcReportPath: null,
  qcReportName: null,
  createdAt: '2026-10-20T05:00:00.000Z',
  createdByName: 'Jinal',
  ...over,
});
const doc = (over: Partial<DossierDocRow>): DossierDocRow => ({
  source: 'qc_document',
  id: 'd1',
  opLogId: null,
  jcOpId: null,
  jobCardId: null,
  jcCodeText: null,
  lineId: null,
  reportTypeId: null,
  qcOpName: null,
  docType: null,
  fileName: 'f.pdf',
  storagePath: 'c1/qc/f.pdf',
  uploadedByName: 'Jinal',
  createdAt: '2026-10-21T05:00:00.000Z',
  ...over,
});
const raw = (over: Partial<DossierRaw>): DossierRaw => ({
  lines: [line('L1', 1)],
  jobCards: [{ id: 'jc1', code: 'IN-JC-1', lineId: 'L1' }],
  steps: [step({})],
  entries: [],
  docs: [],
  reportTypes: [DIR, FI, COC],
  ...over,
});

describe('QC Dossier line / folder state', () => {
  it('no job card → no_jc', () => {
    const b = buildDossier(raw({ jobCards: [], steps: [] }));
    expect(b.lines[0]).toMatchObject({ state: 'no_jc', missingCount: 0, folders: [] });
    expect(b.totals.noQc).toBe(1);
  });

  it('card with no report-producing QC step → no_qc_steps', () => {
    const b = buildDossier(raw({ steps: [step({ reportTypeId: null, reportName: null })] }));
    expect(b.lines[0]!.state).toBe('no_qc_steps');
    expect(b.lines[0]!.folders).toEqual([]);
  });

  it('step with no entry yet → qc_not_done folder, qc_pending line, nothing missing', () => {
    const b = buildDossier(raw({}));
    expect(b.lines[0]).toMatchObject({ state: 'qc_pending', missingCount: 0 });
    expect(b.lines[0]!.folders[0]).toMatchObject({
      reportName: 'DIR',
      isStep: true,
      state: 'qc_not_done',
    });
  });

  it('one entry without its report → report_missing, counted once', () => {
    const b = buildDossier(
      raw({
        entries: [
          entry({ id: 'e1', qcReportPath: 'c1/qc/a.pdf', qcReportName: 'a.pdf' }),
          entry({ id: 'e2', logNo: 'LOG-2' }),
        ],
      }),
    );
    const l = b.lines[0]!;
    expect(l).toMatchObject({ state: 'report_missing', missingCount: 1, fileCount: 1 });
    expect(l.folders[0]!.state).toBe('report_missing');
    expect(l.folders[0]!.entries.map((e) => [e.opLogId, e.state])).toEqual([
      ['e1', 'report_in'],
      ['e2', 'report_missing'],
    ]);
    expect(b.totals).toMatchObject({ reportMissing: 1, missingReports: 1 });
    expect(b.opIndex.get('op1')).toMatchObject({ entries: 2, missing: 1 });
  });

  it('entry stamped report_required = false with no file → not missing (system-carried)', () => {
    const b = buildDossier(raw({ entries: [entry({ reportRequired: false })] }));
    const l = b.lines[0]!;
    expect(l).toMatchObject({ state: 'complete', missingCount: 0 });
    expect(l.folders[0]!.state).toBe('report_in');
    expect(l.folders[0]!.entries[0]!.state).toBe('report_in');
    expect(b.opIndex.get('op1')).toMatchObject({ entries: 1, missing: 0 });
  });

  it('entry from before ADR-252 (report_required NULL) with no file → missing in the Dossier (D8)', () => {
    const b = buildDossier(raw({ entries: [entry({ reportRequired: null })] }));
    expect(b.lines[0]).toMatchObject({ state: 'report_missing', missingCount: 1 });
    expect(b.lines[0]!.folders[0]!.entries[0]!.state).toBe('report_missing');
    expect(b.opIndex.get('op1')).toMatchObject({ entries: 1, missing: 1 });
  });

  it('every entry reported → complete (upload by QC entry counts like the Submit QC file)', () => {
    const b = buildDossier(
      raw({
        entries: [entry({ id: 'e1', qcReportPath: 'c1/qc/a.pdf' }), entry({ id: 'e2' })],
        docs: [doc({ id: 'd2', opLogId: 'e2' })],
      }),
    );
    expect(b.lines[0]).toMatchObject({ state: 'complete', missingCount: 0, fileCount: 2 });
    expect(b.totals.complete).toBe(1);
    expect(b.opIndex.get('op1')).toMatchObject({ entries: 2, missing: 0 });
  });

  it('accepted 0 (all deviated) is not missing, and the step counts as done', () => {
    const b = buildDossier(raw({ entries: [entry({ qty: 0, rejectQty: 5 })] }));
    expect(b.lines[0]).toMatchObject({ state: 'complete', missingCount: 0 });
    expect(b.lines[0]!.folders[0]!.entries).toEqual([]);
  });

  it('rework child card sits under the parent line', () => {
    const b = buildDossier(
      raw({
        jobCards: [
          { id: 'jc1', code: 'IN-JC-1', lineId: 'L1' },
          { id: 'jc2', code: 'IN-JC-1-R1', lineId: 'L1' },
        ],
        steps: [step({}), step({ jcOpId: 'op2', jobCardId: 'jc2' })],
        entries: [
          entry({ id: 'e1', qcReportPath: 'c1/a.pdf' }),
          entry({ id: 'e2', jcOpId: 'op2' }),
        ],
      }),
    );
    const l = b.lines[0]!;
    expect(l.jobCards.map((j) => j.code)).toEqual(['IN-JC-1', 'IN-JC-1-R1']);
    expect(l.folders).toHaveLength(1);
    expect(l.folders[0]!.entries.map((e) => e.jcCode)).toEqual(['IN-JC-1', 'IN-JC-1-R1']);
    expect(l.missingCount).toBe(1);
  });

  it('several files on one entry → newest is current (D4)', () => {
    const b = buildDossier(
      raw({
        entries: [entry({ qcReportPath: 'c1/old.pdf', createdAt: '2026-10-20T05:00:00.000Z' })],
        docs: [
          doc({
            id: 'new',
            opLogId: 'e1',
            storagePath: 'c1/new.pdf',
            createdAt: '2026-10-22T05:00:00.000Z',
          }),
        ],
      }),
    );
    const files = b.lines[0]!.folders[0]!.entries[0]!.files;
    expect(files.map((f) => [f.storagePath, f.current])).toEqual([
      ['c1/new.pdf', true],
      ['c1/old.pdf', false],
    ]);
  });

  it('extra files: own folder (no_step), Other last, SO-only file unlinked', () => {
    const b = buildDossier(
      raw({
        entries: [entry({ qcReportPath: 'c1/a.pdf' })],
        docs: [
          doc({ id: 'c', lineId: 'L1', reportTypeId: COC.id, storagePath: 'c1/coc.pdf' }),
          doc({ id: 'x', lineId: 'L1', docType: 'Mystery', storagePath: 'c1/x.pdf' }),
          doc({
            id: 'jcf',
            source: 'job_card',
            jobCardId: 'jc1',
            docType: 'Final Inspection',
            storagePath: 'c1/fi.pdf',
          }),
          doc({ id: 'u', storagePath: 'c1/so-only.pdf' }),
        ],
      }),
    );
    const l = b.lines[0]!;
    expect(l.folders.map((f) => [f.reportName, f.state])).toEqual([
      ['DIR', 'report_in'],
      ['COC', 'no_step'],
      ['Final Inspection', 'no_step'],
      ['Other', 'no_step'],
    ]);
    expect(l.state).toBe('complete');
    expect(b.unlinked.map((f) => f.storagePath)).toEqual(['c1/so-only.pdf']);
    expect([...dossierPaths(b)].sort()).toEqual(
      ['c1/a.pdf', 'c1/coc.pdf', 'c1/fi.pdf', 'c1/so-only.pdf', 'c1/x.pdf'].sort(),
    );
  });

  it('legacy upload on the QC op (jc_op_id, no entry) is a folder file, not the entry report', () => {
    const b = buildDossier(
      raw({ entries: [entry({})], docs: [doc({ jcOpId: 'op1', jobCardId: 'jc1' })] }),
    );
    const f = b.lines[0]!.folders[0]!;
    expect(f.files).toHaveLength(1);
    expect(f.state).toBe('report_missing');
    expect(b.opIndex.get('op1')!.files).toHaveLength(1);
  });

  it('folders follow route order', () => {
    const b = buildDossier(
      raw({
        steps: [
          step({
            jcOpId: 'op9',
            opSeq: 90,
            operation: 'Final Inspection',
            reportTypeId: FI.id,
            reportName: FI.name,
            mandatory: false,
          }),
          step({ jcOpId: 'op1', opSeq: 20 }),
        ],
      }),
    );
    expect(b.lines[0]!.folders.map((f) => f.reportName)).toEqual(['DIR', 'Final Inspection']);
  });
});

describe('Submit QC rule (shared qcReportMandatory)', () => {
  const dir = { code: 'DIR', reportTypeId: DIR.id, reportTypeName: 'DIR', reportMandatory: true };
  const fi = {
    code: 'Final Inspection',
    reportTypeId: FI.id,
    reportTypeName: 'Final Inspection',
    reportMandatory: false,
  };
  it('mandatory report + accepted qty → must attach; matching is trimmed and case-insensitive', () => {
    expect(qcReportMandatory(' dir ', 3, [dir])).toBe(true);
  });
  it('accepted 0, optional report, or no process → saves without a report', () => {
    expect(qcReportMandatory('DIR', 0, [dir])).toBe(false);
    expect(qcReportMandatory('Final Inspection', 3, [fi])).toBe(false);
    expect(qcReportMandatory('Turning', 3, [dir])).toBe(false);
  });
});
