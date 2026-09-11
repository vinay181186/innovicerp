// Edit Plan modal (PL-4b §5). Large modal with 3-tab type picker, ops table
// (process/QC/OSP), Full Outsource section, Direct Purchase section, and
// Required QC Documents section. Mirrors legacy editPlan (HTML L9500).
//
// Save Draft vs. ✓ Save Plan:
//   Save Draft  → updatePlan() only, status stays in_planning. NOT in legacy —
//                 legacy's single save always transitions to Planned. Kept.
//   ✓ Save Plan → updatePlan() + finalizePlan(), status → planned. This is the
//                 legacy button (showModalLg saveLabel 'Save Plan', L9765).
// Once status is jc_created / pr_created / etc., the parent doesn't open
// this modal (uses view-only navigation instead).

import type {
  PlanDetail,
  PlanOpInput,
  PlanRequiredDoc,
  PlanType,
  UpdatePlanInput,
} from '@innovic/shared';
import { Loader2 } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { SearchableSelect } from '@/components/shared/searchable-select';
import { addDaysLocal, todayLocal } from '@/lib/date';
import { itemCodeWithRev } from '@/lib/item-code';
import { PLAN_DEFAULT_SPAN_DAYS } from '@/modules/plans/components/plan-form';
import {
  MaterialGradePicker,
  MaterialSizePicker,
} from '@/modules/raw-material/components/raw-material-pickers';
import { useCostCentersList } from '@/modules/cost-centers/api';
import {
  MACHINE_GROUP_LIST_LIMIT,
  useMachineGroupsList,
  useMachinesList,
} from '@/modules/machines/api';
import { MachineGroupPicker } from '@/modules/machines/components/machine-group-picker';
import { useFinalizePlan, useUpdatePlan, useDefaultRouteOps } from '@/modules/plans/api';
import { useQcProcessesList } from '@/modules/qc-processes/api';
import { useVendorsList } from '@/modules/vendors/api';
import { Modal } from './modal';

interface Props {
  plan: PlanDetail;
  onClose: () => void;
  /** Called after successful Save (with or without Finalize). */
  onSaved: () => void;
}

// The routing row as this modal holds it: the saved shape plus two fields that
// never leave the browser.
//
// `machineGroupId` is DISPLAY-ONLY. plan_ops has no machine_group_id column, so
// the group is not a thing a plan can store — it exists here purely to narrow the
// Machine picker down to one family of machines (VMC, CNC, Lathe…) before the
// planner picks the machine itself. buildPayload() must never send it; if it is
// ever added to the payload the server will reject the whole save.
type OpRow = PlanOpInput & { uid: string; machineGroupId?: string | null };

const DOC_PRESETS_FALLBACK = [
  'Dimensional Inspection Report',
  'First Article Inspection (FAI)',
  'Material Test Certificate (MTC)',
  'Surface Finish Report',
  'Visual Inspection Report',
];

function uid(): string {
  return Math.random().toString(36).slice(2);
}

// The five route-card fields (machineId / program / toolNo / toolDetails /
// outsourceVendorId) are CARRIED through this modal, never edited in it — the
// user enters them on the Route Card. Reading them here and writing them back
// in buildPayload() is what stops a plan edit blanking them.
function planOpToRow(op: {
  opSeq: number;
  operation: string;
  opType: string;
  machineId: string | null;
  machineCodeText: string | null;
  cycleTimeMin: string;
  program: string | null;
  toolNo: string | null;
  toolDetails: string | null;
  outsourceVendorId: string | null;
  outsourceVendorText: string | null;
  outsourceCost: string | null;
  qcRequired: boolean;
}): OpRow {
  return {
    uid: uid(),
    opSeq: op.opSeq,
    operation: op.operation,
    opType: (op.opType ?? 'process') as PlanOpInput['opType'],
    machineId: op.machineId,
    machineCodeText: op.machineCodeText ?? '',
    cycleTimeMin: Number(op.cycleTimeMin),
    program: op.program,
    toolNo: op.toolNo,
    toolDetails: op.toolDetails,
    qcRequired: op.qcRequired,
    outsourceVendorId: op.outsourceVendorId,
    outsourceVendorText: op.outsourceVendorText ?? '',
    outsourceCost: Number(op.outsourceCost ?? 0),
  };
}

