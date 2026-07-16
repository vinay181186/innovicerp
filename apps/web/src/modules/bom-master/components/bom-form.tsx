// Shared BOM Master form used by create + edit routes.
//
// Header: BOM No (auto on create) + Name + Status + Revision indicator.
// Line editor: item-code datalist autocomplete + qty/set + bom_type
// dropdown + remove button. Excel template download + import.

import type { BomLineType, BomMaster, CreateBomMasterLineInput, Item } from '@innovic/shared';
import { Plus, Trash2, Upload, Download } from 'lucide-react';
import { useMemo, useRef, useState } from 'react';
import { useItemsList } from '@/modules/items/api';

// xlsx (~400 KB raw / 140 KB gzip) is dynamic-imported inside the two
// handlers that need it (template download + Excel parse). Lets every
// other page in the app skip the cost.
type XlsxModule = typeof import('xlsx');
async function loadXlsx(): Promise<XlsxModule> {
  return import('xlsx');
}

export interface BomFormLineDraft {
  childItemId: string;
  childItemCodeText: string;
  qtyPerSet: string;
  bomType: BomLineType;
}

export interface BomFormHeaderDraft {
  bomNo: string;
  bomName: string;
  status: 'draft' | 'active' | 'obsolete';
}

interface ExcelRowError {
  rowIndex: number;
  itemCode: string;
  reason: string;
}

interface BomFormProps {
  mode: 'create' | 'edit';
  initialHeader: BomFormHeaderDraft;
  initialLines: BomFormLineDraft[];
  // For edit mode: prior revision number for the "Rev N → N+1" indicator
  bom?: BomMaster | null;
  onSubmit: (
    header: BomFormHeaderDraft,
    lines: BomFormLineDraft[],
    revisionNote: string | null,
  ) => Promise<void>;
  submitting: boolean;
  submitError: string | null;
  onCancel: () => void;
}

const BOM_TYPES: ReadonlyArray<{ value: BomLineType; label: string }> = [
  { value: 'manufacture', label: '🏭 Manufacture' },
  { value: 'purchase', label: '🛒 Purchase' },
  { value: 'outsource', label: '🏭 Outsource' },
];

const VALID_BOM_TYPES = new Set<BomLineType>(['manufacture', 'purchase', 'outsource']);

function emptyLine(): BomFormLineDraft {
  return { childItemId: '', childItemCodeText: '', qtyPerSet: '1', bomType: 'manufacture' };
}

