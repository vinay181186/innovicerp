// Job Card create/edit form.
//
// Legacy counterpart: `jcModalBody(jc)` L5943 — the ONE body builder both entry
// points pass to showModalLg: addJC L6025 calls `jcModalBody(null)`, editJC
// L6086 calls `jcModalBody(jc)`. Both pass the explicit saveLabel 'Save Job
// Card', so showModalLg L28042-44 renders Cancel (.btn-ghost) + .btn-success
// with the `&#10003;` prefix → "✓ Save Job Card". jcModalOpsHtml L5868 and
// jcModalDocsHtml L5809 are delegates called from inside jcModalBody (L6012 /
// L6016), not counterparts. renderJobCards L5739 is the LIST, not this form.
//
// Legacy section order: JOB CARD DETAILS → DRAWING ATTACHMENT → OPERATION
// ROUTING → QC DOCUMENTS. Mirrored below.
//
// Started ops (hasStarted) are locked from removal/retype, mirroring
// _hasOpStarted L6151.

import type {
  DefaultRouteOpsResponse,
  JobCardEditModel,
  JobCardSourceOption,
  ListVendorsQuery,
  ListVendorsResponse,
} from '@innovic/shared';
import { fmtOpSrNo } from '@innovic/shared';
import { useQueries } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { Loader2 } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { apiFetch } from '@/lib/api';
import { todayLocal } from '@/lib/date';
import { useExitConfirm } from '@/lib/exit-guard';
import { uploadFile } from '@/lib/storage';
import { useSession } from '@/lib/session';
import { useItemsList } from '@/modules/items/api';
import { useDefaultRouteOps } from '@/modules/plans/api';
import { useMachineGroupsList, useMachinesList } from '@/modules/machines/api';
import {
  MaterialGradePicker,
  MaterialSizePicker,
  RawMaterialGroup,
} from '@/modules/raw-material/components/raw-material-pickers';
import { useVendorsList, vendorsKeys } from '@/modules/vendors/api';
import { Panel } from '@/ui/data';
import { Banner } from '@/ui/feedback';
import { FormField, FormGrid, SearchableSelect } from '@/ui/forms';
import { PageHeader, useSaveShortcut } from '@/ui/layout';
import { useCreateJobCard, useJobCardSourceOptions, useNextJcCode, useUpdateJobCard } from '../api';
import {
  buildJcWriteInput,
  grandfatheredOspQcPairs,
  opsSequenceError,
} from '../lib/build-jc-write-input';
import { JcOpEditCard } from './jc-op-edit-card';
import { OutsourceBalanceModal } from './outsource-balance-modal';

const QC_DOC_TYPES = [
  'MIR',
  'MCR',
  'Inspection Report Protocol',
  'Inspection Report',
  'Drawing',
  'Certificate',
  'Other',
];

// The local OP_STATUS copy that used to live here is gone: the op card reads
// the shared map (lib/jc-op-labels.ts), so there is no second copy to drift.

interface FormOp {
  id?: string;
  /** DISPLAY-ONLY, never saved: the Machine GROUP that narrows this row's machine
   *  list (SO Planning / Route Card parity). buildJcWriteInput ignores it. */
  machineGroupId: string | null;
  machineCode: string;
  operation: string;
  opType: 'process' | 'qc' | 'outsource';
  cycleTimeMin: number;
  program: string;
  toolNo: string;
  toolDetails: string;
  qcRequired: boolean;
  outsourceVendorCode: string;
  outsourceCost: number | null;
  hasStarted: boolean;
  /** Remaining qty cleared for this op (from the edit model). Drives the
   *  "Outsource balance" action for a STARTED in-house process op. */
  available: number;
  /** Read-only per-op live progress (from the edit model / v_jc_op_status),
   *  mirroring the JC Status page. Display-only — never sent on save. */
  inputAvail: number;
  completedQty: number;
  qcAcceptedQty: number;
  computedStatus: string;
}

type RouteOp = DefaultRouteOpsResponse['ops'][number];

/** A Route Card's ops as fresh (never-started) Job Card form rows. Only a
 *  process op carries a machine: OSP has none (T32b) and a QC op parks on the
 *  QC lane, exactly as + Add QC Op / + Add OSP Op do. */
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
      hasStarted: false,
      available: 0,
      inputAvail: 0,
      completedQty: 0,
      qcAcceptedQty: 0,
      computedStatus: 'waiting',
    };
  });
}

/** True when the rows are still the seeded ones, field for field. The machine
 *  group is ignored — it is display-only and back-filled after seeding. */
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

interface FormDoc {
  id?: string;
  docType: string;
  fileName: string;
  storagePath: string;
  fileSize: number | null;
}

const today = (): string => todayLocal();

