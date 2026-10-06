// Edit Plan modal (PL-4b §5). Large modal: identity line, the quantity account
// (ClusterGrid), one 12-column header grid with Plan Type as a dropdown, then
// the ops table (process/QC/OSP), Full Outsource section, Direct Purchase
// section and Required QC Documents section. Mirrors legacy editPlan (L9500).
//
// Layout follows the ClusterGrid method agreed on the Plan screens (2026-10-03)
// so Edit Plan reads as the SAME form as Create Plan. The old --bg3 summary
// strip and the three Plan Type picture cards are gone; nothing they did was
// lost — the same state, the same onChange, the same validation.
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
import { opSrNo } from '@innovic/shared';
import { Loader2 } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { SearchableSelect } from '@/components/shared/searchable-select';
import { addDaysLocal, todayLocal } from '@/lib/date';
import { itemCodeWithRev } from '@/lib/item-code';
import { soNoWithInternal } from '@/lib/so-number';
import { useOpenedVersion } from '@/lib/use-opened-version';
import { useSaveKey } from '@/lib/use-save-key';
import { PLAN_DEFAULT_SPAN_DAYS } from '@/modules/plans/components/plan-form';
import {
  MaterialValueDisplay,
  RM_SOURCE_HELP,
} from '@/modules/raw-material/components/raw-material-pickers';
import { useCostCentersList } from '@/modules/cost-centers/api';
import {
  MACHINE_GROUP_LIST_LIMIT,
  useMachineGroupsList,
  useMachinesList,
} from '@/modules/machines/api';
import { MachineGroupPicker } from '@/modules/machines/components/machine-group-picker';
import { isStagedResult } from '@/modules/document-edits/api';
import { useFinalizePlan, useUpdatePlan, useDefaultRouteOps } from '@/modules/plans/api';
import { useQcProcessesList } from '@/modules/qc-processes/api';
import { useVendorsList } from '@/modules/vendors/api';
import {
  Cluster,
  ClusterFact,
  ClusterGrid,
  DocIdent,
  FormField,
  IdentCode,
  IdentSep,
} from '@/ui/forms';
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

