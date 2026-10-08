// JC Status content — the mode dispatcher plus the EDIT body.
//
// VIEW mode (the read-only status page, laid out to the owner-approved
// jobcard-detail-mockup.html) lives in jc-status-view.tsx. EDIT mode below is
// the SAME page — same header line, same banners, same fact block, same one
// filling panel of operations — with the editable fields as inputs in their
// cells (owner, 2026-10-06: "jobcard detail page mockup is ok — apply to JC
// edit"; screen-layout rule 8: Create, Edit and View share one grid and one
// sequence, only the controls differ). Precedent: production-orders/routes/
// edit.tsx.
//
//   header     ← Back · JC No. · Edit Job Card · JC status badge ·
//              (pending-edit note) · Cancel · Save Changes
//   banners    Sent for approval · short-closed Production Order stop
//              (ADR-182) · rework / repair child note
//   facts      jc-edit-fact-block.tsx — the detail page's block with Item
//              Code, Due Date, Priority, Order Qty and Remarks as inputs
//   notes      save error · outsource-balance result · op added · the
//              "no QC directly after OSP" hint
//   panel      Operations — jc-edit-ops-table.tsx, one editable row per op,
//              the rest behind ▸
//
// The save is unchanged: buildJcWriteInput + useUpdateJobCard, the same
// payload (source / date / drawing / raw material / QC docs carried through
// from the model), the same staged-for-approval result handling, and the shared
// OutsourceBalanceModal for ADR-081. The rework/repair banner both modes show
// is in jc-recovery-banner.tsx.
import type {
  JcOpEnriched,
  JcOpInput,
  JobCardEditModel,
  JobCardListItem,
  ListVendorsQuery,
  ListVendorsResponse,
  OpLog,
} from '@innovic/shared';
import { fmtOpSrNo, isProductionOrderStopped } from '@innovic/shared';
import { Link, useNavigate } from '@tanstack/react-router';
import { Loader2 } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQueries, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api';
import { isStagedResult, usePendingEditForDoc } from '@/modules/document-edits/api';
import { FilePreviewModal } from '@/components/shared/file-preview-modal';
import { SearchableSelect } from '@/components/shared/searchable-select';
import { useExitConfirm } from '@/lib/exit-guard';
import { useEditConflict } from '@/lib/use-edit-conflict';
import { useOpFlow } from '@/modules/flow-views/api';
import { useItemsList } from '@/modules/items/api';
import { useMachineGroupsList, useMachinesList } from '@/modules/machines/api';
import { useProductionOrderForJobCard } from '@/modules/production-orders/api';
import { useVendorsList, vendorsKeys } from '@/modules/vendors/api';
import { opEntryKeys, useJcOpsEnriched, useOpLog } from '@/modules/op-entry/api';
import { Banner } from '@/ui/feedback';
import { DetailHeader, useSaveShortcut } from '@/ui/layout';
import {
  jobCardsKeys,
  useFetchJobCard,
  useFetchJobCardEditModel,
  useJobCard,
  useJobCardEditModel,
  useUpdateJobCard,
} from '../api';
import { jcOpsDigest } from '../lib/jc-ops-digest';
import { useJcDrawing } from '../lib/jc-drawing';
import { JcEditFactBlock, jcEditQtyRule } from './jc-edit-fact-block';
import type { JcOpEditValues } from './jc-edit-op-row';
import { JcEditOpsTable } from './jc-edit-ops-table';
import { OutsourceBalanceModal } from './outsource-balance-modal';
import { RecoveryBanner } from './jc-recovery-banner';
import { JcStatusBadge } from './jc-status-badge';
import { JcStatusViewContent } from './jc-status-view';
import { JcStoppedBanner } from './jc-stopped-banner';
import {
  buildJcWriteInput,
  grandfatheredOspQcPairs,
  opsSequenceError,
} from '../lib/build-jc-write-input';
import './jc-detail.css';
import './jc-edit.css';

/** The server's own words when a second edit is sent while one waits
 *  (document-edits/service.ts) — Save's hover text while it is off for that. */
const PENDING_EDIT_MESSAGE = 'This document already has an edit waiting for approval.';

