// Excel import dialog for the Item / Customer / Vendor masters — ERPNext Data
// Import behaviour (packages/shared/src/schemas/master-import.ts), ONE dialog
// for all three list pages.
//
//   1. Choose   — Import Type (Insert new / Update existing (by Code)) + file.
//   2. Preview  — the sheet is sent with dryRun: true; the server checks EVERY
//                 row and writes nothing. Each row shows what WOULD happen:
//                 Insert / Update / Skip, with the reason (red) or warnings
//                 (amber).
//   3. Result   — the same rows are sent with dryRun: false. Good rows go in,
//                 bad rows are listed with their reason, and can be downloaded
//                 as an .xlsx to fix and re-import.
//
// The server's `index` is the 1-based position in the array sent; it is mapped
// back to the SHEET row (rows the parser left out never reach the server, so
// the two drift apart).

import {
  MASTER_IMPORT_MODE_LABEL,
  MASTER_IMPORT_MODES,
  type MasterImportMode,
  type MasterImportResult,
  type MasterImportRowAction,
} from '@innovic/shared';
import { useMemo, useState } from 'react';
import {
  downloadImportErrors,
  type MasterImportParse,
  type MasterImportParser,
} from '@/lib/master-import';
import { type SaveKey, useSaveKey } from '@/lib/use-save-key';
import { Badge, Button, Icon, type BadgeTone } from '@/ui/core';
import { StatStrip } from '@/ui/data';
import { Banner, Modal } from '@/ui/feedback';

/** The server takes at most this many rows per request (bulkCreate*InputSchema). */
const MAX_ROWS = 2000;

export interface MasterImportDialogProps {
  /** e.g. "Import Customers from Excel". */
  title: string;
  /** Singular, lower-case: "customer" / "vendor" / "item". */
  noun: string;
  /** Column header for the code: "Code" / "Item Code". */
  codeLabel: string;
  /** Column header for the name: "Customer Name" / "Vendor Name" / "Item Name". */
  nameLabel: string;
  /** Insert new needs the page's Add right; Update existing its Edit right. */
  allowInsert: boolean;
  allowUpdate: boolean;
  parse: MasterImportParser;
  /** POST /<master>/bulk with { rows, mode, dryRun }. `saveKey` is passed ONLY
   *  for the real import (dryRun false) — one key per dialog open, reused if
   *  the user retries after a timeout, so the sheet is never imported twice.
   *  The preview never carries it: a preview is not a save. */
  submit: (
    rows: unknown[],
    mode: MasterImportMode,
    dryRun: boolean,
    saveKey?: SaveKey,
  ) => Promise<MasterImportResult>;
  /** Fetches the Excel Template. Async because the API builds it (the
   *  dropdowns need Excel data validation, which the browser library cannot
   *  write) — the dialog awaits it so the button can say so. */
  onDownloadTemplate: () => void | Promise<void>;
  /** File name for "Download errors", e.g. "Customer Import Errors.xlsx". */
  errorsFileName: string;
  onClose: () => void;
}

interface ViewRow {
  rowNum: number;
  code: string | null;
  name: string;
  action: MasterImportRowAction;
  reason?: string | undefined;
  warnings: string[];
  changedFields?: number | undefined;
}

type Step = 'choose' | 'preview' | 'done';

const MODE_HELP: Record<MasterImportMode, string> = {
  insert: 'Adds every row as a new record. A row whose Code already exists is skipped.',
  update:
    'Finds each row by its Code and changes only the filled cells — a blank cell keeps the current value. A Code that is not found is skipped.',
};

const ACTION_LABEL: Record<MasterImportRowAction, string> = {
  insert: 'Insert',
  update: 'Update',
  skip: 'Skip',
};
const ACTION_TONE: Record<MasterImportRowAction, BadgeTone> = {
  insert: 'green',
  update: 'blue',
  skip: 'red',
};

function plural(n: number, noun: string): string {
  return `${n} ${noun}${n === 1 ? '' : 's'}`;
}

/** Server answer + the parser's own skips → one list in sheet-row order. */
function mergeRows(parsed: MasterImportParse, result: MasterImportResult | null): ViewRow[] {
  const out: ViewRow[] = parsed.skipped.map(
    (s): ViewRow => ({
      rowNum: s.rowNum,
      code: s.code,
      name: s.name,
      action: 'skip',
      reason: s.reason,
      warnings: [],
    }),
  );
  for (const r of result?.rows ?? []) {
    const p = parsed.rows[r.index - 1];
    out.push({
      rowNum: p?.rowNum ?? r.index,
      code: r.code ?? p?.code ?? null,
      name: r.name || p?.name || '',
      action: r.action,
      reason: r.reason,
      warnings: [...(p?.warnings ?? []), ...(r.warnings ?? [])],
      changedFields: r.changedFields,
    });
  }
  return out.sort((a, b) => a.rowNum - b.rowNum);
}

function countOf(rows: ViewRow[], action: MasterImportRowAction): number {
  return rows.filter((r) => r.action === action).length;
}

