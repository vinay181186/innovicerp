// Shared BOM Master form used by create + edit routes.
//
// Header: BOM No (auto on create) + Name + Status + Revision indicator.
// Line editor: item picker (the shared SearchableSelect) + qty/set + bom_type
// dropdown + remove button. Excel template download + import.

import type {
  BomLineType,
  BomMaster,
  CreateBomMasterLineInput,
  Item,
  ListItemsResponse,
} from '@innovic/shared';
import { Plus, Trash2, Upload, Download } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { SearchableSelect } from '@/components/shared/searchable-select';
import { apiFetch } from '@/lib/api';
import { getCol, readSheetRows } from '@/lib/xlsx-import';
import { useItemsList } from '@/modules/items/api';
import { useNextBomNo } from '../api';

// xlsx (~400 KB raw / 140 KB gzip) is dynamic-imported inside the two
// handlers that need it (template download + Excel parse). Lets every
// other page in the app skip the cost.
type XlsxModule = typeof import('xlsx');
async function loadXlsx(): Promise<XlsxModule> {
  return import('xlsx');
}

// Part-list row layout. Mirrors the invoice line editor: a narrow index, the
// code picker, a wider read-only name, then qty / type / remove.
const BOM_GRID = '30px 1.3fr 1.8fr 110px 140px 36px';

// The parent row uses the SAME tracks as a child row so Item Code / Item Name
// / Qty sit in one continuous column down the page. Its Type and remove cells
// stay empty: a parent is always the thing being assembled, and there is
// exactly one of it.
const PARENT_GRID = BOM_GRID;

// "PARENT ITEM" / "CHILD ITEMS" — the two captions that make the page readable
// at a glance instead of one undifferentiated list of pickers.
const SECTION_LABEL: React.CSSProperties = {
  fontSize: 10,
  fontWeight: 800,
  letterSpacing: 0.6,
  textTransform: 'uppercase',
  color: 'var(--text3)',
  marginBottom: 6,
};

export interface BomFormLineDraft {
  childItemId: string;
  childItemCodeText: string;
  qtyPerSet: string;
  bomType: BomLineType;
}

export interface BomFormHeaderDraft {
  bomNo: string;
  bomName: string;
  /** The assembled item this BOM builds. Exactly one, and required — the part
   *  list stays locked until it is picked. Empty string = not picked yet. */
  parentItemId: string;
  /** What the user typed/picked, so a pasted exact code still resolves. */
  parentItemCodeText: string;
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

// listItemsQuerySchema (packages/shared/src/schemas/item.ts) caps `limit` at
// 1000. Asking for more is a 400, not a bigger page — keep these in step.
const ITEM_PAGE_MAX = 1000;

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

  // Preview the auto-generated BOM No. on CREATE so it's visible before save.
  // Prefill once while the field is still blank; keep it editable.
  const { data: nextBomNo } = useNextBomNo();
  useEffect(() => {
    if (mode !== 'create') return;
    const code = nextBomNo?.code;
    if (!code) return;
    setHeader((prev) => (prev.bomNo.trim() ? prev : { ...prev, bomNo: code }));
  }, [mode, nextBomNo]);

  // Items list — drives the code autocomplete + Excel-import resolution.
  //
  // 1000 is the SERVER's ceiling (listItemsQuerySchema caps limit at 1000).
  // This used to ask for 10000, which Zod rejected: the request 400'd, the map
  // below stayed empty, and every imported row came back "item_code not found
  // in master" — even codes that plainly exist. Never ask for more than the
  // schema allows. Beyond 1000 items the map is only a fast path anyway:
  // lookupMissingCodes() below asks the server directly for whatever it misses.
  const { data: itemsList } = useItemsList({ limit: ITEM_PAGE_MAX, offset: 0 });

  const itemsByCode = useMemo(() => {
    const m = new Map<string, Item>();
    for (const i of itemsList?.items ?? []) m.set(i.code.toUpperCase(), i);
    return m;
  }, [itemsList]);
  const itemById = useMemo(() => {
    const m = new Map<string, Item>();
    for (const i of itemsList?.items ?? []) m.set(i.id, i);
    return m;
  }, [itemsList]);

