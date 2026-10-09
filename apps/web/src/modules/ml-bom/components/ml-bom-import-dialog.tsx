// Multi-Level BOM — Excel import dialog (ADR-225 phase 2). The shape of
// components/shared/master-import-dialog.tsx:
//
//   1. Choose  — the file.
//   2. Preview — the rows go to POST /ml-boms/import with dryRun: true; the
//                server checks the whole file and saves nothing. Tree, counts,
//                and the rows that carry an error or a warning.
//   3. Result  — the SAME rows with dryRun: false. All or nothing: the server
//                saves every BOM in one transaction, or none.
//
// The result names BOMs by code (no ids), so BOM No. links to the list
// filtered on that code (`/ml-boms?search=<code>`).

import {
  BOM_LINE_TYPE_LABEL,
  ML_BOM_IMPORT_HEADERS,
  type MlBomImportBom,
  type MlBomImportResult,
  type MlBomImportRow,
  type MlBomImportTreeRow,
} from '@innovic/shared';
import { Link } from '@tanstack/react-router';
import { useMemo, useState } from 'react';
import { useSaveKey } from '@/lib/use-save-key';
import { Button, Icon } from '@/ui/core';
import { DataTable, type DataTableColumn, StatStrip } from '@/ui/data';
import { Banner, Modal } from '@/ui/feedback';
import { useImportMlBoms } from '../api';
import { parseMlBomFile } from './ml-bom-import-parse';

type Step = 'choose' | 'preview' | 'done';

const ERRORS_FILE = 'Multi-Level-BOM-Import-Errors.xlsx';

const dash = <span className="text3">—</span>;

const strongCode = (code: string | null | undefined): React.ReactNode =>
  code ? (
    <span className="mono fw-700" style={{ color: 'var(--text)' }}>
      {code}
    </span>
  ) : (
    dash
  );

/** Quantities arrive as numeric strings; drop trailing zeros only. */
const qty = (v: string | null): React.ReactNode => (v == null ? dash : String(Number(v)));

const TREE_COLUMNS: DataTableColumn<MlBomImportTreeRow>[] = [
  { header: 'Level', align: 'right', className: 'mono', render: (n) => n.depth },
  {
    header: 'Item Code',
    align: 'left',
    nowrap: true,
    // Indented by depth, exactly as the detail page's Tree tab.
    render: (n) => (
      <span style={{ paddingLeft: n.depth * 18 }}>
        {n.depth > 0 ? <span className="text3">└ </span> : null}
        {strongCode(n.itemCode)}
      </span>
    ),
  },
  {
    header: 'Item Name',
    align: 'left',
    ellipsis: true,
    render: (n) => n.itemName ?? dash,
    title: (n) => n.itemName ?? '',
  },
  {
    header: 'Line Type',
    nowrap: true,
    render: (n) => (n.bomType ? BOM_LINE_TYPE_LABEL[n.bomType] : dash),
  },
  {
    header: 'Qty per Set',
    align: 'right',
    nowrap: true,
    className: 'mono',
    render: (n) => qty(n.qtyPerSet),
  },
  {
    header: 'Exploded Qty',
    align: 'right',
    nowrap: true,
    className: 'mono fw-700',
    render: (n) => qty(n.explodedQty),
  },
  { header: 'UOM', nowrap: true, className: 'mono', render: (n) => n.uom ?? dash },
  {
    header: 'Sub-Assembly',
    nowrap: true,
    render: (n) => (n.isSubAssembly ? <span style={{ color: 'var(--green2)' }}>✓</span> : dash),
  },
];

interface MessageRow {
  rowNum: number;
  sheet: MlBomImportRow | undefined;
  status: 'warning' | 'error';
  messages: string[];
}

const MESSAGE_COLUMNS: DataTableColumn<MessageRow>[] = [
  { header: 'Sheet Row', align: 'right', className: 'mono', render: (m) => m.rowNum },
  { header: 'BOM Item Code', nowrap: true, render: (m) => strongCode(m.sheet?.bomItemCode) },
  { header: 'Child Item Code', nowrap: true, render: (m) => strongCode(m.sheet?.childItemCode) },
  {
    header: 'Result',
    nowrap: true,
    render: (m) =>
      m.status === 'error' ? (
        <span className="fw-700" style={{ color: 'var(--red2)' }} title="Error">
          ✗
        </span>
      ) : (
        <span className="fw-700" style={{ color: 'var(--amber2)' }} title="Warning">
          !
        </span>
      ),
  },
  {
    header: 'Messages',
    align: 'left',
    ellipsis: true,
    render: (m) => (
      <span style={{ color: m.status === 'error' ? 'var(--red2)' : 'var(--amber2)' }}>
        {m.messages.join('; ')}
      </span>
    ),
    title: (m) => m.messages.join('\n'),
  },
];

const ACTION_LABEL: Record<MlBomImportBom['action'], string> = {
  create: 'Created',
  revise: 'Revised',
};