export function MasterImportDialog({
  title,
  noun,
  codeLabel,
  nameLabel,
  allowInsert,
  allowUpdate,
  parse,
  submit,
  onDownloadTemplate,
  errorsFileName,
  onClose,
}: MasterImportDialogProps): React.JSX.Element {
  // R2: one save key per dialog open (the list pages mount the dialog only
  // while it is open, so every open starts with a fresh key).
  const saveKey = useSaveKey();
  const [step, setStep] = useState<Step>('choose');
  const [mode, setMode] = useState<MasterImportMode>(allowInsert ? 'insert' : 'update');
  const [file, setFile] = useState<File | null>(null);
  // The template download is the one action in here that talks to the server
  // before an import exists, so it carries its own progress and failure.
  const [templateBusy, setTemplateBusy] = useState(false);
  const [templateError, setTemplateError] = useState<string | null>(null);
  const [parsed, setParsed] = useState<MasterImportParse | null>(null);
  const [preview, setPreview] = useState<MasterImportResult | null>(null);
  const [finalResult, setFinalResult] = useState<MasterImportResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const rows = useMemo<ViewRow[]>(() => {
    if (!parsed) return [];
    return mergeRows(parsed, step === 'done' ? finalResult : preview);
  }, [parsed, preview, finalResult, step]);
  const nInsert = countOf(rows, 'insert');
  const nUpdate = countOf(rows, 'update');
  const nSkip = countOf(rows, 'skip');
  const nGood = nInsert + nUpdate;

  function reset(): void {
    // Back = a different batch (new file or Import Type). The server replays a
    // key's first answer without comparing the rows, so the next import must
    // not reuse this one. Rows already imported by an earlier attempt show up
    // in the new preview as Skip / Update, so nothing is written twice.
    saveKey.rotate();
    setStep('choose');
    setParsed(null);
    setPreview(null);
    setFinalResult(null);
    setError(null);
  }

  async function runPreview(): Promise<void> {
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      const p = await parse(file, mode);
      if (p.fatal) {
        setError(p.fatal);
        return;
      }
      if (p.rows.length === 0 && p.skipped.length === 0) {
        setError(`Nothing to import — the sheet has no ${noun} rows.`);
        return;
      }
      if (p.rows.length > MAX_ROWS) {
        setError(
          `The sheet has ${p.rows.length} rows; import at most ${MAX_ROWS} at a time. Split the file and import each part.`,
        );
        return;
      }
      const res =
        p.rows.length > 0
          ? await submit(
              p.rows.map((r) => r.payload),
              mode,
              true,
            )
          : null;
      setParsed(p);
      setPreview(res);
      setStep('preview');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not check the file. Try again.');
    } finally {
      setBusy(false);
    }
  }

  async function runImport(): Promise<void> {
    if (!parsed || parsed.rows.length === 0) return;
    setBusy(true);
    setError(null);
    try {
      const res = await submit(
        parsed.rows.map((r) => r.payload),
        mode,
        false,
        saveKey,
      );
      setFinalResult(res);
      setStep('done');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not import the file. Try again.');
    } finally {
      setBusy(false);
    }
  }

  function downloadErrors(): void {
    downloadImportErrors(
      errorsFileName,
      codeLabel,
      nameLabel,
      rows
        .filter((r) => r.action === 'skip')
        .map((r) => ({ rowNum: r.rowNum, code: r.code, name: r.name, reason: r.reason ?? '' })),
    );
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
        <Button variant="ghost" onClick={reset} disabled={busy}>
          Back
        </Button>
        {nSkip > 0 ? (
          <Button
            variant="ghost"
            icon={<Icon name="download" size={12} />}
            onClick={downloadErrors}
            disabled={busy}
          >
            Download errors
          </Button>
        ) : null}
        <Button
          variant="primary"
          loading={busy}
          disabled={nGood === 0 || busy}
          onClick={() => void runImport()}
        >
          {busy ? 'Importing…' : `Import ${plural(nGood, 'row')}`}
        </Button>
      </>
    ) : (
      <>
        {nSkip > 0 ? (
          <Button
            variant="ghost"
            icon={<Icon name="download" size={12} />}
            onClick={downloadErrors}
          >
            Download errors
          </Button>
        ) : null}
        <Button variant="primary" onClick={onClose}>
          Close
        </Button>
      </>
    );

  return (
    <Modal
      title={title}
      {...(busy ? {} : { onClose })}
      size="lg"
      closeOnOverlayClick={false}
      footer={footer}
    >
      {error ? (
        <div style={{ marginBottom: 'var(--sp-3)' }}>
          <Banner tone="error" role="alert" flush>
            {error}
          </Banner>
        </div>
      ) : null}

      {step === 'choose' ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-4)' }}>
          <fieldset style={{ border: 'none', margin: 0, padding: 0 }}>
            <legend className="fw-700" style={{ marginBottom: 'var(--sp-2)' }}>
              Import Type
            </legend>
            {MASTER_IMPORT_MODES.map((m) => {
              const allowed = m === 'insert' ? allowInsert : allowUpdate;
              return (
                <label
                  key={m}
                  style={{
                    display: 'flex',
                    gap: 'var(--sp-2)',
                    alignItems: 'flex-start',
                    marginBottom: 'var(--sp-2)',
                    cursor: allowed ? 'pointer' : 'not-allowed',
                    opacity: allowed ? 1 : 0.6,
                  }}
                  title={allowed ? undefined : 'You do not have the right to do this'}
                >
                  <input
                    type="radio"
                    name="master-import-mode"
                    value={m}
                    checked={mode === m}
                    disabled={!allowed || busy}
                    onChange={() => setMode(m)}
                    style={{ marginTop: 3 }}
                  />
                  <span>
                    <span className="fw-700">{MASTER_IMPORT_MODE_LABEL[m]}</span>
                    <span className="text3" style={{ display: 'block', fontSize: 'var(--fs-xs)' }}>
                      {MODE_HELP[m]}
                    </span>
                  </span>
                </label>
              );
            })}
          </fieldset>

          <div>
            <div className="fw-700" style={{ marginBottom: 'var(--sp-2)' }}>
              Excel file
            </div>
            <input
              type="file"
              className="innovic-input"
              accept=".xlsx,.xls,.csv"
              aria-label="Excel file"
              disabled={busy}
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            />
            <div className="text3" style={{ fontSize: 'var(--fs-xs)', marginTop: 'var(--sp-1)' }}>
              The first tab is read; the header row names the columns. Nothing is saved until you
              press Import on the next screen.{' '}
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                disabled={templateBusy}
                onClick={() => {
                  setTemplateError(null);
                  setTemplateBusy(true);
                  void Promise.resolve(onDownloadTemplate())
                    .catch((err: unknown) =>
                      setTemplateError(
                        err instanceof Error
                          ? err.message
                          : 'Could not download the template. Try again.',
                      ),
                    )
                    .finally(() => setTemplateBusy(false));
                }}
                style={{ marginLeft: 'var(--sp-1)' }}
              >
                <Icon name="download" size={12} />{' '}
                {templateBusy ? 'Preparing…' : 'Download Excel Template'}
              </button>
            </div>
            {/* The page behind the modal cannot show this — a failure fired
                from in here has to be answered in here. */}
            {templateError ? (
              <Banner tone="error" role="alert" flush onDismiss={() => setTemplateError(null)}>
                {templateError}
              </Banner>
            ) : null}
          </div>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-3)' }}>
          <div className="fw-700">
            {step === 'preview'
              ? `${MASTER_IMPORT_MODE_LABEL[mode]} — preview, nothing saved yet: ` +
                `${nInsert} will be inserted · ${nUpdate} updated · ${nSkip} skipped`
              : `Done: ${finalResult?.created ?? nInsert} inserted · ${finalResult?.updated ?? nUpdate} updated · ${nSkip} skipped`}
          </div>
          <StatStrip
            items={[
              { key: 'rows', label: 'Rows in file', count: rows.length },
              {
                key: 'insert',
                label: step === 'preview' ? 'Will insert' : 'Inserted',
                count: nInsert,
                color: 'var(--green2)',
              },
              {
                key: 'update',
                label: step === 'preview' ? 'Will update' : 'Updated',
                count: nUpdate,
                color: 'var(--blue2)',
              },
              { key: 'skip', label: 'Skipped', count: nSkip, color: 'var(--red2)' },
            ]}
          />
          <div className="tbl-wrap" style={{ maxHeight: '50vh' }}>
            <table className="innovic-table">
              <thead>
                <tr>
                  <th>Sheet Row</th>
                  <th>{codeLabel}</th>
                  <th>{nameLabel}</th>
                  <th>Import Action</th>
                  <th>Problems / Warnings</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={`${r.rowNum}-${r.action}`}>
                    <td className="text3">{r.rowNum}</td>
                    <td className="td-code">{r.code ?? (r.action === 'insert' ? 'auto' : '—')}</td>
                    <td
                      title={r.name}
                      style={{ maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis' }}
                    >
                      {r.name || '—'}
                    </td>
                    <td>
                      <Badge tone={ACTION_TONE[r.action]}>{ACTION_LABEL[r.action]}</Badge>
                    </td>
                    <td style={{ whiteSpace: 'normal', minWidth: 280 }}>
                      {r.reason ? <div style={{ color: 'var(--red2)' }}>{r.reason}</div> : null}
                      {r.warnings.map((w, i) => (
                        <div key={i} style={{ color: 'var(--amber2)' }}>
                          {w}
                        </div>
                      ))}
                      {r.action === 'update' && r.changedFields === 0 ? (
                        <div className="text3">Nothing changes</div>
                      ) : null}
                      {!r.reason && r.warnings.length === 0 && r.changedFields !== 0 ? (
                        <span className="text3">—</span>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </Modal>
  );
}
