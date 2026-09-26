// Shared BOM Master form used by create + edit routes.
//
// Header: BOM No (auto on create) + Name + Status + Revision indicator.
// Line editor: item picker (the shared SearchableSelect) + qty/set + bom_type
// dropdown + remove button. Excel template download + import.
//
// Layout is the app theme (create-page pattern): sticky PageHeader (Cancel +
// blue Save, Ctrl+S, "Not saved") → Panel(BOM Details) → Panel(Parent Item) →
// Panel(Child Items: .innovic-table.tbl-grid.tbl-edit) → Panel(Revision Note).
// The private `bomx-` stylesheet (40px inputs, 36px buttons, own palette) is
// gone.

import type {
  BomLineType,
  BomMaster,
  CreateBomMasterLineInput,
  Item,
  ListItemsResponse,
} from '@innovic/shared';
import { Copy, Download, Plus, Trash2, Upload } from 'lucide-react';
import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { SearchableSelect } from '@/components/shared/searchable-select';
import { apiFetch } from '@/lib/api';
import { getCol, normalizeHeaderKey, readSheetRows } from '@/lib/xlsx-import';
import { useItemsList } from '@/modules/items/api';
import {
  MaterialGradePicker,
  MaterialSizePicker,
  RawMaterialGroup,
} from '@/modules/raw-material/components/raw-material-pickers';
import { Panel } from '@/ui/data';
import { Banner } from '@/ui/feedback';
import { FormField, FormGrid } from '@/ui/forms';
import { PageHeader, useSaveShortcut } from '@/ui/layout';
import { useNextBomNo } from '../api';

// xlsx (~400 KB raw / 140 KB gzip) is dynamic-imported inside the two
// handlers that need it (template download + Excel parse). Lets every
// other page in the app skip the cost.
type XlsxModule = typeof import('xlsx');
async function loadXlsx(): Promise<XlsxModule> {
  return import('xlsx');
}

const STATUS_LABEL: Record<BomFormHeaderDraft['status'], string> = {
  active: 'Active',
  draft: 'Draft',
  obsolete: 'Obsolete',
};

/** Status → the theme's badge colour (green live · amber draft · red retired). */
const STATUS_BADGE: Record<BomFormHeaderDraft['status'], string> = {
  active: 'b-green',
  draft: 'b-amber',
  obsolete: 'b-red',
};

/** A part row while the parent is unset: inert, not hidden (see below). */
const LOCKED_ROW: React.CSSProperties = { opacity: 0.45, pointerEvents: 'none' };