  // A code the first page did not cover is not proof the item is missing — the
  // master may simply be larger than one page. Ask the server for each such
  // code before declaring it unknown. An import file holds a handful of rows,
  // so this stays a handful of small requests.
  const lookupMissingCodes = async (codes: string[]): Promise<Map<string, Item>> => {
    const found = new Map<string, Item>();
    await Promise.all(
      codes.map(async (code) => {
        try {
          const page = await apiFetch<ListItemsResponse>(
            `/items?search=${encodeURIComponent(code)}&limit=50&offset=0`,
          );
          const hit = page.items.find((i) => i.code.toUpperCase() === code);
          if (hit) found.set(code, hit);
        } catch {
          // Leave it unresolved — the row error below reports it as not found.
        }
      }),
    );
    return found;
  };

  // Item picker — server-side search, as the dropdown skill requires. One
  // shared term is enough: only the open dropdown is visible, so whichever line
  // the user is typing in owns the current page of options.
  const [itemSearch, setItemSearch] = useState('');
  const { data: itemPage, isFetching: itemsFetching } = useItemsList({
    ...(itemSearch.trim() ? { search: itemSearch.trim() } : {}),
    limit: 50,
    offset: 0,
  });
  const itemOptions = useMemo(
    () =>
      (itemPage?.items ?? []).map((i) => ({
        id: i.id,
        code: i.code,
        name: i.material ? `${i.name} [${i.material}]` : i.name,
      })),
    [itemPage],
  );

  const updateLine = (idx: number, patch: Partial<BomFormLineDraft>): void => {
    setLines((prev) => prev.map((l, i) => (i === idx ? { ...l, ...patch } : l)));
  };

  // A pick from the dropdown always yields the item's ID (never typed text), so
  // the code snapshot and the name display both follow the master row. Typing
  // after a pick clears the id by design — the user must re-pick, which is what
  // stops a stale id sitting under new text.
  const onItemPicked = (idx: number, id: string | null): void => {
    if (!id) {
      // Keep whatever is typed — resolveLine below can still turn an exact
      // code into an id at save time. Clearing it here is what made a pasted
      // code fail with "pick a valid item code".
      updateLine(idx, { childItemId: '' });
      return;
    }
    const picked = itemById.get(id) ?? (itemPage?.items ?? []).find((i) => i.id === id);
    updateLine(idx, { childItemId: id, childItemCodeText: picked?.code ?? '' });
  };

  // Remember what was typed per line. The dropdown reports the debounced term
  // through onSearch; stash it on the line so a code that was pasted rather
  // than clicked is still recoverable.
  const onItemSearch = (idx: number, term: string): void => {
    setItemSearch(term);
    const line = lines[idx];
    if (line && !line.childItemId) updateLine(idx, { childItemCodeText: term });
  };

  // The old <datalist> accepted a typed exact code and resolved it to an id.
  // The shared dropdown only emits an id when a row is CLICKED, so paste-and-go
  // silently produced no id and the save was refused. Resolve an exact code
  // match here so both routes work; anything that is not an exact code still
  // fails validation, now with a message that says what to do.
  const resolveLine = (l: BomFormLineDraft): BomFormLineDraft => {
    if (l.childItemId) return l;
    const typed = l.childItemCodeText.trim().toUpperCase();
    if (!typed) return l;
    const match =
      itemsByCode.get(typed) ??
      (itemPage?.items ?? []).find((i) => i.code.toUpperCase() === typed);
    return match ? { ...l, childItemId: match.id, childItemCodeText: match.code } : l;
  };
  const resolvedLines = useMemo(() => lines.map(resolveLine), [lines, itemsByCode, itemPage]);