// Stable row keys for ops added on this screen (display-only, never saved —
// buildJcWriteInput maps the op fields one by one). A saved op's key is its id.
let editOpRowSeq = 0;
const nextEditOpRowKey = (): string => `new-${++editOpRowSeq}`;

// ADR-226 — the five HEADER fields this screen can edit, plus the operations as
// ONE value, and what the user calls each one (the labels on the fact block,
// which come from docs/NAMING.md).
//
// THE OPERATIONS DO NOT MERGE, by owner decision (ADR-226): an operation's step
// number IS its position in the `ops` array, and the shared schema keeps `ops` a
// required whole array with `.default([])` — so an absent `ops` key means
// "delete every operation", and a partial array cannot express a reorder. The
// ops therefore go on every save in full; if two people edit the routing of one
// card the second save wins outright, and the orange notice says so. Only the
// five header fields merge per field.
//
// `ops` is nonetheless in this list, as a DIGEST string (jc-ops-digest.ts), for
// two reasons: an ops-only edit (change a machine, add a step) would otherwise
// be refused as "nothing changed", because the hook will not send an empty diff;
// and it is what lets the notice say the other person changed the ROUTING rather
// than a header field.
const JC_EDITABLE = ['itemCode', 'orderQty', 'dueDate', 'priority', 'remarks', 'ops'] as const;

const JC_LABELS: Record<string, string> = {
  itemCode: 'Item Code',
  orderQty: 'Order Qty',
  dueDate: 'Due Date',
  priority: 'Priority',
  remarks: 'Remarks',
  ops: 'The operations',
};

// Mode dispatcher. VIEW mode renders the read-only status body
// (jc-status-view.tsx); EDIT mode renders the same page with inputs. No hooks
// here → the branch is safe for rules-of-hooks.
export function JcStatusContent({
  id,
  mode = 'view',
}: {
  id: string;
  mode?: 'view' | 'edit';
}): React.JSX.Element {
  if (mode === 'edit') return <JcStatusEditContent id={id} />;
  // Keyed on the id: the router reuses this component when only $id changes
  // (parent-JC link on a rework child, Related Records rows), and the view's
  // per-op open/collapsed set, Show All and tab choice must not carry over.
  return <JcStatusViewContent key={id} id={id} />;
}

// ─── EDIT MODE ──────────────────────────────────────────────────────────────
/** Editable op row shape (`JcOpEditValues`, jc-edit-op-row.tsx). */
type EditOp = JcOpEditValues;

// Loader: fetches the editable model + the read-only enriched ops/logs,
// then renders the form once everything resolves (so the form seeds its state
// from props, exactly like job-card-form seeds from its `model` prop).
function JcStatusEditContent({ id }: { id: string }): React.JSX.Element {
  const { data: jc, isLoading, isError, error } = useJobCard(id);
  const { data: model, isLoading: modelLoading, isError: modelError } = useJobCardEditModel(id);
  const { data: enrichedOps = [] } = useJcOpsEnriched({ jobCardId: id }, { enabled: Boolean(id) });
  const { data: logs = [] } = useOpLog({ jobCardId: id, limit: 300 }, { enabled: Boolean(id) });

  if (isLoading || modelLoading) {
    return (
      <div className="empty-state">
        <Loader2 className="inline h-4 w-4 animate-spin" /> Loading job card…
      </div>
    );
  }
  if (isError || modelError || !jc || !model) {
    return (
      <div>
        <Link to="/job-cards" className="btn btn-ghost btn-sm">
          ← Back
        </Link>
        <div className="empty-state" style={{ color: 'var(--red2)' }}>
          {error instanceof Error ? error.message : 'Job Card not found.'}
        </div>
      </div>
    );
  }
  return <JcStatusEditForm id={id} jc={jc} model={model} enrichedOps={enrichedOps} logs={logs} />;
}

