// JC Status content — the mode dispatcher plus the EDIT body.
//
// VIEW mode (the read-only status page, laid out to the 2026-09-18 mockup)
// lives in jc-status-view.tsx. EDIT mode below is unchanged: the same summary
// card (JcStatTiles) + editable header + editable op cards, reusing the JC
// create/edit save logic. The rework/repair banner both modes show is in
// jc-recovery-banner.tsx.
import type {
  JcOpEnriched,
  JobCardEditModel,
  JobCardListItem,
  JobCardStatusExtras,
  ListVendorsQuery,
  ListVendorsResponse,
  OpLog,
} from '@innovic/shared';
import { fmtOpSrNo } from '@innovic/shared';
import { Link, useNavigate } from '@tanstack/react-router';
import { Loader2 } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQueries, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api';
import { useExitConfirm } from '@/lib/exit-guard';
import { useItemsList } from '@/modules/items/api';
import { useMachineGroupsList, useMachinesList } from '@/modules/machines/api';
import { useVendorsList, vendorsKeys } from '@/modules/vendors/api';
import { opEntryKeys, useJcOpsEnriched, useOpLog } from '@/modules/op-entry/api';
import {
  jobCardsKeys,
  useJobCard,
  useJobCardEditModel,
  useJobCardStatusExtras,
  useUpdateJobCard,
} from '../api';
import { JcStatTiles } from './jc-stat-tiles';
import { JcOpEditCard, type JcOpEditValues } from './jc-op-edit-card';
import { OutsourceBalanceModal } from './outsource-balance-modal';
import { RecoveryBanner } from './jc-recovery-banner';
import { JcStatusViewContent } from './jc-status-view';
import {
  buildJcWriteInput,
  grandfatheredOspQcPairs,
  opsSequenceError,
} from '../lib/build-jc-write-input';

// Mode dispatcher. VIEW mode renders the read-only status body
// (jc-status-view.tsx). EDIT mode renders the same sections (tiles +
// operation flow + operations table) with the editable fields, reusing the JC
// create/edit save logic. No hooks here → the branch is safe for rules-of-hooks.
export function JcStatusContent({
  id,
  mode = 'view',
}: {
  id: string;
  mode?: 'view' | 'edit';
}): React.JSX.Element {
  if (mode === 'edit') return <JcStatusEditContent id={id} />;
  return <JcStatusViewContent id={id} />;
}

// ─── EDIT MODE ──────────────────────────────────────────────────────────────
// Same sections as the view (tiles + operation flow + operations table) with
// editable header + op cells. Reuses the JC create/edit save logic
// (buildJcWriteInput + useUpdateJobCard), the shared OutsourceBalanceModal +
// useOutsourceOpBalance, and the OP_STATUS map — no reinvented logic.

/** Editable op row shape — now shared with the editable op card
 *  (`JcOpEditValues`, jc-op-edit-card.tsx). Same fields as before; only the
 *  declaration moved so the card and this screen cannot drift. */
type EditOp = JcOpEditValues;

// Loader: fetches the editable model + the read-only enriched ops/logs/extras,
// then renders the form once everything resolves (so the form seeds its state
// from props, exactly like job-card-form seeds from its `model` prop).
function JcStatusEditContent({ id }: { id: string }): React.JSX.Element {
  const { data: jc, isLoading, isError, error } = useJobCard(id);
  const { data: model, isLoading: modelLoading, isError: modelError } = useJobCardEditModel(id);
  const { data: enrichedOps = [] } = useJcOpsEnriched({ jobCardId: id }, { enabled: Boolean(id) });
  const { data: logs = [] } = useOpLog({ jobCardId: id, limit: 300 }, { enabled: Boolean(id) });
  const { data: extras } = useJobCardStatusExtras(id);

  if (isLoading || modelLoading) {
    return (
      <div className="empty-state">
        <Loader2 className="inline h-4 w-4 animate-spin" /> Loading job card…
      </div>
    );
  }
  if (isError || modelError || !jc || !model) {
    return (
      <div className="empty-state" style={{ color: 'var(--red)' }}>
        {error instanceof Error ? error.message : 'Job card not found'}
      </div>
    );
  }
  return (
    <JcStatusEditForm
      id={id}
      jc={jc}
      model={model}
      enrichedOps={enrichedOps}
      logs={logs}
      extras={extras}
    />
  );
}

