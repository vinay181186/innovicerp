// New Job Card — the CREATE form (/job-cards/new). Its only caller is
// routes/new.tsx; editing a saved card is the JC Status page in edit mode
// (routes/edit.tsx → jc-status-content.tsx), so the old `model` / edit branch
// of this form had no caller and is gone.
//
// 2026-10-06 layout: the Job Card DETAIL page's design, grid and sequence
// (jobcard-detail-mockup.html, frame 1; jc-status-view.tsx + jc-fact-block.tsx)
// with controls where the detail page shows values — screen-layout-method
// rule 8: Create, Edit and View share one grid and one sequence. Fits one
// 1440×810 screen with no page scroll (`page-fill` + one <Panel fill>).
//
//   header     ← Back · next JC No. · New Job Card … why Save is off · Cancel ·
//              Save Job Card
//   banners    upload / server error · ops copied for another item · the
//              "no QC directly after OSP" routing hint
//   facts      picture frame (JcItemThumb: the item's photo | the drawing
//              attached here) + identity line (JWSO No. ★ picker · Ln · POL ·
//              customer · Item Code ★ picker · item name) + ClusterGrid:
//     ORDER    Production Order · Plan No. · Route Card · Drawing (attach)
//              JC Date · Due Date · Customer Dispatch Date · Priority
//     QUANTITY Order Qty ★ · SO Qty · JC Qty · Available (the JWSO line)
//     MATERIAL RM Item · RM Qty per piece · RM Grade · RM Size
//     NOTES    Remarks
//   panel      ONE tab strip + ONE filling panel, as on the detail page:
//              Operations (jc-create-ops-table.tsx) · QC Documents
//              (jc-create-docs-table.tsx); each tab's actions at the strip's
//              right end.
//
// Validation, payload, save, route-card seeding and every message are the
// form's as before: buildJcWriteInput (lib/build-jc-write-input.ts) runs on
// every render for Save's reason, and again on Save exactly as before.
//
// Legacy counterpart: addJC L6020 → jcModalBody(null) L5943.

import type {
  DefaultRouteOpsResponse,
  JcRouteCardWriteBack,
  JobCardSourceOption,
  ListVendorsQuery,
  ListVendorsResponse,
} from '@innovic/shared';
import { useQueries } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { Loader2 } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { apiFetch } from '@/lib/api';
import { todayLocal } from '@/lib/date';
import { useExitConfirm } from '@/lib/exit-guard';
import { uploadFile } from '@/lib/storage';
import { useSession } from '@/lib/session';
import { soNoWithInternal } from '@/lib/so-number';
import { useItemsList } from '@/modules/items/api';
import { useDefaultRouteOps } from '@/modules/plans/api';
import { useMachineGroupsList, useMachinesList } from '@/modules/machines/api';
import {
  MaterialGradePicker,
  MaterialSizePicker,
} from '@/modules/raw-material/components/raw-material-pickers';
import { useVendorsList, vendorsKeys } from '@/modules/vendors/api';
import { Panel } from '@/ui/data';
import { Banner, Modal } from '@/ui/feedback';
import {
  Cluster,
  ClusterFact,
  ClusterGrid,
  DocIdent,
  FormField,
  IdentSep,
  SearchableSelect,
} from '@/ui/forms';
import { DetailHeader, useSaveShortcut } from '@/ui/layout';
import { TabStrip } from '@/ui/navigation';
import { useCreateJobCard, useJobCardSourceOptions, useNextJcCode } from '../api';
import {
  buildJcWriteInput,
  grandfatheredOspQcPairs,
  opsSequenceError,
} from '../lib/build-jc-write-input';
import { JcCreateDocsTable, type JcCreateDoc } from './jc-create-docs-table';
import { JcCreateOpsTable, type JcCreateOp } from './jc-create-ops-table';
import { JcItemThumb } from './jc-item-thumb';
import type { JcDrawingRef } from './jc-view-summary';
import './jc-detail.css';
import './jc-create.css';

type FormOp = JcCreateOp;
type RouteOp = DefaultRouteOpsResponse['ops'][number];

// Stable keys for op rows (display-only, never saved).
let opRowSeq = 0;
const nextRowKey = (): string => `op-${++opRowSeq}`;

/** A Route Card's ops as fresh Job Card form rows. Only a process op carries a
 *  machine: OSP has none (T32b) and a QC op parks on the QC lane, exactly as
 *  + Add QC Op / + Add Outsource Op do. */
function routeOpsToFormOps(
  routeOps: readonly RouteOp[],
  machines: ReadonlyArray<{ id: string; code: string }>,
): FormOp[] {
  return routeOps.map((op) => {
    const machineCode =
      op.machineCodeText ??
      (op.machineId ? (machines.find((m) => m.id === op.machineId)?.code ?? '') : '');
    const opType = op.opType ?? 'process';
    return {
      rowKey: nextRowKey(),
      machineGroupId: null,
      machineCode: opType === 'process' ? machineCode : '',
      operation: op.operation,
      opType,
      cycleTimeMin: op.cycleTimeMin ?? 0,
      program: op.program ?? '',
      toolNo: op.toolNo ?? '',
      toolDetails: op.toolDetails ?? '',
      qcRequired: op.qcRequired ?? opType === 'qc',
      outsourceVendorCode: op.outsourceVendorText ?? '',
      outsourceCost: op.outsourceCost ?? 0,
    };
  });
}

/** True when the rows are still the seeded ones, field for field. The machine
 *  group (display-only, back-filled after seeding) and the row key are
 *  ignored. */