  // ── Parent item ─────────────────────────────────────────────────────────
  // Same paste-and-go resolution as a child line: a typed exact code becomes
  // an id, so the user is not forced to click the dropdown row.
  const resolvedParentId = useMemo(() => {
    if (header.parentItemId) return header.parentItemId;
    const typed = header.parentItemCodeText.trim().toUpperCase();
    if (!typed) return '';
    const match =
      itemsByCode.get(typed) ??
      (itemPage?.items ?? []).find((i) => i.code.toUpperCase() === typed);
    return match?.id ?? '';
  }, [header.parentItemId, header.parentItemCodeText, itemsByCode, itemPage]);

  const parentItem = resolvedParentId
    ? (itemById.get(resolvedParentId) ??
      (itemPage?.items ?? []).find((i) => i.id === resolvedParentId) ??
      null)
    : null;

  // THE GATE. No parent → no part list. A BOM with children but no parent is
  // a list of parts that builds nothing, which is exactly the state that let
  // an equipment SO be planned and then never dispatched.
  const parentLocked = !resolvedParentId;

  const onParentPicked = (id: string | null): void => {
    if (!id) {
      setHeader((h) => ({ ...h, parentItemId: '' }));
      return;
    }
    const picked = itemById.get(id) ?? (itemPage?.items ?? []).find((i) => i.id === id);
    setHeader((h) => ({ ...h, parentItemId: id, parentItemCodeText: picked?.code ?? '' }));
  };