function sourceLabel(o: JobCardSourceOption): string {
  const tag = o.type === 'jw' ? '[JWSO]' : '[SO]';
  const ln = o.lineNo && o.lineNo !== 1 ? ` / L${o.lineNo}` : '';
  const part = o.partName ? ` (${o.partName})` : '';
  return `${tag} ${o.code}${ln} — ${o.customerName ?? ''}${part} [Avail: ${o.remaining}]`;
}

export function JobCardForm({
  model,
  initialSourceLineId,
}: {
  model?: JobCardEditModel;
  // Create mode only: pre-select this SO/JW source line (deep-linked from
  // SO Status Review's "Create Job Card"). Cascades item/qty/due once the
  // source options load. Ignored in edit mode (model wins).
  initialSourceLineId?: string | undefined;
}): React.JSX.Element {
  const isEdit = Boolean(model);
  const navigate = useNavigate();
  const goBack = useCallback(() => void navigate({ to: '/job-cards' }), [navigate]);
  const exit = useExitConfirm({ onExit: goBack });
  const { data: me } = useSession();
  const companyId = me?.companyId ?? '';

  const { data: sourceOptions = [] } = useJobCardSourceOptions();
  const { data: itemsData } = useItemsList({ limit: 500, offset: 0 });
  // machines & vendors list-query schemas cap `limit` at 200 — 500 makes the
  // route 400, leaving the machine picker empty ("No matches"). Stay ≤ 200.
  const { data: machinesData } = useMachinesList({ limit: 200, offset: 0 });
  // OSP vendor picker searches the SERVER (same wiring as SO Planning's "+ Add
  // OSP Op"): the endpoint caps `limit` at 200, and the vendor master runs past
  // that, so a static first page left every later vendor unreachable ("No
  // matches" for VND-959).
  const [vendorSearch, setVendorSearch] = useState('');
  const { data: vendorsData, isFetching: vendorsFetching } = useVendorsList({
    ...(vendorSearch.trim() ? { search: vendorSearch.trim() } : {}),
    limit: 200,
    offset: 0,
  });
  // Machine groups exist only to label and narrow the machine picker; the id →
  // code map lets a row show 'VMC' for the group its machine belongs to.
  const { data: machineGroupsData } = useMachineGroupsList({ limit: 200, offset: 0 });
  const items = itemsData?.items ?? [];
  const machines = machinesData?.machines ?? [];
  // Every vendor row this form has seen (first page + each search page), by
  // code. A picked vendor keeps its "CODE — Name" label in the op card even
  // after the search term moves on to another row's picker and that vendor
  // drops out of the current page.
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

  // ISSUE-170: source-options lists only OPEN lines, so a JC linked to a CLOSED
  // order would lose its own source from the datalist/label/banner. The edit
  // model resolves that linked line (open or closed) as `linkedSourceOption`;
  // unshift it (legacy editJC L5947-50) when it isn't already present.
  const allSources = useMemo(() => {
    const linked = model?.linkedSourceOption ?? null;
    if (!linked) return sourceOptions;
    if (sourceOptions.some((o) => o.lineId === linked.lineId)) return sourceOptions;
    return [linked, ...sourceOptions];
  }, [sourceOptions, model?.linkedSourceOption]);

  // Governance: direct SO/item Job Cards are disabled. Manual creation is
  // JW-only — SO items go through Planning (execute a plan). Edit mode keeps
  // whatever source the JC already has (incl. legacy SO-linked JCs).
  const availableSources = isEdit ? allSources : allSources.filter((o) => o.type === 'jw');

  const create = useCreateJobCard();
  const update = useUpdateJobCard(model?.id ?? '');
  // Preview the next IN-JC-YY-##### on create so the JC No. is visible before
  // save (server still assigns authoritatively). Not fetched in edit mode.
  const { data: nextJc } = useNextJcCode(!isEdit);

  // ── Header state ──
  const initialSource = model?.sourceSoLineId
    ? allSources.find((o) => o.lineId === model.sourceSoLineId)
    : model?.sourceJwLineId
      ? allSources.find((o) => o.lineId === model.sourceJwLineId)
      : undefined;
  const [jcDate, setJcDate] = useState(model?.jcDate ?? today());
  const [sourceLineId, setSourceLineId] = useState<string | null>(
    model?.sourceSoLineId ?? model?.sourceJwLineId ?? null,
  );
  const [sourceType, setSourceType] = useState<'so' | 'jw' | null>(
    model?.sourceSoLineId ? 'so' : model?.sourceJwLineId ? 'jw' : null,
  );
  const [sourceText, setSourceText] = useState(initialSource ? sourceLabel(initialSource) : '');
  // ISSUE-169: `sourceText` above initialises from `initialSource`, which reads
  // `sourceOptions` — an empty array on the first render (the query hasn't
  // resolved). The initialiser runs once and never re-syncs, so the linked
  // SO/WO/JW label stays blank on every edit even though the balance banner
  // (driven by the inline `selectedSource`, which recomputes each render) shows
  // the order. This flag lets an effect below sync the display value once the
  // linked option resolves, and stops once the user edits the field.
  const [sourceTextSynced, setSourceTextSynced] = useState(false);
  const [itemCode, setItemCode] = useState(model?.itemCode ?? '');
  const [orderQty, setOrderQty] = useState<string>(model ? String(model.orderQty) : '');
  const [priority, setPriority] = useState<'normal' | 'high'>(model?.priority ?? 'normal');
  const [dueDate, setDueDate] = useState(model?.dueDate ?? '');
  const [drawingFilePath, setDrawingFilePath] = useState<string | null>(
    model?.drawingFilePath ?? null,
  );
  const [remarks, setRemarks] = useState(model?.remarks ?? '');
  // Raw material — both optional and independent. A JC created from a plan
  // arrives with these already filled from the plan; a hand-raised JC can pick
  // them here. Id + text snapshot are stored together.
  const [rmGradeId, setRmGradeId] = useState<string | null>(model?.rawMaterialGradeId ?? null);
  const [rmGradeText, setRmGradeText] = useState<string | null>(
    model?.rawMaterialGradeText ?? null,
  );
  const [rmSizeId, setRmSizeId] = useState<string | null>(model?.rawMaterialSizeId ?? null);
  const [rmSizeText, setRmSizeText] = useState<string | null>(model?.rawMaterialSizeText ?? null);
  // Downstream inheritance (CLAUDE.md §17): a hand-raised JC (JW path) reads
  // the raw material off the item's Route Card, exactly as a Plan does — the
  // route card is the source of truth for what the part is cut from. Create
  // mode only, and only while a field is still blank, so a manual pick or a
  // plan-carried value is never overwritten.
  const pickedItemId = isEdit
    ? null
    : (items.find((i) => i.code.toUpperCase() === itemCode.trim().toUpperCase())?.id ?? null);
  const { data: itemRouteDefaults } = useDefaultRouteOps(pickedItemId);
  useEffect(() => {
    if (isEdit || !itemRouteDefaults) return;
    const d = itemRouteDefaults;
    if (!rmGradeId && !rmGradeText && (d.rawMaterialGradeId || d.rawMaterialGradeText)) {
      setRmGradeId(d.rawMaterialGradeId);
      setRmGradeText(d.rawMaterialGradeText);
    }
    if (!rmSizeId && !rmSizeText && (d.rawMaterialSizeId || d.rawMaterialSizeText)) {
      setRmSizeId(d.rawMaterialSizeId);
      setRmSizeText(d.rawMaterialSizeText);
    }
  }, [isEdit, itemRouteDefaults, rmGradeId, rmGradeText, rmSizeId, rmSizeText]);
  const [drawingName, setDrawingName] = useState<string>(model?.drawingFilePath ? 'Attached' : '');

  const [ops, setOps] = useState<FormOp[]>(
    (model?.ops ?? []).map((o) => ({
      id: o.id,
      // Group is display-only and not stored on the op — back-filled from the
      // machine master once the machine list loads (effect below).
      machineGroupId: null,
      machineCode: o.machineCode ?? '',
      operation: o.operation,
      opType: o.opType,
      cycleTimeMin: o.cycleTimeMin,
      program: o.program ?? '',
      toolNo: o.toolNo ?? '',
      toolDetails: o.toolDetails ?? '',
      qcRequired: o.qcRequired,
      outsourceVendorCode: o.outsourceVendorCode ?? '',
      outsourceCost: o.outsourceCost,
      hasStarted: o.hasStarted,
      available: o.available ?? 0,
      inputAvail: o.inputAvail ?? 0,
      completedQty: o.completedQty ?? 0,
      qcAcceptedQty: o.qcAcceptedQty ?? 0,
      computedStatus: o.computedStatus ?? 'waiting',
    })),
  );
  const [docs, setDocs] = useState<FormDoc[]>(
    (model?.qcDocs ?? []).map((d) => ({
      id: d.id,
      docType: d.docType,
      fileName: d.fileName,
      storagePath: d.storagePath,
      fileSize: d.fileSize,
    })),
  );
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  // ADR-081 dual-lane: index of the started process op whose remaining qty is
  // being outsourced from this form (null = modal closed), plus a transient
  // success note shown after a balance is sent out.
  const [balanceOpIdx, setBalanceOpIdx] = useState<number | null>(null);
  const [balanceNote, setBalanceNote] = useState<string | null>(null);

  // Machine picker: the op card uses the shared SearchableSelect (same control
  // the JC edit screen already uses), replacing this form's <datalist>, which
  // collapsed on a pre-filled value (T32a). Only one row's dropdown is open at
  // a time, so a shared search term is fine.
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

  // Edit-page gap (test row R3-07b-1): an op's saved vendor past the first 200
  // rows (VND-959) is on no page this form has fetched, so knownVendors had no
  // name for it and the op card showed the bare code until a search happened to
  // bring it in. The op carries only `outsourceVendorCode` (no name), so look
  // each still-unknown code up by itself — one small keyed vendors-list query
  // per code, the same key/fetch shape as useVendorsList so react-query caches
  // it like any other page — and keep only the exact code match (the search is
  // a substring match, so "VND-95" would also hit VND-950…). A deleted/unknown
  // code resolves to nothing and simply stays a bare code.
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
  // already-picked vendor that page does not contain (looked up from the rows
  // seen so far), so its "CODE — Name" label and highlight survive a re-search.
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

  // Source picker rows: the full open-JWSO line list is already in memory, so
  // the shared SearchableSelect filters it client-side (no server search).
  // The row reads "[JWSO] CODE / Ln — Customer (Part) [Avail: n]", the same
  // words the old <datalist> label carried.
  const sourcePickerOptions = useMemo(
    () =>
      availableSources.map((o) => {
        const tag = o.type === 'jw' ? '[JWSO]' : '[SO]';
        const ln = o.lineNo && o.lineNo !== 1 ? ` / L${o.lineNo}` : '';
        const part = o.partName ? ` (${o.partName})` : '';
        return {
          id: o.lineId,
          code: `${tag} ${o.code}${ln}`,
          name: `${o.customerName ?? ''}${part} [Avail: ${o.remaining}]`,
        };
      }),
    [availableSources],
  );
  const selectedSource = sourceLineId
    ? allSources.find((o) => o.lineId === sourceLineId)
    : undefined;

  // ISSUE-169 fix: once the linked source option resolves (edit mode), display
  // its label in the search field. Runs once, then yields to user edits.
  useEffect(() => {
    if (!isEdit || sourceTextSynced || !selectedSource) return;
    setSourceText(sourceLabel(selectedSource));
    setSourceTextSynced(true);
  }, [isEdit, sourceTextSynced, selectedSource]);

  // Ops counter (legacy jcModalOpsHtml L5927). Legacy pluralised "op(s)" off the
  // TOTAL row count while PRINTING the non-QC count, so 1 process op + 1 QC op
  // read "1 ops". That deviation is no longer mirrored — the plural now follows
  // the number actually shown.
  const opCount = ops.filter((o) => o.opType !== 'qc').length;
  const qcCount = ops.filter((o) => o.opType === 'qc').length;

  const onSourceChange = (lineId: string | null): void => {
    // User is editing the field — freeze the ISSUE-169 auto-sync effect so it
    // never overwrites what they type.
    setSourceTextSynced(true);
    const opt = lineId ? availableSources.find((o) => o.lineId === lineId) : undefined;
    setSourceText(opt ? sourceLabel(opt) : '');
    if (!opt) {
      setSourceLineId(null);
      setSourceType(null);
      return;
    }
    setSourceLineId(opt.lineId);
    setSourceType(opt.type);
    // Cascade auto-fill (legacy _jcCascadeFromOrder): only fill empties.
    if (opt.itemCode && !itemCode) setItemCode(opt.itemCode);
    if (opt.remaining > 0 && !orderQty) setOrderQty(String(opt.remaining));
    if (opt.dueDate && !dueDate) setDueDate(opt.dueDate);
  };

  // One-time prefill when deep-linked with a source line (create mode). Waits
  // for source options to load, then applies the same cascade as a manual pick.
  const [appliedInitialSource, setAppliedInitialSource] = useState(false);
  useEffect(() => {
    if (isEdit || appliedInitialSource || !initialSourceLineId) return;
    const opt = sourceOptions.find((o) => o.lineId === initialSourceLineId);
    if (!opt) return;
    setSourceText(sourceLabel(opt));
    setSourceLineId(opt.lineId);
    setSourceType(opt.type);
    if (opt.itemCode && !itemCode) setItemCode(opt.itemCode);
    if (opt.remaining > 0 && !orderQty) setOrderQty(String(opt.remaining));
    if (opt.dueDate && !dueDate) setDueDate(opt.dueDate);
    setAppliedInitialSource(true);
  }, [
    isEdit,
    appliedInitialSource,
    initialSourceLineId,
    sourceOptions,
    itemCode,
    orderQty,
    dueDate,
  ]);

  const setOp = (i: number, patch: Partial<FormOp>): void => {
    setOps((prev) => prev.map((o, idx) => (idx === i ? { ...o, ...patch } : o)));
  };

  // Picking a machine that carries a group in the master fills the Group box
  // when it is still empty — the same seeding SO Planning / Route Card do — so a
  // card opened later reads its group, not a bare machine.
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
  // the box that is NOT in the new group is cleared, so the row cannot read
  // "VMC group, running a lathe" — only cleared when the mismatch is PROVEN.
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

  // Group is display-only and not stored, so a JC opened for editing has every
  // row's group empty even though its machine belongs to one. Read it back off
  // the master once the machine list is in, for rows with a machine but no group.
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
  }, [machines]);

  // Downstream inheritance (CLAUDE.md §17), the OPERATIONS half: a hand-raised
  // JWSO Job Card seeds its routing from the item's active Route Card, exactly
  // as a Plan loads it (plans/components/plan-form.tsx handleLoadDefaultOps).
  // Create mode only, and once per item. The list is seeded while it is EMPTY;
  // when the item changes it is re-seeded only if the rows are still exactly
  // the ones seeded (untouched). A routing the user has edited is never
  // replaced silently — a warning offers the new item's ops instead. Deleting
  // every seeded row does not bring them back. The rows stay fully editable.
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
    if (isEdit || !pickedItemId || !itemRouteDefaults) return;
    if (seededFrom?.itemId === pickedItemId) return;
    if (ops.length === 0) {
      if (itemRouteDefaults.ops.length > 0) seedFromRouteCard();
      return;
    }
    // The item changed under rows seeded for the previous item: swap them
    // only while nobody has touched them (the new item may have no Route
    // Card — the old item's ops still do not belong to it).
    if (seededFrom && sameSeedOps(ops, seededFrom.ops)) {
      if (itemRouteDefaults.ops.length > 0) {
        seedFromRouteCard();
      } else {
        setOps([]);
        setSeededFrom(null);
      }
    }
  }, [isEdit, pickedItemId, itemRouteDefaults, seededFrom, ops, seedFromRouteCard]);
  // The "from Route Card" note belongs to the item it was loaded for.
  const seededNote =
    seededFrom && seededFrom.itemId === pickedItemId && ops.length > 0 ? seededFrom : null;
  // Edited rows seeded for a DIFFERENT item than the one now picked.
  const staleSeed =
    !isEdit && seededFrom && pickedItemId && seededFrom.itemId !== pickedItemId && ops.length > 0
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
        hasStarted: false,
        available: 0,
        inputAvail: 0,
        completedQty: 0,
        qcAcceptedQty: 0,
        computedStatus: 'waiting',
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

  const submitting = create.isPending || update.isPending || uploading;

  // "No QC directly after OSP" routing rule. Pairs already saved that way on
  // an existing JC are grandfathered; the live hint below the ops header shows
  // the same message the Save button (and the API) would raise.
  const allowedPairs = useMemo(() => grandfatheredOspQcPairs(model?.ops ?? []), [model?.ops]);
  const startedIds = useMemo(
    () => new Set((model?.ops ?? []).filter((o) => o.hasStarted).map((o) => o.id)),
    [model?.ops],
  );
  const opsSequenceHint = opsSequenceError(ops, { allowedPairs, startedIds });

  const onSubmit = async (): Promise<void> => {
    setError(null);
    // Validation + payload build shared with the JC Status edit branch.
    const result = buildJcWriteInput({
      isEdit,
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
      ops,
      docs,
      allowedPairs,
      startedIds,
    });
    if (!result.ok) {
      setError(result.error);
      return;
    }
    try {
      if (isEdit && model) await update.mutateAsync(result.payload);
      else await create.mutateAsync(result.payload);
      exit.leave(goBack);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save Job Card. Try again.');
    }
  };
  // Ctrl+S runs the same Save as the header button.
  useSaveShortcut(() => void onSubmit(), !submitting);

  return (
    <div>
      {exit.dialog}
      <PageHeader
        sticky
        title={isEdit ? `Edit Job Card${model?.code ? ` — ${model.code}` : ''}` : 'New Job Card'}
        backLabel="Back to Job Cards"
        onBack={goBack}
        actions={
          <>
            <button type="button" className="btn btn-ghost" onClick={() => exit.leave(goBack)}>
              Cancel
            </button>
            <button
              type="button"
              className="btn btn-primary"
              disabled={submitting}
              onClick={() => void onSubmit()}
            >
              {submitting ? (
                <>
                  <Loader2 size={13} className="animate-spin" /> Saving…
                </>
              ) : isEdit ? (
                'Save Changes'
              ) : (
                'Save Job Card'
              )}
            </button>
          </>
        }
      />
      {error ? (
        <Banner tone="error" role="alert">
          {error}
        </Banner>
      ) : null}
      <datalist id="dlJcItem">
        {items.map((i) => (
          <option key={i.id} value={i.code}>
            {i.code} — {i.name}
          </option>
        ))}
      </datalist>

      {/* ── JC DETAILS ── 12-column grid: source order first, then JC No. /
          date, then item / qty / due / priority, then raw material + remarks. */}
      <Panel title="Job Card Details" style={{ marginBottom: 'var(--sp-3)' }}>
        <FormGrid>
          <FormField label={isEdit ? 'SO / JWSO No.' : 'JWSO No.'} required={!isEdit} size="lg">
            {!isEdit ? (
              <div
                style={{
                  fontSize: 'var(--fs-xs)',
                  color: 'var(--amber2)',
                  marginBottom: 4,
                  fontWeight: 600,
                }}
              >
                ⓘ JWSO only. Sales Order items: Planning → Production Order.
              </div>
            ) : null}
            {isEdit ? (
              <input
                className="innovic-input"
                value={sourceText}
                readOnly
                placeholder="Source is fixed after creation"
                style={{ background: 'var(--bg4)', color: 'var(--text3)' }}
                title="A Job Card’s source order cannot be changed after creation."
              />
            ) : (
              <SearchableSelect
                value={sourceLineId}
                onChange={onSourceChange}
                options={sourcePickerOptions}
                valueLabel={sourceText || undefined}
                placeholder="🔍 Search JWSO number…"
              />
            )}
            {/* Line display (legacy #fSoLineDisplay, _jcCascadeFromOrder L1883-87). */}
            {selectedSource ? (
              <div style={{ fontSize: 'var(--fs-xs)', marginTop: 4 }}>
                <span className="cyan fw-700">
                  {selectedSource.type === 'jw' ? '[JW] ' : ''}Ln {selectedSource.lineNo || 1}
                </span>
                {selectedSource.clientPoLineNo ? (
                  <span style={{ color: 'var(--purple)', fontWeight: 700 }}>
                    {' '}
                    [POL:{selectedSource.clientPoLineNo}]
                  </span>
                ) : null}{' '}
                — {selectedSource.code}
                {selectedSource.partName ? (
                  <>
                    {' · '}
                    <b>{selectedSource.partName}</b>
                  </>
                ) : null}{' '}
                · <span className="text3">{selectedSource.customerName ?? ''}</span>
              </div>
            ) : null}
            {selectedSource ? (
              <div
                style={{
                  marginTop: 6,
                  padding: '6px 10px',
                  borderRadius: 6,
                  fontSize: 'var(--fs-xs)',
                  background:
                    selectedSource.remaining <= 0 ? 'var(--red3)' : 'rgba(34,197,94,0.06)',
                  border: `1px solid ${selectedSource.remaining <= 0 ? 'var(--red)' : 'rgba(34,197,94,0.2)'}`,
                  color: selectedSource.remaining <= 0 ? 'var(--red)' : 'var(--text2)',
                }}
              >
                <b style={{ color: 'var(--cyan)' }}>{selectedSource.code}:</b> Order Qty{' '}
                <b>{selectedSource.orderQty}</b> | Already in JCs <b>{selectedSource.inJc}</b> |{' '}
                <b style={{ color: selectedSource.remaining <= 0 ? 'var(--red)' : 'var(--green)' }}>
                  Available: {selectedSource.remaining}
                </b>
              </div>
            ) : null}
          </FormField>
          <FormField label="JC No." size="sm">
            <input
              className="innovic-input"
              value={model?.code ?? nextJc?.code ?? '(auto on save)'}
              readOnly
            />
          </FormField>
          <FormField label="JC Date" size="sm">
            <input
              type="date"
              className="innovic-input"
              value={jcDate}
              onChange={(e) => setJcDate(e.target.value)}
            />
          </FormField>
          <FormField label="Item Code" required size="md">
            <input
              className="innovic-input"
              list="dlJcItem"
              value={itemCode}
              placeholder="🔍 Search item code or name…"
              onChange={(e) => setItemCode(e.target.value)}
            />
          </FormField>
          <FormField label="Order Qty" required size="sm">
            <input
              type="number"
              min={1}
              className="innovic-input"
              value={orderQty}
              onChange={(e) => setOrderQty(e.target.value)}
            />
          </FormField>
          <FormField label="Due Date" size="sm">
            <input
              type="date"
              className="innovic-input"
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
            />
          </FormField>
          <FormField label="Priority" size="xs">
            <select
              className="innovic-select"
              value={priority}
              onChange={(e) => setPriority(e.target.value as 'normal' | 'high')}
            >
              <option value="normal">Normal</option>
              <option value="high">High</option>
            </select>
          </FormField>
          {/* Raw material — Grade + Size under one bracket, both optional
              (no ★ on either). Same two pickers Planning uses, so a
              hand-raised JC carries the same fields a planned one does. */}
          <div className="f-full">
            <RawMaterialGroup>
              <div className="form-grp">
                <label className="form-label">Grade</label>
                <MaterialGradePicker
                  valueId={rmGradeId}
                  valueText={rmGradeText}
                  onChange={(id, text) => {
                    setRmGradeId(id);
                    setRmGradeText(text);
                  }}
                />
              </div>
              <div className="form-grp">
                <label className="form-label">Size</label>
                <MaterialSizePicker
                  valueId={rmSizeId}
                  valueText={rmSizeText}
                  onChange={(id, text) => {
                    setRmSizeId(id);
                    setRmSizeText(text);
                  }}
                />
              </div>
            </RawMaterialGroup>
          </div>
          {/* Remarks has no legacy counterpart (jcModalBody has no such field),
              but job_cards.remarks is a real column the service persists —
              kept per "legacy has fewer fields than ours → keep ours". */}
          <FormField label="Remarks" size="full">
            <textarea
              className="innovic-textarea"
              rows={2}
              value={remarks}
              onChange={(e) => setRemarks(e.target.value)}
              placeholder="Optional notes for this job card"
            />
          </FormField>
        </FormGrid>
      </Panel>

      {/* ── DRAWING ATTACHMENT (legacy jcModalBody L5996-6006) ── */}
      <div className="panel" style={{ marginBottom: 12 }}>
        <div className="panel-hdr">
          <div className="panel-title">
            ▸ Drawing Attachment <span className="text3">(optional — image or PDF)</span>
          </div>
        </div>
        <div className="panel-body">
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <label
              style={{
                cursor: 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                padding: '6px 12px',
                background: 'var(--bg4)',
                border: '1px solid var(--border2)',
                borderRadius: 'var(--radius)',
                fontSize: 12,
                fontWeight: 600,
                color: 'var(--text2)',
              }}
            >
              📎 Attach Drawing
              <input
                type="file"
                accept="image/*,.pdf"
                style={{ display: 'none' }}
                onChange={(e) => void onDrawing(e.target.files?.[0])}
              />
            </label>
            <span className="text3" style={{ fontSize: 12 }}>
              {drawingName || 'No file attached'}
            </span>
            {drawingFilePath ? (
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => {
                  setDrawingFilePath(null);
                  setDrawingName('');
                }}
              >
                ✕ Remove
              </button>
            ) : null}
          </div>
        </div>
      </div>

      {staleSeed ? (
        <Banner tone="warn" role="status">
          <span>
            Operations are from Route Card{' '}
            <span className="mono fw-700">{staleSeed.code ?? '—'}</span> — item changed
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
      {/* ── OPERATION ROUTING (legacy jcModalBody L6007-6013 + jcModalOpsHtml L5868) ── */}
      <div className="panel" style={{ marginBottom: 12 }}>
        <div className="panel-hdr">
          <div className="panel-title">▸ Operations — Routing Sequence</div>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
            {seededNote ? (
              <span
                className="text2"
                style={{ fontSize: 11 }}
                title="Loaded from the item's active Route Card — every row stays editable"
              >
                Operations from Route Card{' '}
                <span className="mono fw-700">{seededNote.code ?? '—'}</span>
                {seededNote.revision != null ? ` Rev ${seededNote.revision}` : ''}
              </span>
            ) : null}
            <span className="text3" style={{ fontSize: 11 }}>
              {opCount} op{opCount !== 1 ? 's' : ''}
              {qcCount > 0 ? ` + ${qcCount} QC` : ''}
            </span>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => addOp('process')}>
              + Add Op
            </button>
            <button
              type="button"
              className="btn btn-sm"
              style={{ color: 'var(--green2)', border: '1px solid rgba(34,197,94,0.3)' }}
              onClick={() => addOp('qc')}
            >
              + Add QC Op
            </button>
            <button
              type="button"
              className="btn btn-sm"
              style={{ color: 'var(--amber2)', border: '1px solid rgba(245,158,11,0.4)' }}
              onClick={() => addOp('outsource')}
            >
              + Add Outsource Op
            </button>
          </div>
        </div>
        <div className="panel-body">
          {opsSequenceHint ? (
            <div
              role="alert"
              style={{
                color: 'var(--red2)',
                background: 'var(--red3)',
                border: '1px solid var(--red)',
                borderRadius: 6,
                padding: '6px 10px',
                fontSize: 12,
                marginBottom: 10,
              }}
            >
              {opsSequenceHint}
            </div>
          ) : null}
          {ops.length === 0 ? (
            <div className="empty-state">No operations yet.</div>
          ) : (
            ops.map((o, i) => (
              <JcOpEditCard
                key={i}
                // Order Qty is typed on this screen; the other tiles have no
                // source until the JC is saved, so they render “—”.
                jc={{ orderQty: Number(orderQty) || 0 }}
                op={o}
                index={i}
                seqLabel={i + 1}
                enriched={undefined}
                machineName={machines.find((m) => m.code === o.machineCode)?.name ?? ''}
                machines={machines}
                machineOptions={machineOptions}
                machineGroupCodeById={machineGroupCodeById}
                onMachineSearch={setMachineSearch}
                onMachineChange={(code) => onOpMachineChange(i, code)}
                onGroupChange={(gid) => onOpGroupChange(i, gid)}
                vendorOptions={vendorOptions}
                onVendorSearch={setVendorSearch}
                vendorsLoading={vendorsFetching}
                toolDetailsPlaceholder="Insert, fixtures, setup notes"
                isFirst={i === 0}
                isLast={i === ops.length - 1}
                onChange={(patch) => setOp(i, patch)}
                onMove={(dir) => moveOp(i, dir)}
                onRemove={() => setOps((prev) => prev.filter((_, idx) => idx !== i))}
                onOutsourceBalance={() => {
                  setBalanceNote(null);
                  setBalanceOpIdx(i);
                }}
              />
            ))
          )}
        </div>
      </div>

      {/* ── QC DOCUMENTS (legacy jcModalBody L6014-6017 + jcModalDocsHtml L5809) ── */}
      <div className="panel" style={{ marginBottom: 12 }}>
        <div className="panel-hdr">
          <div className="panel-title">▸ QC Documents</div>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <span className="text3" style={{ fontSize: 11 }}>
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
          </div>
        </div>
        <div className="panel-body">
          {docs.length === 0 ? (
            <div className="empty-state" style={{ fontSize: 12 }}>
              No QC documents.
            </div>
          ) : (
            <table className="innovic-table">
              <thead>
                <tr>
                  <th style={{ width: 200 }}>Document Type</th>
                  <th>Attached File</th>
                  <th style={{ width: 40 }} />
                </tr>
              </thead>
              <tbody>
                {docs.map((d, i) => (
                  <tr key={i}>
                    <td>
                      <select
                        className="innovic-select"
                        value={d.docType}
                        onChange={(e) =>
                          setDocs((prev) =>
                            prev.map((x, idx) =>
                              idx === i ? { ...x, docType: e.target.value } : x,
                            ),
                          )
                        }
                        style={{ fontSize: 12 }}
                      >
                        {QC_DOC_TYPES.map((t) => (
                          <option key={t} value={t}>
                            {t}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td>
                      <label style={{ cursor: 'pointer', fontSize: 12 }}>
                        📎 {d.fileName || 'Attach File'}
                        <input
                          type="file"
                          accept="image/*,.pdf"
                          style={{ display: 'none' }}
                          disabled={Boolean(d.id)}
                          onChange={(e) => void onDocFile(i, e.target.files?.[0])}
                        />
                      </label>
                    </td>
                    <td>
                      <button
                        type="button"
                        className="btn btn-danger btn-sm btn-icon"
                        onClick={() => setDocs((prev) => prev.filter((_, idx) => idx !== i))}
                        title="Remove"
                      >
                        ✕
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {balanceNote ? (
        <div
          style={{
            color: 'var(--green2)',
            background: 'rgba(34,197,94,0.08)',
            border: '1px solid rgba(34,197,94,0.3)',
            borderRadius: 6,
            padding: '6px 10px',
            fontSize: 12,
            marginBottom: 10,
          }}
        >
          {balanceNote}
        </div>
      ) : null}

      {balanceOpIdx !== null && ops[balanceOpIdx]?.id ? (
        <OutsourceBalanceModal
          jcId={model?.id ?? ''}
          jcCode={model?.code ?? ''}
          opId={ops[balanceOpIdx]!.id!}
          opSeq={balanceOpIdx + 1}
          operation={ops[balanceOpIdx]!.operation}
          itemCode={itemCode}
          available={ops[balanceOpIdx]!.available}
          defaultVendorCode={ops[balanceOpIdx]!.outsourceVendorCode}
          onClose={() => setBalanceOpIdx(null)}
          onDone={(qtyDone) => {
            const idx = balanceOpIdx;
            const op = ops[idx];
            if (op) setOp(idx, { available: Math.max(0, op.available - qtyDone) });
            setBalanceNote(`Outsource PR raised for ${qtyDone} pcs (Op ${fmtOpSrNo(idx + 1)}).`);
            setBalanceOpIdx(null);
          }}
        />
      ) : null}
    </div>
  );
}
