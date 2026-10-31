import type { QcDossierFile, QcDossierFolder, QcDossierLine } from '@innovic/shared';
import { describe, expect, it } from 'vitest';
import {
  entryLabel,
  folderChip,
  lineChip,
  lineRows,
  zipFilePath,
  zipLineFolder,
  zipPlan,
  zipRootName,
} from './dossier-model';

function file(over: Partial<QcDossierFile> = {}): QcDossierFile {
  return {
    key: 'qc_document:1',
    source: 'qc_document',
    qcDocumentId: '1',
    fileName: 'DIR.pdf',
    storagePath: 'c/qc-docs/1-DIR.pdf',
    uploadedByName: 'Shivani P.',
    uploadedAt: '2026-10-18T10:00:00Z',
    jcCode: 'IN-JC-26-00031',
    current: true,
    ...over,
  };
}

function folder(over: Partial<QcDossierFolder> = {}): QcDossierFolder {
  return {
    reportTypeId: 'rt-1',
    reportName: 'DIR',
    mandatory: true,
    isStep: true,
    state: 'report_in',
    entries: [],
    files: [],
    ...over,
  };
}

function line(over: Partial<QcDossierLine> = {}): QcDossierLine {
  return {
    lineId: 'l1',
    lineNo: 1,
    clientPoLineNo: '10',
    itemCode: 'VB-2210',
    itemRevision: 'C',
    itemName: 'Valve Body',
    orderQty: 40,
    jobCards: [{ id: 'j1', code: 'IN-JC-26-00031' }],
    state: 'complete',
    missingCount: 0,
    fileCount: 0,
    folders: [],
    ...over,
  };
}

describe('lineChip — line state → chip', () => {
  it('maps every state', () => {
    expect(lineChip(line({ state: 'no_jc' }))).toMatchObject({ tone: 'grey', text: 'No JC yet' });
    expect(lineChip(line({ state: 'no_qc_steps' }))).toMatchObject({
      tone: 'grey',
      text: 'No QC steps',
    });
    expect(lineChip(line({ state: 'qc_pending' }))).toMatchObject({
      tone: 'grey',
      text: 'QC not done',
    });
    expect(lineChip(line({ state: 'complete' }))).toMatchObject({ tone: 'green', text: '✓' });
  });
  it('report_missing is red with no files, orange with some', () => {
    expect(lineChip(line({ state: 'report_missing', missingCount: 2 }))).toMatchObject({
      tone: 'red',
      text: '2 missing',
    });
    expect(
      lineChip(line({ state: 'report_missing', missingCount: 1, fileCount: 3 })),
    ).toMatchObject({ tone: 'orange', text: '1 missing' });
  });
});

describe('folderChip', () => {
  it('maps every folder state', () => {
    expect(folderChip({ state: 'qc_not_done' }, 0).tone).toBe('grey');
    expect(folderChip({ state: 'report_missing' }, 0)).toMatchObject({
      tone: 'red',
      text: 'missing',
    });
    expect(folderChip({ state: 'report_in' }, 2)).toMatchObject({ tone: 'green', text: '2' });
    expect(folderChip({ state: 'no_step' }, 1)).toMatchObject({ tone: 'grey', text: '1' });
  });
});

describe('lineRows', () => {
  it('turns a QC entry with no report into one missing row', () => {
    const l = line({
      folders: [
        folder({
          state: 'report_missing',
          entries: [
            {
              opLogId: 'op1',
              logNo: 'L1',
              jobCardId: 'j1',
              jcCode: 'IN-JC-26-00031',
              inspectedOn: '2026-10-20',
              acceptedQty: 15,
              rejectedQty: 0,
              remarks: null,
              reportRequired: true,
              reportMandatory: true,
              state: 'report_missing',
              files: [],
            },
          ],
          files: [file({ key: 'qc_document:2' })],
        }),
      ],
    });
    const rows = lineRows(l);
    expect(rows.map((r) => r.kind)).toEqual(['missing', 'file']);
    const first = rows[0];
    expect(first && first.entry ? entryLabel(first.entry) : '').toBe('Accepted 15 · 20-Oct');
    expect(lineRows(l, 'MIR')).toEqual([]);
  });
});

describe('ZIP paths', () => {
  it('names the root with the Internal SO No. when there is one', () => {
    expect(zipRootName({ code: 'IN-SO-00042', internalSoNo: 'SO-2611' })).toBe(
      'IN-SO-00042_SO-2611',
    );
    expect(zipRootName({ code: 'IN-JW-00007', internalSoNo: null })).toBe('IN-JW-00007');
  });
  it('turns / in the item code into -', () => {
    expect(zipLineFolder(line())).toBe('POL-10_VB-2210-C');
    expect(zipLineFolder(line({ clientPoLineNo: null, itemRevision: null }))).toBe('POL-1_VB-2210');
  });
  it('prefixes earlier revisions', () => {
    expect(zipFilePath('R', ['POL-10_X', 'DIR'], file({ current: false }))).toBe(
      'R/POL-10_X/DIR/earlier_DIR.pdf',
    );
  });
  it('plans the whole order, unlinked files under Unlinked/, duplicates numbered', () => {
    const l = line({
      folders: [folder({ files: [file(), file({ key: 'qc_document:3', storagePath: 'p2' })] })],
    });
    const plan = zipPlan({ code: 'IN-SO-00042', internalSoNo: null }, [l], [file({ key: 'u' })]);
    expect(plan.map((p) => p.path)).toEqual([
      'IN-SO-00042/POL-10_VB-2210-C/DIR/DIR.pdf',
      'IN-SO-00042/POL-10_VB-2210-C/DIR/DIR (2).pdf',
      'IN-SO-00042/Unlinked/DIR.pdf',
    ]);
  });
  it('never lets a renamed duplicate collide with a real "name (2)" file', () => {
    const l = line({
      folders: [
        folder({
          files: [
            file({ key: 'a', fileName: 'report.pdf', storagePath: 'pa' }),
            file({ key: 'b', fileName: 'report.pdf', storagePath: 'pb' }),
            file({ key: 'c', fileName: 'report (2).pdf', storagePath: 'pc' }),
          ],
        }),
      ],
    });
    const plan = zipPlan({ code: 'IN-SO-00042', internalSoNo: null }, [l], []);
    const paths = plan.map((p) => p.path);
    expect(new Set(paths).size).toBe(3);
    expect(plan.map((p) => p.storagePath)).toEqual(['pa', 'pb', 'pc']);
    expect(paths).toEqual([
      'IN-SO-00042/POL-10_VB-2210-C/DIR/report.pdf',
      'IN-SO-00042/POL-10_VB-2210-C/DIR/report (2).pdf',
      'IN-SO-00042/POL-10_VB-2210-C/DIR/report (2) (2).pdf',
    ]);
  });
});