function bomColumns(onOpen: () => void): DataTableColumn<MlBomImportBom>[] {
  return [
    { header: 'Item Code', nowrap: true, render: (b) => strongCode(b.itemCode) },
    {
      header: 'Item Name',
      align: 'left',
      ellipsis: true,
      render: (b) => b.itemName ?? dash,
      title: (b) => b.itemName ?? '',
    },
    {
      header: 'BOM No.',
      nowrap: true,
      render: (b) =>
        b.code ? (
          <Link
            to="/ml-boms"
            search={{ search: b.code, page: 1 }}
            className="td-code"
            onClick={onOpen}
          >
            {b.code}
          </Link>
        ) : (
          dash
        ),
    },
    { header: 'BOM Action', nowrap: true, render: (b) => ACTION_LABEL[b.action] },
    { header: 'BOM Rev', align: 'right', className: 'mono', render: (b) => b.revision },
    { header: 'Lines', align: 'right', className: 'mono', render: (b) => b.lineCount },
    {
      header: 'Sub-Assemblies',
      align: 'right',
      className: 'mono',
      render: (b) => b.subAssemblyCount,
    },
  ];
}

function messageRows(rows: MlBomImportRow[], result: MlBomImportResult | null): MessageRow[] {
  if (!result) return [];
  const byNum = new Map(rows.map((r) => [r.rowNum, r]));
  return result.rows
    .filter((r) => r.messages.length > 0)
    .map(
      (r): MessageRow => ({
        rowNum: r.rowNum,
        sheet: byNum.get(r.rowNum),
        status: r.status === 'error' ? 'error' : 'warning',
        messages: r.messages,
      }),
    )
    .sort((a, b) => a.rowNum - b.rowNum);
}