  const onParentSearch = (term: string): void => {
    setItemSearch(term);
    // Keep the typed text so resolvedParentId can still recover an exact code.
    setHeader((h) => (h.parentItemId ? h : { ...h, parentItemCodeText: term }));
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
      // Shared reader parses .xlsx/.xls AND real .csv via SheetJS, and matches
      // headers normalized (case/spacing/`*` tolerant) — so `item_code` and
      // `Item Code`, `qty_per_set` and `Qty Per Set`, `bom_type`/`Type`/`BOM
      // Type` all resolve instead of demanding exact lowercase-snake headers.
      const { rows, sheetError, sheetName, sheetNames } = await readSheetRows(file);
      if (sheetError) throw new Error(sheetError);

      // Only the FIRST sheet is read. A user who adds their rows on a later tab
      // gets whatever sheet 1 holds — in practice the untouched template — and
      // the errors then name EXAMPLE-001/002, which looks like the item master
      // is wrong when the real problem is the wrong tab. Say both things out
      // loud instead of importing the samples silently.
      const onlySampleRows =
        rows.length > 0 &&
        rows.every((r) => /^EXAMPLE-\d+$/i.test(getCol(r, ['item_code', 'Item Code', 'code']).trim()));
      if (onlySampleRows) {
        throw new Error(
          `Sheet "${sheetName}" still contains only the sample rows (EXAMPLE-001 / EXAMPLE-002). ` +
            `Replace them with your own rows on that sheet` +
            ((sheetNames?.length ?? 0) > 1
              ? ` — this workbook has ${sheetNames!.length} sheets (${sheetNames!.join(', ')}) and only the first is read.`
              : '.'),
        );
      }
      const sheetNote =
        (sheetNames?.length ?? 0) > 1
          ? ` (read sheet "${sheetName}" of ${sheetNames!.length}: ${sheetNames!.join(', ')})`
          : '';

      // Resolve every code in one go BEFORE walking the rows: whatever the
      // preloaded page missed gets one targeted ?search= each. Without this a
      // large item master reads as "not found" for perfectly valid codes.
      const fileCodes = Array.from(
        new Set(
          rows
            .map((r) => getCol(r, ['item_code', 'Item Code', 'code']).trim().toUpperCase())
            .filter(Boolean),
        ),
      );
      const lateFound = await lookupMissingCodes(fileCodes.filter((c) => !itemsByCode.has(c)));

      // What is already on the form, and what THIS file has already claimed.
      // A BOM cannot list the same part twice — one line, one qty/set — so both
      // kinds of repeat are reported by name rather than silently dropped.
      const existingByItemId = new Map<string, number>();
      lines.forEach((l, i) => {
        if (l.childItemId && !existingByItemId.has(l.childItemId)) existingByItemId.set(l.childItemId, i);
      });
      const seenInFile = new Map<string, number>();

      const added: BomFormLineDraft[] = [];
      const errors: ExcelRowError[] = [];
      rows.forEach((row, idx) => {
        const itemCode = getCol(row, ['item_code', 'Item Code', 'code']).trim();
        const qtyRaw = getCol(row, ['qty_per_set', 'Qty Per Set', 'qty', 'qty/set']);
        const bomType = getCol(row, ['bom_type', 'BOM Type', 'Type'])
          .trim()
          .toLowerCase() as BomLineType;
        if (!itemCode) {
          errors.push({ rowIndex: idx, itemCode: '(blank)', reason: 'item_code is required' });
          return;
        }
        const key = itemCode.toUpperCase();
        const item = itemsByCode.get(key) ?? lateFound.get(key);
        if (!item) {
          errors.push({ rowIndex: idx, itemCode, reason: 'item_code not found in master' });
          return;
        }
        const firstRow = seenInFile.get(item.id);
        if (firstRow !== undefined) {
          errors.push({
            rowIndex: idx,
            itemCode,
            reason: `duplicate item code — ${item.code} (${item.name}) is already on row ${firstRow + 2} of this file. A BOM can list a part only once; delete one row or add the two quantities together.`,
          });
          return;
        }
        const onFormAt = existingByItemId.get(item.id);
        if (onFormAt !== undefined) {
          errors.push({
            rowIndex: idx,
            itemCode,
            reason: `duplicate item code — ${item.code} (${item.name}) is already part ${onFormAt + 1} in the list below. Remove that part first, or drop this row from the file.`,
          });
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
        seenInFile.set(item.id, idx);
        added.push({
          childItemId: item.id,
          childItemCodeText: item.code,
          qtyPerSet: String(qty),
          bomType,
        });
      });

      setLines((prev) =>
        prev.length === 1 && prev[0]!.childItemId === '' ? added : [...prev, ...added],
      );
      setImportErrors(errors);
      setImportSummary(
        `Imported ${added.length} row(s)${errors.length > 0 ? `, ${errors.length} row(s) had errors` : ''}.${sheetNote}`,
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
    // Parent before parts — it is the thing the parts add up to, and the part
    // list is locked until it is set, so complain about it first.
    if (!resolvedParentId) {
      return header.parentItemCodeText.trim()
        ? `Parent item: "${header.parentItemCodeText.trim()}" is not an item code in the master — pick the item from the dropdown list.`
        : 'Pick the parent item this BOM builds before adding parts.';
    }
    if (resolvedLines.length === 0) return 'Add at least one item to the BOM';
    const itemIds = new Map<string, number>();
    for (let i = 0; i < resolvedLines.length; i++) {
      const l = resolvedLines[i]!;
      if (!l.childItemId) {
        // Say what to DO. The old text implied the code was wrong, when the
        // usual cause is a code typed but never selected from the list.
        return l.childItemCodeText.trim()
          ? `Line ${i + 1}: "${l.childItemCodeText.trim()}" is not an item code in the master — pick the item from the dropdown list.`
          : `Line ${i + 1}: pick an item from the dropdown list.`;
      }
      if (l.childItemId === resolvedParentId) {
        const code = l.childItemCodeText.trim() || parentItem?.code || 'this item';
        return `Line ${i + 1}: ${code} is the parent item, so it cannot also be one of its own parts. Remove this line, or pick a different parent.`;
      }
      const firstLine = itemIds.get(l.childItemId);
      if (firstLine !== undefined) {
        // Name the part and both lines. "duplicate item code" alone left the
        // user hunting for which two rows collided in a 20-part BOM.
        const code = l.childItemCodeText.trim() || itemById.get(l.childItemId)?.code || 'this item';
        return `Line ${i + 1}: duplicate item code — ${code} is already on line ${firstLine + 1}. A BOM can list a part only once; remove one line, or put the combined quantity on a single line.`;
      }
      itemIds.set(l.childItemId, i);
      const qty = Number(l.qtyPerSet);
      if (!Number.isFinite(qty) || qty <= 0) {
        return `Line ${i + 1}: qty must be > 0`;
      }
    }
    return null;
  }, [header, resolvedLines, itemById, resolvedParentId, parentItem]);

  const submit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    if (validationError) return;
    await onSubmit(
      // Hand back the RESOLVED parent id so a pasted code saves too.
      { ...header, parentItemId: resolvedParentId },
      // Resolved, so a pasted exact code saves with its real item id.
      resolvedLines,
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
            {/* Import and Add are the two ways to put a part on the list, so
                both are gated on the parent. Template stays open — you may
                well want the empty sheet before you have decided the parent. */}
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              style={{ color: 'var(--green)' }}
              disabled={parentLocked}
              title={parentLocked ? 'Pick the parent item first' : undefined}
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
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              disabled={parentLocked}
              title={parentLocked ? 'Pick the parent item first' : undefined}
              onClick={addLine}
            >
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
        <div className="panel-body">
          {/* ── PARENT ITEM ────────────────────────────────────────────────
              Its own captioned block above the children, on the SAME grid
              tracks, so Item Code / Item Name / Qty line up in one column
              from parent to child and the page reads top-to-bottom:
              "this assembly ← is built from these parts". */}
          <div style={SECTION_LABEL}>Parent Item</div>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: PARENT_GRID,
              gap: 8,
              padding: '0 10px 4px',
              fontSize: 9,
              fontWeight: 700,
              letterSpacing: 0.4,
              color: 'var(--text3)',
              textTransform: 'uppercase',
            }}
          >
            <span />
            <span>Item Code ★</span>
            <span>Item Name</span>
            <span style={{ textAlign: 'center' }}>Qty</span>
            <span />
            <span />
          </div>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: PARENT_GRID,
              gap: 8,
              alignItems: 'center',
              background: 'var(--bg)',
              // Amber only while it is missing — that is the gate telling you
              // what to do. Once picked it is an ordinary row like the rest.
              border: `1px solid ${parentItem ? 'var(--border)' : 'var(--amber)'}`,
              borderRadius: 8,
              padding: 10,
              marginBottom: 14,
            }}
          >
            <span />
            <SearchableSelect
              id="bom-parent-item"
              value={resolvedParentId || null}
              onChange={onParentPicked}
              onSearch={onParentSearch}
              loading={itemsFetching}
              options={itemOptions}
              placeholder="🔍 Parent item code…"
              emptyText="No matching item"
              selectedLabel={(o) => o.code ?? o.name}
              {...(parentItem
                ? { valueLabel: parentItem.code }
                : header.parentItemCodeText
                  ? { valueLabel: header.parentItemCodeText }
                  : {})}
            />
            <input
              className="innovic-input"
              readOnly
              placeholder="auto-filled"
              value={
                parentItem
                  ? parentItem.material
                    ? `${parentItem.name} [${parentItem.material}]`
                    : parentItem.name
                  : ''
              }
              style={{ background: 'var(--bg2)', color: 'var(--text2)' }}
            />
            {/* Always 1, and read-only on purpose: a BOM defines the parts for
                ONE finished unit, and every child's Qty/Set is already
                "per one parent". Making it editable would mean two different
                places to say the same number. */}
            <input
              className="innovic-input fw-700"
              readOnly
              value="1"
              title="A BOM builds one unit — each child's Qty / Set is per one parent."
              style={{ textAlign: 'center', background: 'var(--bg2)', color: 'var(--text2)' }}
            />
            <span />
            <span />
          </div>

          {/* ── CHILD ITEMS ─────────────────────────────────────────────── */}
          <div style={SECTION_LABEL}>Child Items</div>
          <div className="text3" style={{ fontSize: 11, marginBottom: 8 }}>
            {parentLocked
              ? '⚠ Pick the parent item above to unlock the part list.'
              : 'Add a line, then pick an item code — name auto-fills from the Item Master.'}
          </div>

          {lines.length > 0 ? (
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: BOM_GRID,
                gap: 8,
                padding: '0 10px 4px',
                fontSize: 9,
                fontWeight: 700,
                letterSpacing: 0.4,
                color: 'var(--text3)',
                textTransform: 'uppercase',
              }}
            >
              <span>#</span>
              <span>Item Code ★</span>
              <span>Item Name</span>
              <span style={{ textAlign: 'center' }}>Qty / Set ★</span>
              <span>Type</span>
              <span />
            </div>
          ) : null}

          {lines.length === 0 ? (
            <div className="empty-state" style={{ padding: 20 }}>
              {parentLocked ? (
                <>
                  Locked — pick the <strong>parent item</strong> above first.
                </>
              ) : (
                <>
                  No items yet. Click <strong>+ Add Item</strong>.
                </>
              )}
            </div>
          ) : null}

          {/* Render the RESOLVED lines so a pasted exact code fills the Name
              box immediately, instead of staying blank until save.
              While the parent is unset the rows go inert rather than vanishing:
              on the EDIT form a pre-0085 BOM already has parts, and hiding them
              would read as "my BOM lost its parts". */}
          {resolvedLines.map((line, idx) => {
            // Name follows the PICKED item. Resolve from the full master first
            // (covers a line loaded into the edit form), then from the current
            // search page (covers a pick just made).
            const item = line.childItemId
              ? (itemById.get(line.childItemId) ??
                (itemPage?.items ?? []).find((i) => i.id === line.childItemId))
              : null;
            return (
              <div
                key={idx}
                style={{
                  display: 'grid',
                  gridTemplateColumns: BOM_GRID,
                  gap: 8,
                  alignItems: 'center',
                  background: 'var(--bg)',
                  border: '1px solid var(--border)',
                  borderRadius: 8,
                  padding: 10,
                  marginBottom: 8,
                  opacity: parentLocked ? 0.45 : 1,
                  pointerEvents: parentLocked ? 'none' : 'auto',
                }}
                aria-disabled={parentLocked}
              >
                <span
                  className="mono fw-700"
                  style={{ textAlign: 'center', color: 'var(--text3)' }}
                >
                  {idx + 1}
                </span>
                {/* Shared type-to-search dropdown — substring match anywhere,
                    server-side search, keyboard nav. The field shows the CODE
                    only once picked; the adjacent read-only box carries the
                    name, mirroring the invoice line editor. */}
                <SearchableSelect
                  id={`bom-item-${idx}`}
                  value={line.childItemId || null}
                  onChange={(id) => onItemPicked(idx, id)}
                  onSearch={(t) => onItemSearch(idx, t)}
                  loading={itemsFetching}
                  options={itemOptions}
                  placeholder="🔍 Search item code or name…"
                  emptyText="No matching item"
                  selectedLabel={(o) => o.code ?? o.name}
                  {...(item
                    ? { valueLabel: item.code }
                    : line.childItemCodeText
                      ? { valueLabel: line.childItemCodeText }
                      : {})}
                />
                <input
                  className="innovic-input"
                  readOnly
                  placeholder="auto-filled"
                  value={item ? (item.material ? `${item.name} [${item.material}]` : item.name) : ''}
                  style={{ background: 'var(--bg2)', color: 'var(--text2)' }}
                />
                <input
                  type="number"
                  min="0.01"
                  step="0.01"
                  className="innovic-input fw-700"
                  value={line.qtyPerSet}
                  onChange={(e) => updateLine(idx, { qtyPerSet: e.target.value })}
                  style={{ textAlign: 'center' }}
                />
                <select
                  className="innovic-select"
                  value={line.bomType}
                  onChange={(e) => updateLine(idx, { bomType: e.target.value as BomLineType })}
                  style={{ fontSize: 11 }}
                >
                  {BOM_TYPES.map((t) => (
                    <option key={t.value} value={t.value}>
                      {t.label}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  className="btn btn-danger btn-sm btn-icon"
                  onClick={() => removeLine(idx)}
                  title="Remove line"
                >
                  <Trash2 size={12} />
                </button>
              </div>
            );
          })}

        </div>
      </div>

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
