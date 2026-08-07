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
import { Boxes, Download, FileText, Package, Plus, Search, Trash2, Upload } from 'lucide-react';
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

// One grid shared by the child header row AND every child data row, so the
// columns line up exactly. Track minimums add up to 578px + 50px of gap; below
// that the block scrolls horizontally inside itself rather than squeezing the
// Type select or clipping the delete button off the end of the row.
const CHILD_GRID = '40px minmax(140px,1.1fr) minmax(150px,2fr) 90px minmax(120px,150px) 38px';

// The parent uses the same first three tracks so Item Code / Item Name sit in
// one continuous column from parent to child, then gives Qty the rest. It has
// no Type (a parent is always the thing being assembled) and no delete (there
// is exactly one).
const PARENT_GRID = 'minmax(140px,1.1fr) minmax(150px,2fr) 110px';

const STATUS_PILL: Record<BomFormHeaderDraft['status'], string> = {
  active: 'bomx-pill-green',
  draft: 'bomx-pill-amber',
  obsolete: 'bomx-pill-red',
};

// Scoped stylesheet. Inline styles cannot express :focus / :hover / :disabled,
// and those three states are most of what makes a form feel solid — so the
// chrome lives here under a bomx- prefix that cannot collide with the app's
// global panel/innovic-* classes.
const BOMX_CSS = `
.bomx { display:flex; flex-direction:column; gap:16px;
  font-family:'Inter Tight',Inter,system-ui,-apple-system,'Segoe UI',sans-serif;
  color:#0f172a; }
.bomx-card { background:#fff; border:1px solid #dfe4ec; border-radius:12px;
  box-shadow:0 1px 2px rgba(16,24,40,.04),0 1px 3px rgba(16,24,40,.06);
  display:flex; flex-direction:column; overflow:hidden; }
.bomx-hd { display:flex; align-items:center; justify-content:space-between; gap:12px;
  padding:14px 18px; background:#f8fafc; border-bottom:1px solid #e6ebf2; }
.bomx-hd-l { display:flex; align-items:center; gap:10px; min-width:0; }
.bomx-ic { width:28px; height:28px; border-radius:8px; background:#eef2f8;
  display:flex; align-items:center; justify-content:center; color:#475569; flex:none; }
.bomx-ttl { font-size:15px; font-weight:700; letter-spacing:-.01em; }
.bomx-pill { font-size:11px; font-weight:700; letter-spacing:.02em; padding:3px 9px;
  border-radius:999px; background:#eef2f7; color:#64748b; white-space:nowrap; }
.bomx-pill-green { background:#e7f6ed; color:#15803d; }
.bomx-pill-amber { background:#fdf3e3; color:#b45309; }
.bomx-pill-red { background:#fdeaea; color:#b91c1c; }
.bomx-hd-r { display:flex; align-items:center; gap:8px; flex:none; }
.bomx-meta { font-size:12px; color:#94a3b8; white-space:nowrap; }
.bomx-body { display:flex; flex-direction:column; gap:18px; padding:18px; }
.bomx-fields { display:grid; grid-template-columns:repeat(auto-fit,minmax(180px,1fr)); gap:16px; }
.bomx-f { display:flex; flex-direction:column; gap:6px; min-width:0; }
.bomx-lbl { font-size:11px; font-weight:700; letter-spacing:.06em; text-transform:uppercase;
  color:#64748b; }
.bomx-req { color:#dc2626; }
.bomx-help { font-size:11px; color:#94a3b8; line-height:1.35; }
.bomx-sec { display:flex; flex-direction:column; gap:8px; }
.bomx-parent { background:#f4f7fb; border:1px solid #e6ebf2; border-radius:10px; padding:14px; }
.bomx-pgrid { display:grid; grid-template-columns:${PARENT_GRID}; gap:10px; align-items:end; }
.bomx-block { border:1px solid #e6ebf2; border-radius:10px; overflow:hidden;
  display:flex; flex-direction:column; }
.bomx-scroll { overflow-x:auto; display:flex; flex-direction:column; }
.bomx-row { display:grid; grid-template-columns:${CHILD_GRID}; gap:10px; align-items:center;
  padding:10px 12px; }
.bomx-row-hd { background:#f7f9fc; border-bottom:1px solid #e6ebf2; font-size:10px;
  font-weight:700; letter-spacing:.06em; text-transform:uppercase; color:#64748b; }
.bomx-row + .bomx-row { border-top:1px solid #eef2f7; }
.bomx-row-hd + .bomx-row { border-top:none; }
.bomx-num { width:28px; height:28px; border-radius:7px; background:#eef2f7; color:#475569;
  font-size:12px; font-weight:700; display:flex; align-items:center; justify-content:center; }
.bomx-search { position:relative; min-width:0; }
.bomx-search > svg { position:absolute; left:10px; top:50%; transform:translateY(-50%);
  color:#94a3b8; pointer-events:none; z-index:1; }
.bomx-search input { padding-left:30px !important; }
.bomx input, .bomx select { height:40px; border-radius:8px; border:1px solid #cfd8e6;
  background:#fff; color:#0f172a; font-size:13px; padding:0 10px; width:100%;
  font-family:inherit; outline:none; transition:border-color .12s, box-shadow .12s; }
.bomx input:focus, .bomx select:focus { border-color:#2563eb; box-shadow:0 0 0 3px rgba(37,99,235,.15); }
.bomx input[readonly] { background:#f1f5f9; color:#64748b; cursor:default; }
.bomx input[readonly]:focus { border-color:#cfd8e6; box-shadow:none; }
.bomx input:disabled, .bomx select:disabled { background:#f1f5f9; color:#94a3b8; }
.bomx-ctr { text-align:center; }
.bomx-btn { height:36px; border-radius:8px; padding:0 14px; font-size:13px; font-weight:600;
  display:inline-flex; align-items:center; gap:6px; white-space:nowrap; cursor:pointer;
  border:1px solid #cfd8e6; background:#fff; color:#334155; font-family:inherit;
  transition:background .12s, border-color .12s; }
.bomx-btn:hover:not(:disabled) { background:#f4f7fb; border-color:#b9c5d6; }
.bomx-btn:disabled { opacity:.5; cursor:not-allowed; }
.bomx-btn-primary { background:#2563eb; border-color:#2563eb; color:#fff; }
.bomx-btn-primary:hover:not(:disabled) { background:#1d4ed8; border-color:#1d4ed8; }
.bomx-del { width:32px; height:32px; border-radius:7px; padding:0; justify-content:center;
  border:1px solid #f3d3d3; background:#fdf3f3; color:#dc2626; }
.bomx-del:hover:not(:disabled) { background:#fbe6e6; border-color:#eebcbc; }
.bomx-tools { display:flex; align-items:center; gap:8px; padding:12px;
  border-top:1px solid #eef2f7; background:#fcfdfe; }
.bomx-tools-sp { margin-left:auto; font-size:12px; color:#94a3b8; white-space:nowrap; }
.bomx-empty { padding:22px 12px; text-align:center; font-size:13px; color:#94a3b8; }
.bomx-alert { display:flex; gap:8px; padding:10px 12px; border-radius:8px; font-size:12px;
  line-height:1.45; }
.bomx-alert-red { background:#fdeaea; border:1px solid #f6cccc; color:#b91c1c; }
.bomx-alert-amber { background:#fdf6ea; border:1px solid #f5e0bb; color:#92400e; }
.bomx-alert-green { background:#eaf7ef; border:1px solid #c6e9d3; color:#15803d; }
.bomx-alert ul { margin:6px 0 0; padding-left:18px; }
.bomx-ta { border-radius:8px; border:1px solid #cfd8e6; padding:10px; font-size:13px;
  font-family:inherit; width:100%; resize:vertical; outline:none; }
.bomx-ta:focus { border-color:#2563eb; box-shadow:0 0 0 3px rgba(37,99,235,.15); }
`;

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