async function downloadErrors(msgs: MessageRow[], fileErrors: string[]): Promise<void> {
  const XLSX = await import('xlsx');
  const aoa: (string | number)[][] = [['Sheet Row', ...ML_BOM_IMPORT_HEADERS, 'Reason']];
  for (const e of fileErrors) aoa.push(['', '', '', '', '', '', '', '', e]);
  for (const m of msgs) {
    const s = m.sheet;
    aoa.push([
      m.rowNum,
      s?.bomItemCode ?? '',
      s?.childItemCode ?? '',
      s?.qtyPerSet ?? '',
      s?.lineType ?? '',
      s?.rawMaterialGrade ?? '',
      s?.rawMaterialSize ?? '',
      s?.remarks ?? '',
      m.messages.join('; '),
    ]);
  }
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws['!cols'] = [10, 20, 20, 12, 14, 16, 16, 30, 80].map((wch) => ({ wch }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Errors');
  XLSX.writeFile(wb, ERRORS_FILE);
}

export interface MlBomImportDialogProps {
  onClose: () => void;
}

export function MlBomImportDialog({ onClose }: MlBomImportDialogProps): React.JSX.Element {
  // One save key per dialog open (the list mounts the dialog only while open).
  const saveKey = useSaveKey();
  const importMut = useImportMlBoms();
  const [step, setStep] = useState<Step>('choose');
  const [file, setFile] = useState<File | null>(null);
  const [rows, setRows] = useState<MlBomImportRow[]>([]);
  const [preview, setPreview] = useState<MlBomImportResult | null>(null);
  const [finalResult, setFinalResult] = useState<MlBomImportResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const msgs = useMemo(() => messageRows(rows, preview), [rows, preview]);
  const nErrors =
    (preview?.rows.filter((r) => r.status === 'error').length ?? 0) +
    (preview?.fileErrors.length ?? 0);
  const nWarnings = preview?.rows.filter((r) => r.status === 'warning').length ?? 0;
  const shown = step === 'done' ? finalResult : preview;
  const nCreate = shown?.boms.filter((b) => b.action === 'create').length ?? 0;
  const nRevise = shown?.boms.filter((b) => b.action === 'revise').length ?? 0;
  const resultColumns = useMemo(() => bomColumns(onClose), [onClose]);

  function back(): void {
    // A different file is a different save: the server replays a key's first
    // answer without comparing rows, so the next import gets a new key.
    saveKey.rotate();
    setStep('choose');
    setRows([]);
    setPreview(null);
    setFinalResult(null);
    setError(null);
  }

  async function runPreview(): Promise<void> {
    if (!file || busy) return;
    setBusy(true);
    setError(null);
    try {
      const p = await parseMlBomFile(file);
      if (p.fatal) {
        setError(p.fatal);
        return;
      }
      const res = await importMut.mutateAsync({
        input: { dryRun: true, fileName: file.name.slice(0, 255), rows: p.rows },
      });
      setRows(p.rows);
      setPreview(res);
      setStep('preview');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not check the file. Try again.');
    } finally {
      setBusy(false);
    }
  }

  async function runImport(): Promise<void> {
    if (!file || !preview?.ok || rows.length === 0 || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await importMut.mutateAsync({
        input: { dryRun: false, fileName: file.name.slice(0, 255), rows },
        saveKey,
      });
      if (!res.saved) {
        // The data moved between Preview and Import — show what the server
        // found now, nothing was written.
        setPreview(res);
        setError('Nothing was saved.');
        return;
      }
      setFinalResult(res);
      setStep('done');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not import the file. Try again.');
    } finally {
      setBusy(false);
    }
  }

  const footer =
    step === 'choose' ? (
      <>
        <Button variant="ghost" onClick={onClose} disabled={busy}>
          Cancel
        </Button>
        <Button
          variant="primary"
          loading={busy}
          disabled={!file || busy}
          onClick={() => void runPreview()}
        >
          Preview
        </Button>
      </>
    ) : step === 'preview' ? (
      <>
        <Button variant="ghost" onClick={back} disabled={busy}>
          Back
        </Button>
        {msgs.length > 0 || (preview?.fileErrors.length ?? 0) > 0 ? (
          <Button
            variant="ghost"
            icon={<Icon name="download" size={12} />}
            disabled={busy}
            onClick={() => {
              void downloadErrors(msgs, preview?.fileErrors ?? []).catch((e: unknown) =>
                setError(e instanceof Error ? e.message : 'Could not download the errors.'),
              );
            }}
          >
            Download errors
          </Button>
        ) : null}
        <Button
          variant="primary"
          loading={busy}
          disabled={!preview?.ok || busy}
          onClick={() => void runImport()}
        >
          {busy ? 'Importing…' : 'Import'}
        </Button>
      </>
    ) : (
      <Button variant="primary" onClick={onClose}>
        Close
      </Button>
    );

  return (
    <Modal
      title="Import Multi-Level BOM"
      {...(busy ? {} : { onClose })}
      size="lg"
      closeOnOverlayClick={false}
      footer={footer}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-3)' }}>
        {error ? (
          <Banner tone="error" role="alert" flush>
            {error}
          </Banner>
        ) : null}

        {step === 'choose' ? (
          <div className="form-grp">
            <label className="form-label" htmlFor="mlbom-import-file">
              Excel file
            </label>
            <input
              id="mlbom-import-file"
              type="file"
              className="innovic-input"
              accept=".xlsx,.xls"
              disabled={busy}
              onChange={(e) => {
                setFile(e.target.files?.[0] ?? null);
                setError(null);
              }}
            />
          </div>
        ) : null}

        {step === 'preview' && preview ? (
          <>
            {preview.fileErrors.length > 0 ? (
              <Banner tone="error" role="alert" flush>
                {preview.fileErrors.map((e, i) => (
                  <div key={i}>{e}</div>
                ))}
              </Banner>
            ) : null}
            <StatStrip
              items={[
                { key: 'create', label: 'BOMs to create', count: nCreate },
                { key: 'revise', label: 'BOMs to revise', count: nRevise },
                { key: 'lines', label: 'Lines', count: rows.length },
                { key: 'levels', label: 'Levels', count: preview.levels },
                {
                  key: 'errors',
                  label: 'Errors',
                  count: nErrors,
                  color: nErrors > 0 ? 'var(--red2)' : undefined,
                },
                {
                  key: 'warnings',
                  label: 'Warnings',
                  count: nWarnings,
                  color: nWarnings > 0 ? 'var(--amber2)' : undefined,
                },
              ]}
            />
            {preview.tree.length > 0 ? (
              <DataTable
                columns={TREE_COLUMNS}
                rows={preview.tree}
                rowKey={(n, i) => `${n.topItemCode}-${i}`}
                density="compact"
                autoWidth
                maxHeight="36vh"
                emptyText="No lines."
              />
            ) : null}
            {msgs.length > 0 ? (
              <DataTable
                columns={MESSAGE_COLUMNS}
                rows={msgs}
                rowKey={(m) => m.rowNum}
                density="compact"
                autoWidth
                maxHeight="28vh"
                emptyText="No messages."
              />
            ) : null}
          </>
        ) : null}

        {step === 'done' && finalResult ? (
          <>
            <StatStrip
              items={[
                {
                  key: 'create',
                  label: 'BOMs created',
                  count: nCreate,
                  color: 'var(--green2)',
                },
                { key: 'revise', label: 'BOMs revised', count: nRevise, color: 'var(--blue2)' },
                { key: 'lines', label: 'Lines', count: rows.length },
                { key: 'levels', label: 'Levels', count: finalResult.levels },
              ]}
            />
            <DataTable
              columns={resultColumns}
              rows={finalResult.boms}
              rowKey={(b) => b.itemCode}
              density="compact"
              autoWidth
              maxHeight="50vh"
              emptyText="No BOMs."
            />
          </>
        ) : null}
      </div>
    </Modal>
  );
}