export interface BomFormLineDraft {
  childItemId: string;
  childItemCodeText: string;
  qtyPerSet: string;
  bomType: BomLineType;
  /** Raw material for THIS child part. A child is a different part from its
   *  parent and is cut from different stock, so it hangs off the LINE, never
   *  the BOM header — the cascade stamps each child Job Card from its own
   *  line. Both optional: a purchase/outsource line buys the part instead of
   *  cutting it, so blank is normal there. Id + text snapshot move together. */
  rawMaterialGradeId: string | null;
  rawMaterialGradeText: string | null;
  rawMaterialSizeId: string | null;
  rawMaterialSizeText: string | null;
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

/** Why a row was rejected. Kept separate from `reason` (which names the item
 *  and the offending row) so the report can count identical problems once —
 *  "79 rows: item_code not found in master" instead of 79 near-identical lines. */
type ExcelRowErrorKind =
  | 'blank_code'
  | 'not_found'
  | 'lookup_failed'
  | 'parent_as_child'
  | 'duplicate'
  | 'bad_qty'
  | 'bad_type';

const ERROR_KIND_LABEL: Record<ExcelRowErrorKind, string> = {
  blank_code: 'Item Code is blank',
  not_found: 'item code not in Item Master',
  lookup_failed: 'could not be checked — try again',
  parent_as_child: 'the parent item cannot be its own part',
  duplicate: 'the same item appears more than once',
  bad_qty: 'Qty / Set must be a number greater than 0',
  bad_type: 'BOM Type must be Manufacture, Purchase or Outsource',
};

interface ExcelRowError {
  rowIndex: number;
  itemCode: string;
  kind: ExcelRowErrorKind;
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

// The three columns the importer reads, with every header spelling accepted for
// each. ONE list, used for both the up-front template check and the per-row
// reads — so a column can never be validated under one name and then read under
// another.
const CODE_ALIASES = ['item_code', 'Item Code', 'code'];
const QTY_ALIASES = ['qty_per_set', 'Qty Per Set', 'qty', 'qty/set'];
const TYPE_ALIASES = ['bom_type', 'BOM Type', 'Type'];
const REQUIRED_COLUMNS: ReadonlyArray<{ label: string; aliases: string[] }> = [
  { label: 'Item Code', aliases: CODE_ALIASES },
  { label: 'Qty Per Set', aliases: QTY_ALIASES },
  { label: 'BOM Type', aliases: TYPE_ALIASES },
];

// listItemsQuerySchema (packages/shared/src/schemas/item.ts) caps `limit` at
// 1000. Asking for more is a 400, not a bigger page — keep these in step.
const ITEM_PAGE_MAX = 1000;

function emptyLine(): BomFormLineDraft {
  return {
    childItemId: '',
    childItemCodeText: '',
    qtyPerSet: '1',
    bomType: 'manufacture',
    rawMaterialGradeId: null,
    rawMaterialGradeText: null,
    rawMaterialSizeId: null,
    rawMaterialSizeText: null,
  };
}

export function BomForm(props: BomFormProps): React.JSX.Element {
  const { mode, initialHeader, initialLines, bom, onSubmit, submitting, submitError, onCancel } =
    props;
  const [header, setHeader] = useState<BomFormHeaderDraft>(initialHeader);
  const [lines, setLines] = useState<BomFormLineDraft[]>(initialLines);
  const [revisionNote, setRevisionNote] = useState('');
  const [importErrors, setImportErrors] = useState<ExcelRowError[]>([]);
  const [importSummary, setImportSummary] = useState<string | null>(null);
  /** Codes the last import could not find in Item Master. Drives the "download
   *  these as an Item Master import sheet" escape hatch — without it a file of
   *  83 unknown codes is a dead end, since this form can only match items and
   *  never create them. */
  const [missingCodes, setMissingCodes] = useState<string[]>([]);
  /** The file was rejected outright — wrong template, wrong tab, unreadable —
   *  so nothing was imported. Distinct from per-row errors: it paints the box
   *  red (it used to come up GREEN, the colour of success) and offers the
   *  template download, which is what the user needs next. */
  const [importFatal, setImportFatal] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const clearImportReport = (): void => {
    setImportSummary(null);
    setImportErrors([]);
    setMissingCodes([]);
    setImportFatal(false);
  };

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

  // True once the loaded page holds the ENTIRE master. Then a code the map does
  // not have is genuinely absent, and the per-code lookups below are pure waste
  // — an 83-row file used to fire 83 requests that could not possibly succeed.
  const masterFullyLoaded = itemsList ? itemsList.items.length >= itemsList.total : false;

  // A code the first page did not cover is not proof the item is missing — the
  // master may simply be larger than one page. Ask the server for each such
  // code before declaring it unknown. An import file holds a handful of rows,
  // so this stays a handful of small requests.
  //
  // `failed` carries the codes whose lookup ERRORED. They are not the same as
  // "not in the master" and must not be reported as such: the old empty catch
  // turned every network/500 blip into "item_code not found in master", which
  // sends the user hunting through a master where the item is sitting fine.
  const lookupMissingCodes = async (
    codes: string[],
  ): Promise<{ found: Map<string, Item>; failed: Set<string> }> => {
    const found = new Map<string, Item>();
    const failed = new Set<string>();
    await Promise.all(
      codes.map(async (code) => {
        try {
          const page = await apiFetch<ListItemsResponse>(
            `/items?search=${encodeURIComponent(code)}&limit=50&offset=0`,
          );
          const hit = page.items.find((i) => i.code.toUpperCase() === code);
          if (hit) found.set(code, hit);
        } catch {
          failed.add(code);
        }
      }),
    );
    return { found, failed };
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
      itemsByCode.get(typed) ?? (itemPage?.items ?? []).find((i) => i.code.toUpperCase() === typed);
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
      itemsByCode.get(typed) ?? (itemPage?.items ?? []).find((i) => i.code.toUpperCase() === typed);
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
      // Title Case headers; the importer's aliases still read item_code / qty_per_set / bom_type.
      ['Item Code', 'Qty Per Set', 'BOM Type'],
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
    a.download = 'BOM Import Template.xlsx';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const onImportFile = async (e: React.ChangeEvent<HTMLInputElement>): Promise<void> => {
    const file = e.target.files?.[0];
    if (!file) return;
    clearImportReport();
    try {
      // Shared reader parses .xlsx/.xls AND real .csv via SheetJS, and matches
      // headers normalized (case/spacing/`*` tolerant) — so `item_code` and
      // `Item Code`, `qty_per_set` and `Qty Per Set`, `bom_type`/`Type`/`BOM
      // Type` all resolve instead of demanding exact lowercase-snake headers.
      const { rows, sheetError, sheetName, sheetNames } = await readSheetRows(file);
      if (sheetError) throw new Error(sheetError);

      // The template check, BEFORE any row work. A sheet built from somebody
      // else's template used to fail one row at a time — 83 lines of "not found
      // in master" when the real fault was a missing column — so name the fault
      // once, at the top, with the right template one click away.
      if (rows.length === 0) {
        throw new Error(
          `Sheet "${sheetName}" has no data rows. Put your rows under the header row of the template.`,
        );
      }
      const headerKeys = new Set(Object.keys(rows[0] ?? {}));
      const missingColumns = REQUIRED_COLUMNS.filter(
        (c) => !c.aliases.some((a) => headerKeys.has(normalizeHeaderKey(a))),
      );
      if (missingColumns.length > 0) {
        throw new Error(
          `Import template is not valid — missing column${missingColumns.length === 1 ? '' : 's'}: ` +
            `${missingColumns.map((c) => c.label).join(', ')}. ` +
            `Sheet "${sheetName}" has: ${Array.from(headerKeys).join(', ') || '(no columns)'}. ` +
            `Download the template, put your rows into it, and import that.`,
        );
      }

      // Only the FIRST sheet is read. A user who adds their rows on a later tab
      // gets whatever sheet 1 holds — in practice the untouched template — and
      // the errors then name EXAMPLE-001/002, which looks like the item master
      // is wrong when the real problem is the wrong tab. Say both things out
      // loud instead of importing the samples silently.
      const onlySampleRows =
        rows.length > 0 && rows.every((r) => /^EXAMPLE-\d+$/i.test(getCol(r, CODE_ALIASES).trim()));
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
        new Set(rows.map((r) => getCol(r, CODE_ALIASES).trim().toUpperCase()).filter(Boolean)),
      );
      const unknownCodes = fileCodes.filter((c) => !itemsByCode.has(c));
      const { found: lateFound, failed: lookupFailed } =
        masterFullyLoaded || unknownCodes.length === 0
          ? { found: new Map<string, Item>(), failed: new Set<string>() }
          : await lookupMissingCodes(unknownCodes);

      // What is already on the form, and what THIS file has already claimed.
      // A BOM cannot list the same part twice — one line, one qty/set — so both
      // kinds of repeat are reported by name rather than silently dropped.
      const existingByItemId = new Map<string, number>();
      lines.forEach((l, i) => {
        if (l.childItemId && !existingByItemId.has(l.childItemId))
          existingByItemId.set(l.childItemId, i);
      });
      const seenInFile = new Map<string, number>();

      const added: BomFormLineDraft[] = [];
      const errors: ExcelRowError[] = [];
      // Codes that are simply absent from the master, in file order and without
      // repeats. Lookup FAILURES are deliberately left out — those items may
      // well exist, and offering to create them would make duplicates.
      const notInMaster: string[] = [];
      const notInMasterSeen = new Set<string>();
      rows.forEach((row, idx) => {
        const itemCode = getCol(row, CODE_ALIASES).trim();
        const qtyRaw = getCol(row, QTY_ALIASES);
        const bomType = getCol(row, TYPE_ALIASES).trim().toLowerCase() as BomLineType;
        if (!itemCode) {
          errors.push({
            rowIndex: idx,
            itemCode: '(blank)',
            kind: 'blank_code',
            reason: 'Item Code is required.',
          });
          return;
        }
        const key = itemCode.toUpperCase();
        const item = itemsByCode.get(key) ?? lateFound.get(key);
        if (!item) {
          if (lookupFailed.has(key)) {
            errors.push({
              rowIndex: idx,
              itemCode,
              kind: 'lookup_failed',
              reason: 'could not be checked. Try the import again.',
            });
            return;
          }
          if (!notInMasterSeen.has(key)) {
            notInMasterSeen.add(key);
            notInMaster.push(itemCode);
          }
          errors.push({
            rowIndex: idx,
            itemCode,
            kind: 'not_found',
            reason: 'Item Code not found in Item Master.',
          });
          return;
        }
        // The parent cannot be one of its own parts. The server refuses it, but
        // only at Save — on an 80-row file that means importing, reviewing and
        // then hunting for the one bad line. Say it here, with the others.
        if (resolvedParentId && item.id === resolvedParentId) {
          errors.push({
            rowIndex: idx,
            itemCode,
            kind: 'parent_as_child',
            reason: 'is the parent item of this BOM, so it cannot be one of its parts.',
          });
          return;
        }
        const firstRow = seenInFile.get(item.id);
        if (firstRow !== undefined) {
          errors.push({
            rowIndex: idx,
            itemCode,
            kind: 'duplicate',
            reason: `is already on row ${firstRow + 2}.`,
          });
          return;
        }
        const onFormAt = existingByItemId.get(item.id);
        if (onFormAt !== undefined) {
          errors.push({
            rowIndex: idx,
            itemCode,
            kind: 'duplicate',
            reason: `is already part ${onFormAt + 1} in the list below.`,
          });
          return;
        }
        const qty = Number(qtyRaw);
        if (!Number.isFinite(qty) || qty <= 0) {
          errors.push({
            rowIndex: idx,
            itemCode,
            kind: 'bad_qty',
            reason: 'Qty / Set must be greater than 0.',
          });
          return;
        }
        if (!VALID_BOM_TYPES.has(bomType)) {
          errors.push({
            rowIndex: idx,
            itemCode,
            kind: 'bad_type',
            reason: 'BOM Type must be Manufacture, Purchase or Outsource.',
          });
          return;
        }
        seenInFile.set(item.id, idx);
        added.push({
          // The import sheet carries no Grade/Size columns, so an imported row
          // starts blank and is picked on the form afterwards.
          ...emptyLine(),
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
      setMissingCodes(notInMaster);
      setImportSummary(
        `Imported ${added.length} row(s)${errors.length > 0 ? `, ${errors.length} row(s) had errors` : ''}.${sheetNote}`,
      );
    } catch (err) {
      setImportFatal(true);
      setImportSummary(
        err instanceof Error ? err.message : 'Could not read the Excel file. Try again.',
      );
    } finally {
      // Clear the input so re-uploading the same file fires onChange again.
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  // ── Import report helpers ───────────────────────────────────────────────
  // 83 rows failing for the same reason is one fact, not 83. Count the reasons
  // so the headline says "79 rows: item_code not found in master" and the row
  // list underneath is detail, not the message.
  const errorRollup = useMemo(() => {
    const byKind = new Map<ExcelRowErrorKind, number>();
    for (const e of importErrors) byKind.set(e.kind, (byKind.get(e.kind) ?? 0) + 1);
    return Array.from(byKind.entries()).sort((a, b) => b[1] - a[1]);
  }, [importErrors]);

  const errorLines = (): string[] =>
    importErrors.map((e) => `Row ${e.rowIndex + 2}: ${e.itemCode} — ${e.reason}`);

  const [copiedErrors, setCopiedErrors] = useState(false);
  const copyErrors = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(errorLines().join('\n'));
      setCopiedErrors(true);
      window.setTimeout(() => setCopiedErrors(false), 1500);
    } catch {
      // Clipboard blocked (insecure context / permission). The download button
      // next to this one is the fallback, so stay silent rather than alarm.
    }
  };

  const saveFile = (blob: Blob, filename: string): void => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const downloadErrors = (): void => {
    const esc = (s: string): string => `"${s.replace(/"/g, '""')}"`;
    const csv = [
      'Row,Item Code,Reason',
      ...importErrors.map((e) =>
        [String(e.rowIndex + 2), esc(e.itemCode), esc(e.reason)].join(','),
      ),
    ].join('\r\n');
    // BOM so Excel opens it as UTF-8 instead of mangling non-ASCII codes.
    saveFile(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' }), 'bom-import-errors.csv');
  };

  // The way OUT of "not found in master". This form can only match items, so a
  // file of unknown codes is otherwise a dead end. Hand back exactly those codes
  // in the Item Master importer's own column layout: fill Name and import there,
  // then re-run this BOM import.
  const downloadMissingItemsSheet = async (): Promise<void> => {
    const { utils: xlsxUtils, write: xlsxWrite } = await loadXlsx();
    const aoa: (string | number)[][] = [
      [
        'Item Code*',
        'Item Name*',
        'Description',
        // No Drawing No. / Revision columns: the Item Master importer ignores
        // both (items/lib/import-export.ts), so they would be filled for nothing.
        'Material',
        'UOM',
        'Item Type',
      ],
      // Item Name is REQUIRED by the Item Master importer, so it is pre-filled with
      // the code — the sheet imports as-is, and the names can be corrected in
      // the sheet before importing or in Item Master afterwards.
      ...missingCodes.map((code) => [code, code, '', '', 'NOS', 'component']),
    ];
    const sheet = xlsxUtils.aoa_to_sheet(aoa);
    sheet['!cols'] = [22, 22, 28, 18, 8, 12].map((wch) => ({ wch }));
    const wb = xlsxUtils.book_new();
    xlsxUtils.book_append_sheet(wb, sheet, 'Items');
    const buf = xlsxWrite(wb, { type: 'array', bookType: 'xlsx' });
    saveFile(
      new Blob([buf], { type: 'application/octet-stream' }),
      'Missing Items Import Template.xlsx',
    );
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
        return `Line ${i + 1}: Qty / Set must be greater than 0.`;
      }
    }
    return null;
  }, [header, resolvedLines, itemById, resolvedParentId, parentItem]);

  const save = async (): Promise<void> => {
    if (validationError || submitting) return;
    await onSubmit(
      // Hand back the RESOLVED parent id so a pasted code saves too.
      { ...header, parentItemId: resolvedParentId },
      // Resolved, so a pasted exact code saves with its real item id.
      resolvedLines,
      mode === 'edit' && revisionNote.trim() ? revisionNote.trim() : null,
    );
  };
  const submit = (e: React.FormEvent): void => {
    e.preventDefault();
    void save();
  };
  // Ctrl+S runs the same Save as the header button, and is off whenever that
  // button is disabled.
  useSaveShortcut(() => void save(), !validationError && !submitting);

  // "Not saved" pill. The create form's auto-filled BOM No. is ours, not the
  // user's, so on create the number does not count as an edit.
  const initialSnapshot = useRef(
    JSON.stringify({
      h: { ...initialHeader, bomNo: mode === 'create' ? '' : initialHeader.bomNo },
      l: initialLines,
    }),
  );
  const isDirty =
    revisionNote.trim() !== '' ||
    JSON.stringify({
      h: { ...header, bomNo: mode === 'create' ? '' : header.bomNo },
      l: lines,
    }) !== initialSnapshot.current;

  const saveLabel = submitting
    ? 'Saving…'
    : mode === 'create'
      ? 'Save BOM'
      : `Save as BOM Rev ${nextRevision}`;

  // Child grid: # · Item Code · Item Name · Qty / Set · BOM Type · (remove).
  const childCols = 6;

  return (
    <form onSubmit={submit}>
      <PageHeader
        sticky
        title={mode === 'create' ? 'New BOM' : `Edit BOM — ${bom?.bomNo ?? ''}`}
        subtitle={
          <span style={{ display: 'inline-flex', gap: 'var(--sp-2)', alignItems: 'center' }}>
            <span className={`badge ${STATUS_BADGE[header.status]}`}>
              {STATUS_LABEL[header.status]}
            </span>
            {mode === 'edit' ? (
              <span className="badge b-grey">
                BOM REV {bom?.revision ?? 1} → {nextRevision}
              </span>
            ) : null}
          </span>
        }
        dirty={isDirty}
        actions={
          <>
            <button type="button" className="btn btn-ghost" onClick={onCancel}>
              Cancel
            </button>
            <button
              type="submit"
              className="btn btn-primary"
              disabled={Boolean(validationError) || submitting}
              title={validationError ?? 'Save (Ctrl+S)'}
            >
              {saveLabel}
            </button>
          </>
        }
      />

      {/* Under the header, next to Save — where the disabled button is. */}
      {validationError ? <Banner tone="warn">{validationError}</Banner> : null}
      {submitError ? (
        <Banner tone="error" role="alert">
          {submitError}
        </Banner>
      ) : null}

      {/* ── BOM header ─────────────────────────────────────────────────── */}
      <Panel title="BOM Details">
        <FormGrid>
          <FormField
            label="BOM No."
            required
            size="sm"
            htmlFor="bom-no"
            help="Auto-generated · editable"
          >
            <input
              id="bom-no"
              className="innovic-input mono"
              value={header.bomNo}
              onChange={(e) => setHeader({ ...header, bomNo: e.target.value })}
              placeholder={mode === 'create' ? 'BOM-NNNN (auto if blank)' : 'BOM-0001'}
            />
          </FormField>
          <FormField
            label="BOM Name"
            required
            size="md"
            htmlFor="bom-name"
            help="Shown across production and planning screens"
          >
            <input
              id="bom-name"
              className="innovic-input"
              value={header.bomName}
              onChange={(e) => setHeader({ ...header, bomName: e.target.value })}
              placeholder="e.g. Hydraulic Press Assembly"
            />
          </FormField>
          <FormField
            label="BOM Status"
            size="sm"
            htmlFor="bom-status"
            help="Only Active BOMs attach to sales orders"
          >
            <select
              id="bom-status"
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
          </FormField>
          <FormField label="BOM Rev" size="xs" htmlFor="bom-rev" help="Increments on each release">
            <input
              id="bom-rev"
              className="innovic-input mono is-derived"
              value={String(bom?.revision ?? 1)}
              readOnly
            />
          </FormField>
        </FormGrid>
      </Panel>

      {/* ── Parent item ────────────────────────────────────────────────── */}
      <Panel title="Parent Item">
        <FormGrid>
          <FormField label="Item Code" required size="md" htmlFor="bom-parent-item">
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
          </FormField>
          <FormField label="Item Name" size="lg" htmlFor="bom-parent-name">
            <input
              id="bom-parent-name"
              className="innovic-input is-derived"
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
          </FormField>
          <FormField label="Qty" required size="xs" htmlFor="bom-parent-qty">
            {/* Always 1, read-only: a BOM defines the parts for ONE finished
                unit, and every child's Qty/Set is already "per one parent".
                Editable here would be a second place to say the same number. */}
            <input
              id="bom-parent-qty"
              className="innovic-input mono is-derived"
              readOnly
              value="1"
              title="A BOM builds one unit — each child's Qty / Set is per one parent."
            />
          </FormField>
        </FormGrid>
      </Panel>

      {/* ── Child items ────────────────────────────────────────────────── */}
      <Panel
        title="Child Items"
        bodyPadding="none"
        actions={
          <span className="text3 mono">
            {filledChildCount} of {lines.length} line{lines.length === 1 ? '' : 's'} filled
          </span>
        }
      >
        <div className="panel-body">
          <div className="form-help" style={{ marginTop: 0 }}>
            {parentLocked
              ? 'Pick the parent item above to unlock the part list.'
              : 'Pick an item code — the name auto-fills from the Item Master.'}
          </div>

          {importSummary ? (
            <div style={{ marginTop: 'var(--sp-2)' }}>
              <Banner
                tone={importFatal ? 'error' : importErrors.length > 0 ? 'warn' : 'success'}
                flush
                onDismiss={clearImportReport}
                title={importSummary}
              >
                {errorRollup.length > 0 ? (
                  <ul style={{ margin: 0, paddingLeft: 18, fontWeight: 600 }}>
                    {errorRollup.map(([kind, count]) => (
                      <li key={kind}>
                        {count} row{count === 1 ? '' : 's'}: {ERROR_KIND_LABEL[kind]}
                      </li>
                    ))}
                  </ul>
                ) : null}
                <div
                  style={{
                    display: 'flex',
                    gap: 'var(--sp-1)',
                    flexWrap: 'wrap',
                    marginTop: 'var(--sp-1)',
                  }}
                >
                  {importFatal ? (
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      onClick={() => void downloadTemplate()}
                    >
                      <Download size={12} /> Download template
                    </button>
                  ) : null}
                  {importErrors.length > 0 ? (
                    <>
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        onClick={() => void copyErrors()}
                      >
                        <Copy size={12} /> {copiedErrors ? 'Copied' : 'Copy'}
                      </button>
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        onClick={downloadErrors}
                      >
                        <Download size={12} /> CSV
                      </button>
                    </>
                  ) : null}
                </div>

                {/* The way out of "not found in master": this form can only
                    match items, so hand the unknown codes back in the Item
                    Master importer's own layout instead of leaving a dead end. */}
                {missingCodes.length > 0 ? (
                  <div style={{ marginTop: 'var(--sp-1)' }}>
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      onClick={() => void downloadMissingItemsSheet()}
                    >
                      <Download size={12} /> Download {missingCodes.length} missing code
                      {missingCodes.length === 1 ? '' : 's'} as an Item Master import sheet
                    </button>
                    <div style={{ marginTop: 4 }}>
                      Fill in the Name column, import it on Item Master, then run this BOM import
                      again.
                    </div>
                  </div>
                ) : null}

                {/* Import report. An 83-row failure used to print 10 lines and
                    "… and 73 more" with no way to see, keep or clear them — so
                    the list scrolls in full, the repeated reasons are counted
                    once at the top, and the box can be dismissed. */}
                {importErrors.length > 0 ? (
                  <ol
                    style={{
                      maxHeight: 220,
                      overflowY: 'auto',
                      margin: 'var(--sp-1) 0 0',
                      padding: 'var(--sp-1) var(--sp-2)',
                      borderRadius: 'var(--radius)',
                      background: 'var(--bg2)',
                      border: '1px solid var(--border)',
                      listStyle: 'none',
                    }}
                  >
                    {importErrors.map((err, i) => (
                      <li key={i}>
                        Row {err.rowIndex + 2}: {err.itemCode} — {err.reason}
                      </li>
                    ))}
                  </ol>
                ) : null}
              </Banner>
            </div>
          ) : null}
        </div>

        {/* Own scroller (.tbl-wrap): below the table's natural width it
            scrolls sideways rather than squeezing the Type select or pushing
            the delete button off the row. */}
        <div className="tbl-wrap">
          <table className="innovic-table tbl-grid tbl-edit">
            <thead>
              <tr>
                <th className="th-num" style={{ width: 44 }}>
                  #
                </th>
                <th style={{ minWidth: 160 }}>
                  Item Code<span className="req">★</span>
                </th>
                <th style={{ minWidth: 200 }}>Item Name</th>
                <th className="th-num" style={{ width: 100 }}>
                  Qty / Set<span className="req">★</span>
                </th>
                <th style={{ width: 150 }}>BOM Type</th>
                <th style={{ width: 48 }} />
              </tr>
            </thead>
            <tbody>
              {lines.length === 0 ? (
                <tr>
                  <td colSpan={childCols} className="empty-state">
                    {parentLocked
                      ? 'Locked — pick the parent item above first.'
                      : 'No parts yet. Use + Add child item below.'}
                  </td>
                </tr>
              ) : null}

              {/* RESOLVED lines so a pasted exact code fills the Name box at
                  once. While the parent is unset the rows go inert rather than
                  vanishing: on the EDIT form a pre-0085 BOM already has parts,
                  and hiding them would read as "my BOM lost its parts". */}
              {resolvedLines.map((line, idx) => {
                const item = line.childItemId
                  ? (itemById.get(line.childItemId) ??
                    (itemPage?.items ?? []).find((i) => i.id === line.childItemId))
                  : null;
                const inert = parentLocked ? LOCKED_ROW : undefined;
                return (
                  <Fragment key={idx}>
                    <tr aria-disabled={parentLocked} style={inert}>
                      <td className="td-num mono fw-700">{idx + 1}</td>
                      <td>
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
                      </td>
                      <td>
                        <input
                          className="innovic-input is-derived"
                          readOnly
                          placeholder="auto-filled"
                          aria-label={`Item Name, line ${idx + 1}`}
                          value={
                            item
                              ? item.material
                                ? `${item.name} [${item.material}]`
                                : item.name
                              : ''
                          }
                        />
                      </td>
                      <td className="td-num">
                        <input
                          type="number"
                          min="0.01"
                          step="0.01"
                          className="innovic-input mono"
                          aria-label={`Qty / Set, line ${idx + 1}`}
                          value={line.qtyPerSet}
                          onChange={(e) => updateLine(idx, { qtyPerSet: e.target.value })}
                        />
                      </td>
                      <td>
                        <select
                          className="innovic-select"
                          aria-label={`BOM Type, line ${idx + 1}`}
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
                      </td>
                      <td>
                        <button
                          type="button"
                          className="btn btn-ghost btn-sm"
                          style={{ color: 'var(--red2)' }}
                          onClick={() => removeLine(idx)}
                          title="Remove line"
                          aria-label={`Remove line ${idx + 1}`}
                        >
                          <Trash2 size={14} />
                        </button>
                      </td>
                    </tr>

                    {/* Raw material for THIS part, on its own sub-row rather
                        than two more columns on the part row. Both optional (a
                        purchase/outsource part is bought, not cut), so neither
                        label carries a ★. */}
                    <tr aria-disabled={parentLocked} style={inert}>
                      <td />
                      <td colSpan={childCols - 1} style={{ whiteSpace: 'normal' }}>
                        <div style={{ maxWidth: 520 }}>
                          <RawMaterialGroup>
                            <div className="form-grp">
                              <label className="form-label" htmlFor={`bom-line-grade-${idx}`}>
                                Grade
                              </label>
                              <MaterialGradePicker
                                id={`bom-line-grade-${idx}`}
                                valueId={line.rawMaterialGradeId}
                                valueText={line.rawMaterialGradeText}
                                onChange={(gradeId, text) =>
                                  updateLine(idx, {
                                    rawMaterialGradeId: gradeId,
                                    rawMaterialGradeText: text,
                                  })
                                }
                              />
                            </div>
                            <div className="form-grp">
                              <label className="form-label" htmlFor={`bom-line-size-${idx}`}>
                                Size
                              </label>
                              <MaterialSizePicker
                                id={`bom-line-size-${idx}`}
                                valueId={line.rawMaterialSizeId}
                                valueText={line.rawMaterialSizeText}
                                onChange={(sizeId, text) =>
                                  updateLine(idx, {
                                    rawMaterialSizeId: sizeId,
                                    rawMaterialSizeText: text,
                                  })
                                }
                              />
                            </div>
                          </RawMaterialGroup>
                        </div>
                      </td>
                    </tr>
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Toolbar under the list — the actions belong to the list they act on. */}
        <div
          className="panel-body"
          style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-2)', flexWrap: 'wrap' }}
        >
          <button
            type="button"
            className="btn btn-ghost"
            disabled={parentLocked}
            title={parentLocked ? 'Pick the parent item first' : undefined}
            onClick={addLine}
          >
            <Plus size={14} /> Add child item
          </button>
          {/* Template stays open even while locked — you may well want the empty
              sheet before you have decided the parent. */}
          <button type="button" className="btn btn-ghost" onClick={() => void downloadTemplate()}>
            <Download size={14} /> Template
          </button>
          <button
            type="button"
            className="btn btn-ghost"
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
          {/* The filled-vs-total count lives in the panel header. Only the
              exception is repeated here, next to the button that creates blank
              rows. */}
          {blankChildCount > 0 ? (
            <span style={{ marginLeft: 'auto', color: 'var(--amber2)' }}>
              {blankChildCount} blank row{blankChildCount > 1 ? 's' : ''} — pick an item or remove
            </span>
          ) : null}
        </div>
      </Panel>

      {/* ── Revision note (edit only) ──────────────────────────────────── */}
      {mode === 'edit' ? (
        <Panel
          title="Revision Note"
          actions={
            <span className="badge b-grey">
              BOM REV {bom?.revision ?? 1} → {nextRevision}
            </span>
          }
        >
          <div className="form-grp">
            <textarea
              id="bom-rev-note"
              className="innovic-textarea"
              rows={2}
              aria-label="Revision Note"
              value={revisionNote}
              onChange={(e) => setRevisionNote(e.target.value)}
              placeholder="Auto-generated on save. You can edit…"
            />
            <div className="form-help">
              Generated from what changed when you save. Edit it first if you want your own wording.
            </div>
          </div>
        </Panel>
      ) : null}
    </form>
  );
}

export function linesToInput(lines: BomFormLineDraft[]): CreateBomMasterLineInput[] {
  return lines.map((l) => ({
    childItemId: l.childItemId,
    qtyPerSet: Number(l.qtyPerSet),
    bomType: l.bomType,
    // Always sent, never omitted — an edit replaces the lines wholesale on the
    // server, so a cleared picker has to arrive as an explicit null or the old
    // grade/size would silently survive the save.
    rawMaterialGradeId: l.rawMaterialGradeId,
    rawMaterialGradeText: l.rawMaterialGradeText,
    rawMaterialSizeId: l.rawMaterialSizeId,
    rawMaterialSizeText: l.rawMaterialSizeText,
  }));
}