export function BomForm(props: BomFormProps): React.JSX.Element {
  const { mode, initialHeader, initialLines, bom, onSubmit, submitting, submitError, onCancel } =
    props;
  const [header, setHeader] = useState<BomFormHeaderDraft>(initialHeader);
  const [lines, setLines] = useState<BomFormLineDraft[]>(initialLines);
  const [revisionNote, setRevisionNote] = useState('');
  const [importErrors, setImportErrors] = useState<ExcelRowError[]>([]);
  const [importSummary, setImportSummary] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Legacy editBOMMaster L8610: newRev = current revision + 1. Drives the
  // header suffix, the revision-note indicator and the save-button label.
  const nextRevision = (bom?.revision ?? 0) + 1;

  // Items list — drives the code autocomplete + Excel-import resolution.
  // Limit 1000 should cover any company's item master at our scale; revisit
  // if the item master grows past that.
  const { data: itemsList } = useItemsList({ limit: 1000, offset: 0 });

  const itemsByCode = useMemo(() => {
    const m = new Map<string, Item>();
    for (const i of itemsList?.items ?? []) m.set(i.code.toUpperCase(), i);
    return m;
  }, [itemsList]);

  const updateLine = (idx: number, patch: Partial<BomFormLineDraft>): void => {
    setLines((prev) => prev.map((l, i) => (i === idx ? { ...l, ...patch } : l)));
  };

  // On item-code change try to resolve to a known itemId immediately;
  // the form keeps both the text + id so the user can see what's typed
  // even when the code doesn't (yet) match a master row.
  const onItemCodeChange = (idx: number, code: string): void => {
    const match = itemsByCode.get(code.trim().toUpperCase());
    updateLine(idx, {
      childItemCodeText: code,
      childItemId: match?.id ?? '',
    });
  };

  const addLine = (): void => setLines((prev) => [...prev, emptyLine()]);
  const removeLine = (idx: number): void => setLines((prev) => prev.filter((_, i) => i !== idx));

  const downloadTemplate = async (): Promise<void> => {
    const { utils: xlsxUtils, write: xlsxWrite } = await loadXlsx();
    // 3 columns + a sample row so users know the shape.
    const aoa = [
      ['item_code', 'qty_per_set', 'bom_type'],
      ['EXAMPLE-001', 2, 'manufacture'],
      ['EXAMPLE-002', 3, 'purchase'],
    ];
    const sheet = xlsxUtils.aoa_to_sheet(aoa);
    const wb = xlsxUtils.book_new();
    xlsxUtils.book_append_sheet(wb, sheet, 'BOM');
    const buf = xlsxWrite(wb, { type: 'array', bookType: 'xlsx' });
    const blob = new Blob([buf], { type: 'application/octet-stream' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'bom-import-template.xlsx';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const onImportFile = async (e: React.ChangeEvent<HTMLInputElement>): Promise<void> => {
    const file = e.target.files?.[0];
    if (!file) return;
    setImportErrors([]);
    setImportSummary(null);
    try {
      const { read: xlsxRead, utils: xlsxUtils } = await loadXlsx();
      const buf = await file.arrayBuffer();
      const wb = xlsxRead(buf, { type: 'array' });
      const sheetName = wb.SheetNames[0];
      if (!sheetName) throw new Error('Workbook has no sheets');
      const sheet = wb.Sheets[sheetName]!;
      const rows = xlsxUtils.sheet_to_json<Record<string, unknown>>(sheet, { defval: '' });

      const added: BomFormLineDraft[] = [];
      const errors: ExcelRowError[] = [];
      rows.forEach((row, idx) => {
        const itemCode = String(row['item_code'] ?? '').trim();
        const qtyRaw = row['qty_per_set'];
        const bomType = String(row['bom_type'] ?? '')
          .trim()
          .toLowerCase() as BomLineType;
        if (!itemCode) {
          errors.push({ rowIndex: idx, itemCode: '(blank)', reason: 'item_code is required' });
          return;
        }
        const item = itemsByCode.get(itemCode.toUpperCase());
        if (!item) {
          errors.push({ rowIndex: idx, itemCode, reason: 'item_code not found in master' });
          return;
        }
        const qty = Number(qtyRaw);
        if (!Number.isFinite(qty) || qty <= 0) {
          errors.push({ rowIndex: idx, itemCode, reason: 'qty_per_set must be > 0' });
          return;
        }
        if (!VALID_BOM_TYPES.has(bomType)) {
          errors.push({
            rowIndex: idx,
            itemCode,
            reason: 'bom_type must be manufacture | purchase | outsource',
          });
          return;
        }
        added.push({
          childItemId: item.id,
          childItemCodeText: item.code,
          qtyPerSet: String(qty),
          bomType,
        });
      });

      // Merge into existing lines, skipping duplicates already in the list.
      const existingItemIds = new Set(lines.map((l) => l.childItemId).filter(Boolean));
      const novel = added.filter((l) => !existingItemIds.has(l.childItemId));
      const skippedDuplicates = added.length - novel.length;

      setLines((prev) =>
        prev.length === 1 && prev[0]!.childItemId === '' ? novel : [...prev, ...novel],
      );
      setImportErrors(errors);
      setImportSummary(
        `Imported ${novel.length} row(s)${skippedDuplicates > 0 ? `, skipped ${skippedDuplicates} duplicate(s)` : ''}${errors.length > 0 ? `, ${errors.length} row(s) had errors` : ''}.`,
      );
    } catch (err) {
      setImportSummary(err instanceof Error ? err.message : 'Failed to parse Excel file');
    } finally {
      // Clear the input so re-uploading the same file fires onChange again.
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const validationError = useMemo(() => {
    if (!header.bomName.trim()) return 'BOM Name is required';
    if (lines.length === 0) return 'Add at least one item to the BOM';
    const itemIds = new Set<string>();
    for (let i = 0; i < lines.length; i++) {
      const l = lines[i]!;
      if (!l.childItemId) {
        return `Line ${i + 1}: pick a valid item code`;
      }
      if (itemIds.has(l.childItemId)) {
        return `Line ${i + 1}: duplicate item code`;
      }
      itemIds.add(l.childItemId);
      const qty = Number(l.qtyPerSet);
      if (!Number.isFinite(qty) || qty <= 0) {
        return `Line ${i + 1}: qty must be > 0`;
      }
    }
    return null;
  }, [header, lines]);

  const submit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    if (validationError) return;
    await onSubmit(
      header,
      lines,
      mode === 'edit' && revisionNote.trim() ? revisionNote.trim() : null,
    );
  };

  return (
    <form onSubmit={(e) => void submit(e)}>
      <div className="panel">
        <div className="panel-hdr">
          <div className="panel-title">
            {mode === 'create'
              ? '📦 New BOM'
              : `📦 Edit BOM — ${bom?.bomNo ?? ''} (Rev ${bom?.revision ?? 1} → ${nextRevision})`}
          </div>
        </div>
        <div className="panel-body">
          <div className="form-grid">
            <div className="form-grp">
              <span className="form-label">
                BOM No.<span className="req">★</span>
              </span>
              <input
                className="innovic-input"
                value={header.bomNo}
                onChange={(e) => setHeader({ ...header, bomNo: e.target.value })}
                placeholder={mode === 'create' ? 'BOM-NNNN (auto if blank)' : 'BOM-0001'}
              />
            </div>
            <div className="form-grp">
              <span className="form-label">
                BOM Name<span className="req">★</span>
              </span>
              <input
                className="innovic-input"
                value={header.bomName}
                onChange={(e) => setHeader({ ...header, bomName: e.target.value })}
                placeholder="e.g. Hydraulic Press Assembly"
              />
            </div>
            <div className="form-grp">
              <span className="form-label">Status</span>
              <select
                className="innovic-select"
                value={header.status}
                onChange={(e) =>
                  setHeader({ ...header, status: e.target.value as BomFormHeaderDraft['status'] })
                }
              >
                <option value="active">Active</option>
                <option value="draft">Draft</option>
                <option value="obsolete">Obsolete</option>
              </select>
            </div>
            <div className="form-grp">
              <span className="form-label">Revision</span>
              <input
                className="innovic-input fw-700"
                value={String(bom?.revision ?? 1)}
                readOnly
                style={{ color: 'var(--amber)' }}
              />
            </div>
          </div>
        </div>
      </div>

      <div className="panel">
        <div className="panel-hdr">
          <div className="panel-title">📦 Part List / Items ({lines.length})</div>
          <div style={{ display: 'flex', gap: 6 }}>
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => void downloadTemplate()}
            >
              <Download size={13} /> Template
            </button>
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              style={{ color: 'var(--green)' }}
              onClick={() => fileInputRef.current?.click()}
            >
              <Upload size={13} /> Import Excel
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept=".xlsx,.xls,.csv"
              style={{ display: 'none' }}
              onChange={(e) => void onImportFile(e)}
            />
            <button type="button" className="btn btn-ghost btn-sm" onClick={addLine}>
              <Plus size={13} /> Add Item
            </button>
          </div>
        </div>
        {importSummary ? (
          <div
            style={{
              padding: '6px 12px',
              background: importErrors.length > 0 ? 'var(--amber3)' : 'var(--green3)',
              color: importErrors.length > 0 ? 'var(--amber2)' : 'var(--green2)',
              fontSize: 12,
              borderBottom: '1px solid var(--border)',
            }}
          >
            {importSummary}
            {importErrors.length > 0 ? (
              <ul style={{ marginTop: 6, paddingLeft: 18, fontSize: 11 }}>
                {importErrors.slice(0, 10).map((err, i) => (
                  <li key={i}>
                    Row {err.rowIndex + 2}: {err.itemCode} — {err.reason}
                  </li>
                ))}
                {importErrors.length > 10 ? <li>… and {importErrors.length - 10} more</li> : null}
              </ul>
            ) : null}
          </div>
        ) : null}
        <div className="tbl-wrap">
          <table className="innovic-table">
            <thead>
              <tr>
                <th style={{ width: 30 }}>#</th>
                <th>Item Code ★</th>
                <th>Name</th>
                <th style={{ width: 90 }}>Qty / Set ★</th>
                <th style={{ width: 120 }}>Type</th>
                <th style={{ width: 40 }}></th>
              </tr>
            </thead>
            <tbody>
              {lines.length === 0 ? (
                <tr>
                  <td colSpan={6} className="empty-state">
                    No items yet. Click <strong>+ Add Item</strong>.
                  </td>
                </tr>
              ) : (
                lines.map((line, idx) => {
                  const item = line.childItemId
                    ? (itemsList?.items ?? []).find((i) => i.id === line.childItemId)
                    : null;
                  return (
                    <tr key={idx}>
                      <td className="td-ctr mono fw-700">{idx + 1}</td>
                      <td>
                        <input
                          className="innovic-input"
                          list="bom-items-dl"
                          value={line.childItemCodeText}
                          onChange={(e) => onItemCodeChange(idx, e.target.value)}
                          placeholder="🔍 Search item code or name..."
                          style={{ fontSize: 12 }}
                        />
                      </td>
                      <td style={{ fontSize: 11, color: 'var(--text2)' }}>
                        {item?.name ?? <span className="text3">—</span>}
                      </td>
                      <td>
                        <input
                          type="number"
                          min="0.01"
                          step="0.01"
                          className="innovic-input"
                          value={line.qtyPerSet}
                          onChange={(e) => updateLine(idx, { qtyPerSet: e.target.value })}
                          style={{ textAlign: 'center', fontWeight: 700 }}
                        />
                      </td>
                      <td>
                        <select
                          className="innovic-select"
                          value={line.bomType}
                          onChange={(e) =>
                            updateLine(idx, { bomType: e.target.value as BomLineType })
                          }
                          style={{ fontSize: 11 }}
                        >
                          {BOM_TYPES.map((t) => (
                            <option key={t.value} value={t.value}>
                              {t.label}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td>
                        <button
                          type="button"
                          className="btn btn-danger btn-sm btn-icon"
                          onClick={() => removeLine(idx)}
                          title="Remove line"
                        >
                          <Trash2 size={12} />
                        </button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      <datalist id="bom-items-dl">
        {(itemsList?.items ?? []).map((i) => (
          <option key={i.id} value={i.code}>
            {i.code} — {i.name}
            {i.material ? ` [${i.material}]` : ''}
          </option>
        ))}
      </datalist>

      {mode === 'edit' ? (
        <div className="panel">
          <div className="panel-hdr">
            <div className="panel-title">📋 Revision Note</div>
            <div className="text3" style={{ fontSize: 11 }}>
              Rev {bom?.revision ?? 1} → <b style={{ color: 'var(--green)' }}>Rev {nextRevision}</b>
            </div>
          </div>
          <div className="panel-body">
            <textarea
              className="innovic-textarea"
              rows={2}
              value={revisionNote}
              onChange={(e) => setRevisionNote(e.target.value)}
              placeholder="Auto-generated on save. You can edit..."
            />
            <div className="form-help">
              ℹ Note is auto-generated when you save. You can edit it before saving.
            </div>
          </div>
        </div>
      ) : null}

      {validationError ? (
        <div
          style={{
            color: 'var(--red)',
            background: 'var(--red3)',
            border: '1px solid #fca5a5',
            borderRadius: 6,
            padding: '6px 10px',
            fontSize: 12,
            marginBottom: 12,
          }}
        >
          {validationError}
        </div>
      ) : null}
      {submitError ? (
        <div
          style={{
            color: 'var(--red)',
            background: 'var(--red3)',
            border: '1px solid #fca5a5',
            borderRadius: 6,
            padding: '6px 10px',
            fontSize: 12,
            marginBottom: 12,
          }}
        >
          {submitError}
        </div>
      ) : null}

      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 6 }}>
        <button type="button" className="btn btn-ghost" onClick={onCancel}>
          Cancel
        </button>
        <button
          type="submit"
          className="btn btn-primary"
          disabled={Boolean(validationError) || submitting}
        >
          {submitting ? 'Saving…' : mode === 'create' ? 'Save BOM' : `Save as Rev ${nextRevision}`}
        </button>
      </div>
    </form>
  );
}

export function linesToInput(lines: BomFormLineDraft[]): CreateBomMasterLineInput[] {
  return lines.map((l) => ({
    childItemId: l.childItemId,
    qtyPerSet: Number(l.qtyPerSet),
    bomType: l.bomType,
  }));
}