function JcStatusEditForm({
  id,
  jc,
  model,
  enrichedOps,
  logs,
  extras,
}: {
  id: string;
  jc: JobCardListItem;
  model: JobCardEditModel;
  enrichedOps: JcOpEnriched[];
  logs: OpLog[];
  extras: JobCardStatusExtras | undefined;
}): React.JSX.Element {
  const navigate = useNavigate();
  const goBack = useCallback(
    () => void navigate({ to: '/job-cards/$id', params: { id } }),
    [navigate, id],
  );
  const exit = useExitConfirm({ onExit: goBack });
  const queryClient = useQueryClient();
  const update = useUpdateJobCard(id);

  const { data: itemsData } = useItemsList({ limit: 500, offset: 0 });
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
  const [detailOpen, setDetailOpen] = useState(true);
  const [balanceOpIdx, setBalanceOpIdx] = useState<number | null>(null);
  const [balanceNote, setBalanceNote] = useState<string | null>(null);
  // Friendly "op line added — fill it in" feedback. addNote is the green
  // banner text; flashIdx briefly rings the freshly-added card; opsEndRef is
  // the scroll target so the new line is never left below the fold.
  const [addNote, setAddNote] = useState<string | null>(null);
  const [flashIdx, setFlashIdx] = useState<number | null>(null);
  const opsEndRef = useRef<HTMLDivElement | null>(null);
  const scrollToNewOp = useRef(false);
  // After a new op is appended and the section is open, scroll it into view.
  // Runs post-render so the new card exists in the DOM. Timers auto-clear the
  // banner + highlight; the effect cleans them up on unmount / re-fire.
  useEffect(() => {
    if (!scrollToNewOp.current) return;
    scrollToNewOp.current = false;
    opsEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    const t1 = setTimeout(() => setFlashIdx(null), 2500);
    const t2 = setTimeout(() => setAddNote(null), 5000);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
    };
  }, [addNote]);

  // Read-only enriched columns + recent logs (from the JC Status view) keyed by
  // op id, so each editable row shows the SAME live progress the view shows.
  const enrichedById = useMemo(() => new Map(enrichedOps.map((o) => [o.id, o])), [enrichedOps]);
  const sortedEnriched = useMemo(
    () => [...enrichedOps].sort((a, b) => a.opSeq - b.opSeq),
    [enrichedOps],
  );
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
  const opExtraById = useMemo(
    () => new Map((extras?.opExtras ?? []).map((e) => [e.jcOpId, e])),
    [extras?.opExtras],
  );

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
    let newPos = 0;
    setOps((prev) => {
      newPos = prev.length + 1;
      return [
        ...prev,
        {
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
      ];
    });
    // Never leave the new line hidden behind a collapsed section.
    setDetailOpen(true);
    const kindLabel = kind === 'qc' ? 'QC' : kind === 'outsource' ? 'OSP' : 'machining';
    const need =
      kind === 'qc'
        ? 'pick the QC process'
        : kind === 'outsource'
          ? 'pick a vendor (and operation name)'
          : 'pick a machine and operation name';
    setFlashIdx(newPos - 1);
    scrollToNewOp.current = true;
    setAddNote(`✅ Op line #${newPos} (${kindLabel}) added below — now ${need}, then Save.`);
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

  const onSave = async (): Promise<void> => {
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
    try {
      await update.mutateAsync(result.payload);
      void queryClient.invalidateQueries({ queryKey: jobCardsKeys.detail(id) });
      void queryClient.invalidateQueries({ queryKey: opEntryKeys.all });
      exit.leave(goBack);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed');
    }
  };

  const opCount = ops.filter((o) => o.opType !== 'qc').length;
  const qcCount = ops.filter((o) => o.opType === 'qc').length;

  return (
    <div>
      {exit.dialog}
      <RecoveryBanner jc={jc} />
      <datalist id="dlJcEditItem">
        {items.map((i) => (
          <option key={i.id} value={i.code}>
            {i.code} — {i.name}
          </option>
        ))}
      </datalist>

      {/* Same consolidated summary card as the view — shared JcStatTiles. */}
      <JcStatTiles
        jc={jc}
        ops={enrichedOps}
        rmAvailable={extras?.rmAvailable ?? null}
        sortedOps={sortedEnriched}
        opExtraById={opExtraById}
      />

      {/* Editable header fields */}
      <div className="panel" style={{ marginBottom: 12 }}>
        <div className="panel-hdr">
          <div className="panel-title">▸ Job Card Details</div>
        </div>
        <div className="panel-body">
          <div className="form-grid">
            <div className="form-grp">
              <label className="form-label">JC No.</label>
              <input className="innovic-input" value={model.code} readOnly />
            </div>
            <div className="form-grp">
              <label className="form-label">Priority</label>
              <select
                className="innovic-select"
                value={priority}
                onChange={(e) => setPriority(e.target.value as 'normal' | 'high')}
              >
                <option value="normal">Normal</option>
                <option value="high">High</option>
              </select>
            </div>
            <div className="form-grp form-full">
              <label className="form-label">
                Item Code <span className="req">★</span>
              </label>
              <input
                className="innovic-input"
                list="dlJcEditItem"
                value={itemCode}
                placeholder="🔍 Search item code or name…"
                onChange={(e) => setItemCode(e.target.value)}
              />
            </div>
            <div className="form-grp">
              <label className="form-label">
                Order Qty <span className="req">★</span>
              </label>
              <input
                type="number"
                min={1}
                className="innovic-input"
                value={orderQty}
                onChange={(e) => setOrderQty(e.target.value)}
              />
            </div>
            <div className="form-grp">
              <label className="form-label">Due Date</label>
              <input
                type="date"
                className="innovic-input"
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
              />
            </div>
            <div className="form-grp form-full">
              <label className="form-label">Remarks</label>
              <textarea
                className="innovic-textarea"
                rows={2}
                value={remarks}
                onChange={(e) => setRemarks(e.target.value)}
                placeholder="Optional notes for this job card"
              />
            </div>
          </div>
        </div>
      </div>

      {/* OPERATIONS DETAIL — same table as the view, with editable cells for
          Machine/Operation/Cycle/Prog-Tool/QC/Outsource. The qty/status/logs
          columns stay READ-ONLY from the enriched ops. */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <button
          type="button"
          onClick={() => setDetailOpen((v) => !v)}
          className="mono"
          style={{
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            fontSize: 11,
            color: 'var(--cyan)',
            fontWeight: 700,
            letterSpacing: '.08em',
            textTransform: 'uppercase',
            marginBottom: 8,
            padding: 0,
          }}
        >
          {detailOpen ? '▾' : '▸'} Operations Detail
        </button>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
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
            style={{ color: 'var(--green)', border: '1px solid rgba(34,197,94,0.3)' }}
            onClick={() => addOp('qc')}
          >
            + Add QC Op
          </button>
          <button
            type="button"
            className="btn btn-sm"
            style={{ color: 'var(--amber)', border: '1px solid rgba(245,158,11,0.4)' }}
            onClick={() => addOp('outsource')}
          >
            + Add OSP Op
          </button>
        </div>
      </div>
      {addNote ? (
        <div
          role="status"
          style={{
            color: 'var(--green)',
            background: 'rgba(34,197,94,0.08)',
            border: '1px solid rgba(34,197,94,0.3)',
            borderRadius: 6,
            padding: '6px 10px',
            fontSize: 12,
            fontWeight: 600,
            marginBottom: 10,
          }}
        >
          {addNote}
        </div>
      ) : null}
      {detailOpen && opsSequenceHint ? (
        <div
          role="alert"
          style={{
            color: 'var(--red)',
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
      {detailOpen ? (
        <div style={{ marginBottom: 16 }}>
          {ops.length === 0 ? (
            <div className="panel">
              <div className="empty-state">
                No operations — click “+ Add Op”, “+ Add QC Op”, or “+ Add OSP Op”.
              </div>
            </div>
          ) : (
            ops.map((o, i) => {
              const en = o.id ? enrichedById.get(o.id) : undefined;
              return (
                <div
                  key={o.id ?? `new-${i}`}
                  style={
                    flashIdx === i
                      ? {
                          borderRadius: 12,
                          boxShadow: '0 0 0 2px var(--amber)',
                          transition: 'box-shadow .3s',
                        }
                      : { transition: 'box-shadow .3s' }
                  }
                >
                  <JcOpEditCard
                    jc={jc}
                    op={o}
                    index={i}
                    seqLabel={en ? en.opSeq : i + 1}
                    enriched={en}
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
                    logs={o.id ? (logsByOp.get(o.id) ?? []).slice(0, 3) : []}
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
                </div>
              );
            })
          )}
          {/* Scroll target: the effect scrolls here after a new op is added. */}
          <div ref={opsEndRef} />
        </div>
      ) : null}

      {error ? (
        <div
          style={{
            color: 'var(--red)',
            background: 'var(--red3)',
            border: '1px solid #fca5a5',
            borderRadius: 6,
            padding: '6px 10px',
            fontSize: 12,
            marginBottom: 10,
          }}
        >
          {error}
        </div>
      ) : null}

      {balanceNote ? (
        <div
          style={{
            color: 'var(--green)',
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
          jcId={id}
          jcCode={model.code}
          opId={ops[balanceOpIdx]!.id!}
          opSeq={enrichedById.get(ops[balanceOpIdx]!.id!)?.opSeq ?? balanceOpIdx + 1}
          operation={ops[balanceOpIdx]!.operation}
          itemCode={itemCode}
          available={ops[balanceOpIdx]!.available}
          defaultVendorCode={ops[balanceOpIdx]!.outsourceVendorCode}
          onClose={() => setBalanceOpIdx(null)}
          onDone={(qtyDone) => {
            const idx = balanceOpIdx;
            const op = ops[idx];
            if (op) setOp(idx, { available: Math.max(0, op.available - qtyDone) });
            setBalanceNote(
              `Outsourced ${qtyDone} pc(s) from Op${fmtOpSrNo(idx + 1)} — JW OSP purchase request raised.`,
            );
            setBalanceOpIdx(null);
          }}
        />
      ) : null}

      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 6 }}>
        <Link to="/job-cards/$id" params={{ id }} className="btn btn-ghost" onClick={exit.allow}>
          Cancel
        </Link>
        <button
          type="button"
          className="btn btn-success"
          disabled={submitting}
          onClick={() => void onSave()}
        >
          {submitting ? <Loader2 size={13} className="animate-spin" /> : null} ✓ Save Job Card
        </button>
      </div>
    </div>
  );
}