function JcStatusEditForm({
  id,
  jc,
  model,
  enrichedOps,
  logs,
}: {
  id: string;
  jc: JobCardListItem;
  model: JobCardEditModel;
  enrichedOps: JcOpEnriched[];
  logs: OpLog[];
}): React.JSX.Element {
  const navigate = useNavigate();
  const goBack = useCallback(
    () => void navigate({ to: '/job-cards/$id', params: { id } }),
    [navigate, id],
  );
  const exit = useExitConfirm({ onExit: goBack });
  const queryClient = useQueryClient();
  const update = useUpdateJobCard(id);
  const fetchJc = useFetchJobCard();
  const fetchJcModel = useFetchJobCardEditModel();
  // ADR-226 / §20.4 — the version the form loaded travels with the save, a
  // conflict on a HEADER field is merged instead of overwriting the other
  // person's field, and the 3-second notice says what happened. Also subscribes
  // to this one card, so the user is told the moment somebody else saves it.
  //
  // `freshJc` is how the merge is actually honest here. The Job Card header is
  // written by ONE unguarded UPDATE server-side (`.set({ itemId, orderQty,
  // priority, dueDate, remarks, … })` — no `if (input.x !== undefined)`), and
  // `itemCode` / `orderQty` are REQUIRED by the shared schema, so this screen
  // cannot send a partial header the way the GRN and DC screens do: every field
  // must be in the payload. Re-sending a photograph of the four fields we did not
  // touch is exactly §20.4's bug. So on the retry the payload is rebuilt with the
  // FRESH values for the fields this user did not change, and this user's own
  // values only where they did. On the first attempt `freshJc` is null and the
  // payload is what the form holds, unchanged from before.
  //
  // The record the hook compares against is the card plus an `ops` digest, and
  // the re-read fetches the write model too so the digest on the fresh side is
  // the real routing — see the note on JC_EDITABLE.
  const freshJc = useRef<JobCardListItem | null>(null);
  const freshOps = useRef<JcOpInput[] | null>(null);
  const conflictRecord = useMemo(() => ({ ...jc, ops: jcOpsDigest(model.ops) }), [jc, model.ops]);
  const conflict = useEditConflict({
    table: 'job_cards',
    id,
    record: conflictRecord,
    refetch: async () => {
      const [latest, latestModel] = await Promise.all([fetchJc(id), fetchJcModel(id)]);
      freshJc.current = latest;
      // The routing as it stands NOW, in write shape. Used only when this user
      // did not touch the operations: the whole array has to be sent on every
      // save, so without this a "I only changed the due date" save would push
      // the screen's old routing back over somebody else's change to it.
      freshOps.current = latestModel.ops.map((o) => ({
        id: o.id,
        machineCode: o.machineCode,
        operation: o.operation,
        opType: o.opType,
        cycleTimeMin: o.cycleTimeMin,
        program: o.program,
        toolNo: o.toolNo,
        toolDetails: o.toolDetails,
        qcRequired: o.qcRequired,
        outsourceVendorCode: o.outsourceVendorCode,
        // null = this login may not see the cost; the server's money-in rule
        // then keeps the stored value instead of letting a blinded 0 write it.
        outsourceCost: o.outsourceCost ?? 0,
      }));
      return { ...latest, ops: jcOpsDigest(latestModel.ops) };
    },
    editableKeys: JC_EDITABLE,
    label: (f) => JC_LABELS[f] ?? f,
    noun: 'Job Card',
  });

  // Read-only context for the fact block — the same reads the detail page
  // makes (jc-status-view.tsx). ADR-182: the Production Order that built this
  // card (actual size, and whether it was SHORT CLOSED — the server refuses
  // every edit to a stopped order's card, so Save is off with its reason).
  // The drawing ref + thumbnail come from the shared useJcDrawing. None of this
  // touches the editable header/ops state or the save payload.
  const { order: productionOrder, isLoading: productionOrderLoading } =
    useProductionOrderForJobCard(id);
  const stopped = productionOrder ? isProductionOrderStopped(productionOrder.status) : false;
  const { drawing, drawingRef } = useJcDrawing(jc, model);
  const [drawingPreviewOpen, setDrawingPreviewOpen] = useState(false);
  // ADR-212 — the server's Job Card check for the Quantity cluster (same query
  // the detail page reads, so it comes from cache when arriving from there).
  const opFlow = useOpFlow(id);
  // ADR-202 — an edit already waiting for approval on this Job Card. Its
  // per-field changes drive the orange chips in the input cells, and while it
  // waits Save is off: the server keeps ONE open edit per document and refuses
  // a second. Until the check answers Save stays off too.
  const pendingEdit = usePendingEditForDoc('JobCard', id);
  const pendingRows = pendingEdit.data?.rows ?? [];
  const pendingChanges = pendingRows.flatMap((r) => r.changes);
  const hasPendingEdit = pendingRows.length > 0;
  // Also off while the Production Order is still being looked up: until it
  // answers, a short-closed order's card would look editable (no banner is
  // shown for that — only Save waits).
  const saveBlocked = hasPendingEdit || pendingEdit.isLoading || productionOrderLoading;
  const pendingCount = pendingChanges.length || pendingRows.length;

  // Item Code picker searches the SERVER (?search=), like the create form's —
  // a fixed first page (was 500) left every item after it unpickable.
  const [itemSearch, setItemSearch] = useState('');
  const { data: itemsData, isFetching: itemsFetching } = useItemsList({
    ...(itemSearch.trim() ? { search: itemSearch.trim() } : {}),
    limit: 50,
    offset: 0,
  });
  // machines & vendors list-query schemas cap `limit` at 200 — asking for 500
  // makes the route's zod .parse() 400, so the picker got ZERO options and the
  // machine dropdown showed "No matches". Stay within the cap.
  const { data: machinesData } = useMachinesList({ limit: 200, offset: 0 });
  // OSP vendor picker searches the SERVER (same wiring as JobCardForm and SO
  // Planning): the endpoint caps `limit` at 200 and the vendor master runs past
  // that, so a static first page left later vendors unreachable ("No matches").
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
  // Every vendor row seen so far (by code), so an op's picked vendor keeps its
  // "CODE — Name" label after the search page moves on to another row.
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
  // T32a: the edit machine picker now uses the shared SearchableSelect (like
  // create/plan) instead of a datalist, which collapsed on a pre-filled value.
  // Only one row's dropdown is open at a time, so a shared search term is fine.
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

  // ── Editable header (item code, order qty, due date, priority, remarks).
  //    Source, date, drawing and existing QC docs are preserved unchanged from
  //    the model on save (not editable on this screen). ──
  const [itemCode, setItemCode] = useState(model.itemCode);
  const [orderQty, setOrderQty] = useState<string>(String(model.orderQty));
  const [dueDate, setDueDate] = useState(model.dueDate ?? '');
  const [priority, setPriority] = useState<'normal' | 'high'>(model.priority);
  const [remarks, setRemarks] = useState(model.remarks ?? '');

  const [ops, setOps] = useState<EditOp[]>(
    model.ops.map((o) => ({
      rowKey: o.id,
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
    })),
  );

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
  // already-picked vendor that page does not contain (from the rows seen so
  // far), so its "CODE — Name" label and highlight survive a re-search.
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
  const [error, setError] = useState<string | null>(null);
  // ADR-202 — set when an edit to a LIVE Job Card is staged for approval instead
  // of applied; the neutral "Sent for approval" banner shows it before we return
  // to the status page (whose fields now carry the pending-change chips).
  const [stagedNotice, setStagedNotice] = useState<string | null>(null);
  // Which op rows have their ▸ detail open (keyed by each op's stable rowKey,
  // so it follows the op on Move up / down). A freshly added op opens, so its
  // tool / cost fields are in view.
  const [openKeys, setOpenKeys] = useState<Set<string>>(() => new Set());
  const toggleOpen = (key: string): void =>
    setOpenKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  const [balanceOpIdx, setBalanceOpIdx] = useState<number | null>(null);
  const [balanceNote, setBalanceNote] = useState<string | null>(null);
  // Friendly "op line added — fill it in" feedback. addNote is the green
  // banner text; flashKey briefly rings the freshly-added row; the row's ref
  // scrolls it into view inside the table's own scroll box.
  const [addNote, setAddNote] = useState<string | null>(null);
  const [flashKey, setFlashKey] = useState<string | null>(null);
  const scrollToNewOp = useRef(false);
  const newRowRef = useCallback((el: HTMLTableRowElement | null) => {
    if (!el || !scrollToNewOp.current) return;
    scrollToNewOp.current = false;
    el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, []);
  // Timers auto-clear the banner + highlight; cleaned up on unmount / re-fire.
  useEffect(() => {
    if (!addNote) return undefined;
    const t1 = setTimeout(() => setFlashKey(null), 2500);
    const t2 = setTimeout(() => setAddNote(null), 5000);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
    };
  }, [addNote]);

  // Read-only enriched columns + recent logs keyed by op id, so each editable
  // row shows the SAME live progress the view shows.
  const enrichedById = useMemo(() => new Map(enrichedOps.map((o) => [o.id, o])), [enrichedOps]);
  const logsByOp = useMemo(() => {
    const m = new Map<string, OpLog[]>();
    for (const l of logs) {
      const arr = m.get(l.jcOpId) ?? [];
      arr.push(l);
      m.set(l.jcOpId, arr);
    }
    for (const arr of m.values()) arr.sort((a, b) => b.logDate.localeCompare(a.logDate));
    return m;
  }, [logs]);

  const setOp = (i: number, patch: Partial<EditOp>): void => {
    setOps((prev) => prev.map((o, idx) => (idx === i ? { ...o, ...patch } : o)));
  };

  // Picking a machine seeds the row's group from that machine's master group
  // when the Group box is still empty (SO Planning / Route Card parity).
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

  // Picking a group narrows the row's machine list; a machine already picked that
  // is NOT in the new group is cleared, only when the mismatch is PROVEN.
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

  // Group is display-only and not stored, so an op opened for edit (incl. the RW
  // child JC) has an empty group even though its machine belongs to one. Read it
  // back off the master once the machine list is in, for rows with a machine but
  // no group yet — exactly as Route Card does.
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
    const newIdx = ops.length;
    const rowKey = nextEditOpRowKey();
    setOps((prev) => [
      ...prev,
      {
        rowKey,
        // OSP ops carry no machine (T32b); QC parks on the QC lane.
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
      },
    ]);
    // The new row opens, so nothing it needs is hidden behind ▸.
    setOpenKeys((prev) => new Set(prev).add(rowKey));
    const kindLabel = kind === 'qc' ? 'QC' : kind === 'outsource' ? 'Outsource' : 'Machining';
    const need =
      kind === 'qc'
        ? 'pick the QC process'
        : kind === 'outsource'
          ? 'pick a vendor (and operation name)'
          : 'pick a machine and operation name';
    setFlashKey(rowKey);
    scrollToNewOp.current = true;
    setAddNote(`Op ${fmtOpSrNo(newIdx + 1)} (${kindLabel}) added — ${need}, then Save.`);
  };

  const submitting = update.isPending;

  // "No QC directly after OSP" routing rule. Pairs already saved that way on
  // this JC are grandfathered so old cards stay editable; rework/repair
  // children skip the rule (the server appends their terminal QC itself). The
  // live hint above the ops list shows the same message Save / the API raise.
  const allowedPairs = useMemo(() => grandfatheredOspQcPairs(model.ops), [model.ops]);
  const startedIds = useMemo(
    () => new Set(model.ops.filter((o) => o.hasStarted).map((o) => o.id)),
    [model.ops],
  );
  const opsSequenceHint = opsSequenceError(ops, {
    recoveryKind: jc.recoveryKind,
    allowedPairs,
    startedIds,
  });

  // The Order Qty caps the server enforces on this card (service.ts
  // updateJobCardTx), stated in the cell; a typed qty that breaks one turns
  // Save off with the server's own words. PRO Qty only for the card's OWN
  // order — the server reads head.productionOrderId, not a parent's.
  const ownOrder =
    productionOrder && jc.productionOrderId && productionOrder.id === jc.productionOrderId
      ? productionOrder
      : null;
  const qtyRule = jcEditQtyRule({
    jcCode: jc.code,
    savedQty: model.orderQty,
    typedQty: orderQty.trim() === '' ? Number.NaN : Number(orderQty),
    proCode: ownOrder?.code ?? jc.productionOrderCode ?? null,
    proQty: ownOrder?.orderQty ?? null,
    completedQty: model.ops.reduce((m, o) => Math.max(m, o.completedQty), 0),
    issuedNetQty: jc.customerMaterial
      ? Math.max(0, jc.customerMaterial.issuedToJcQty - jc.customerMaterial.returnedToStoreQty)
      : 0,
  });

  const onSave = async (): Promise<void> => {
    // Same gates as the Save button — Ctrl+S cannot slip past them: saving,
    // an edit already waiting (or that check / the Production Order lookup
    // still loading), a stopped order, a qty the server would refuse.
    if (update.isPending || saveBlocked || stopped || qtyRule.error) return;
    setError(null);
    // Shared validation + payload build. Source/date/drawing/docs are carried
    // through from the model unchanged (edit here only touches header + ops).
    const result = buildJcWriteInput({
      isEdit: true,
      jcDate: model.jcDate,
      sourceType: model.sourceSoLineId ? 'so' : model.sourceJwLineId ? 'jw' : null,
      sourceLineId: model.sourceSoLineId ?? model.sourceJwLineId ?? null,
      itemCode,
      orderQty,
      priority,
      dueDate,
      drawingFilePath: model.drawingFilePath,
      remarks,
      // Carried through unchanged — this screen has no raw-material pickers, and
      // omitting them from the payload would blank the JC's grade/size on save.
      rawMaterialGradeId: model.rawMaterialGradeId,
      rawMaterialGradeText: model.rawMaterialGradeText,
      rawMaterialSizeId: model.rawMaterialSizeId,
      rawMaterialSizeText: model.rawMaterialSizeText,
      ops,
      // Existing QC docs already carry ids → filtered out of the write payload
      // (unchanged server-side); no new-doc upload on this screen.
      docs: model.qcDocs.map((d) => ({
        id: d.id,
        docType: d.docType,
        fileName: d.fileName,
        storagePath: d.storagePath,
        fileSize: d.fileSize,
      })),
      recoveryKind: jc.recoveryKind,
      allowedPairs,
      startedIds,
    });
    if (!result.ok) {
      setError(result.error);
      return;
    }
    const payload = result.payload;
    // What the five editable header cells hold now, plus the routing as one
    // digest. The hook diffs this against the card as it was loaded and hands
    // back only the keys that moved.
    const current = {
      itemCode: payload.itemCode,
      orderQty: payload.orderQty,
      dueDate: payload.dueDate ?? null,
      priority: payload.priority,
      remarks: payload.remarks ?? null,
      ops: jcOpsDigest(payload.ops),
    };
    // Only a conflict on THIS save may fill these.
    freshJc.current = null;
    freshOps.current = null;
    try {
      const saved = await conflict.save(current, (changed, expectedUpdatedAt) => {
        // Only reached a second time after a 409. `base` is then the card as it
        // is NOW, so a field this user did not touch is sent with the OTHER
        // person's value rather than the photograph the form opened with — the
        // merge, done here because the server writes the whole header in one
        // unguarded UPDATE (see the note on `freshJc` above).
        const base = freshJc.current;
        const merged = { ...payload, ...(expectedUpdatedAt ? { expectedUpdatedAt } : {}) };
        if (base) {
          if (!('itemCode' in changed)) merged.itemCode = base.itemCode;
          if (!('orderQty' in changed)) merged.orderQty = base.orderQty;
          if (!('dueDate' in changed)) merged.dueDate = base.dueDate;
          if (!('priority' in changed)) merged.priority = base.priority;
          if (!('remarks' in changed)) merged.remarks = base.remarks;
          // The ops are NOT merged (ADR-226) — but if this user never touched
          // them, the other person's routing is what should stand, not ours.
          if (!('ops' in changed) && freshOps.current) merged.ops = freshOps.current;
        }
        return update.mutateAsync(merged);
      });
      // null = nothing on the header changed AND nothing else was sent; the user
      // has been told and nothing was written. Stay on the page.
      if (saved === null) return;
      if (isStagedResult(saved)) {
        // The edit-approval gate is on and this Job Card is live: nothing was
        // changed on the card — the edit is now waiting for approval. Say so,
        // then return to the status page (its fields now carry the chip).
        setStagedNotice('Sent for approval — your changes will apply once an approver signs off.');
        void queryClient.invalidateQueries({ queryKey: jobCardsKeys.detail(id) });
        exit.leave(goBack);
        return;
      }
      void queryClient.invalidateQueries({ queryKey: jobCardsKeys.detail(id) });
      void queryClient.invalidateQueries({ queryKey: opEntryKeys.all });
      exit.leave(goBack);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save Job Card. Try again.');
    }
  };

  // Ctrl+S runs the same Save as the header button. Always bound, so the
  // browser's "Save page as" never opens; onSave's own guard refuses while
  // Save is off.
  useSaveShortcut(() => void onSave());

  // Item Code → item name (dependent field): the saved item's name while the
  // box holds the saved code, else the picked item's from the search page.
  const typedCode = itemCode.trim().toUpperCase();
  const itemName =
    typedCode === model.itemCode.trim().toUpperCase()
      ? jc.itemName
      : (items.find((i) => i.code.toUpperCase() === typedCode)?.name ?? '');

  // Why Save is off, first reason first: a stopped order (the server refuses
  // every edit to its card), then an edit already waiting for approval, then a
  // typed Order Qty the server would refuse.
  const stoppedMessage =
    stopped && productionOrder
      ? `Production Order ${productionOrder.code} was short closed — no further work is allowed on Job Card ${jc.code}.`
      : undefined;
  const saveOffTitle =
    stoppedMessage ?? (hasPendingEdit ? PENDING_EDIT_MESSAGE : (qtyRule.error ?? undefined));
  const pendingNote = `${pendingCount} change${
    pendingCount === 1 ? '' : 's'
  } waiting for approval · Save is off until it is decided`;

  return (
    <div className="page-fill jc-detail jc-edit">
      {exit.dialog}
      <DetailHeader
        backLabel="Back"
        backTo="/job-cards"
        renderLink={(p) => <Link {...p} />}
        code={jc.code}
        // One header line, as on the detail page: code · page name · status.
        badges={
          <>
            <span className="panel-title">Edit Job Card</span>
            <JcStatusBadge status={jc.computedStatus} />
          </>
        }
        actions={
          <>
            {hasPendingEdit ? (
              <span className="jc-edit-pend" role="status" title={PENDING_EDIT_MESSAGE}>
                {pendingNote}
              </span>
            ) : null}
            <Link
              to="/job-cards/$id"
              params={{ id }}
              className="btn btn-ghost btn-sm"
              onClick={exit.allow}
            >
              Cancel
            </Link>
            {/* The wrapper carries the hover text: a disabled button gets none. */}
            <span title={saveOffTitle}>
              <button
                type="button"
                className="btn btn-primary btn-sm"
                disabled={submitting || saveBlocked || stopped || Boolean(qtyRule.error)}
                title={saveOffTitle}
                onClick={() => void onSave()}
              >
                {submitting ? (
                  <>
                    <Loader2 size={13} className="animate-spin" /> Saving…
                  </>
                ) : (
                  'Save Changes'
                )}
              </button>
            </span>
          </>
        }
      >
        {stagedNotice ? (
          <Banner tone="success" role="status">
            {stagedNotice}
          </Banner>
        ) : null}
        <JcStoppedBanner order={productionOrder} />
        <RecoveryBanner jc={jc} />
        <JcEditFactBlock
          jc={jc}
          productionOrder={productionOrder}
          drawing={drawingRef}
          onOpenDrawing={() => setDrawingPreviewOpen(true)}
          pendingChanges={pendingChanges}
          check={opFlow.data?.jobCardCheck}
          checkError={opFlow.isError}
          typedOrderQty={Number(orderQty)}
          itemName={itemName}
          qtyRule={qtyRule}
          fields={{
            // Stores the item CODE, exactly as before; the label comes from
            // the code itself so it survives the search page moving on.
            item: (
              <SearchableSelect
                id="jc-edit-item"
                value={items.find((i) => i.code.toUpperCase() === typedCode)?.id ?? null}
                onChange={(pickedId) =>
                  setItemCode(items.find((i) => i.id === pickedId)?.code ?? '')
                }
                onSearch={setItemSearch}
                loading={itemsFetching}
                options={items.map((i) => ({ id: i.id, code: i.code, name: i.name }))}
                valueLabel={itemCode || undefined}
                selectedLabel={(o) => o.code ?? o.name}
                placeholder="🔍 Search item code or name…"
              />
            ),
            dueDate: (
              <input
                id="jc-edit-due"
                type="date"
                className="innovic-input jc-in-date"
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
              />
            ),
            priority: (
              <select
                id="jc-edit-priority"
                className="innovic-select jc-in-sel"
                value={priority}
                onChange={(e) => setPriority(e.target.value as 'normal' | 'high')}
              >
                <option value="normal">Normal</option>
                <option value="high">High</option>
              </select>
            ),
            orderQty: (
              <input
                id="jc-edit-qty"
                type="number"
                min={1}
                className="innovic-input jc-in-qty"
                value={orderQty}
                onChange={(e) => setOrderQty(e.target.value)}
              />
            ),
            remarks: (
              <textarea
                id="jc-edit-remarks"
                className="innovic-textarea"
                rows={1}
                value={remarks}
                onChange={(e) => setRemarks(e.target.value)}
              />
            ),
          }}
        />
      </DetailHeader>
      {drawingPreviewOpen && drawing ? (
        <FilePreviewModal
          storagePath={drawing.path}
          kind="drawing"
          source={drawing.source}
          refCode={jc.code}
          onClose={() => setDrawingPreviewOpen(false)}
        />
      ) : null}

      {error ? <Banner tone="error">{error}</Banner> : null}
      {balanceNote ? <Banner tone="success">{balanceNote}</Banner> : null}
      {addNote ? <Banner tone="success">{addNote}</Banner> : null}
      {/* The live "no QC directly after OSP" hint — the same message Save and
          the API raise. */}
      {opsSequenceHint ? (
        <Banner tone="error" role="alert">
          {opsSequenceHint}
        </Banner>
      ) : null}

      <JcEditOpsTable
        ops={ops}
        enrichedById={enrichedById}
        logsByOp={logsByOp}
        shared={{
          machines,
          machineOptions,
          machineGroupCodeById,
          onMachineSearch: setMachineSearch,
          vendorOptions,
          onVendorSearch: setVendorSearch,
          vendorsLoading: vendorsFetching,
        }}
        openKeys={openKeys}
        flashKey={flashKey}
        newRowRef={newRowRef}
        onToggle={toggleOpen}
        onAdd={addOp}
        onChange={setOp}
        onMachineChange={onOpMachineChange}
        onGroupChange={onOpGroupChange}
        onMove={moveOp}
        onRemove={(i) => setOps((prev) => prev.filter((_, idx) => idx !== i))}
        onOutsourceBalance={(i) => {
          setBalanceNote(null);
          setBalanceOpIdx(i);
        }}
      />

      {balanceOpIdx !== null && ops[balanceOpIdx]?.id ? (
        <OutsourceBalanceModal
          jcId={id}
          jcCode={model.code}
          opId={ops[balanceOpIdx]!.id!}
          opSeq={enrichedById.get(ops[balanceOpIdx]!.id!)?.opSeq ?? balanceOpIdx + 1}
          operation={ops[balanceOpIdx]!.operation}
          itemCode={itemCode}
          itemRevision={jc.itemRevision}
          available={ops[balanceOpIdx]!.available}
          defaultVendorCode={ops[balanceOpIdx]!.outsourceVendorCode}
          onClose={() => setBalanceOpIdx(null)}
          onDone={(qtyDone) => {
            const idx = balanceOpIdx;
            const op = ops[idx];
            if (op) setOp(idx, { available: Math.max(0, op.available - qtyDone) });
            const seq = (op?.id ? enrichedById.get(op.id)?.opSeq : undefined) ?? idx + 1;
            setBalanceNote(`Outsource PR raised for ${qtyDone} pcs (Op ${fmtOpSrNo(seq)}).`);
            setBalanceOpIdx(null);
          }}
        />
      ) : null}
    </div>
  );
}