function sameSeedOps(a: readonly FormOp[], b: readonly FormOp[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((x, i) => {
    const y = b[i]!;
    return (
      x.machineCode === y.machineCode &&
      x.operation === y.operation &&
      x.opType === y.opType &&
      x.cycleTimeMin === y.cycleTimeMin &&
      x.program === y.program &&
      x.toolNo === y.toolNo &&
      x.toolDetails === y.toolDetails &&
      x.qcRequired === y.qcRequired &&
      x.outsourceVendorCode === y.outsourceVendorCode &&
      x.outsourceCost === y.outsourceCost
    );
  });
}

const today = (): string => todayLocal();
const DASH = '—';
const IMAGE_RE = /\.(png|jpe?g|gif|webp|bmp|svg)$/i;

function sourceLabel(o: JobCardSourceOption): string {
  const tag = o.type === 'jw' ? '[JWSO]' : '[SO]';
  const ln = o.lineNo && o.lineNo !== 1 ? ` / L${o.lineNo}` : '';
  const part = o.partName ? ` (${o.partName})` : '';
  return `${tag} ${soNoWithInternal(o.code, o.internalSoNo)}${ln} — ${o.customerName ?? ''}${part} [Avail: ${o.remaining}]`;
}

/** The quiet mono figure after a value ("Route Card Rev 3", "Required 12"). */
function Sub({ children }: { children: React.ReactNode }): React.JSX.Element {
  return <span className="jc-sub">{children}</span>;
}

type TabKey = 'ops' | 'docs';

export function JobCardForm({
  initialSourceLineId,
}: {
  // Pre-select this SO/JW source line (deep-linked from SO Status Review's
  // "Create Job Card"). Cascades item/qty/due once the source options load.
  initialSourceLineId?: string | undefined;
}): React.JSX.Element {
  const navigate = useNavigate();
  const goBack = useCallback(() => void navigate({ to: '/job-cards' }), [navigate]);
  const exit = useExitConfirm({ onExit: goBack });
  const { data: me } = useSession();
  const companyId = me?.companyId ?? '';

  const { data: sourceOptions = [] } = useJobCardSourceOptions();
  // machines & vendors list-query schemas cap `limit` at 200 — 500 makes the
  // route 400, leaving the machine picker empty ("No matches"). Stay ≤ 200.
  const { data: machinesData } = useMachinesList({ limit: 200, offset: 0 });
  // OSP vendor picker searches the SERVER (same wiring as SO Planning's "+ Add
  // OSP Op"): the endpoint caps `limit` at 200, and the vendor master runs past
  // that, so a static first page left every later vendor unreachable.
  const [vendorSearch, setVendorSearch] = useState('');
  // Active vendors only, filtered by the server (A10). An op's already-linked
  // vendor that is now disabled is still resolved by code (missingVendorCodes
  // below, which does not filter) so its "CODE — Name" label survives.
  const { data: vendorsData, isFetching: vendorsFetching } = useVendorsList({
    ...(vendorSearch.trim() ? { search: vendorSearch.trim() } : {}),
    isActive: true,
    limit: 200,
    offset: 0,
  });
  // Machine groups exist only to label and narrow the machine picker.
  const { data: machineGroupsData } = useMachineGroupsList({ limit: 200, offset: 0 });
  const machines = useMemo(() => machinesData?.machines ?? [], [machinesData]);
  // Every vendor row this form has seen (first page + each search page), by
  // code, so a picked vendor keeps its "CODE — Name" label after the search
  // term moves on to another row's picker.
  const [knownVendors, setKnownVendors] = useState<
    Map<string, { id: string; code: string; name: string }>
  >(() => new Map());
  useEffect(() => {
    const rows = vendorsData?.vendors ?? [];
    if (rows.length === 0) return;
    setKnownVendors((prev) => {
      let next: typeof prev | null = null;
      for (const v of rows) {
        if (prev.has(v.code)) continue;
        next ??= new Map(prev);
        next.set(v.code, { id: v.id, code: v.code, name: v.name });
      }
      return next ?? prev;
    });
  }, [vendorsData]);
  const machineGroupCodeById = useMemo(
    () => new Map((machineGroupsData?.groups ?? []).map((g) => [g.id, g.code])),
    [machineGroupsData],
  );

  // Governance: direct SO/item Job Cards are disabled. Manual creation is
  // JW-only — SO items go through Planning (execute a plan).
  const availableSources = useMemo(
    () => sourceOptions.filter((o) => o.type === 'jw'),
    [sourceOptions],
  );

  const create = useCreateJobCard();
  // Preview the next IN-JC-YY-##### so the JC No. is visible before save
  // (the server still assigns it authoritatively).
  const { data: nextJc } = useNextJcCode(true);

  // ── Header state ──
  const [jcDate, setJcDate] = useState(today());
  const [sourceLineId, setSourceLineId] = useState<string | null>(null);
  const [sourceType, setSourceType] = useState<'so' | 'jw' | null>(null);
  const [sourceText, setSourceText] = useState('');
  const [itemCode, setItemCode] = useState('');
  // Master id of the picked item (null until picked / resolved from the code).
  const [itemId, setItemId] = useState<string | null>(null);
  // Item is LOCKED to the JWSO line's item (2026-09-28 form audit): a Job Card
  // on a JWSO line makes that line's item, never another one typed over it.
  // Locked only when the line carries a MASTER item (itemId set) — a legacy
  // text-only line keeps the picker editable, the same rule the server applies
  // (createJobCard -> assertItemIsJwLineItem checks only line.item_id).
  const lineSource = sourceOptions.find((o) => o.lineId === sourceLineId);
  const lineItemCode = lineSource?.itemId ? (lineSource.itemCode ?? null) : null;
  const itemLocked = Boolean(lineItemCode);
  // The shared master-only item picker, searching the SERVER. While locked,
  // the page is fetched for the line's code so its id resolves.
  const [itemSearch, setItemSearch] = useState('');
  const itemQuerySearch = itemLocked ? (lineItemCode ?? '') : itemSearch.trim();
  const { data: itemsData, isFetching: itemsFetching } = useItemsList({
    ...(itemQuerySearch ? { search: itemQuerySearch } : {}),
    limit: 50,
    offset: 0,
  });
  const items = useMemo(() => itemsData?.items ?? [], [itemsData]);
  const itemIdByCode =
    items.find((i) => i.code.toUpperCase() === itemCode.trim().toUpperCase())?.id ?? null;
  const [orderQty, setOrderQty] = useState<string>('');
  const [priority, setPriority] = useState<'normal' | 'high'>('normal');
  const [dueDate, setDueDate] = useState('');
  const [drawingFilePath, setDrawingFilePath] = useState<string | null>(null);
  const [remarks, setRemarks] = useState('');
  // Raw material — both optional and independent. Id + text snapshot are
  // stored together.
  const [rmGradeId, setRmGradeId] = useState<string | null>(null);
  const [rmGradeText, setRmGradeText] = useState<string | null>(null);
  const [rmSizeId, setRmSizeId] = useState<string | null>(null);
  const [rmSizeText, setRmSizeText] = useState<string | null>(null);
  // Downstream inheritance (CLAUDE.md §17): a hand-raised JC (JW path) reads
  // the raw material off the item's Route Card, exactly as a Plan does. Only
  // while a field is still blank, so a manual pick is never overwritten.
  const pickedItemId = itemId ?? itemIdByCode;
  const { data: itemRouteDefaults } = useDefaultRouteOps(pickedItemId);
  useEffect(() => {
    if (!itemRouteDefaults) return;
    const d = itemRouteDefaults;
    if (!rmGradeId && !rmGradeText && (d.rawMaterialGradeId || d.rawMaterialGradeText)) {
      setRmGradeId(d.rawMaterialGradeId);
      setRmGradeText(d.rawMaterialGradeText);
    }
    if (!rmSizeId && !rmSizeText && (d.rawMaterialSizeId || d.rawMaterialSizeText)) {
      setRmSizeId(d.rawMaterialSizeId);
      setRmSizeText(d.rawMaterialSizeText);
    }
  }, [itemRouteDefaults, rmGradeId, rmGradeText, rmSizeId, rmSizeText]);
  // ADR-193 phase 3a — the RM ITEM pair travels with a hand-raised JC too, so
  // the store sees its Required. Read off the item's Route Card; shown in the
  // Material row (it was sent without being shown before).
  const rmItemFromRoute =
    itemRouteDefaults?.rawMaterialItemId && itemRouteDefaults.rmQtyPerPiece != null
      ? {
          rawMaterialItemId: itemRouteDefaults.rawMaterialItemId,
          rmQtyPerPiece: itemRouteDefaults.rmQtyPerPiece,
        }
      : undefined;
  const [drawingName, setDrawingName] = useState<string>('');
  // The drawing attached here, held in the browser for the picture frame: its
  // thumbnail when it is an image, and "open" shows the user's own file. Not
  // saved — drawingFilePath (the upload) is what the server gets.
  const [localDrawing, setLocalDrawing] = useState<{ url: string; isImage: boolean } | null>(null);
  const localDrawingRef = useRef<string | null>(null);
  const replaceLocalDrawing = (file: File | null): void => {
    if (localDrawingRef.current) URL.revokeObjectURL(localDrawingRef.current);
    if (!file) {
      localDrawingRef.current = null;
      setLocalDrawing(null);
      return;
    }
    const url = URL.createObjectURL(file);
    localDrawingRef.current = url;
    setLocalDrawing({
      url,
      isImage: file.type.startsWith('image/') || IMAGE_RE.test(file.name),
    });
  };
  useEffect(
    () => () => {
      if (localDrawingRef.current) URL.revokeObjectURL(localDrawingRef.current);
    },
    [],
  );

  // The picked item's master row (name + product image) for the identity line
  // and the picture frame. Kept once seen, so a later search that pages past
  // the item does not blank it; dropped the moment the code no longer matches.
  const [itemInfo, setItemInfo] = useState<{
    id: string;
    code: string;
    name: string;
    imagePath: string | null;
  } | null>(null);
  useEffect(() => {
    if (!pickedItemId) return;
    const it = items.find((i) => i.id === pickedItemId);
    if (!it || itemInfo?.id === it.id) return;
    setItemInfo({ id: it.id, code: it.code, name: it.name, imagePath: it.imagePath ?? null });
  }, [items, pickedItemId, itemInfo?.id]);
  const pickedItem =
    itemInfo && itemCode.trim() && itemInfo.code.toUpperCase() === itemCode.trim().toUpperCase()
      ? itemInfo
      : null;

  const [ops, setOps] = useState<FormOp[]>([]);
  const [docs, setDocs] = useState<JcCreateDoc[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  // Shown after a save that also wrote the item's Route Card.
  const [savedNote, setSavedNote] = useState<{
    jcCode: string;
    rc: JcRouteCardWriteBack;
  } | null>(null);
  const [tab, setTab] = useState<TabKey>('ops');

  // Machine picker: only one row's dropdown is open at a time, so a shared
  // search term is fine.
  const [machineSearch, setMachineSearch] = useState('');
  const machineOptions = machines
    .filter(
      (m) =>
        !machineSearch.trim() ||
        `${m.code} ${m.name}`.toLowerCase().includes(machineSearch.trim().toLowerCase()),
    )
    .map((m) => ({
      id: m.id,
      code: m.code,
      name: m.name,
      machineGroupId: m.machineGroupId ?? null,
    }));

  // An op's vendor past the first 200 rows (a Route Card copy can bring one in)
  // is on no page this form has fetched; look each still-unknown code up by
  // itself — one small keyed vendors-list query per code, the same key/fetch
  // shape as useVendorsList — and keep only the exact code match.
  const missingVendorCodes = useMemo(() => {
    const onPage = new Set((vendorsData?.vendors ?? []).map((v) => v.code));
    const codes = new Set<string>();
    for (const o of ops) {
      const code = o.outsourceVendorCode;
      if (code && !knownVendors.has(code) && !onPage.has(code)) codes.add(code);
    }
    return [...codes].sort();
  }, [ops, knownVendors, vendorsData]);
  const combineVendorLookups = useCallback(
    (results: { data?: ListVendorsResponse | undefined }[]) =>
      results.flatMap((r, i) => {
        const code = missingVendorCodes[i];
        const v = r.data?.vendors.find((x) => x.code === code);
        return v ? [{ id: v.id, code: v.code, name: v.name }] : [];
      }),
    [missingVendorCodes],
  );
  const resolvedOpVendors = useQueries({
    queries: missingVendorCodes.map((code) => {
      const q: ListVendorsQuery = { search: code, limit: 200, offset: 0 };
      return {
        queryKey: vendorsKeys.list(q),
        queryFn: () =>
          apiFetch<ListVendorsResponse>(
            `/vendors?search=${encodeURIComponent(code)}&limit=200&offset=0`,
          ),
        // Wait for the first page so codes it already carries are not fetched
        // again one by one.
        enabled: vendorsData !== undefined,
      };
    }),
    combine: combineVendorLookups,
  });
  useEffect(() => {
    if (resolvedOpVendors.length === 0) return;
    setKnownVendors((prev) => {
      let next: typeof prev | null = null;
      for (const v of resolvedOpVendors) {
        if (prev.has(v.code)) continue;
        next ??= new Map(prev);
        next.set(v.code, v);
      }
      return next ?? prev;
    });
  }, [resolvedOpVendors]);

  // Picker rows = the server's page for the current term, plus any op's
  // already-picked vendor that page does not contain.
  const vendorOptions = useMemo(() => {
    const page = (vendorsData?.vendors ?? [])
      .filter((v) => v.isActive)
      .map((v) => ({ id: v.id, code: v.code, name: v.name }));
    const seen = new Set(page.map((v) => v.code));
    for (const o of ops) {
      const code = o.outsourceVendorCode;
      if (!code || seen.has(code)) continue;
      const known = knownVendors.get(code);
      if (known) {
        page.push(known);
        seen.add(code);
      }
    }
    return page;
  }, [vendorsData, ops, knownVendors]);

  // Source picker rows: the open-JWSO line list is already in memory, so the
  // shared SearchableSelect filters it client-side. The row reads
  // "[JWSO] CODE / Ln — Customer (Part) [Avail: n]".
  const sourcePickerOptions = useMemo(
    () =>
      availableSources.map((o) => {
        const tag = o.type === 'jw' ? '[JWSO]' : '[SO]';
        const ln = o.lineNo && o.lineNo !== 1 ? ` / L${o.lineNo}` : '';
        const part = o.partName ? ` (${o.partName})` : '';
        return {
          id: o.lineId,
          code: `${tag} ${soNoWithInternal(o.code, o.internalSoNo)}${ln}`,
          name: `${o.customerName ?? ''}${part} [Avail: ${o.remaining}]`,
        };
      }),
    [availableSources],
  );
  const selectedSource = sourceLineId
    ? sourceOptions.find((o) => o.lineId === sourceLineId)
    : undefined;

  // Ops counter (legacy jcModalOpsHtml L5927); the plural follows the number
  // actually shown.
  const opCount = ops.filter((o) => o.opType !== 'qc').length;
  const qcCount = ops.filter((o) => o.opType === 'qc').length;

  const onSourceChange = (lineId: string | null): void => {
    const opt = lineId ? availableSources.find((o) => o.lineId === lineId) : undefined;
    setSourceText(opt ? sourceLabel(opt) : '');
    if (!opt) {
      setSourceLineId(null);
      setSourceType(null);
      return;
    }
    setSourceLineId(opt.lineId);
    setSourceType(opt.type);
    // Cascade auto-fill (legacy _jcCascadeFromOrder): only fill empties -
    // except the item, which IS the line's item (locked), so it always follows.
    if (opt.itemCode) {
      setItemCode(opt.itemCode);
      setItemId(null);
    }
    if (opt.remaining > 0 && !orderQty) setOrderQty(String(opt.remaining));
    if (opt.dueDate && !dueDate) setDueDate(opt.dueDate);
  };

  // One-time prefill when deep-linked with a source line. Waits for source
  // options to load, then applies the same cascade as a manual pick.
  const [appliedInitialSource, setAppliedInitialSource] = useState(false);
  useEffect(() => {
    if (appliedInitialSource || !initialSourceLineId) return;
    const opt = sourceOptions.find((o) => o.lineId === initialSourceLineId);
    if (!opt) return;
    setSourceText(sourceLabel(opt));
    setSourceLineId(opt.lineId);
    setSourceType(opt.type);
    if (opt.itemCode) {
      setItemCode(opt.itemCode);
      setItemId(null);
    }
    if (opt.remaining > 0 && !orderQty) setOrderQty(String(opt.remaining));
    if (opt.dueDate && !dueDate) setDueDate(opt.dueDate);
    setAppliedInitialSource(true);
  }, [appliedInitialSource, initialSourceLineId, sourceOptions, orderQty, dueDate]);

  const setOp = (i: number, patch: Partial<FormOp>): void => {
    setOps((prev) => prev.map((o, idx) => (idx === i ? { ...o, ...patch } : o)));
  };

  // Picking a machine that carries a group in the master fills the Group box
  // when it is still empty — the same seeding SO Planning / Route Card do.
  const onOpMachineChange = (i: number, code: string): void => {
    const match = machines.find((m) => m.code.toUpperCase() === code.trim().toUpperCase());
    const current = ops[i];
    setOp(i, {
      machineCode: code,
      ...(current && current.machineGroupId == null && match?.machineGroupId
        ? { machineGroupId: match.machineGroupId }
        : {}),
    });
  };

  // Picking a group narrows the machine list for that row. A machine already in
  // the box that is NOT in the new group is cleared — only when the mismatch is
  // PROVEN.
  const onOpGroupChange = (i: number, groupId: string | null): void => {
    const current = ops[i];
    const machine = current?.machineCode
      ? machines.find((m) => m.code === current.machineCode)
      : undefined;
    const mismatch = groupId != null && machine != null && machine.machineGroupId !== groupId;
    setOp(i, {
      machineGroupId: groupId,
      ...(mismatch ? { machineCode: '' } : {}),
    });
  };

  // Group is display-only and not stored, so rows seeded from a Route Card
  // arrive with their group empty even though their machine belongs to one.
  // Read it back off the master once the machine list is in.
  useEffect(() => {
    if (!machines.length) return;
    setOps((prev) => {
      let changed = false;
      const next = prev.map((o) => {
        if (o.opType !== 'process' || o.machineGroupId != null || !o.machineCode) return o;
        const m = machines.find((x) => x.code === o.machineCode);
        if (!m?.machineGroupId) return o;
        changed = true;
        return { ...o, machineGroupId: m.machineGroupId };
      });
      return changed ? next : prev;
    });
  }, [machines, ops.length]);

  // Downstream inheritance (CLAUDE.md §17), the OPERATIONS half: a hand-raised
  // JWSO Job Card seeds its routing from the item's active Route Card, exactly
  // as a Plan loads it (plans/components/plan-form.tsx handleLoadDefaultOps).
  // Once per item. The list is seeded while it is EMPTY; when the item changes
  // it is re-seeded only if the rows are still exactly the ones seeded
  // (untouched). A routing the user has edited is never replaced silently — a
  // warning offers the new item's ops instead. Deleting every seeded row does
  // not bring them back. The rows stay fully editable.
  const [seededFrom, setSeededFrom] = useState<{
    itemId: string;
    code: string | null;
    revision: number | null;
    /** The rows exactly as seeded — to tell "untouched" from "edited". */
    ops: FormOp[];
  } | null>(null);
  const seedFromRouteCard = useCallback((): void => {
    if (!pickedItemId || !itemRouteDefaults) return;
    const seeded = routeOpsToFormOps(itemRouteDefaults.ops, machines);
    setOps(seeded);
    setSeededFrom({
      itemId: pickedItemId,
      code: itemRouteDefaults.routeCardCode,
      revision: itemRouteDefaults.routeCardRevision,
      ops: seeded,
    });
  }, [pickedItemId, itemRouteDefaults, machines]);
  useEffect(() => {
    if (!pickedItemId || !itemRouteDefaults) return;
    if (seededFrom?.itemId === pickedItemId) return;
    if (ops.length === 0) {
      if (itemRouteDefaults.ops.length > 0) seedFromRouteCard();
      return;
    }
    // The item changed under rows seeded for the previous item: swap them
    // only while nobody has touched them.
    if (seededFrom && sameSeedOps(ops, seededFrom.ops)) {
      if (itemRouteDefaults.ops.length > 0) {
        seedFromRouteCard();
      } else {
        setOps([]);
        setSeededFrom(null);
      }
    }
  }, [pickedItemId, itemRouteDefaults, seededFrom, ops, seedFromRouteCard]);
  // The "from Route Card" note belongs to the item it was loaded for.
  const seededNote =
    seededFrom && seededFrom.itemId === pickedItemId && ops.length > 0 ? seededFrom : null;
  // Edited rows seeded for a DIFFERENT item than the one now picked.
  const staleSeed =
    seededFrom && pickedItemId && seededFrom.itemId !== pickedItemId && ops.length > 0
      ? seededFrom
      : null;
  const canReplaceStaleSeed = !!staleSeed && (itemRouteDefaults?.ops.length ?? 0) > 0;

  const moveOp = (i: number, dir: -1 | 1): void => {
    setOps((prev) => {
      const next = [...prev];
      const j = i + dir;
      if (j < 0 || j >= next.length) return prev;
      [next[i], next[j]] = [next[j]!, next[i]!];
      return next;
    });
  };
  const addOp = (kind: 'process' | 'qc' | 'outsource' = 'process'): void => {
    setOps((prev) => [
      ...prev,
      {
        rowKey: nextRowKey(),
        // OSP ops have no machine (T32b); a QC op parks on the QC lane.
        machineGroupId: null,
        machineCode: '',
        operation: '',
        opType: kind,
        cycleTimeMin: 0,
        program: '',
        toolNo: '',
        toolDetails: '',
        qcRequired: kind === 'qc',
        outsourceVendorCode: '',
        outsourceCost: 0,
      },
    ]);
  };

  const onDrawing = async (file: File | undefined): Promise<void> => {
    if (!file || !companyId) return;
    setError(null);
    setUploading(true);
    try {
      const path = await uploadFile(file, companyId, { folder: 'jc-drawings' });
      setDrawingFilePath(path);
      setDrawingName(file.name);
      replaceLocalDrawing(file);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not upload the drawing. Try again.');
    } finally {
      setUploading(false);
    }
  };

  const onDocFile = async (i: number, file: File | undefined): Promise<void> => {
    if (!file || !companyId) return;
    setError(null);
    setUploading(true);
    try {
      const path = await uploadFile(file, companyId, { folder: 'qc-docs' });
      setDocs((prev) =>
        prev.map((d, idx) =>
          idx === i ? { ...d, fileName: file.name, storagePath: path, fileSize: file.size } : d,
        ),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not upload the document. Try again.');
    } finally {
      setUploading(false);
    }
  };

  const submitting = create.isPending || uploading;

  // "No QC directly after OSP" routing rule. A new card has no saved pairs to
  // grandfather and no started ops, so both sets are empty — the same calls
  // the form always made in create mode.
  const allowedPairs = useMemo(() => grandfatheredOspQcPairs([]), []);
  const startedIds = useMemo(() => new Set<string>(), []);
  const opsSequenceHint = opsSequenceError(ops, { allowedPairs, startedIds });

  // Validation + payload build shared with the JC Status edit branch. Run on
  // every render so Save can say why it is off (the first message, the same
  // text Save raised before), and run again on Save.
  const buildInput = (): ReturnType<typeof buildJcWriteInput> =>
    buildJcWriteInput({
      isEdit: false,
      jcDate,
      sourceType,
      sourceLineId,
      itemCode,
      orderQty,
      priority,
      dueDate,
      drawingFilePath,
      remarks,
      rawMaterialGradeId: rmGradeId,
      rawMaterialGradeText: rmGradeText,
      rawMaterialSizeId: rmSizeId,
      rawMaterialSizeText: rmSizeText,
      rmItem: rmItemFromRoute,
      ops,
      docs,
      allowedPairs,
      startedIds,
    });
  const check = buildInput();
  const saveBlockedReason = check.ok ? undefined : check.error;

  const onSubmit = async (): Promise<void> => {
    // Same gates as the Save button (submitting / uploading, then invalid) —
    // Ctrl+S cannot slip past them. An invalid form saves nothing; it only
    // shows its first message, as it always did.
    if (submitting) return;
    setError(null);
    const result = buildInput();
    if (!result.ok) {
      setError(result.error);
      return;
    }
    try {
      const saved = await create.mutateAsync(result.payload);
      // No silent write-back (2026-09-28 form audit): when the save also wrote
      // these operations to the item's Route Card, say so before leaving.
      if (saved.routeCardWriteBack) {
        setSavedNote({ jcCode: saved.code, rc: saved.routeCardWriteBack });
        return;
      }
      exit.leave(goBack);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save Job Card. Try again.');
    }
  };
  // Ctrl+S runs the same Save as the header button. Always bound, so the
  // browser's "Save page as" never opens while Save is off; onSubmit's own
  // guards refuse in that case.
  useSaveShortcut(() => void onSubmit());

  // ── Display-only figures ──
  const qtyNum = Number(orderQty) || 0;
  const required =
    rmItemFromRoute != null
      ? Math.round(rmItemFromRoute.rmQtyPerPiece * qtyNum * 10000) / 10000
      : null;
  const routeCardRev =
    itemRouteDefaults?.routeCardRevision != null
      ? `Route Card Rev ${itemRouteDefaults.routeCardRevision}`
      : null;
  const noLineTitle = 'Pick a JWSO line — the figure comes from it';
  const handRaisedTitle =
    'A Job Card raised here by hand, off a JWSO line, has no Production Order or Plan';
  const drawingRef: JcDrawingRef | null = drawingFilePath
    ? {
        label: 'Attached to this Job Card',
        fileName: drawingName || 'drawing',
        thumbUrl: localDrawing?.isImage ? localDrawing.url : null,
      }
    : null;
  const openDrawing = (): void => {
    if (localDrawing) window.open(localDrawing.url, '_blank', 'noopener');
  };
  const remaining = selectedSource?.remaining;

  return (
    <div className="page-fill jc-detail jcc">
      {exit.dialog}
      <DetailHeader
        backLabel="Back"
        onBack={goBack}
        code={nextJc?.code ?? '(auto on save)'}
        // One header line, as the detail page draws it: JC No. · document name.
        badges={
          <>
            {nextJc?.code ? (
              <span
                className="jcc-next"
                title="A preview — the server assigns the real number on Save"
              >
                next no.
              </span>
            ) : null}
            <span className="panel-title">New Job Card</span>
          </>
        }
        actions={
          <>
            {/* Why Save is off — the first validation message, the same text
                Save gave before. Full text on hover. */}
            {saveBlockedReason ? (
              <span className="form-error jcc-why" title={saveBlockedReason}>
                {saveBlockedReason}
              </span>
            ) : null}
            <button type="button" className="btn btn-ghost" onClick={() => exit.leave(goBack)}>
              Cancel
            </button>
            {/* The wrapper carries the reason too: a disabled button gets no
                hover in every browser. */}
            <span title={saveBlockedReason}>
              <button
                type="button"
                className="btn btn-primary"
                disabled={submitting || !check.ok}
                title={saveBlockedReason}
                onClick={() => void onSubmit()}
              >
                {submitting ? (
                  <>
                    <Loader2 size={13} className="animate-spin" /> Saving…
                  </>
                ) : (
                  'Save Job Card'
                )}
              </button>
            </span>
          </>
        }
      >
        {error ? (
          <Banner tone="error" role="alert">
            {error}
          </Banner>
        ) : null}
        {staleSeed ? (
          <Banner tone="warn" role="status">
            <span>
              Operations are from Route Card{' '}
              <span className="mono fw-700">{staleSeed.code ?? DASH}</span> — item changed
            </span>
            {canReplaceStaleSeed ? (
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                style={{ marginLeft: 'var(--sp-2)' }}
                onClick={seedFromRouteCard}
              >
                Replace with {itemCode.trim()}&apos;s Route Card ops
              </button>
            ) : null}
          </Banner>
        ) : null}
        {opsSequenceHint ? (
          <Banner tone="error" role="alert">
            {opsSequenceHint}
          </Banner>
        ) : null}

        <div className="jc-facts">
          <JcItemThumb
            imagePath={pickedItem?.imagePath ?? null}
            drawing={drawingRef}
            onOpenDrawing={openDrawing}
            itemLabel={`${itemCode.trim()} ${pickedItem?.name ?? ''}`.trim() || 'Item'}
          />
          <div className="jc-facts-main">
            {/* WHICH line and item this card is for — the two decisions on
                this screen, where the detail page names them. */}
            <DocIdent>
              <label className="jcc-id-lb" htmlFor="jc-source">
                JWSO No.<span className="req">★</span>
              </label>
              <SearchableSelect
                id="jc-source"
                className="jcc-id-src"
                value={sourceLineId}
                onChange={onSourceChange}
                options={sourcePickerOptions}
                valueLabel={sourceText || undefined}
                placeholder="🔍 Search JWSO number…"
              />
              {selectedSource ? (
                <>
                  {/* Ln is OUR order line number; POL is the line number on
                      the CUSTOMER's own PO. Never the same fact. */}
                  <span>Ln {selectedSource.lineNo || 1}</span>
                  {selectedSource.clientPoLineNo ? (
                    <span>
                      POL <b className="jc-pol">{selectedSource.clientPoLineNo}</b>
                    </span>
                  ) : null}
                  {selectedSource.customerName ? (
                    <span className="jc-ident-name" title={selectedSource.customerName}>
                      {selectedSource.customerName}
                    </span>
                  ) : null}
                </>
              ) : null}
              <IdentSep />
              <label className="jcc-id-lb" htmlFor="jc-item">
                Item Code<span className="req">★</span>
              </label>
              <SearchableSelect
                id="jc-item"
                className="jcc-id-item"
                value={itemId ?? itemIdByCode}
                onChange={(id) => {
                  const it = items.find((i) => i.id === id);
                  setItemId(it?.id ?? null);
                  setItemCode(it?.code ?? '');
                }}
                onSearch={setItemSearch}
                loading={itemsFetching}
                options={items.map((i) => ({ id: i.id, code: i.code, name: i.name }))}
                valueLabel={itemCode || undefined}
                selectedLabel={(o) => o.code ?? o.name}
                disabled={itemLocked}
                placeholder="🔍 Search item code or name…"
              />
              {pickedItem?.name ? (
                <span className="jc-ident-name" title={pickedItem.name}>
                  {pickedItem.name}
                </span>
              ) : null}
              {itemLocked ? (
                <span className="jcc-id-quiet">The JWSO line&apos;s item — fixed.</span>
              ) : null}
              <span
                className="jcc-id-note"
                title="JWSO only. Sales Order items: Planning → Production Order."
              >
                ⓘ JWSO only. Sales Order items: Planning → Production Order.
              </span>
            </DocIdent>

            <ClusterGrid>
              {/* ── ORDER: where the card comes from and what it is made to ── */}
              <Cluster name="Order">
                <ClusterFact label="Production Order" empty title={handRaisedTitle} value={DASH} />
                <ClusterFact label="Plan No." empty title={handRaisedTitle} value={DASH} />
                {/* The item's CURRENT route card + revision — the card the
                    operations below are copied from. */}
                <ClusterFact
                  label="Route Card"
                  empty={!itemRouteDefaults?.routeCardCode}
                  title={
                    itemRouteDefaults?.routeCardCode
                      ? `${itemRouteDefaults.routeCardCode}${routeCardRev ? ` · ${routeCardRev}` : ''}`
                      : pickedItemId
                        ? 'This item has no route card'
                        : 'Pick the item — its route card shows here'
                  }
                  value={
                    itemRouteDefaults?.routeCardCode ? (
                      <>
                        <span className="jc-code-link">{itemRouteDefaults.routeCardCode}</span>
                        {routeCardRev ? <Sub> {routeCardRev}</Sub> : null}
                      </>
                    ) : pickedItemId && itemRouteDefaults ? (
                      <span className="jc-none">None</span>
                    ) : (
                      DASH
                    )
                  }
                />
                {/* DRAWING ATTACHMENT (legacy jcModalBody L5996-6006) —
                    optional, image or PDF. */}
                <div className="form-grp jcc-in jcc-drawing">
                  <span className="form-label">Drawing</span>
                  <label
                    className="btn btn-ghost btn-sm jcc-attach"
                    title="Attach Drawing (optional — image or PDF)"
                  >
                    📎 {drawingFilePath ? 'Replace' : 'Attach'}
                    <input
                      type="file"
                      accept="image/*,.pdf"
                      hidden
                      aria-label="Attach Drawing"
                      onChange={(e) => void onDrawing(e.target.files?.[0])}
                    />
                  </label>
                  <span className="jcc-file" title={drawingName || undefined}>
                    {drawingName || 'No file attached'}
                  </span>
                  {drawingFilePath ? (
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm btn-icon"
                      title="Remove the drawing"
                      aria-label="Remove the drawing"
                      onClick={() => {
                        setDrawingFilePath(null);
                        setDrawingName('');
                        replaceLocalDrawing(null);
                      }}
                    >
                      ✕
                    </button>
                  ) : null}
                </div>
              </Cluster>
              <Cluster name={null}>
                <FormField label="JC Date" htmlFor="jc-date" className="jcc-in">
                  <input
                    id="jc-date"
                    type="date"
                    className="innovic-input"
                    value={jcDate}
                    onChange={(e) => setJcDate(e.target.value)}
                  />
                </FormField>
                <FormField label="Due Date" htmlFor="jc-due" className="jcc-in">
                  <input
                    id="jc-due"
                    type="date"
                    className="innovic-input"
                    value={dueDate}
                    onChange={(e) => setDueDate(e.target.value)}
                  />
                </FormField>
                <ClusterFact
                  label="Customer Dispatch Date"
                  empty
                  title="Comes from the Plan — a Job Card raised here by hand has none"
                  value={DASH}
                />
                <FormField label="Priority" htmlFor="jc-priority" className="jcc-in">
                  <select
                    id="jc-priority"
                    className="innovic-select cl-cap"
                    value={priority}
                    onChange={(e) => setPriority(e.target.value as 'normal' | 'high')}
                  >
                    <option value="normal">Normal</option>
                    <option value="high">High</option>
                  </select>
                </FormField>
              </Cluster>

              {/* ── QUANTITY: this card's qty, then the JWSO line it comes
                  off — SO Qty − JC Qty = Available, ending on the result ── */}
              <Cluster name="Quantity">
                <FormField label="Order Qty" required htmlFor="jc-qty" className="jcc-in">
                  <input
                    id="jc-qty"
                    type="number"
                    min={1}
                    className="innovic-input cl-num cl-cap"
                    value={orderQty}
                    onWheel={(e) => (e.target as HTMLInputElement).blur()}
                    onChange={(e) => setOrderQty(e.target.value)}
                  />
                </FormField>
                <ClusterFact
                  num
                  label="SO Qty"
                  empty={!selectedSource}
                  title={selectedSource ? 'Ordered on the JWSO line' : noLineTitle}
                  value={selectedSource ? selectedSource.orderQty : DASH}
                />
                <ClusterFact
                  num
                  label="JC Qty"
                  empty={!selectedSource}
                  title={selectedSource ? 'Already on Job Cards for this JWSO line' : noLineTitle}
                  value={selectedSource ? selectedSource.inJc : DASH}
                />
                <ClusterFact
                  num
                  lead={remaining != null && remaining > 0}
                  className={remaining != null && remaining <= 0 ? 'jc-red' : ''}
                  label="Available"
                  empty={!selectedSource}
                  title={
                    selectedSource
                      ? `Available = SO Qty ${selectedSource.orderQty} − JC Qty ${selectedSource.inJc}`
                      : noLineTitle
                  }
                  value={remaining != null ? remaining : DASH}
                />
              </Cluster>

              {/* ── MATERIAL: what it is cut from ── */}
              <Cluster name="Material">
                <ClusterFact
                  num
                  className="jc-one-line"
                  label="RM Item"
                  empty={!rmItemFromRoute}
                  title={
                    rmItemFromRoute
                      ? "From the item's Route Card"
                      : "Comes from the item's Route Card"
                  }
                  value={rmItemFromRoute ? (itemRouteDefaults?.rawMaterialItemCode ?? DASH) : DASH}
                />
                <ClusterFact
                  num
                  label="RM Qty per piece"
                  empty={!rmItemFromRoute}
                  title={
                    required != null
                      ? `RM Qty per piece × Order Qty = Required ${required}`
                      : undefined
                  }
                  value={
                    rmItemFromRoute ? (
                      <>
                        {rmItemFromRoute.rmQtyPerPiece}
                        <Sub> Required {required}</Sub>
                      </>
                    ) : (
                      DASH
                    )
                  }
                />
                {/* Grade + Size: both optional (no ★), the same two pickers
                    Planning uses. */}
                <FormField label="RM Grade" htmlFor="jc-rm-grade" className="jcc-in">
                  <MaterialGradePicker
                    id="jc-rm-grade"
                    valueId={rmGradeId}
                    valueText={rmGradeText}
                    onChange={(id, text) => {
                      setRmGradeId(id);
                      setRmGradeText(text);
                    }}
                  />
                </FormField>
                <FormField label="RM Size" htmlFor="jc-rm-size" className="jcc-in">
                  <MaterialSizePicker
                    id="jc-rm-size"
                    valueId={rmSizeId}
                    valueText={rmSizeText}
                    onChange={(id, text) => {
                      setRmSizeId(id);
                      setRmSizeText(text);
                    }}
                  />
                </FormField>
              </Cluster>

              {/* ── NOTES ── job_cards.remarks. A one-row textarea: it reads
                  as one line, but Enter adds a line and saved breaks survive. */}
              <Cluster name="Notes">
                <FormField label="Remarks" htmlFor="jc-remarks" className="jcc-in cl-span-4">
                  <textarea
                    id="jc-remarks"
                    className="innovic-textarea jcc-one-row"
                    rows={1}
                    value={remarks}
                    title={remarks || undefined}
                    onChange={(e) => setRemarks(e.target.value)}
                  />
                </FormField>
              </Cluster>
            </ClusterGrid>
          </div>
        </div>
      </DetailHeader>

      {savedNote ? (
        <Modal
          title={`Job Card ${savedNote.jcCode} saved`}
          size="sm"
          onClose={() => exit.leave(goBack)}
          closeOnOverlayClick={false}
          footer={
            <>
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() =>
                  exit.leave(
                    () =>
                      void navigate({
                        to: '/route-cards/$id',
                        params: { id: savedNote.rc.routeCardId },
                      }),
                  )
                }
              >
                Open {savedNote.rc.routeCardCode}
              </button>
              <button type="button" className="btn btn-primary" onClick={() => exit.leave(goBack)}>
                Back to Job Cards
              </button>
            </>
          }
        >
          <Banner tone="info" flush>
            {savedNote.rc.created ? (
              <>
                Route Card <span className="mono fw-700">{savedNote.rc.routeCardCode}</span> created
                (Rev {savedNote.rc.routeCardRevision}) from this Job Card&apos;s operations.
              </>
            ) : (
              <>
                Route Card <span className="mono fw-700">{savedNote.rc.routeCardCode}</span> updated
                to Rev {savedNote.rc.routeCardRevision} — this Job Card&apos;s operations are now
                the item&apos;s standard routing.
              </>
            )}
          </Banner>
        </Modal>
      ) : null}

      {/* The one panel that takes the height left on screen — the detail
          page's tab strip + filling panel. */}
      <div className="jc-tabs jcc-tabs">
        <TabStrip
          label="New Job Card lists"
          activeKey={tab}
          onChange={(k) => setTab(k === 'docs' ? 'docs' : 'ops')}
          tabs={[
            { key: 'ops', label: 'Operations', count: ops.length },
            { key: 'docs', label: 'QC Documents', count: docs.length },
          ]}
        />
        <div className="jcc-tabs-act">
          {tab === 'ops' ? (
            <>
              {seededNote ? (
                <span
                  className="jcc-tabs-note"
                  title="Loaded from the item's active Route Card — every row stays editable"
                >
                  Operations from Route Card <b className="mono">{seededNote.code ?? DASH}</b>
                  {seededNote.revision != null ? ` Rev ${seededNote.revision}` : ''}
                </span>
              ) : null}
              {ops.length > 0 ? (
                <span
                  className="jcc-tabs-note"
                  title="The Job Card's operations become the item's Route Card routing (a new revision)"
                >
                  Save also updates the item&apos;s Route Card ·
                </span>
              ) : null}
              <span className="jcc-tabs-note jcc-tabs-count">
                {opCount} op{opCount !== 1 ? 's' : ''}
                {qcCount > 0 ? ` + ${qcCount} QC` : ''}
              </span>
              {/* Create PO's order: the occasional adds as ghost buttons, the
                  one pressed most last, in blue. */}
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => addOp('outsource')}
              >
                + Add Outsource Op
              </button>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => addOp('qc')}>
                + Add QC Op
              </button>
              <button
                type="button"
                className="btn btn-primary btn-sm"
                onClick={() => addOp('process')}
              >
                + Add Op
              </button>
            </>
          ) : (
            <>
              <span className="jcc-tabs-note jcc-tabs-count">
                {docs.length} doc{docs.length !== 1 ? 's' : ''} attached
              </span>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() =>
                  setDocs((prev) => [
                    ...prev,
                    { docType: 'MIR', fileName: '', storagePath: '', fileSize: null },
                  ])
                }
              >
                + Add Document
              </button>
            </>
          )}
        </div>
      </div>
      <Panel fill bodyPadding="none" bodyClassName="tbl-wrap">
        {tab === 'ops' ? (
          <JcCreateOpsTable
            ops={ops}
            machines={machines}
            machineOptions={machineOptions}
            machineGroupCodeById={machineGroupCodeById}
            onMachineSearch={setMachineSearch}
            onMachineChange={onOpMachineChange}
            onGroupChange={onOpGroupChange}
            vendorOptions={vendorOptions}
            onVendorSearch={setVendorSearch}
            vendorsLoading={vendorsFetching}
            onChange={setOp}
            onMove={moveOp}
            onRemove={(i) => setOps((prev) => prev.filter((_, idx) => idx !== i))}
          />
        ) : (
          <JcCreateDocsTable
            docs={docs}
            onTypeChange={(i, docType) =>
              setDocs((prev) => prev.map((x, idx) => (idx === i ? { ...x, docType } : x)))
            }
            onFile={(i, file) => void onDocFile(i, file)}
            onRemove={(i) => setDocs((prev) => prev.filter((_, idx) => idx !== i))}
          />
        )}
      </Panel>
    </div>
  );
}