export function EditPlanModal({ plan, onClose, onSaved }: Props): JSX.Element {
  const [planQty, setPlanQty] = useState<number>(plan.planQty);
  const [planType, setPlanType] = useState<PlanType>(plan.planType);
  // Direct Purchase means "buy the finished item outright" — meaningless for a
  // job-work order (the client owns the job + supplies the material), so the
  // option is hidden for JWSO-sourced plans. Server also rejects it (createPlan
  // /updatePlan) so a direct API call can't set it either.
  const isJw = plan.jwLineId != null;
  // An undated plan opens on today .. today+5 rather than on two blank boxes.
  // A plan that already carries dates keeps exactly what it was saved with —
  // the default fills a gap, it never overwrites a planner's own dates.
  const [plannedStartDate, setPlannedStartDate] = useState<string>(
    plan.plannedStartDate || todayLocal(),
  );
  const [plannedEndDate, setPlannedEndDate] = useState<string>(
    plan.plannedEndDate || addDaysLocal(plan.plannedStartDate || todayLocal(), PLAN_DEFAULT_SPAN_DAYS),
  );
  const [remarks, setRemarks] = useState<string>(plan.remarks ?? '');
  // Raw material — two INDEPENDENT master pickers, both optional (no ★). The
  // id is the link; the *Text snapshot is what this plan still prints after the
  // master row is renamed or deactivated, so both are stored together.
  const [rmGradeId, setRmGradeId] = useState<string | null>(plan.rawMaterialGradeId);
  const [rmGradeText, setRmGradeText] = useState<string | null>(plan.rawMaterialGradeText);
  const [rmSizeId, setRmSizeId] = useState<string | null>(plan.rawMaterialSizeId);
  const [rmSizeText, setRmSizeText] = useState<string | null>(plan.rawMaterialSizeText);

  // Manufacture / ops
  const [ops, setOps] = useState<OpRow[]>(() => plan.ops.map(planOpToRow));

  // Full Outsource
  const [foVendor, setFoVendor] = useState<string>(plan.foVendorCodeText ?? '');
  const [foRate, setFoRate] = useState<number | null>(plan.foRate ? Number(plan.foRate) : null);
  const [foProcess, setFoProcess] = useState<string>(plan.foProcess ?? '');
  // ADR-095: material source is no longer collected — always written as null.
  const [foDeliveryDate, setFoDeliveryDate] = useState<string>(plan.foDeliveryDate ?? '');
  const [foCostCenter, setFoCostCenter] = useState<string>(plan.foCostCenter ?? '');
  const [foRemarks, setFoRemarks] = useState<string>(plan.foRemarks ?? '');

  // Direct Purchase
  const [dpVendor, setDpVendor] = useState<string>(plan.dpVendorCodeText ?? '');
  const [dpCost, setDpCost] = useState<number | null>(plan.dpCost ? Number(plan.dpCost) : null);
  const [dpRemarks, setDpRemarks] = useState<string>(plan.dpRemarks ?? '');

  // Required QC Docs
  const [requiredDocs, setRequiredDocs] = useState<PlanRequiredDoc[]>(() =>
    Array.isArray(plan.requiredDocs) ? plan.requiredDocs : [],
  );

  const [err, setErr] = useState<string | null>(null);

  const update = useUpdatePlan(plan.id);
  const finalize = useFinalizePlan();

  // Searchable master pickers (server-searched via ?search=; one shared search
  // term per master, like the SO line table). Machine ← Machine Master,
  // Vendor ← Vendor Master.
  const [machineSearch, setMachineSearch] = useState('');
  const machines = useMachinesList({
    ...(machineSearch.trim() ? { search: machineSearch.trim() } : {}),
    // 200 (the endpoint's documented cap) rather than 50: the Machine picker is
    // now narrowed to the chosen Machine Group in the browser, over whatever
    // rows this one hook returned. On 50 rows a group whose machines all sat on
    // page 2 would look empty, which reads as "this group has no machines".
    limit: 200,
    offset: 0,
  });
  const [vendorSearch, setVendorSearch] = useState('');
  const vendors = useVendorsList({
    ...(vendorSearch.trim() ? { search: vendorSearch.trim() } : {}),
    // 200 (the endpoint's cap) rather than 50: the vendor master runs to several
    // hundred rows, so browsing without typing showed a thin and arbitrary slice.
    // Typing is still what finds a specific vendor — the search goes to the
    // server — but a wider first page makes the list worth opening.
    limit: 200,
    offset: 0,
  });
  // The full machine rows, not just the three picker fields: the Machine Group
  // narrowing and the group seeding both read `machineGroupId` off the master.
  const machineRows = useMemo(() => machines.data?.machines ?? [], [machines.data]);
  const machineOpts = useMemo(
    () => machineRows.map((m) => ({ id: m.id, code: m.code, name: m.name })),
    [machineRows],
  );
  const vendorOpts = useMemo(
    () => (vendors.data?.vendors ?? []).map((v) => ({ id: v.id, code: v.code, name: v.name })),
    [vendors.data],
  );
  const machineById = useMemo(() => new Map(machineRows.map((m) => [m.id, m])), [machineRows]);
  // A plan op stores the machine CODE snapshot and may carry a null machineId
  // (older rows, and anything typed before the picker existed), so the machine
  // has to be findable by either key.
  const machineByCode = useMemo(() => new Map(machineRows.map((m) => [m.code, m])), [machineRows]);
  const vendorById = useMemo(() => new Map(vendorOpts.map((o) => [o.id, o])), [vendorOpts]);
  const machineIdByCode = (code: string): string | null => machineByCode.get(code)?.id ?? null;

  // The whole Machine Group master in one fetch — groups scroll, they do not
  // paginate. This is only a NAME lookup: the picker shows the text it is handed
  // until it is opened, so a group recovered from the machine master would sit in
  // the box as an invisible id and the row would look ungrouped. Deliberately NOT
  // filtered to active groups, so a machine still linked to a retired group keeps
  // showing which group that was.
  const machineGroups = useMachineGroupsList({
    limit: MACHINE_GROUP_LIST_LIMIT,
    offset: 0,
  });
  const machineGroupCodeById = useMemo(
    () => new Map((machineGroups.data?.groups ?? []).map((g) => [g.id, g.code])),
    [machineGroups.data],
  );
  const vendorIdByCode = (code: string): string | null =>
    vendorOpts.find((v) => v.code === code)?.id ?? null;

  // What a picked row reads as once the box is closed: "CODE — Name", the shape
  // <SearchableSelect> uses in its own dropdown. These fields used to collapse to
  // the bare code, which meant picking a vendor and then reading the row back
  // gave you an identifier and no way to tell whether it was the right firm
  // without opening the list again.
  //
  // Only the CODE is stored on the op, so the name has to be recovered from the
  // master. When it cannot be — the row is not in the page this hook fetched —
  // the code alone is shown, exactly as before. A missing name degrades the
  // label; it never blanks the field.
  const codeAndName = (o: { code?: string | null; name: string } | undefined): string | undefined =>
    o ? (o.code ? `${o.code} — ${o.name}` : o.name) : undefined;

  const vendorLabelOf = (o: OpRow): string | undefined => {
    const id = o.outsourceVendorId ?? vendorIdByCode(o.outsourceVendorText ?? '');
    return codeAndName(id ? vendorById.get(id) : undefined) ?? o.outsourceVendorText ?? undefined;
  };

  // Heal a plan that carries only the vendor FK and no code snapshot. Plans
  // raised by the BOM planning modal before it sent the code arrive that way,
  // and validate() reads the code — so the modal refused to save with
  // "Select a vendor for direct purchase" on a plan that plainly had a vendor.
  // Fill the code in from the id the moment the vendor list can resolve it.
  useEffect(() => {
    if (vendorById.size === 0) return;
    if (!dpVendor && plan.dpVendorId) {
      const v = vendorById.get(plan.dpVendorId);
      if (v) setDpVendor(v.code);
    }
    if (!foVendor && plan.foVendorId) {
      const v = vendorById.get(plan.foVendorId);
      if (v) setFoVendor(v.code);
    }
    // dpVendor/foVendor are deliberately not dependencies: this only ever fills
    // a BLANK one, and re-running on every keystroke would fight the user.
  }, [vendorById, plan.dpVendorId, plan.foVendorId, dpVendor, foVendor]);

  // Which machine master row an op is pointing at, by id first and by the stored
  // code snapshot second.
  const machineOfOp = (o: OpRow) =>
    (o.machineId ? machineById.get(o.machineId) : undefined) ??
    (o.machineCodeText ? machineByCode.get(o.machineCodeText) : undefined);

  // Defined after machineOfOp because it reads it. See codeAndName above for why
  // these labels carry the name as well as the code.
  const machineLabelOf = (o: OpRow): string | undefined =>
    codeAndName(machineOfOp(o)) ?? o.machineCodeText ?? undefined;

  // Fill in the Machine Group for ops that arrived with a machine already on
  // them. The group is not stored on the plan, so the only way to show one on a
  // saved op is to look its machine up in the machine master and read the group
  // off there.
  //
  // Best-effort on purpose. A machine that is not in the page of rows this hook
  // returned (the planner has typed a search term, or the master is larger than
  // the 200 fetched) leaves the Group box blank and the op keeps its machine
  // exactly as saved — a group we could not display must never cost the user
  // the machine that IS on the op.
  //
  // `undefined` means "not resolved yet, try again when more rows arrive";
  // `null` means "resolved, and this machine has no group" — or the planner
  // cleared the box by hand. Only `undefined` rows are ever touched, so this
  // cannot fight a choice the planner has made.
  useEffect(() => {
    if (machineById.size === 0) return;
    setOps((prev) => {
      let changed = false;
      const next = prev.map((o) => {
        // QC rows are skipped: they carry the literal 'QC' as their machine
        // text, which is not a machine and has no group to find.
        if (o.opType === 'qc' || o.machineGroupId !== undefined) return o;
        const m = machineOfOp(o);
        if (!m) return o;
        changed = true;
        return { ...o, machineGroupId: m.machineGroupId };
      });
      return changed ? next : prev;
    });
    // machineOfOp is derived from exactly these two maps, so they are the real
    // dependencies; listing the function itself would re-run this on every render.
    // Deliberately no eslint-disable directive here: the react-hooks plugin is
    // not registered in this branch's config, so naming its rule is itself a
    // lint ERROR ("Definition for rule ... was not found").
  }, [machineById, machineByCode]);

  // Datalists
  const costCenters = useCostCentersList({ limit: 200, offset: 0 });
  // Active only. Inactive is how a QC stage is retired without breaking the
  // documents that already name it (deleting one that is in use is refused by
  // the server), so an inactive process must not remain pickable for new work.
  const qcProcesses = useQcProcessesList({ isActive: true, limit: 200, offset: 0 });
  const docPresets = useMemo(() => DOC_PRESETS_FALLBACK, []);
  const defaultOpsQuery = useDefaultRouteOps(plan.itemId);

  // How many ops this modal filled in from the route card, or null if it did
  // not fill any in (the plan already had its own ops). Only used for the
  // "N operations loaded" line — it never reaches the save payload.
  const [autoLoadedCount, setAutoLoadedCount] = useState<number | null>(null);

  // Recompute ops when defaultOpsQuery resolves on first load AND the plan
  // currently has zero ops (initial blank state from chained-from-create).
  useEffect(() => {
    const incoming = (defaultOpsQuery.data?.ops ?? []) as PlanOpInput[];
    if (ops.length === 0 && incoming.length > 0) {
      setAutoLoadedCount(incoming.length);
      setOps(
        incoming.map((op) => ({
          uid: uid(),
          ...op,
          machineCodeText: op.machineCodeText ?? '',
          outsourceVendorText: op.outsourceVendorText ?? '',
          outsourceCost: op.outsourceCost ?? 0,
          cycleTimeMin: op.cycleTimeMin ?? 0,
          opType: op.opType ?? 'process',
          qcRequired: op.qcRequired ?? false,
          operation: op.operation,
          opSeq: op.opSeq,
        })),
      );
    }
  }, [defaultOpsQuery.data, ops.length]);

  const buildPayload = (): UpdatePlanInput => ({
    planType,
    planQty,
    plannedStartDate: plannedStartDate || null,
    plannedEndDate: plannedEndDate || null,
    remarks: remarks || null,
    rawMaterialGradeId: rmGradeId,
    rawMaterialGradeText: rmGradeText,
    rawMaterialSizeId: rmSizeId,
    rawMaterialSizeText: rmSizeText,
    dpVendorCodeText: planType === 'direct_purchase' ? dpVendor || null : null,
    dpCost: planType === 'direct_purchase' ? dpCost : null,
    dpRemarks: planType === 'direct_purchase' ? dpRemarks || null : null,
    foVendorCodeText: planType === 'full_outsource' ? foVendor || null : null,
    foProcess: planType === 'full_outsource' ? foProcess || null : null,
    foRate: planType === 'full_outsource' ? foRate : null,
    foMaterialSrc: null,
    foDeliveryDate: planType === 'full_outsource' ? foDeliveryDate || null : null,
    foCostCenter: planType === 'full_outsource' ? foCostCenter || null : null,
    foRemarks: planType === 'full_outsource' ? foRemarks || null : null,
    requiredDocs,
    // Field by field on purpose, never a spread of the row: `uid` and the new
    // display-only `machineGroupId` live on OpRow and must not reach the server,
    // which has no column for either and rejects unknown keys.
    ops:
      planType === 'manufacture' || planType === 'assembly'
        ? ops.map((o, i) => ({
            opSeq: i + 1,
            operation: o.operation,
            opType: o.opType,
            machineId: o.machineId ?? null,
            machineCodeText: o.machineCodeText || null,
            cycleTimeMin: o.cycleTimeMin,
            program: o.program || null,
            toolNo: o.toolNo || null,
            toolDetails: o.toolDetails || null,
            qcRequired: o.qcRequired,
            outsourceVendorId: o.outsourceVendorId ?? null,
            outsourceVendorText: o.outsourceVendorText || null,
            outsourceCost: o.outsourceCost,
          }))
        : [],
  });

  const validate = (): string | null => {
    if (planQty <= 0) return 'Plan Qty must be > 0';
    if (planType === 'manufacture' || planType === 'assembly') {
      if (ops.length === 0) return 'Add at least one operation';
      const missingName = ops.find((o) => !o.operation);
      if (missingName) return 'Every op needs an operation name';
      const inHouseNoMachine = ops.find(
        (o) => o.opType === 'process' && !o.machineCodeText,
      );
      if (inHouseNoMachine) return 'In-house ops need a machine';
      const outsourceNoVendor = ops.find(
        (o) => o.opType === 'outsource' && !o.outsourceVendorText,
      );
      if (outsourceNoVendor) return 'Outsource ops need a vendor';
    } else if (planType === 'full_outsource') {
      if (!foVendor) return 'Select a vendor for outsourcing';
      if (!foProcess) return 'Enter process description';
    } else if (planType === 'direct_purchase') {
      if (!dpVendor) return 'Select a vendor for direct purchase';
    }
    return null;
  };

  const onSave = async (finalizeAfter: boolean) => {
    const v = validate();
    if (v) {
      setErr(v);
      return;
    }
    setErr(null);
    try {
      await update.mutateAsync(buildPayload());
      if (finalizeAfter) await finalize.mutateAsync(plan.id);
      onSaved();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Save failed');
    }
  };

  const addOp = (kind: 'process' | 'outsource' | 'qc') => {
    setOps((prev) => [
      ...prev,
      {
        uid: uid(),
        opSeq: prev.length + 1,
        operation: '',
        opType: kind,
        machineCodeText: kind === 'qc' ? 'QC' : '',
        // A hand-added op starts with NO group: null (resolved, empty) rather
        // than undefined, so the seeding effect leaves the planner's blank box
        // alone instead of treating it as "not looked up yet".
        machineGroupId: null,
        cycleTimeMin: 0,
        qcRequired: kind === 'qc',
        outsourceVendorText: '',
        outsourceCost: 0,
      },
    ]);
  };

  const updateOp = (uidVal: string, patch: Partial<OpRow>) => {
    setOps((prev) => prev.map((o) => (o.uid === uidVal ? { ...o, ...patch } : o)));
  };

  const removeOp = (uidVal: string) => {
    setOps((prev) => prev.filter((o) => o.uid !== uidVal));
  };

  // The machines this row may offer. No group chosen = the whole list, because
  // the group is a convenience and the planner is never forced through it.
  // Narrowing happens in the browser over the rows the machines hook already
  // returned — /machines has no machineGroupId filter and adding one would be an
  // API + shared-contract change, which this UI task is not.
  const machineOptsForGroup = (groupId: string | null | undefined) =>
    groupId
      ? machineRows.filter((m) => m.machineGroupId === groupId).map((m) => ({
          id: m.id,
          code: m.code,
          name: m.name,
        }))
      : machineOpts;

  // Picking a group re-scopes the Machine picker, so a machine that is not in
  // the new group would sit in the box as a value the picker can no longer
  // offer — an op that reads as "VMC group, running a lathe". It is cleared so
  // the planner re-picks inside the group they just chose.
  //
  // Only cleared when we can PROVE the mismatch: a machine we cannot find in the
  // loaded rows is left alone, because "not in this page of the master" is not
  // the same as "not in this group" and guessing would blank a real machine.
  const onGroupChange = (row: OpRow, groupId: string | null) => {
    const current = machineOfOp(row);
    const mismatch = groupId != null && current != null && current.machineGroupId !== groupId;
    updateOp(row.uid, {
      machineGroupId: groupId,
      ...(mismatch ? { machineId: null, machineCodeText: '' } : {}),
    });
  };

  const footer = (
    <>
      <button type="button" className="btn btn-ghost" onClick={onClose}>
        Cancel
      </button>
      <button
        type="button"
        className="btn"
        onClick={() => onSave(false)}
        disabled={update.isPending || finalize.isPending}
      >
        Save Draft
      </button>
      <button
        type="button"
        className="btn btn-success"
        onClick={() => onSave(true)}
        disabled={update.isPending || finalize.isPending}
      >
        {update.isPending || finalize.isPending ? (
          <>
            <Loader2 className="inline-block animate-spin" style={{ width: 14, height: 14 }} />{' '}
            …
          </>
        ) : (
          // Legacy editPlan: showModalLg(title, body, onSave, 'Save Plan') →
          // btn-success rendering `&#10003; Save Plan` (L28044). Its single save
          // always sets status='Planned', i.e. it is this button, not Save Draft.
          '✓ Save Plan'
        )}
      </button>
    </>
  );

  // `active` is passed in rather than derived from `planType === val`: legacy's
  // Manufacture tab lights up for anything that is NOT direct_purchase/full_outsource
  // (L9609), which is what keeps an `assembly` plan showing a selected tab.
  // `activeBg` is legacy's literal rgba; the border/label use the CSS token like
  // legacy does (var(--cyan)/var(--purple)/var(--green)) — the previous hard-coded
  // #22d3ee/#22c55e were the DARK theme's values (ISSUE-067).
  const typeBtn = (
    val: PlanType,
    icon: string,
    label: string,
    help: string,
    color: string,
    activeBg: string,
    active: boolean,
  ) => (
    <label
      style={{
        flex: 1,
        cursor: 'pointer',
        padding: '10px 14px',
        borderRadius: 8,
        border: `2px solid ${active ? color : 'var(--border)'}`,
        background: active ? activeBg : 'var(--bg)',
        textAlign: 'center',
      }}
      onClick={() => setPlanType(val)}
    >
      <div style={{ fontSize: 20, marginBottom: 4 }}>{icon}</div>
      <div style={{ fontSize: 12, fontWeight: 700, color }}>{label}</div>
      <div style={{ fontSize: 10, color: 'var(--text3)' }}>{help}</div>
    </label>
  );

  // The two step pills — 🏭 OSP and 🔬 QC — now sit in the SAME Group column,
  // one under the other, so they are drawn from one helper. When they lived in
  // separate places a difference in padding or radius went unnoticed; stacked in
  // one column any drift reads as a ragged edge.
  //
  // The tints stay the literal rgba they have always been: there is a --purple
  // token (identical to the old hard-coded #7c3aed, so the text colour now uses
  // it) but no token for these 12%/30% washes, and inventing one is not this
  // task's job.
  const stepBadge = (label: string, color: string, tint: string, edge: string) => (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 4,
        padding: '3px 8px',
        background: tint,
        border: `1px solid ${edge}`,
        borderRadius: 4,
        fontSize: 10,
        fontWeight: 700,
        letterSpacing: '.04em',
        whiteSpace: 'nowrap',
        color,
      }}
    >
      {label}
    </span>
  );

  // "Nothing to show here." Used by the QC row's OSP cell, which is deliberately
  // left as a dash — the QC row's Machine / Vendor cell says NA instead, because
  // there the field genuinely does not apply.
  const naDash = <span style={{ color: 'var(--text3)', fontSize: 11 }}>—</span>;

  // `CODE/REV` — the customer's drawing revision from the SO line this plan was
  // raised against. A JW-sourced or ad-hoc plan has none and keeps the bare code,
  // with no trailing slash.
  const planItemLabel = plan.itemCode
    ? itemCodeWithRev(plan.itemCode, plan.itemRevision)
    : (plan.itemNameText ?? '');

  return (
    <Modal
      title={`✏ Plan: ${plan.code} — ${planItemLabel}`}
      size="lg"
      onClose={onClose}
      footer={footer}
    >
      {/* Header summary */}
      <div
        style={{
          background: 'var(--bg3)',
          padding: 12,
          borderRadius: 8,
          border: '1px solid var(--border)',
          marginBottom: 14,
        }}
      >
        <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <div>
            <span style={{ fontSize: 10, color: 'var(--text3)' }}>PLAN</span>
            <br />
            <b className="mono" style={{ color: 'var(--cyan)' }}>
              {plan.code}
            </b>
          </div>
          <div>
            <span style={{ fontSize: 10, color: 'var(--text3)' }}>SO/JW</span>
            <br />
            <b className="mono">
              {plan.soCodeText ?? '—'} L{plan.lineNo ?? '—'}
            </b>
          </div>
          <div>
            <span style={{ fontSize: 10, color: 'var(--text3)' }}>ITEM</span>
            <br />
            {/* `CODE/REV` — see planItemLabel. nowrap so a short code never
                breaks across two lines in this summary strip. */}
            <b style={{ color: 'var(--purple)', whiteSpace: 'nowrap' }}>
              {itemCodeWithRev(plan.itemCode ?? plan.itemCodeText, plan.itemRevision, '')}
            </b>{' '}
            {plan.itemName ?? plan.itemNameText ?? ''}
          </div>
          <div>
            <span style={{ fontSize: 10, color: 'var(--text3)' }}>SO QTY</span>
            <br />
            <b style={{ fontSize: 16 }}>{plan.orderQty}</b>
          </div>
          <div>
            <span style={{ fontSize: 10, color: 'var(--cyan)', fontWeight: 700 }}>
              PLAN QTY ★
            </span>
            <br />
            <input
              type="number"
              min={1}
              max={plan.orderQty}
              value={planQty}
              onChange={(e) => setPlanQty(Number(e.target.value))}
              style={{
                width: 80,
                fontSize: 16,
                fontWeight: 800,
                textAlign: 'center',
                border: '2px solid var(--cyan)',
                color: 'var(--cyan)',
                padding: 4,
                borderRadius: 4,
              }}
            />
          </div>
        </div>
      </div>

      {/* 3-tab type picker */}
      <div
        style={{
          marginBottom: 14,
          padding: '10px 14px',
          background: 'var(--bg3)',
          border: '1px solid var(--border)',
          borderRadius: 8,
        }}
      >
        <label
          className="form-label"
          style={{ marginBottom: 8, fontWeight: 700, display: 'block' }}
        >
          Plan Type ★
        </label>
        <div style={{ display: 'flex', gap: 8 }}>
          {typeBtn(
            'manufacture',
            '🏭',
            'Manufacture',
            'Job Card + Operations',
            'var(--cyan)',
            'rgba(34,211,238,0.08)',
            planType !== 'direct_purchase' && planType !== 'full_outsource',
          )}
          {typeBtn(
            'full_outsource',
            '📦',
            'Full Outsource',
            'Our material, vendor does all',
            'var(--purple)',
            'rgba(124,58,237,0.08)',
            planType === 'full_outsource',
          )}
          {!isJw &&
            typeBtn(
              'direct_purchase',
              '🛒',
              'Direct Purchase',
              'Buy finished item (with material)',
              'var(--green)',
              'rgba(34,197,94,0.08)',
              planType === 'direct_purchase',
            )}
        </div>
      </div>

      {/* Dates · raw material · remark — ONE row. Two small captions sit above
          the field labels: SCHEDULE over the two dates, RAW MATERIAL over grade
          / size / remark. The raw-material grouping is shown by the pale blue
          wash on those three fields plus blue labels — deliberately NO border,
          card or nested container. Grade and Size are optional, so neither
          carries a ★. Remark sits here rather than in its old standalone block
          at the bottom of the modal so the whole header reads in one line.
          Both groups are flex-wrap, so a narrow window stacks them instead of
          growing a horizontal scrollbar. */}
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: 14,
          alignItems: 'flex-end',
          marginBottom: 14,
        }}
      >
        <div style={{ flex: '1 1 300px', minWidth: 0 }}>
          <div
            className="mono fw-700 text3"
            style={{
              fontSize: 9,
              textTransform: 'uppercase',
              letterSpacing: '.08em',
              marginBottom: 6,
            }}
          >
            Schedule
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
            <div className="form-grp" style={{ flex: '1 1 150px', minWidth: 0 }}>
              <label className="form-label">Planned Start / Required Date</label>
              <input
                type="date"
                className="innovic-input"
                value={plannedStartDate}
                onChange={(e) => setPlannedStartDate(e.target.value)}
              />
            </div>
            <div className="form-grp" style={{ flex: '1 1 150px', minWidth: 0 }}>
              <label className="form-label">Planned End Date</label>
              <input
                type="date"
                className="innovic-input"
                value={plannedEndDate}
                onChange={(e) => setPlannedEndDate(e.target.value)}
              />
            </div>
          </div>
        </div>
        {/* The tint IS the grouping: the arbitrary variant paints every control
            inside this block with the pale blue token wash (bg-innovic-blue3 =
            --blue3), including the Grade / Size pickers' own <input>. */}
        <div className="[&_input]:bg-innovic-blue3" style={{ flex: '1.6 1 420px', minWidth: 0 }}>
          <div
            className="mono fw-700"
            style={{
              fontSize: 9,
              textTransform: 'uppercase',
              letterSpacing: '.08em',
              marginBottom: 6,
              color: 'var(--blue)',
            }}
          >
            Raw Material
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
            <div className="form-grp" style={{ flex: '1 1 130px', minWidth: 0 }}>
              <label className="form-label" style={{ color: 'var(--blue)' }}>
                Grade
              </label>
              <MaterialGradePicker
                valueId={rmGradeId}
                valueText={rmGradeText}
                onChange={(id, text) => {
                  setRmGradeId(id);
                  setRmGradeText(text);
                }}
              />
            </div>
            <div className="form-grp" style={{ flex: '1 1 140px', minWidth: 0 }}>
              <label className="form-label" style={{ color: 'var(--blue)' }}>
                Size
              </label>
              <MaterialSizePicker
                valueId={rmSizeId}
                valueText={rmSizeText}
                onChange={(id, text) => {
                  setRmSizeId(id);
                  setRmSizeText(text);
                }}
              />
            </div>
            <div className="form-grp" style={{ flex: '2.4 1 200px', minWidth: 0 }}>
              <label className="form-label" style={{ color: 'var(--blue)' }}>
                Remark
              </label>
              <input
                className="innovic-input"
                value={remarks}
                onChange={(e) => setRemarks(e.target.value)}
                placeholder="Planning notes, special instructions"
              />
            </div>
          </div>
        </div>
      </div>

      {/* Manufacture section */}
      {(planType === 'manufacture' || planType === 'assembly') && (
        <div
          style={{
            border: '1px solid var(--border)',
            borderRadius: 8,
            // Not 'hidden': the Machine / Vendor SearchableSelect dropdowns are
            // absolutely positioned and must overflow the table without clipping.
            overflow: 'visible',
            marginBottom: 14,
          }}
        >
          <div
            style={{
              padding: '8px 12px',
              background: 'var(--bg4)',
              borderTopLeftRadius: 8,
              borderTopRightRadius: 8,
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
            }}
          >
            <div style={{ minWidth: 0 }}>
              <span className="form-label" style={{ marginBottom: 0 }}>
                Operations Routing
              </span>
              {/* Where these ops came from. Planning has always auto-filled them
                  from the item's active route card, but silently — a card that
                  loaded and a card that does not exist looked identical here.
                  Display only: the code and revision never enter the payload. */}
              {plan.itemId ? (
                <div style={{ fontSize: 11, marginTop: 2 }}>
                  {defaultOpsQuery.isLoading ? (
                    <span style={{ color: 'var(--text3)' }}>Loading…</span>
                  ) : defaultOpsQuery.isError ? null : defaultOpsQuery.data?.routeCardCode ? (
                    <>
                      <span style={{ color: 'var(--text3)' }}>Route Card: </span>
                      <span className="mono fw-700" style={{ color: 'var(--cyan)' }}>
                        {defaultOpsQuery.data.routeCardCode}
                      </span>
                      {defaultOpsQuery.data.routeCardRevision != null ? (
                        <span className="badge b-blue" style={{ marginLeft: 4, fontSize: 9 }}>
                          Rev {defaultOpsQuery.data.routeCardRevision}
                        </span>
                      ) : null}
                      {autoLoadedCount != null ? (
                        <span style={{ color: 'var(--text3)' }}>
                          {' '}
                          &mdash; {autoLoadedCount} operations loaded
                        </span>
                      ) : null}
                    </>
                  ) : (
                    <span style={{ color: 'var(--text3)' }}>
                      Route Card: <span style={{ color: 'var(--amber)' }}>none</span> &mdash; enter
                      the operations below
                    </span>
                  )}
                </div>
              ) : null}
            </div>
            {/* The op count is a badge rather than loose grey text so it reads as
                a value and not as part of the button row next to it. */}
            <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
              <span className="badge b-grey" style={{ whiteSpace: 'nowrap' }}>
                {ops.length} {ops.length === 1 ? 'op' : 'ops'}
              </span>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => addOp('process')}
              >
                + Add Op
              </button>
              <button
                type="button"
                className="btn btn-sm"
                style={{
                  background: 'rgba(124,58,237,0.08)',
                  // --purple is exactly the #7c3aed that was hard-coded here.
                  color: 'var(--purple)',
                  border: '1px solid rgba(124,58,237,0.25)',
                  fontSize: 11,
                }}
                onClick={() => addOp('outsource')}
              >
                + Add OSP Op
              </button>
              <button
                type="button"
                className="btn btn-sm"
                style={{
                  background: 'rgba(34,197,94,0.08)',
                  color: 'var(--green)',
                  border: '1px solid rgba(34,197,94,0.25)',
                  fontSize: 11,
                }}
                onClick={() => addOp('qc')}
              >
                + Add QC Op
              </button>
            </div>
          </div>
          {ops.length === 0 ? (
            <div className="empty-state" style={{ padding: 20, textAlign: 'center' }}>
              <div style={{ fontSize: 12, marginBottom: 4 }}>No operations yet.</div>
              <div style={{ fontSize: 11, color: 'var(--text3)' }}>
                Use <b>+ Add Op</b> for in-house work, <b>+ Add OSP Op</b> for vendor work,
                or <b>+ Add QC Op</b> for an inspection step.
              </div>
            </div>
          ) : (
            // Seven columns is more than the 1320px modal has to spare on a small
            // laptop, so the TABLE scrolls sideways inside its own box. Letting the
            // modal body scroll instead would drag the Plan Qty header and the
            // Save buttons off-screen with it.
            //
            // Both pickers draw their dropdown into a <body> portal and reposition
            // on any capture-phase scroll, so this scroller cannot clip them.
            <div style={{ overflowX: 'auto' }}>
              <table className="ops-routing" style={{ minWidth: 900 }}>
                <thead>
                  <tr style={{ background: 'var(--bg4)' }}>
                    <th style={{ width: 40, textAlign: 'center' }}>#</th>
                    {/* The Group column leads because it is the first thing the
                        planner decides — what KIND of step this is (a machine
                        family, an OSP hand-off, or a QC check). Everything to the
                        right of it is scoped by that answer. */}
                    <th style={{ width: 190 }}>Group</th>
                    <th style={{ width: 210 }}>Machine / Vendor</th>
                    <th style={{ minWidth: 200 }}>Operation</th>
                    <th style={{ width: 96 }}>Cycle (h)</th>
                    <th style={{ width: 132, color: 'var(--amber)' }}>OSP</th>
                    <th style={{ width: 48 }} />
                  </tr>
                </thead>
                <tbody>
                  {ops.map((op, i) => {
                    const isQC = op.opType === 'qc';
                    const isOS = op.opType === 'outsource';
                    if (isQC) {
                      return (
                        <tr
                          key={op.uid}
                          style={{
                            background: 'rgba(34,197,94,0.06)',
                            borderLeft: '3px solid var(--green)',
                          }}
                        >
                          <td className="td-ctr mono fw-700" style={{ color: 'var(--green)' }}>
                            {i + 1}
                          </td>
                          {/* A QC step has no machine group — the badge takes the
                              Group cell so every row's leftmost data cell answers
                              the same question: what kind of step is this. */}
                          <td>
                            {stepBadge(
                              '🔬 QC',
                              'var(--green)',
                              'rgba(34,197,94,0.12)',
                              'rgba(34,197,94,0.3)',
                            )}
                          </td>
                          {/* NA, not a dash: a QC step is never run on a machine
                              and never sent to a vendor, so this field does not
                              apply at all. A dash reads like a value somebody
                              simply forgot to fill in, which invites a planner to
                              go looking for the missing machine. Same look as the
                              OSP row's "NA" cycle cell so both read as one idea. */}
                          <td className="td-ctr">
                            <span
                              className="mono fw-700"
                              style={{
                                color: 'var(--text3)',
                                fontSize: 11,
                                whiteSpace: 'nowrap',
                              }}
                              title="A QC step is not done on a machine or by a vendor"
                            >
                              NA
                            </span>
                          </td>
                          <td>
                            <select
                              className="innovic-select"
                              value={op.operation}
                              onChange={(e) => {
                                const name = e.target.value;
                                const proc = (qcProcesses.data?.items ?? []).find(
                                  (p) => p.code === name,
                                );
                                updateOp(op.uid, {
                                  operation: name,
                                  cycleTimeMin: proc?.defaultCycleTimeMin
                                    ? Number(proc.defaultCycleTimeMin)
                                    : op.cycleTimeMin,
                                });
                              }}
                            >
                              <option value="">— Select QC Process —</option>
                              {(qcProcesses.data?.items ?? []).map((p) => (
                                <option key={p.id} value={p.code}>
                                  {p.code}
                                </option>
                              ))}
                            </select>
                          </td>
                          <td>
                            <input
                              className="innovic-input"
                              type="number"
                              step="0.01"
                              value={op.cycleTimeMin}
                              onChange={(e) =>
                                updateOp(op.uid, { cycleTimeMin: Number(e.target.value) })
                              }
                              style={{ textAlign: 'center' }}
                            />
                          </td>
                          <td className="td-ctr">{naDash}</td>
                          <td>
                            <button
                              type="button"
                              className="btn btn-danger btn-sm btn-icon"
                              onClick={() => removeOp(op.uid)}
                            >
                              ×
                            </button>
                          </td>
                        </tr>
                      );
                    }
                    // Non-QC op row — process by default. Ticking the OUTSOURCE box
                    // turns it into an outsourced (OSP) op, and the row re-reads
                    // left to right without changing shape:
                    //   Group   — the Machine Group picker becomes the OSP badge
                    //             (work leaves the shop, so there is no group).
                    //   Machine — the machine picker becomes the VENDOR picker;
                    //   / Vendor  it is the same question, "who does this step".
                    //   Cycle   — NA. An outsourced step has no in-house machine
                    //             time to plan, so there is nothing to type here.
                    //   OSP     — the tick box, plus the ₹/pc rate it unlocks.
                    return (
                      <tr
                        key={op.uid}
                        style={{ background: i % 2 === 0 ? 'var(--bg)' : 'var(--bg3)' }}
                      >
                        <td className="td-ctr mono fw-700">{i + 1}</td>
                        <td>
                          {isOS
                            ? stepBadge(
                                '🏭 OSP',
                                'var(--purple)',
                                'rgba(124,58,237,0.12)',
                                'rgba(124,58,237,0.3)',
                              )
                            : (
                                <MachineGroupPicker
                                  id={`plan-mgrp-${op.uid}`}
                                  valueId={op.machineGroupId ?? null}
                                  valueText={
                                    op.machineGroupId
                                      ? (machineGroupCodeById.get(op.machineGroupId) ?? null)
                                      : null
                                  }
                                  onChange={(gid) => onGroupChange(op, gid)}
                                />
                              )}
                        </td>
                        <td>
                          {isOS ? (
                            <SearchableSelect
                              id={`plan-osp-vend-${op.uid}`}
                              // The stored FK is the LINK to Vendor Master, so it
                              // is what the picker is asked for first. Matching on
                              // the code text was the fallback doing all the work,
                              // and it could only ever match a vendor inside the
                              // page of rows this hook had fetched — against a
                              // vendor master of several hundred that is almost
                              // never the saved one, so an op that plainly had a
                              // vendor read as unlinked and reopening the list
                              // risked clearing it. The text match stays as the
                              // fallback for ops saved before the id was recorded.
                              value={op.outsourceVendorId ?? vendorIdByCode(op.outsourceVendorText ?? '')}
                              onChange={(id) =>
                                updateOp(op.uid, {
                                  outsourceVendorId: id,
                                  outsourceVendorText: id ? (vendorById.get(id)?.code ?? '') : '',
                                })
                              }
                              onSearch={setVendorSearch}
                              loading={vendors.isFetching}
                              options={vendorOpts}
                              placeholder="🔍 Vendor"
                              // No selectedLabel override: the component's own
                              // default is "CODE — Name", which is what the user
                              // asked for. valueLabel matches it so a saved row
                              // reads the same as one just picked.
                              valueLabel={vendorLabelOf(op)}
                            />
                          ) : (
                            <SearchableSelect
                              id={`plan-mach-${op.uid}`}
                              value={machineIdByCode(op.machineCodeText ?? '')}
                              onChange={(id) => {
                                const picked = id ? machineById.get(id) : undefined;
                                updateOp(op.uid, {
                                  machineId: id,
                                  machineCodeText: picked?.code ?? '',
                                  // Show the group the picked machine belongs to
                                  // when the row had none. Reopening this plan
                                  // would fill the same box from the same machine
                                  // master, so filling it now keeps the row reading
                                  // identically before and after a save.
                                  ...(op.machineGroupId == null && picked?.machineGroupId
                                    ? { machineGroupId: picked.machineGroupId }
                                    : {}),
                                });
                              }}
                              onSearch={setMachineSearch}
                              loading={machines.isFetching}
                              options={machineOptsForGroup(op.machineGroupId)}
                              placeholder="🔍 Machine"
                              // Same as the vendor box beside it: code AND name,
                              // both when picked and when read back from a save.
                              valueLabel={machineLabelOf(op)}
                            />
                          )}
                        </td>
                        <td>
                          <input
                            className="innovic-input"
                            value={op.operation}
                            onChange={(e) => updateOp(op.uid, { operation: e.target.value })}
                            placeholder="Operation name"
                          />
                        </td>
                        <td className="td-ctr">
                          {isOS ? (
                            // NA, not a blank or a dash: an outsourced step has no
                            // cycle time to enter, and saying so stops a planner
                            // hunting for a field that is deliberately not there.
                            <span
                              className="mono fw-700"
                              style={{
                                color: 'var(--text3)',
                                fontSize: 11,
                                whiteSpace: 'nowrap',
                              }}
                              title="Outsourced work has no in-house cycle time"
                            >
                              NA
                            </span>
                          ) : (
                            <input
                              className="innovic-input"
                              type="number"
                              step="0.01"
                              value={op.cycleTimeMin}
                              onChange={(e) =>
                                updateOp(op.uid, { cycleTimeMin: Number(e.target.value) })
                              }
                              style={{ textAlign: 'center' }}
                            />
                          )}
                        </td>
                        <td>
                          <label
                            style={{
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: 6,
                              fontSize: 10,
                              fontWeight: 700,
                              // Legacy L9576: amber only while ticked, else text3.
                              color: isOS ? 'var(--amber)' : 'var(--text3)',
                              cursor: 'pointer',
                              letterSpacing: '.04em',
                              whiteSpace: 'nowrap',
                            }}
                          >
                            <input
                              type="checkbox"
                              checked={isOS}
                              style={{ accentColor: 'var(--amber)' }}
                              onChange={(e) =>
                                updateOp(
                                  op.uid,
                                  e.target.checked
                                    ? {
                                        opType: 'outsource',
                                        cycleTimeMin: 0,
                                      }
                                    : { opType: 'process' },
                                )
                              }
                            />
                            OUTSOURCE
                          </label>
                          {/* No ₹/pc rate here. Legacy L9578 put one on an
                              outsourced op and it was added back in an earlier
                              pass, but the user does not price the work on this
                              screen — the rate is agreed on the purchase side,
                              not while planning the route. Checked before
                              removing it: outsource_cost is 0 on every plan_ops
                              row in both databases, so no one has ever entered a
                              figure here and nothing on screen was carrying
                              information.

                              The COLUMN stays: buildPayload still writes
                              o.outsourceCost, which is whatever the plan was
                              loaded with. Dropping the input hides the field, it
                              does not blank a value already stored. */}
                        </td>
                        <td>
                          <button
                            type="button"
                            className="btn btn-danger btn-sm btn-icon"
                            onClick={() => removeOp(op.uid)}
                          >
                            ×
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Full Outsource section */}
      {planType === 'full_outsource' && (
        <div
          style={{
            border: '1px solid rgba(124,58,237,0.3)',
            borderRadius: 8,
            padding: 14,
            marginBottom: 14,
            background: 'rgba(124,58,237,0.04)',
          }}
        >
          <div
            style={{
              fontSize: 12,
              fontWeight: 700,
              color: 'var(--purple)',
              marginBottom: 10,
            }}
          >
            📦 Full Outsource Details
          </div>
          <div style={{ fontSize: 11, color: 'var(--text3)', marginBottom: 12 }}>
            ℹ Our material will be sent to vendor. Vendor does all machining/processes and
            returns finished parts.
          </div>
          <datalist id="dlFOCC">
            {(costCenters.data?.items ?? []).map((c) => (
              <option key={c.id} value={c.code}>
                {c.code} — {c.name}
              </option>
            ))}
          </datalist>
          <div className="form-grid">
            <div className="form-grp">
              <label className="form-label" style={{ color: 'var(--purple)' }}>
                Vendor ★
              </label>
              <SearchableSelect
                id="plan-fo-vend"
                value={vendorIdByCode(foVendor)}
                onChange={(id) => setFoVendor(id ? (vendorById.get(id)?.code ?? '') : '')}
                onSearch={setVendorSearch}
                loading={vendors.isFetching}
                options={vendorOpts}
                placeholder="🔍 Search vendor…"
                valueLabel={foVendor || undefined}
                selectedLabel={(o) => o.code ?? o.name}
              />
            </div>
            <div className="form-grp">
              <label className="form-label">Rate ₹/pc</label>
              <input
                type="number"
                min={0}
                step="0.01"
                value={foRate ?? ''}
                onChange={(e) => setFoRate(e.target.value === '' ? null : Number(e.target.value))}
                placeholder="0.00"
                style={{ fontSize: 14, color: 'var(--green)', fontWeight: 700 }}
              />
            </div>
            <div className="form-grp form-full">
              <label className="form-label">Process Description ★</label>
              <input
                value={foProcess}
                onChange={(e) => setFoProcess(e.target.value)}
                placeholder="e.g. Complete machining as per drawing, Heat Treatment + Grinding"
              />
            </div>
            {/* ADR-095: Material Source removed — the vendor supplies his own
                material on a full-outsource job, so no material PR is raised. */}
            <div className="form-grp">
              <label className="form-label">Expected Delivery Date</label>
              <input
                type="date"
                value={foDeliveryDate}
                onChange={(e) => setFoDeliveryDate(e.target.value)}
              />
            </div>
            <div className="form-grp">
              <label className="form-label">🏢 Cost Center</label>
              <input
                list="dlFOCC"
                value={foCostCenter}
                onChange={(e) => setFoCostCenter(e.target.value)}
                placeholder="🔍 Cost center…"
                style={{ fontSize: 12 }}
              />
            </div>
            <div className="form-grp form-full">
              <label className="form-label">Outsource Remarks / Specifications</label>
              <input
                value={foRemarks}
                onChange={(e) => setFoRemarks(e.target.value)}
                placeholder="Hardness, finish, tolerance requirements…"
              />
            </div>
          </div>
        </div>
      )}

      {/* Direct Purchase section */}
      {planType === 'direct_purchase' && (
        <div
          style={{
            border: '1px solid rgba(34,197,94,0.3)',
            borderRadius: 8,
            padding: 14,
            marginBottom: 14,
            background: 'rgba(34,197,94,0.04)',
          }}
        >
          <div
            style={{
              fontSize: 12,
              fontWeight: 700,
              color: 'var(--green)',
              marginBottom: 10,
            }}
          >
            🛒 Direct Purchase Details
          </div>
          <div className="form-grid">
            <div className="form-grp">
              <label className="form-label" style={{ color: 'var(--green)' }}>
                Vendor ★
              </label>
              <SearchableSelect
                id="plan-dp-vend"
                value={vendorIdByCode(dpVendor)}
                onChange={(id) => setDpVendor(id ? (vendorById.get(id)?.code ?? '') : '')}
                onSearch={setVendorSearch}
                loading={vendors.isFetching}
                options={vendorOpts}
                placeholder="🔍 Search vendor…"
                valueLabel={dpVendor || undefined}
                selectedLabel={(o) => o.code ?? o.name}
              />
            </div>
            <div className="form-grp">
              <label className="form-label">Est. Cost / pc (₹)</label>
              <input
                type="number"
                min={0}
                step="0.01"
                value={dpCost ?? ''}
                onChange={(e) => setDpCost(e.target.value === '' ? null : Number(e.target.value))}
                style={{ fontSize: 14 }}
              />
            </div>
            <div className="form-grp form-full">
              <label className="form-label">Purchase Remarks</label>
              <input
                value={dpRemarks}
                onChange={(e) => setDpRemarks(e.target.value)}
                placeholder="Specifications, grade, size, any special requirements"
              />
            </div>
          </div>
        </div>
      )}

      {/* Required QC Documents */}
      <div
        style={{
          border: '1px solid var(--border)',
          borderRadius: 8,
          overflow: 'hidden',
          marginTop: 14,
        }}
      >
        <div
          style={{
            padding: '8px 12px',
            background: 'var(--bg4)',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}
        >
          <span
            style={{
              fontSize: 11,
              color: 'var(--red)',
              fontFamily: 'var(--mono)',
              fontWeight: 700,
              letterSpacing: '0.06em',
            }}
          >
            📋 REQUIRED QC DOCUMENTS
          </span>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() =>
              setRequiredDocs((prev) => [...prev, { name: '', mandatory: true }])
            }
          >
            + Add Document
          </button>
        </div>
        <div>
          {requiredDocs.length === 0 ? (
            <div className="empty-state" style={{ padding: 14, fontSize: 12 }}>
              — No document requirements. Click + Add Document.
            </div>
          ) : (
            <>
              <datalist id="dlDocPresets">
                {docPresets.map((d) => (
                  <option key={d} value={d} />
                ))}
              </datalist>
              <table className="ops-routing">
                <thead>
                  <tr style={{ background: 'var(--bg4)' }}>
                    <th style={{ width: 44, textAlign: 'center' }}>#</th>
                    <th>Document Name ★</th>
                    <th style={{ width: 180 }}>Requirement</th>
                    <th style={{ width: 56 }} />
                  </tr>
                </thead>
                <tbody>
                  {requiredDocs.map((d, i) => (
                    <tr
                      key={i}
                      style={{ background: i % 2 === 0 ? 'var(--bg)' : 'var(--bg3)' }}
                    >
                      <td className="td-ctr mono fw-700">{i + 1}</td>
                      <td>
                        <input
                          className="innovic-input"
                          list="dlDocPresets"
                          value={d.name}
                          onChange={(e) =>
                            setRequiredDocs((prev) =>
                              prev.map((row, idx) =>
                                idx === i ? { ...row, name: e.target.value } : row,
                              ),
                            )
                          }
                          placeholder="🔍 Type or select document…"
                        />
                      </td>
                      <td>
                        <select
                          className="innovic-select"
                          value={d.mandatory ? 'mandatory' : 'optional'}
                          onChange={(e) =>
                            setRequiredDocs((prev) =>
                              prev.map((row, idx) =>
                                idx === i
                                  ? { ...row, mandatory: e.target.value === 'mandatory' }
                                  : row,
                              ),
                            )
                          }
                        >
                          <option value="mandatory">★ Mandatory</option>
                          <option value="optional">Optional</option>
                        </select>
                      </td>
                      <td>
                        <button
                          type="button"
                          className="btn btn-danger btn-sm btn-icon"
                          onClick={() =>
                            setRequiredDocs((prev) => prev.filter((_, idx) => idx !== i))
                          }
                        >
                          ×
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
        </div>
        <div
          style={{
            padding: '6px 12px',
            fontSize: 10,
            color: 'var(--text3)',
            borderTop: '1px solid var(--border)',
          }}
        >
          📌 QC person must upload these documents during inspection. Mandatory docs will block
          QC completion.
        </div>
      </div>

      {err ? (
        <div
          style={{
            marginTop: 12,
            padding: 8,
            borderRadius: 4,
            background: 'rgba(239,68,68,0.1)',
            color: 'var(--red)',
            fontSize: 12,
          }}
        >
          {err}
        </div>
      ) : null}
    </Modal>
  );
}