// Plain labels — the two factory emoji were identical, so "🏭 Manufacture" and
// "🏭 Outsource" read as the same option at a glance.
const BOM_TYPES: ReadonlyArray<{ value: BomLineType; label: string }> = [
  { value: 'manufacture', label: 'Manufacture' },
  { value: 'purchase', label: 'Purchase' },
  { value: 'outsource', label: 'Outsource' },
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

  // Rows that name a real part vs rows that are still empty. resolvedLines is
  // used so a pasted-but-not-clicked code counts as filled — it saves fine.
  const filledChildCount = resolvedLines.filter((l) => l.childItemId).length;
  const blankChildCount = resolvedLines.length - filledChildCount;

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

  const saveLabel = submitting
    ? 'Saving…'
    : mode === 'create'
      ? 'Save BOM'
      : `Save as Rev ${nextRevision}`;

  return (
    <form className="bomx" onSubmit={(e) => void submit(e)}>
      <style>{BOMX_CSS}</style>

      {/* ── Card 1: BOM header ───────────────────────────────────────────── */}
      <div className="bomx-card">
        <div className="bomx-hd">
          <div className="bomx-hd-l">
            <span className="bomx-ic">
              <Package size={15} />
            </span>
            <span className="bomx-ttl">
              {mode === 'create' ? 'New BOM' : `Edit BOM — ${bom?.bomNo ?? ''}`}
            </span>
            <span className={`bomx-pill ${STATUS_PILL[header.status]}`}>
              {header.status.toUpperCase()}
            </span>
            {mode === 'edit' ? (
              <span className="bomx-pill">
                REV {bom?.revision ?? 1} → {nextRevision}
              </span>
            ) : null}
          </div>
          {/* Save and Cancel live in the header, not a detached footer — the
              form is one card and the commit action belongs with its title. */}
          <div className="bomx-hd-r">
            <button type="button" className="bomx-btn" onClick={onCancel}>
              Cancel
            </button>
            <button
              type="submit"
              className="bomx-btn bomx-btn-primary"
              disabled={Boolean(validationError) || submitting}
              title={validationError ?? undefined}
            >
              {saveLabel}
            </button>
          </div>
        </div>

        <div className="bomx-body">
          <div className="bomx-fields">
            <div className="bomx-f">
              <span className="bomx-lbl">
                BOM No. <span className="bomx-req">*</span>
              </span>
              <input
                value={header.bomNo}
                onChange={(e) => setHeader({ ...header, bomNo: e.target.value })}
                placeholder={mode === 'create' ? 'BOM-NNNN (auto if blank)' : 'BOM-0001'}
              />
              <span className="bomx-help">Auto-generated · editable</span>
            </div>
            <div className="bomx-f">
              <span className="bomx-lbl">
                BOM Name <span className="bomx-req">*</span>
              </span>
              <input
                value={header.bomName}
                onChange={(e) => setHeader({ ...header, bomName: e.target.value })}
                placeholder="e.g. Hydraulic Press Assembly"
              />
              <span className="bomx-help">Shown across production and planning screens</span>
            </div>
            <div className="bomx-f">
              <span className="bomx-lbl">Status</span>
              <select
                value={header.status}
                onChange={(e) =>
                  setHeader({ ...header, status: e.target.value as BomFormHeaderDraft['status'] })
                }
              >
                <option value="active">Active</option>
                <option value="draft">Draft</option>
                <option value="obsolete">Obsolete</option>
              </select>
              <span className="bomx-help">Only Active BOMs attach to sales orders</span>
            </div>
            <div className="bomx-f">
              <span className="bomx-lbl">Revision</span>
              <input value={String(bom?.revision ?? 1)} readOnly />
              <span className="bomx-help">Increments on each release</span>
            </div>
          </div>

          {/* Next to Save, where the disabled button is — not at the far end of
              the page where you would never look for it. */}
          {validationError ? (
            <div className="bomx-alert bomx-alert-red">{validationError}</div>
          ) : null}
          {submitError ? <div className="bomx-alert bomx-alert-red">{submitError}</div> : null}
        </div>
      </div>

      {/* ── Card 2: Bill of Materials ────────────────────────────────────── */}
      <div className="bomx-card">
        <div className="bomx-hd">
          <div className="bomx-hd-l">
            <span className="bomx-ic">
              <Boxes size={15} />
            </span>
            <span className="bomx-ttl">Bill of Materials</span>
            <span className="bomx-pill">
              {lines.length} line{lines.length === 1 ? '' : 's'}
            </span>
          </div>
          <div className="bomx-meta">
            {filledChildCount} of {lines.length} lines filled
          </div>
        </div>

        <div className="bomx-body">
          {importSummary ? (
            <div
              className={`bomx-alert ${importErrors.length > 0 ? 'bomx-alert-amber' : 'bomx-alert-green'}`}
            >
              <div>
                {importSummary}
                {importErrors.length > 0 ? (
                  <ul>
                    {importErrors.slice(0, 10).map((err, i) => (
                      <li key={i}>
                        Row {err.rowIndex + 2}: {err.itemCode} — {err.reason}
                      </li>
                    ))}
                    {importErrors.length > 10 ? (
                      <li>… and {importErrors.length - 10} more</li>
                    ) : null}
                  </ul>
                ) : null}
              </div>
            </div>
          ) : null}

          {/* ── PARENT ITEM ─────────────────────────────────────────────── */}
          <section className="bomx-sec">
            <span className="bomx-lbl">Parent Item</span>
            <div className="bomx-parent">
              <div className="bomx-pgrid">
                <div className="bomx-f">
                  <span className="bomx-lbl">
                    Item Code <span className="bomx-req">*</span>
                  </span>
                  <div className="bomx-search">
                    <Search size={14} />
                    <SearchableSelect
                      id="bom-parent-item"
                      value={resolvedParentId || null}
                      onChange={onParentPicked}
                      onSearch={onParentSearch}
                      loading={itemsFetching}
                      options={itemOptions}
                      placeholder="Search parent item code…"
                      emptyText="No matching item"
                      selectedLabel={(o) => o.code ?? o.name}
                      {...(parentItem
                        ? { valueLabel: parentItem.code }
                        : header.parentItemCodeText
                          ? { valueLabel: header.parentItemCodeText }
                          : {})}
                    />
                  </div>
                </div>
                <div className="bomx-f">
                  <span className="bomx-lbl">Item Name</span>
                  <input
                    readOnly
                    placeholder="auto-filled"
                    value={
                      parentItem
                        ? parentItem.material
                          ? `${parentItem.name} [${parentItem.material}]`
                          : parentItem.name
                        : ''
                    }
                  />
                </div>
                <div className="bomx-f">
                  <span className="bomx-lbl">
                    Qty <span className="bomx-req">*</span>
                  </span>
                  {/* Always 1, read-only: a BOM defines the parts for ONE
                      finished unit, and every child's Qty/Set is already "per
                      one parent". Editable here would be a second place to say
                      the same number. */}
                  <input
                    className="bomx-ctr"
                    readOnly
                    value="1"
                    title="A BOM builds one unit — each child's Qty / Set is per one parent."
                  />
                </div>
              </div>
            </div>
          </section>

          {/* ── CHILD ITEMS ─────────────────────────────────────────────── */}
          <section className="bomx-sec">
            <span className="bomx-lbl">Child Items</span>
            <span className="bomx-help">
              {parentLocked
                ? 'Pick the parent item above to unlock the part list.'
                : 'Pick an item code — the name auto-fills from the Item Master.'}
            </span>

            <div className="bomx-block">
              {/* Own scroller: below ~630px of row width the tracks cannot all
                  fit, and squeezing them would push the Type select and the
                  delete button off the row. Scrolling keeps every control
                  reachable instead of hiding the destructive one. */}
              <div className="bomx-scroll">
                <div className="bomx-row bomx-row-hd">
                  <span>#</span>
                  <span>
                    Item Code <span className="bomx-req">*</span>
                  </span>
                  <span>Item Name</span>
                  <span className="bomx-ctr">
                    Qty / Set <span className="bomx-req">*</span>
                  </span>
                  <span>Type</span>
                  <span />
                </div>

                {lines.length === 0 ? (
                  <div className="bomx-empty">
                    {parentLocked
                      ? 'Locked — pick the parent item above first.'
                      : 'No parts yet. Use + Add child item below.'}
                  </div>
                ) : null}

                {/* RESOLVED lines so a pasted exact code fills the Name box at
                    once. While the parent is unset the rows go inert rather
                    than vanishing: on the EDIT form a pre-0085 BOM already has
                    parts, and hiding them would read as "my BOM lost its
                    parts". */}
                {resolvedLines.map((line, idx) => {
                  const item = line.childItemId
                    ? (itemById.get(line.childItemId) ??
                      (itemPage?.items ?? []).find((i) => i.id === line.childItemId))
                    : null;
                  return (
                    <div
                      key={idx}
                      className="bomx-row"
                      aria-disabled={parentLocked}
                      style={
                        parentLocked ? { opacity: 0.45, pointerEvents: 'none' } : undefined
                      }
                    >
                      <span className="bomx-num">{idx + 1}</span>
                      <div className="bomx-search">
                        <Search size={14} />
                        <SearchableSelect
                          id={`bom-item-${idx}`}
                          value={line.childItemId || null}
                          onChange={(id) => onItemPicked(idx, id)}
                          onSearch={(t) => onItemSearch(idx, t)}
                          loading={itemsFetching}
                          options={itemOptions}
                          placeholder="Search item code…"
                          emptyText="No matching item"
                          selectedLabel={(o) => o.code ?? o.name}
                          {...(item
                            ? { valueLabel: item.code }
                            : line.childItemCodeText
                              ? { valueLabel: line.childItemCodeText }
                              : {})}
                        />
                      </div>
                      <input
                        readOnly
                        placeholder="auto-filled"
                        value={
                          item ? (item.material ? `${item.name} [${item.material}]` : item.name) : ''
                        }
                      />
                      <input
                        type="number"
                        min="0.01"
                        step="0.01"
                        className="bomx-ctr"
                        value={line.qtyPerSet}
                        onChange={(e) => updateLine(idx, { qtyPerSet: e.target.value })}
                      />
                      <select
                        value={line.bomType}
                        onChange={(e) =>
                          updateLine(idx, { bomType: e.target.value as BomLineType })
                        }
                      >
                        {BOM_TYPES.map((t) => (
                          <option key={t.value} value={t.value}>
                            {t.label}
                          </option>
                        ))}
                      </select>
                      <button
                        type="button"
                        className="bomx-btn bomx-del"
                        onClick={() => removeLine(idx)}
                        title="Remove line"
                        aria-label={`Remove line ${idx + 1}`}
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  );
                })}
              </div>

              {/* Toolbar is the last row INSIDE the block — the actions belong
                  to the list they act on, not to the card header. */}
              <div className="bomx-tools">
                <button
                  type="button"
                  className="bomx-btn bomx-btn-primary"
                  disabled={parentLocked}
                  title={parentLocked ? 'Pick the parent item first' : undefined}
                  onClick={addLine}
                >
                  <Plus size={14} /> Add child item
                </button>
                {/* Template stays open even while locked — you may well want the
                    empty sheet before you have decided the parent. */}
                <button
                  type="button"
                  className="bomx-btn"
                  onClick={() => void downloadTemplate()}
                >
                  <Download size={14} /> Template
                </button>
                <button
                  type="button"
                  className="bomx-btn"
                  disabled={parentLocked}
                  title={parentLocked ? 'Pick the parent item first' : undefined}
                  onClick={() => fileInputRef.current?.click()}
                >
                  <Upload size={14} /> Import Excel
                </button>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".xlsx,.xls,.csv"
                  style={{ display: 'none' }}
                  onChange={(e) => void onImportFile(e)}
                />
                <span className="bomx-tools-sp">
                  {filledChildCount} of {lines.length} lines filled
                  {blankChildCount > 0
                    ? ` · ${blankChildCount} blank row${blankChildCount > 1 ? 's' : ''}`
                    : ''}
                </span>
              </div>
            </div>
          </section>
        </div>
      </div>

      {/* ── Card 3: revision note (edit only) ────────────────────────────── */}
      {mode === 'edit' ? (
        <div className="bomx-card">
          <div className="bomx-hd">
            <div className="bomx-hd-l">
              <span className="bomx-ic">
                <FileText size={15} />
              </span>
              <span className="bomx-ttl">Revision Note</span>
              <span className="bomx-pill">
                REV {bom?.revision ?? 1} → {nextRevision}
              </span>
            </div>
          </div>
          <div className="bomx-body">
            <div className="bomx-f">
              <textarea
                className="bomx-ta"
                rows={2}
                value={revisionNote}
                onChange={(e) => setRevisionNote(e.target.value)}
                placeholder="Auto-generated on save. You can edit…"
              />
              <span className="bomx-help">
                Generated from what changed when you save. Edit it first if you want your own
                wording.
              </span>
            </div>
          </div>
        </div>
      ) : null}
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