// What each Plan Type MEANS for the rest of this modal — the one line the three
// picture cards used to carry under their icons, now the hint under the Plan
// Type dropdown. `assembly` reads the same as `manufacture` because it drives
// the same sections (a Job Card over the operations below).
const PLAN_TYPE_HELP: Record<PlanType, string> = {
  manufacture: 'Job Card + the operations below',
  assembly: 'Job Card + the operations below',
  full_outsource: 'Our material, vendor does all',
  direct_purchase: 'Buy finished item (with material)',
};

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
    plan.plannedEndDate ||
      addDaysLocal(plan.plannedStartDate || todayLocal(), PLAN_DEFAULT_SPAN_DAYS),
  );
  // Customer Dispatch Date — the day the goods must leave for the customer.
  // Optional; opens on whatever the plan was saved with (blank if none).
  const [customerDispatchDate, setCustomerDispatchDate] = useState<string>(
    plan.customerDispatchDate ?? '',
  );
  const [remarks, setRemarks] = useState<string>(plan.remarks ?? '');
  // ADR-218 — raw material is not state any more: this box SHOWS what the plan
  // holds (`plan.rawMaterialGradeText` / `…SizeText`) and cannot change it. The
  // author is the part's Route Card, or the BOM line for a BOM child.

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
  // ADR-202 — set when an edit to a LIVE plan is staged for approval instead of
  // applied; a neutral notice shows it and the modal stays open to be read.
  const [stagedNotice, setStagedNotice] = useState<string | null>(null);

  const saveKey = useSaveKey();
  const update = useUpdatePlan(plan.id, saveKey);
  // R5 — the version this modal opened with; a save over someone else's newer
  // edit is refused (409 edit_conflict) and its message shows in the modal.
  const opened = useOpenedVersion(plan.updatedAt);
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
  // Every vendor row fetched (active or not) resolves a label / heals a saved
  // link; only ACTIVE ones are offered for a new pick (A10). A plan whose vendor
  // was disabled later still shows and keeps that vendor.
  const vendorRows = useMemo(
    () =>
      (vendors.data?.vendors ?? []).map((v) => ({
        id: v.id,
        code: v.code,
        name: v.name,
        isActive: v.isActive,
      })),
    [vendors.data],
  );
  const vendorOpts = useMemo(
    () =>
      vendorRows.filter((v) => v.isActive).map((v) => ({ id: v.id, code: v.code, name: v.name })),
    [vendorRows],
  );
  const machineById = useMemo(() => new Map(machineRows.map((m) => [m.id, m])), [machineRows]);
  // A plan op stores the machine CODE snapshot and may carry a null machineId
  // (older rows, and anything typed before the picker existed), so the machine
  // has to be findable by either key.
  const machineByCode = useMemo(() => new Map(machineRows.map((m) => [m.code, m])), [machineRows]);
  const vendorById = useMemo(() => new Map(vendorRows.map((o) => [o.id, o])), [vendorRows]);
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
    vendorRows.find((v) => v.code === code)?.id ?? null;

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
  const codeAndName = (
    o: { code?: string | null; name: string } | undefined,
  ): string | undefined => (o ? (o.code ? `${o.code} — ${o.name}` : o.name) : undefined);

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
    customerDispatchDate: customerDispatchDate || null,
    remarks: remarks || null,
    // ADR-218 — RM Grade / RM Size are deliberately ABSENT from this payload.
    // Server contract (apps/api/src/modules/plans/service.ts, updatePlanTx): a
    // field that IS sent — a value OR an explicit null — is applied as the
    // caller's own answer, and only an OMITTED field leaves the server free to
    // fill the plan from its BOM line / Route Card. This box used to send all
    // four keys on every save, which is what made a BOM-child plan disagree
    // with its BOM line. Omitting them closes that.
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
      const inHouseNoMachine = ops.find((o) => o.opType === 'process' && !o.machineCodeText);
      if (inHouseNoMachine) return 'In-house ops need a machine';
      const outsourceNoVendor = ops.find((o) => o.opType === 'outsource' && !o.outsourceVendorText);
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
    setStagedNotice(null);
    try {
      const saved = await update.mutateAsync({
        ...buildPayload(),
        expectedUpdatedAt: opened.expected(),
      });
      if (isStagedResult(saved)) {
        // Edit-approval gate is on and this plan is live: nothing changed on the
        // plan — the edit is now waiting for approval. Say so and keep the modal
        // open so the planner reads it (there is no detail page to land on here).
        setStagedNotice('Sent for approval — your changes will apply once an approver signs off.');
        return;
      }
      // A failed Finalize leaves the modal open; the next Save must carry the
      // version our own save just wrote, not the one the modal opened with.
      opened.saved(saved.updatedAt);
      if (finalizeAfter) await finalize.mutateAsync(plan.id);
      onSaved();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not save Plan. Try again.');
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
      ? machineRows
          .filter((m) => m.machineGroupId === groupId)
          .map((m) => ({
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
        className="btn btn-primary"
        onClick={() => onSave(true)}
        disabled={update.isPending || finalize.isPending}
      >
        {update.isPending || finalize.isPending ? (
          <>
            <Loader2 className="inline-block animate-spin" style={{ width: 14, height: 14 }} />{' '}
            Saving…
          </>
        ) : (
          // Legacy editPlan's single save always sets status='Planned', i.e. it
          // is this button, not Save Draft.
          'Save Plan'
        )}
      </button>
    </>
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
        fontSize: 11,
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

  // The two item parts of the identity line below. Empty string, not a dash:
  // DocIdent leaves a part out entirely when the plan does not carry it.
  const identItemCode = itemCodeWithRev(plan.itemCode ?? plan.itemCodeText, plan.itemRevision, '');
  const identItemName = plan.itemName ?? plan.itemNameText ?? '';

  return (
    <Modal title={`Edit Plan ${plan.code}`} size="lg" onClose={onClose} footer={footer}>
      {/* WHICH plan this is — identity only, the same line Create Plan shows,
          so the two screens read as one form. A part the plan does not have is
          left out of the line; it is never printed as a dash. */}
      <DocIdent>
        <IdentCode>{plan.code}</IdentCode>
        {plan.soCodeText ? (
          <>
            <IdentSep />
            <span>
              <IdentCode>{soNoWithInternal(plan.soCodeText, plan.soInternalNo)}</IdentCode>
              {plan.lineNo != null ? ` Ln ${plan.lineNo}` : ''}
            </span>
          </>
        ) : null}
        {identItemCode ? (
          <>
            <IdentSep />
            <span>
              <IdentCode>{identItemCode}</IdentCode>
              {identItemName ? ` ${identItemName}` : ''}
            </span>
          </>
        ) : null}
      </DocIdent>

      {/* The quantity account, ending on the result it adds up to. Plan Qty is
          a FIELD sitting inside the arithmetic it changes, not a box off to one
          side of it.

          Covered / Pending are the ADR-185 figures (lib/plan-order-coverage.ts),
          the same two the Plans list states. On an old `ops_source='plan'` plan
          they arrive as 0 and Plan Qty, which is literally true there — nothing
          is covered by a Production Order yet, because that flow never raises
          one. */}
      <ClusterGrid>
        <Cluster>
          <ClusterFact num label="Order Qty" value={String(plan.orderQty)} />
          <FormField label="Plan Qty" required htmlFor="edit-plan-qty">
            <input
              id="edit-plan-qty"
              type="number"
              min={1}
              max={plan.orderQty}
              className="innovic-input cl-num"
              value={planQty}
              onChange={(e) => setPlanQty(Number(e.target.value))}
            />
          </FormField>
          <ClusterFact num label="Covered" value={String(plan.coveredQty)} />
          {/* Recomputed from the TYPED Plan Qty, not read off the plan.
              `plan.pendingQty` is the server's figure for the SAVED plan qty,
              so a saved 20 with 10 Covered still read "Pending 10" after you
              typed 50 — the row stopped adding up at the one moment it is
              being used. Same arithmetic as the server
              (PLAN_PENDING_QTY_SQL / lib/plan-order-coverage.ts): plan qty
              less what live Production Orders already cover, floored at 0. */}
          <ClusterFact
            num
            lead
            label="Pending"
            value={String(Math.max(0, (Number(planQty) || 0) - plan.coveredQty))}
          />
        </Cluster>
      </ClusterGrid>
      <div className="divider" />

      {/* The rest of the header in ONE grid: four cells to a row, both rows
          coming out full — 3/12 four times, then 3/12 + 3/12 + 6/12. */}
      <div className="form-grid-12" style={{ marginBottom: 'var(--sp-3)' }}>
        <FormField
          label="Plan Type"
          required
          size="sm"
          htmlFor="edit-plan-type"
          help={PLAN_TYPE_HELP[planType]}
        >
          <select
            id="edit-plan-type"
            className="innovic-select"
            value={planType}
            onChange={(e) => setPlanType(e.target.value as PlanType)}
          >
            <option value="manufacture">Manufacture</option>
            <option value="full_outsource">Full Outsource</option>
            {/* Direct Purchase buys the finished item outright, which is
                meaningless on a job-work order (the client owns the job and
                supplies the material). Hidden for a JWSO-sourced plan exactly
                as the old picture-card picker hid it; the server refuses it
                as well, so a direct API call cannot set it either. */}
            {isJw && planType !== 'direct_purchase' ? null : (
              <option value="direct_purchase" disabled={isJw}>
                Direct Purchase
              </option>
            )}
            {/* Assembly is never OFFERED: the old picker had no Assembly card
                and lit its Manufacture card for an assembly plan. The option
                appears only when the plan already IS one, so the box states
                what it is instead of rendering blank.

                Same reason the hidden Direct Purchase option comes back above
                when a JW plan somehow carries it (a legacy row, a direct API
                write): a controlled <select> whose value matches no option
                paints the FIRST option instead, so the box would have said
                "Manufacture" while the Direct Purchase block rendered below it
                and the save kept `direct_purchase`. Shown disabled — it states
                the plan's type without offering it as a choice. */}
            {planType === 'assembly' ? <option value="assembly">Assembly</option> : null}
          </select>
        </FormField>

        <FormField label="Planned Start Date" size="sm" htmlFor="edit-plan-start">
          <input
            id="edit-plan-start"
            type="date"
            className="innovic-input"
            value={plannedStartDate}
            onChange={(e) => setPlannedStartDate(e.target.value)}
          />
        </FormField>

        <FormField label="Planned End Date" size="sm" htmlFor="edit-plan-end">
          <input
            id="edit-plan-end"
            type="date"
            className="innovic-input"
            value={plannedEndDate}
            onChange={(e) => setPlannedEndDate(e.target.value)}
          />
        </FormField>

        <FormField label="Customer Dispatch Date" size="sm" htmlFor="edit-plan-dispatch">
          <input
            id="edit-plan-dispatch"
            type="date"
            className="innovic-input"
            value={customerDispatchDate}
            onChange={(e) => setCustomerDispatchDate(e.target.value)}
          />
        </FormField>

        {/* RM Grade / RM Size (docs/NAMING.md) — ADR-218: what this plan holds,
            shown and not picked. The Route Card (or the BOM line for a BOM
            child) is the only place either value can be changed. */}
        <FormField label="RM Grade" size="sm" htmlFor="edit-plan-rm-grade" help={RM_SOURCE_HELP}>
          <MaterialValueDisplay id="edit-plan-rm-grade" value={plan.rawMaterialGradeText} />
        </FormField>

        <FormField label="RM Size" size="sm" htmlFor="edit-plan-rm-size">
          <MaterialValueDisplay id="edit-plan-rm-size" value={plan.rawMaterialSizeText} />
        </FormField>

        <FormField label="Remarks" size="lg" htmlFor="edit-plan-remarks">
          <textarea
            id="edit-plan-remarks"
            className="innovic-textarea"
            rows={2}
            value={remarks}
            onChange={(e) => setRemarks(e.target.value)}
          />
        </FormField>
      </div>

      {/* Manufacture section */}
      {(planType === 'manufacture' || planType === 'assembly') && (
        <div style={{ marginBottom: 14 }}>
          {/* A quiet section heading row — `.section-hdr`, the heading the rest
              of the app's modals use — in place of the old bordered panel with
              its tinted header strip. Nothing inside the section changed. */}
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              gap: 'var(--sp-2)',
              flexWrap: 'wrap',
              marginBottom: 'var(--sp-2)',
            }}
          >
            <div style={{ minWidth: 0 }}>
              <div className="section-hdr" style={{ marginBottom: 0 }}>
                Operations Routing
              </div>
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
                        <span className="badge b-blue" style={{ marginLeft: 4, fontSize: 11 }}>
                          Route Card Rev {defaultOpsQuery.data.routeCardRevision}
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
                      Route Card: <span style={{ color: 'var(--amber2)' }}>none</span> &mdash; enter
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
                + Add Outsource Op
              </button>
              <button
                type="button"
                className="btn btn-sm"
                style={{
                  background: 'rgba(34,197,94,0.08)',
                  color: 'var(--green2)',
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
              <div style={{ fontSize: 12 }}>No operations yet.</div>
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
                    <th style={{ width: 40, textAlign: 'center' }}>Op</th>
                    {/* The Group column leads because it is the first thing the
                        planner decides — what KIND of step this is (a machine
                        family, an OSP hand-off, or a QC check). Everything to the
                        right of it is scoped by that answer. */}
                    <th style={{ width: 190 }}>Group</th>
                    <th style={{ width: 210 }}>Machine / Vendor</th>
                    <th style={{ minWidth: 200 }}>Operation</th>
                    <th style={{ width: 96 }}>Cycle Time (min)</th>
                    <th style={{ width: 132, color: 'var(--amber2)' }}>OSP</th>
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
                          <td className="td-ctr mono fw-700" style={{ color: 'var(--green2)' }}>
                            {opSrNo(i + 1)}
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
                        {/* Shown as 10, 20, 30 — display rule, see opSrNo. The
                            stored opSeq stays 1, 2, 3. */}
                        <td className="td-ctr mono fw-700">{opSrNo(i + 1)}</td>
                        <td>
                          {isOS ? (
                            stepBadge(
                              '🏭 OSP',
                              'var(--purple)',
                              'rgba(124,58,237,0.12)',
                              'rgba(124,58,237,0.3)',
                            )
                          ) : (
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
                              value={
                                op.outsourceVendorId ?? vendorIdByCode(op.outsourceVendorText ?? '')
                              }
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
                              fontSize: 11,
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
        <div style={{ marginBottom: 14 }}>
          {/* Quiet `.section-hdr` heading instead of the old purple-tinted box.
              Every field inside is unchanged. */}
          <div className="section-hdr">📦 Full Outsource Details</div>
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
                style={{ fontSize: 14, color: 'var(--green2)', fontWeight: 700 }}
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
              <label className="form-label">🏢 Cost Centre</label>
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
        <div style={{ marginBottom: 14 }}>
          {/* Quiet `.section-hdr` heading instead of the old green-tinted box.
              Every field inside is unchanged. */}
          <div className="section-hdr">🛒 Direct Purchase Details</div>
          <div className="form-grid">
            <div className="form-grp">
              <label className="form-label" style={{ color: 'var(--green2)' }}>
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
      <div style={{ marginTop: 14 }}>
        {/* Quiet `.section-hdr` heading row instead of the old bordered box
            with its tinted header strip. The table and the ★ footnote below
            are unchanged. */}
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            gap: 'var(--sp-2)',
            flexWrap: 'wrap',
            marginBottom: 'var(--sp-2)',
          }}
        >
          <div className="section-hdr" style={{ marginBottom: 0 }}>
            📋 Required QC Documents
          </div>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => setRequiredDocs((prev) => [...prev, { name: '', mandatory: true }])}
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
                    <th style={{ width: 44, textAlign: 'center' }}>Sr No</th>
                    <th>Document Name ★</th>
                    <th style={{ width: 180 }}>Requirement</th>
                    <th style={{ width: 56 }} />
                  </tr>
                </thead>
                <tbody>
                  {requiredDocs.map((d, i) => (
                    <tr key={i} style={{ background: i % 2 === 0 ? 'var(--bg)' : 'var(--bg3)' }}>
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
            fontSize: 11,
            color: 'var(--text3)',
            borderTop: '1px solid var(--border)',
          }}
        >
          ★ Mandatory docs must be uploaded before QC can complete.
        </div>
      </div>

      {err ? (
        <div
          style={{
            marginTop: 12,
            padding: 8,
            borderRadius: 4,
            background: 'rgba(239,68,68,0.1)',
            color: 'var(--red2)',
            fontSize: 12,
          }}
        >
          {err}
        </div>
      ) : null}
      {stagedNotice ? (
        <div
          style={{
            marginTop: 12,
            padding: 8,
            borderRadius: 4,
            background: 'var(--bg3)',
            border: '1px solid var(--border2)',
            color: 'var(--text2)',
            fontSize: 12,
          }}
        >
          {stagedNotice}
        </div>
      ) : null}
    </Modal>
  );
}
