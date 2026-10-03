// Shared Route Card form used by create + edit routes.
//
// Redesigned to the owner-approved layout, 2026-10-03:
//
// Header: three rows of 12 columns, the same four widths on both data rows so
// the columns line up down the panel as well as across — RC No. / Item Code /
// Item Name / Plan Type, then RM Grade / RM Size / RM Item / RM Qty per piece,
// then Remarks. The "Rev N → N+1" indicator moved off the grid onto the page
// header's subtitle, so create and edit draw the identical grid.
//
// Op editor: 7 data columns — Op / Group / Machine or Vendor / Operation /
// Cycle Time (min) / Program No. / Lead Days — plus one action cell holding
// "▸ More" and Remove. Tool No. and Tool Details are no longer rendered (they
// are still stored and still saved; see RouteCardFormOpDraft), and the per-op
// Remarks lives in the "▸ More" drawer, the shape Create PO uses for a
// per-line remark. Mirrors legacy rcOpsHtml (L10208), the single op renderer
// shared by BOTH legacy entry points — addRouteCard() (L6939, via
// _rcCheckExisting L6994) and editRouteCard() (L10169, direct call at L10198).
// That shared renderer is why legacy's two modes are field-identical.

import type {
  CreateRouteCardOpInput,
  Machine,
  RouteCard,
  RouteCardDetail,
  RouteCardPlanType,
  Vendor,
} from '@innovic/shared';
import { ITEM_TYPE_RULES, type ItemType } from '@innovic/shared';
import { opSrNo, qcAfterOutsourceError } from '@innovic/shared';
import { Link } from '@tanstack/react-router';
import { Trash2 } from 'lucide-react';
import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { QcProcessPicker } from '@/components/shared/qc-process-picker';
import { type RmItemValue, rmItemToInput } from '@/components/shared/rm-item-fields';
import { useItemsList } from '@/modules/items/api';
import { useMachineGroupsList, useMachinesList } from '@/modules/machines/api';
import { usePlansList } from '@/modules/plans/api';
import { MachineGroupPicker } from '@/modules/machines/components/machine-group-picker';
import {
  MaterialGradePicker,
  MaterialSizePicker,
} from '@/modules/raw-material/components/raw-material-pickers';
import { useVendorsList } from '@/modules/vendors/api';
import { Panel } from '@/ui/data';
import { Banner, ConfirmDialog } from '@/ui/feedback';
import { FormField, FormGrid, SearchableSelect } from '@/ui/forms';
import { PageHeader, useSaveShortcut } from '@/ui/layout';
import { useFetchRouteCard, useNextRouteCardCode, useRouteCardsList } from '../api';

export type RouteCardOpType = 'process' | 'qc' | 'outsource';

/** Columns in the operations table: Op, Group, Machine / Vendor, Operation,
 *  Cycle Time (min), Program No., Lead Days, actions. The "▸ More" drawer row
 *  spans all but the first, so the two have to agree. */
const RC_OP_COL_COUNT = 8;

/** Plan Type as a plain Select, the same control Create SO uses for SO Type.
 *  `assembly` is never offered here (it needs a BOM behind an order line and
 *  is decided at planning). ADR-171: `direct_purchase` is no longer offered
 *  either — it shows only on a card that already holds it, so such a card
 *  still opens and still saves unchanged. Same filter the Plan form uses. */
const RC_PLAN_TYPE_OPTIONS: Array<{ value: RouteCardPlanType; label: string }> = [
  { value: 'manufacture', label: 'Manufacture' },
  { value: 'full_outsource', label: 'Full Outsource' },
  { value: 'direct_purchase', label: 'Buy' },
];

export interface RouteCardFormOpDraft {
  // DISPLAY-ONLY, never sent: the machine group narrows the machine list for
  // this row, exactly as the GROUP column on SO Planning does. route_card_ops
  // has no group column — the machine carries its group in the master, so the
  // group is re-read from the picked machine whenever the card is opened.
  machineGroupId: string | null;
  // Resolved on machine-code change (or null when QC/OSP).
  machineId: string;
  machineCodeText: string; // displayed value; also stored as fallback
  operation: string;
  opType: RouteCardOpType;
  cycleTimeMin: string; // MINUTES per piece
  program: string;
  // Tool No. / Tool Details are NO LONGER shown or editable on this form (the
  // 2026-10-03 redesign took them off the grid), but they stay on the draft,
  // on every factory and in the submit payload: old cards hold these values
  // and editing a card must never wipe a tool number that is already saved.
  toolNo: string;
  toolDetails: string;
  // Free text for ONE step — "leave 0.4 mm for grinding", "send the MTC with
  // the DC". Lives in the row's "▸ More" drawer (migration 0195).
  remarks: string;
  qcRequired: boolean;
  // OSP-only fields. Resolved on vendor-code change.
  ospVendorId: string;
  ospVendorCodeText: string;
  // DISPLAY-ONLY, never sent: the picked vendor's name, so the box reads
  // "CODE — Name" even when that vendor is not on the current search page.
  ospVendorName?: string;
  ospLeadDays: string;
}

export interface RouteCardFormHeaderDraft {
  code: string;
  itemId: string;
  itemCodeText: string; // code snapshot, shown in the field once picked
  itemName: string; // name snapshot, shown under the picker (survives a search that pages past it)
  // Raw material — two INDEPENDENT master pickers, both optional. The id links
  // to the master; the *Text snapshot is what the detail page and the printout
  // still show after the master row is renamed, so both travel together and
  // both go null together when the picker is cleared.
  rawMaterialGradeId: string | null;
  rawMaterialGradeText: string | null;
  rawMaterialSizeId: string | null;
  rawMaterialSizeText: string | null;
  // ADR-193 phase 3a: the RM ITEM + qty per piece (Required on the JC).
  rawMaterialItemId: string | null;
  rawMaterialItemCode: string | null;
  rmQtyPerPiece: string;
  notes: string;
  // How this item is normally made — the same three-way choice SO Planning
  // asks per plan, recorded once on the card as the default.
  planType: RouteCardPlanType;
}

interface RouteCardFormProps {
  mode: 'create' | 'edit';
  initialHeader: RouteCardFormHeaderDraft;
  initialOps: RouteCardFormOpDraft[];
  routeCard?: RouteCard | null; // edit-only: drives Rev N → N+1 indicator
  onSubmit: (
    header: RouteCardFormHeaderDraft,
    ops: RouteCardFormOpDraft[],
    revisionNote: string | null,
  ) => Promise<void>;
  submitting: boolean;
  submitError: string | null;
  onCancel: () => void;
  /** Header Back — a plain navigation, so the router's exit guard asks first. */
  onBack?: () => void;
}

/** A saved card's operations as editable form rows — used by the edit page to
 *  open a card, and by "Copy ops from Route Card…" on create. One mapping, so
 *  a copied row and an edited row can never disagree. */
export function detailOpsToDrafts(ops: RouteCardDetail['ops']): RouteCardFormOpDraft[] {
  return ops.map((op) => ({
    // Group is display-only; the form reads it back off the machine master
    // once the machines list has loaded.
    machineGroupId: null,
    machineId: op.machineId ?? '',
    machineCodeText: op.machineCode ?? op.machineCodeText ?? '',
    operation: op.operation,
    opType: op.opType,
    // Legacy: `${op.cycleTime||''}` — a stored 0 renders blank, same as a
    // freshly added row. Keeps create/edit identical (ISSUE-099).
    cycleTimeMin: Number(op.cycleTimeMin) ? String(Number(op.cycleTimeMin)) : '',
    program: op.program ?? '',
    toolNo: op.toolNo ?? '',
    toolDetails: op.toolDetails ?? '',
    remarks: op.remarks ?? '',
    qcRequired: op.qcRequired,
    ospVendorId: op.ospVendorId ?? '',
    ospVendorCodeText: op.ospVendorCode ?? op.ospVendorCodeText ?? '',
    ospVendorName: op.ospVendorName ?? '',
    ospLeadDays: op.ospLeadDays != null ? String(op.ospLeadDays) : '',
  }));
}

/** A row counts as typed when ANY field the user fills is filled — not just
 *  the operation name — so a copy never silently drops a picked machine, a
 *  cycle time, a vendor, a program, a tool or a remark. */
function isOpRowTyped(o: RouteCardFormOpDraft): boolean {
  return [
    o.operation,
    o.machineId,
    o.machineCodeText,
    o.cycleTimeMin,
    o.program,
    o.toolNo,
    o.toolDetails,
    o.remarks,
    o.ospVendorId,
    o.ospVendorCodeText,
    o.ospLeadDays,
  ].some((v) => v.trim() !== '');
}

export function emptyProcessOp(): RouteCardFormOpDraft {
  return {
    machineGroupId: null,
    machineId: '',
    machineCodeText: '',
    operation: '',
    opType: 'process',
    // Legacy renders `${op.cycleTime||''}` as a blank cell (L10216 /
    // L10240), not a literal 0. opsToInput coerces '' → 0.
    cycleTimeMin: '',
    program: '',
    toolNo: '',
    toolDetails: '',
    remarks: '',
    qcRequired: false,
    ospVendorId: '',
    ospVendorCodeText: '',
    ospLeadDays: '',
  };
}

export function emptyQcOp(): RouteCardFormOpDraft {
  return {
    ...emptyProcessOp(),
    machineCodeText: 'QC',
    opType: 'qc',
    qcRequired: true,
  };
}

export function emptyOspOp(): RouteCardFormOpDraft {
  return {
    ...emptyProcessOp(),
    opType: 'outsource',
    ospLeadDays: '5',
  };
}

export function RouteCardForm(props: RouteCardFormProps): React.JSX.Element {
  const {
    mode,
    initialHeader,
    initialOps,
    routeCard,
    onSubmit,
    submitting,
    submitError,
    onCancel,
    onBack,
  } = props;
  const [header, setHeader] = useState<RouteCardFormHeaderDraft>(initialHeader);
  const [ops, setOps] = useState<RouteCardFormOpDraft[]>(initialOps);
  const [revisionNote, setRevisionNote] = useState('');

  // Master-only item picker, same as Create SO: type to search the server, the
  // dropdown lists "CODE — Name", the field shows the code once picked. Server
  // search (not load-all) so the box scales past a page of items.
  const [itemSearch, setItemSearch] = useState('');
  const { data: itemsList, isFetching: itemsFetching } = useItemsList({
    ...(itemSearch.trim() ? { search: itemSearch.trim() } : {}),
    limit: 50,
    offset: 0,
  });
  // machines list-query schema caps `limit` at 200 — 500 makes the route
  // 400, leaving the picker empty. Stay ≤ 200. Vendors are NOT loaded here:
  // each OSP row's vendor box searches the server itself (RouteCardVendorCell),
  // so a vendor past the first page (e.g. VND-760) can still be picked.
  const { data: machinesList } = useMachinesList({ limit: 200, offset: 0 });
  // Machine groups exist only to label and narrow the machine picker; the id
  // → code map lets a row show "VMC" for the group its machine belongs to.
  const { data: machineGroups } = useMachineGroupsList({ limit: 200, offset: 0 });
  const machineGroupCodeById = useMemo(
    () => new Map((machineGroups?.groups ?? []).map((g) => [g.id, g.code])),
    [machineGroups],
  );

  // Create-mode only: prefill the RC No with the previewed next code once,
  // while the field is still blank. Keeps the field editable (user may
  // override) and never clobbers a value they've already typed.
  const { data: nextCodeData } = useNextRouteCardCode({ enabled: mode === 'create' });
  const codePrefilled = useRef(false);
  useEffect(() => {
    if (mode !== 'create' || codePrefilled.current) return;
    const next = nextCodeData?.code;
    if (!next) return;
    codePrefilled.current = true;
    setHeader((prev) => (prev.code.trim() ? prev : { ...prev, code: next }));
  }, [mode, nextCodeData]);

  const machinesByCode = useMemo(() => {
    const m = new Map<string, Machine>();
    for (const x of machinesList?.machines ?? []) m.set(x.code.toUpperCase(), x);
    return m;
  }, [machinesList]);

  // The picker returns the master item's id. Snapshot its code (shown in the
  // field) and name (shown underneath) so both survive a later search that
  // pages past this item. Clearing the box empties all three together.
  const onPickItem = (id: string | null): void => {
    const it = (itemsList?.items ?? []).find((i) => i.id === id);
    setHeader({
      ...header,
      itemId: it?.id ?? '',
      itemCodeText: it?.code ?? '',
      itemName: it?.name ?? '',
    });
  };

  // "This item already has a route card" (user, 2026-09-22; hardened by the
  // 2026-09-28 form audit). On create, the moment an item is picked we look up
  // its route cards. The server ALWAYS refuses a second card for an item, so
  // the form is blocked instead of warned: the operations table is hidden,
  // Save is off, and the banner offers "Open RC-xxxx to add a revision" —
  // nobody types ten ops only to lose them to a refusal on Save.
  const { data: existingForItem } = useRouteCardsList(
    { itemId: header.itemId, limit: 5, offset: 0 },
    { enabled: mode === 'create' && Boolean(header.itemId) },
  );
  const existingCards = mode === 'create' && header.itemId ? (existingForItem?.items ?? []) : [];
  const blockingCard = existingCards[0] ?? null;

  // "Copy ops from Route Card…" (round-2 "Next" item, 2026-09-26). On create,
  // pick any existing card and its operations are copied into this form as
  // ordinary editable rows — a similar part's routing, not re-typed by hand.
  // The copy is a one-time fill: nothing links the two cards afterwards.
  const [copySearch, setCopySearch] = useState('');
  const [copyFromId, setCopyFromId] = useState<string | null>(null);
  const [copiedFrom, setCopiedFrom] = useState<{ id: string; label: string } | null>(null);
  const { data: copyList, isFetching: copyListFetching } = useRouteCardsList(
    { ...(copySearch.trim() ? { search: copySearch.trim() } : {}), limit: 20, offset: 0 },
    { enabled: mode === 'create' },
  );
  const fetchRouteCard = useFetchRouteCard();
  // The picker's choice waiting on "replace what you typed?" — set only when
  // the form already holds typed rows.
  const [pendingCopy, setPendingCopy] = useState<RouteCardDetail | null>(null);
  const [copyError, setCopyError] = useState<string | null>(null);
  // The latest pick, so a slow fetch for an earlier pick is dropped.
  const copyPickRef = useRef<string | null>(null);
  // Read inside the async handler after the fetch, so it sees the rows as
  // they are THEN, not as they were when the pick was made.
  const opsRef = useRef(ops);
  opsRef.current = ops;
  const applyCopy = (detail: RouteCardDetail): void => {
    setOps(detailOpsToDrafts(detail.ops));
    setCopiedFrom({ id: detail.id, label: `${detail.code} Rev ${detail.currentRevision}` });
    setCopyFromId(detail.id);
  };
  const onPickCopySource = async (id: string | null): Promise<void> => {
    copyPickRef.current = id;
    setCopyError(null);
    setCopyFromId(id);
    if (!id || id === copiedFrom?.id) return;
    let detail: RouteCardDetail;
    try {
      detail = await fetchRouteCard(id);
    } catch (e) {
      if (copyPickRef.current !== id) return;
      setCopyError(e instanceof Error ? e.message : 'Could not load that route card.');
      setCopyFromId(copiedFrom?.id ?? null);
      return;
    }
    if (copyPickRef.current !== id) return;
    if (opsRef.current.some(isOpRowTyped)) {
      setPendingCopy(detail);
      return;
    }
    applyCopy(detail);
  };

  // Raw material prefilled from the item's latest PLAN, on create only.
  //
  // The Route Card is the source of truth for raw material and the chain runs
  // Route Card → Plan. But a planner often knows the material before anyone
  // writes the routing, types it on the plan, and only then makes the card —
  // and then had to type grade and size a second time (user, 2026-09-24).
  //
  // So: while BOTH boxes are still empty, fill them from the newest plan for
  // this item that has either, and say which plan it came from. It is a
  // prefill, not a link — typing over it is the point, and nothing is written
  // back to the plan. Once either box holds a value this never fires again, so
  // it can only ever fill a blank, never overwrite a choice.
  const [rmPrefillFrom, setRmPrefillFrom] = useState<string | null>(null);
  const rmBlank =
    !header.rawMaterialGradeId &&
    !header.rawMaterialGradeText &&
    !header.rawMaterialSizeId &&
    !header.rawMaterialSizeText &&
    !header.rawMaterialItemId;
  const { data: plansForItem } = usePlansList(
    { search: header.itemCodeText, limit: 50, offset: 0 },
    { enabled: mode === 'create' && rmBlank && Boolean(header.itemId && header.itemCodeText) },
  );
  useEffect(() => {
    if (mode !== 'create' || !header.itemId || !rmBlank) return;
    // `search` is a text match, so confirm the row really is THIS item before
    // borrowing its material — a code that is a substring of another's would
    // otherwise hand over the wrong grade.
    const source = (plansForItem?.items ?? []).find(
      (pl) =>
        pl.itemId === header.itemId &&
        (pl.rawMaterialGradeId ||
          pl.rawMaterialGradeText ||
          pl.rawMaterialSizeId ||
          pl.rawMaterialSizeText ||
          pl.rawMaterialItemId),
    );
    if (!source) return;
    setHeader((prev) => ({
      ...prev,
      rawMaterialGradeId: source.rawMaterialGradeId,
      rawMaterialGradeText: source.rawMaterialGradeText,
      rawMaterialSizeId: source.rawMaterialSizeId,
      rawMaterialSizeText: source.rawMaterialSizeText,
      rawMaterialItemId: source.rawMaterialItemId,
      rawMaterialItemCode: source.rawMaterialItemCode,
      rmQtyPerPiece: source.rmQtyPerPiece != null ? String(source.rmQtyPerPiece) : '',
    }));
    setRmPrefillFrom(source.code);
  }, [plansForItem, header.itemId, rmBlank, mode]);

  // A different item means the old prefill note no longer applies.
  useEffect(() => {
    setRmPrefillFrom(null);
  }, [header.itemId]);

  const updateOp = (idx: number, patch: Partial<RouteCardFormOpDraft>): void => {
    setOps((prev) => prev.map((o, i) => (i === idx ? { ...o, ...patch } : o)));
  };

  // Picking a machine that carries a group in the master fills the Group box
  // when it is still empty — the same seeding SO Planning does — so a card
  // opened later reads "VMC · vmc-2", not a bare machine.
  const onOpMachineChange = (idx: number, code: string): void => {
    const match = machinesByCode.get(code.trim().toUpperCase());
    const current = ops[idx];
    updateOp(idx, {
      machineCodeText: code,
      machineId: match?.id ?? '',
      ...(current && current.machineGroupId == null && match?.machineGroupId
        ? { machineGroupId: match.machineGroupId }
        : {}),
    });
  };

  // Picking a group narrows the machine list for that row. A machine already in
  // the box that is NOT in the new group is cleared, so the row cannot read
  // "VMC group, running a lathe" — the planner re-picks inside the group. Only
  // cleared when the mismatch is PROVEN: a machine we cannot find in the loaded
  // rows is left alone rather than blanked on a guess.
  const onOpGroupChange = (idx: number, groupId: string | null): void => {
    const current = ops[idx];
    const machine = current?.machineId
      ? (machinesList?.machines ?? []).find((m) => m.id === current.machineId)
      : undefined;
    const mismatch = groupId != null && machine != null && machine.machineGroupId !== groupId;
    updateOp(idx, {
      machineGroupId: groupId,
      ...(mismatch ? { machineId: '', machineCodeText: '' } : {}),
    });
  };

  // Group is display-only and is not stored, so a card opened for editing has
  // every row's group empty even though its machine belongs to one. Read it
  // back off the master once the machine list is in, for rows that have a
  // machine but no group yet.
  useEffect(() => {
    const rows = machinesList?.machines;
    if (!rows?.length) return;
    setOps((prev) => {
      let changed = false;
      const next = prev.map((o) => {
        if (o.opType !== 'process' || o.machineGroupId != null || !o.machineId) return o;
        const m = rows.find((x) => x.id === o.machineId);
        if (!m?.machineGroupId) return o;
        changed = true;
        return { ...o, machineGroupId: m.machineGroupId };
      });
      return changed ? next : prev;
    });
  }, [machinesList]);

  const onOpVendorChange = (idx: number, v: Vendor | null): void => {
    updateOp(idx, {
      ospVendorId: v?.id ?? '',
      ospVendorCodeText: v?.code ?? '',
      ospVendorName: v?.name ?? '',
    });
  };

  const addOp = (kind: RouteCardOpType): void => {
    setOps((prev) => [
      ...prev,
      kind === 'qc' ? emptyQcOp() : kind === 'outsource' ? emptyOspOp() : emptyProcessOp(),
    ]);
  };
  const removeOp = (idx: number): void => setOps((prev) => prev.filter((_, i) => i !== idx));

  const validationError = useMemo<string | null>(() => {
    if (!header.itemId) return 'Item Code is required.';
    if (blockingCard) {
      return `Item ${header.itemCodeText} already has Route Card ${blockingCard.code} — open it to add a revision.`;
    }
    if (ops.length === 0) return 'Add at least one operation.';
    for (let i = 0; i < ops.length; i++) {
      const o = ops[i]!;
      // Messages name the op as the table shows it (10, 20, 30) — see opSrNo.
      const sr = opSrNo(i + 1);
      if (!o.operation.trim()) return `Op ${sr}: Operation is required.`;
      // Master-only (2026-09-28 audit): a typed machine that is not in the
      // Machine Master was saved as text only, so loading and costing never
      // saw the op. An old row holding such text must be re-picked.
      if (o.opType === 'process' && !o.machineId) {
        return o.machineCodeText.trim()
          ? `Op ${sr}: Machine "${o.machineCodeText.trim()}" is not in the Machine Master — pick one from the list.`
          : `Op ${sr}: Machine is required.`;
      }
      if (o.opType === 'outsource' && !o.ospVendorId && !o.ospVendorCodeText.trim()) {
        return `Op ${sr}: Vendor is required.`;
      }
      const cycle = Number(o.cycleTimeMin);
      if (!Number.isFinite(cycle) || cycle < 0) {
        return `Op ${sr}: Cycle Time (min) cannot be less than 0.`;
      }
      if (o.ospLeadDays.trim()) {
        const lead = Number(o.ospLeadDays);
        if (!Number.isInteger(lead) || lead < 0) {
          return `Op ${sr}: Lead Days must be a whole number, 0 or more.`;
        }
      }
    }
    // Shared routing rule (ADR-179), the same the Job Card form and the API
    // enforce: a non-TPI QC op cannot sit directly after an OSP op. TPI IS
    // allowed there (it inspects the vendor's work), so `operation` is passed
    // on every op — that is how the shared rule recognises and exempts TPI.
    // opSeq = i + 1 so the message names the Sr No the table shows (10, 20…).
    const seqError = qcAfterOutsourceError(
      ops.map((o, i) => ({ opType: o.opType, operation: o.operation, opSeq: i + 1 })),
    );
    if (seqError) return seqError;
    return null;
  }, [header, ops, blockingCard]);

  const save = async (): Promise<void> => {
    if (validationError || submitting) return;
    await onSubmit(
      header,
      ops,
      mode === 'edit' && revisionNote.trim() ? revisionNote.trim() : null,
    );
  };
  const submit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    await save();
  };
  // Ctrl+S runs the same Save as the header button (no-op while it is disabled).
  useSaveShortcut(() => void save(), !submitting);

  // Display-only totals under the operations table: how long the whole routing
  // takes on the machines, and how many days it spends out at vendors. Summed
  // only from the rows where the column is live — a dimmed cell is not shown,
  // so a stale value behind one must not show up in a total either.
  const totalCycleMin = useMemo(
    () =>
      Math.round(
        ops.reduce((s, o) => (o.opType === 'process' ? s + (Number(o.cycleTimeMin) || 0) : s), 0) *
          100,
      ) / 100,
    [ops],
  );
  const totalLeadDays = useMemo(
    () =>
      ops.reduce((s, o) => (o.opType === 'outsource' ? s + (Number(o.ospLeadDays) || 0) : s), 0),
    [ops],
  );

  return (
    <form onSubmit={(e) => void submit(e)}>
      <PageHeader
        sticky
        title={mode === 'create' ? 'New Route Card' : `Edit Route Card — ${routeCard?.code ?? ''}`}
        // The "Rev N → N+1" indicator used to take a slot on the header grid,
        // which made create and edit lay out differently. It is a fact ABOUT
        // the document, not a field, so it now sits on the header band and the
        // grid is identical in both modes.
        subtitle={
          mode === 'edit' && routeCard ? (
            <span className="mono fw-700" style={{ color: 'var(--amber2)', fontSize: 14 }}>
              Route Card Rev {routeCard.currentRevision} →{' '}
              <span style={{ color: 'var(--green2)' }}>{routeCard.currentRevision + 1}</span>
            </span>
          ) : undefined
        }
        backLabel="Back"
        onBack={onBack ?? onCancel}
        actions={
          <>
            <button type="button" className="btn btn-ghost" onClick={onCancel}>
              Cancel
            </button>
            <button
              type="submit"
              className="btn btn-primary"
              disabled={Boolean(validationError) || submitting}
              title={validationError ?? undefined}
            >
              {submitting ? 'Saving…' : mode === 'create' ? 'Save Route Card' : 'Save Changes'}
            </button>
          </>
        }
      />
      {/* Why Save is disabled / why it failed — right under the header, where
          the Save button is, instead of at the foot of the form. */}
      {validationError ? (
        <div className="form-error" style={{ marginBottom: 'var(--sp-2)' }}>
          {validationError}
        </div>
      ) : null}
      {submitError ? (
        <Banner tone="error" role="alert">
          {submitError}
        </Banner>
      ) : null}
      {blockingCard ? (
        <Banner
          tone="warn"
          role="alert"
          accent
          title={
            <>
              Item <span className="mono">{header.itemCodeText}</span> already has Route Card{' '}
              <span className="mono">{blockingCard.code}</span>
            </>
          }
        >
          <div
            style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-2)', flexWrap: 'wrap' }}
          >
            <span style={{ flex: 1 }}>
              An item has one Route Card. Changes to its operations are saved as a new revision of
              that card, not as a second card.
            </span>
            <Link
              to="/route-cards/$id/edit"
              params={{ id: blockingCard.id }}
              className="btn btn-primary btn-sm"
            >
              Open {blockingCard.code} to add a revision
            </Link>
          </div>
        </Banner>
      ) : null}
      {/* Plain panels (the old inline cyan / amber left stripes were not theme
          classes). Header fields sit on the 12-column grid, sized by content. */}
      <Panel title="Route Card Details">
        <FormGrid>
          <FormField label="RC No." size="sm">
            <input
              className="innovic-input"
              value={header.code}
              onChange={(e) => setHeader({ ...header, code: e.target.value })}
              placeholder={mode === 'create' ? 'IN-RC-NNNNN (auto if blank)' : ''}
            />
          </FormField>
          <FormField label="Item Code" required size="sm">
            {/* The same master-only picker Create SO uses (SearchableSelect),
                not a free-text datalist: it lists "CODE — Name", shows the code
                in the field once picked, and only lets a real master item be
                chosen — so an off-master typo can no longer sit in the box
                looking accepted. */}
            <SearchableSelect
              id="rc-item"
              value={header.itemId || null}
              onChange={onPickItem}
              onSearch={setItemSearch}
              loading={itemsFetching}
              options={(itemsList?.items ?? []).map((i) => ({
                id: i.id,
                code: i.code,
                name: i.name,
              }))}
              placeholder="🔍 Search item code or name…"
              valueLabel={header.itemCodeText || undefined}
              selectedLabel={(o) => o.code ?? o.name}
            />
          </FormField>
          {/* Item Name — read-only, auto-filled from the picked item, sitting
              right beside Item Code (the format Create SO shows). It mirrors
              the master; you pick the item by code, the name follows. */}
          <FormField label="Item Name" size="md">
            <input
              className="innovic-input"
              value={header.itemName}
              readOnly
              placeholder="—"
              style={{ background: 'var(--bg4)', color: 'var(--text2)' }}
            />
          </FormField>
          {/* Plan Type — the same choice SO Planning asks for every plan,
              recorded once here as the item's default. A plain Select, exactly
              as Create SO asks for SO Type. */}
          <FormField label="Plan Type" required size="xs" htmlFor="rc-plantype">
            <select
              id="rc-plantype"
              className="innovic-select"
              value={header.planType}
              onChange={(e) =>
                setHeader((prev) => ({ ...prev, planType: e.target.value as RouteCardPlanType }))
              }
            >
              {RC_PLAN_TYPE_OPTIONS.filter(
                (o) => o.value !== 'direct_purchase' || header.planType === 'direct_purchase',
              ).map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </FormField>
          {/* Raw material — Grade, Size, RM Item and RM Qty per piece, all
              optional (no ★ on any). The same four pickers Planning and the Job
              Card form use, so the route card names the same stock they do;
              they sit straight on the grid under Row 1 so the four columns line
              up down the panel as well as across. */}
          <FormField label="RM Grade" size="sm">
            <MaterialGradePicker
              valueId={header.rawMaterialGradeId}
              valueText={header.rawMaterialGradeText}
              onChange={(id, text) =>
                setHeader((prev) => ({
                  ...prev,
                  rawMaterialGradeId: id,
                  rawMaterialGradeText: text,
                }))
              }
            />
          </FormField>
          <FormField label="RM Size" size="sm">
            <MaterialSizePicker
              valueId={header.rawMaterialSizeId}
              valueText={header.rawMaterialSizeText}
              onChange={(id, text) =>
                setHeader((prev) => ({
                  ...prev,
                  rawMaterialSizeId: id,
                  rawMaterialSizeText: text,
                }))
              }
            />
          </FormField>
          <RouteCardRmItemFields
            value={{
              rawMaterialItemId: header.rawMaterialItemId,
              rawMaterialItemCode: header.rawMaterialItemCode,
              rmQtyPerPiece: header.rmQtyPerPiece,
            }}
            onChange={(v) => setHeader((prev) => ({ ...prev, ...v }))}
          />
          {/* "Route Card Remarks" not "Remarks": the per-operation field in the
              "▸ More" drawer is already called Remarks, and one word cannot name
              two facts on one screen (CLAUDE.md §18). Create PO draws exactly
              this distinction — "PO Remarks" on the document, "Remarks" on the
              line. Same column as before (route_cards.notes), new label. */}
          <FormField label="Route Card Remarks" size="full" htmlFor="rc-remarks">
            <textarea
              id="rc-remarks"
              className="innovic-textarea"
              rows={2}
              value={header.notes}
              onChange={(e) => setHeader({ ...header, notes: e.target.value })}
              placeholder="Optional manufacturing notes…"
            />
          </FormField>
        </FormGrid>
        {/* Quiet notes under the grid, so the three field rows stay three rows
            and the columns keep lining up. */}
        {rmPrefillFrom ? (
          <div className="text3" style={{ fontSize: 11, marginTop: 'var(--sp-2)' }}>
            Raw material prefilled from plan{' '}
            <b className="mono" style={{ color: 'var(--text)' }}>
              {rmPrefillFrom}
            </b>{' '}
            — change it if the routing calls for something else.
          </div>
        ) : null}
        {/* ADR-171: `direct_purchase` is no longer offered — a bought-in item is
            flagged Source = Buy on the Item Master and the Planning line raises
            a PR. A card that already holds it keeps it (the Select still shows
            it) and saves unchanged; this line says why it is there. */}
        {header.planType === 'direct_purchase' ? (
          <div style={{ marginTop: 'var(--sp-2)', fontSize: 11, color: 'var(--text2)' }}>
            <span className="badge b-grey">🛒 Buy</span>{' '}
            <span className="text3">Old setting — set the item&apos;s Source to Buy instead.</span>
          </div>
        ) : null}
      </Panel>

      {blockingCard ? null : (
        <Panel
          title={`Operation Sequence (${ops.length})`}
          bodyPadding="none"
          bodyClassName="tbl-wrap"
          actions={
            <>
              {mode === 'create' ? (
                <div
                  style={{ minWidth: 240 }}
                  title="Copy another card's operations into this form"
                >
                  <SearchableSelect
                    id="rc-copy-from"
                    value={copyFromId}
                    onChange={(id) => void onPickCopySource(id)}
                    onSearch={setCopySearch}
                    loading={copyListFetching}
                    options={(copyList?.items ?? []).map((rc) => ({
                      id: rc.id,
                      code: rc.code,
                      name: [rc.itemCode, rc.itemName].filter(Boolean).join(' — ') || '—',
                    }))}
                    placeholder="Copy ops from Route Card…"
                    emptyText="No route cards"
                    selectedLabel={(o) => o.code ?? o.name}
                  />
                </div>
              ) : null}
              {copyError ? (
                <span className="text2" role="alert" style={{ fontSize: 11, color: 'var(--red2)' }}>
                  {copyError}
                </span>
              ) : null}
              {copiedFrom && mode === 'create' ? (
                <span className="text2" style={{ fontSize: 11 }}>
                  Copied from <span className="mono fw-700">{copiedFrom.label}</span> — edit freely
                </span>
              ) : null}
              {/* Create PO's Line Items header order: the occasional actions as
                  ghost buttons, then ONE blue primary last — the button the
                  planner presses most. The old inline purple / green fills are
                  gone; a row's kind is still told by its tint and badge. */}
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => addOp('outsource')}
              >
                + Outsourced op
              </button>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => addOp('qc')}>
                + Inspection
              </button>
              <button
                type="button"
                className="btn btn-primary btn-sm"
                onClick={() => addOp('process')}
              >
                + Add Operation
              </button>
            </>
          }
        >
          <table className="innovic-table tbl-ctr tbl-edit">
            <thead>
              <tr>
                <th style={{ width: 36 }}>Op</th>
                {/* Group replaces the old Type dropdown. The KIND of a row is
                    decided by which Add button raised it (Op / OSP / QC) and is
                    shown by the row's tint and by the QC / OSP badge in this
                    column, exactly as SO Planning does — a second control for
                    the same fact invited rows whose Type disagreed with their
                    machine. */}
                <th style={{ width: 140 }}>Group</th>
                <th style={{ width: 150 }}>
                  Machine / Vendor<span className="req">★</span>
                </th>
                <th>
                  Operation<span className="req">★</span>
                </th>
                <th className="th-num" style={{ width: 90 }}>
                  Cycle Time (min)
                </th>
                <th style={{ width: 90 }}>Program No.</th>
                <th className="th-num" style={{ width: 70 }}>
                  Lead Days
                </th>
                <th style={{ width: 120 }}></th>
              </tr>
            </thead>
            <tbody>
              {ops.length === 0 ? (
                <tr>
                  <td colSpan={RC_OP_COL_COUNT} className="empty-state">
                    No operations yet.
                  </td>
                </tr>
              ) : (
                ops.map((op, idx) => (
                  <RouteCardOpRow
                    key={idx}
                    idx={idx}
                    op={op}
                    machinesList={machinesList?.machines ?? []}
                    machineGroupCodeById={machineGroupCodeById}
                    onChange={(patch) => updateOp(idx, patch)}
                    onMachineChange={(code) => onOpMachineChange(idx, code)}
                    onGroupChange={(gid) => onOpGroupChange(idx, gid)}
                    onVendorChange={(v) => onOpVendorChange(idx, v)}
                    onRemove={() => removeOp(idx)}
                  />
                ))
              )}
            </tbody>
            {/* Display only — nothing is stored or sent from this row. */}
            {ops.length > 0 ? (
              <tfoot>
                <tr className="fw-700">
                  <td className="td-num" colSpan={4}>
                    Total
                  </td>
                  <td className="td-num mono">{totalCycleMin || '—'}</td>
                  <td />
                  <td className="td-num mono">{totalLeadDays || '—'}</td>
                  <td />
                </tr>
              </tfoot>
            ) : null}
          </table>
        </Panel>
      )}

      {mode === 'edit' ? (
        <Panel title="Revision Note">
          <textarea
            className="innovic-textarea"
            rows={2}
            value={revisionNote}
            onChange={(e) => setRevisionNote(e.target.value)}
            placeholder="Optional — auto-filled if blank"
          />
        </Panel>
      ) : null}

      {pendingCopy ? (
        <ConfirmDialog
          title={`Copy operations from ${pendingCopy.code}?`}
          message={`Replace the ${ops.length} operation(s) on this form with the ${pendingCopy.ops.length} from ${pendingCopy.code} Rev ${pendingCopy.currentRevision}?`}
          confirmLabel="Replace operations"
          tone="primary"
          onConfirm={() => {
            applyCopy(pendingCopy);
            setPendingCopy(null);
          }}
          onCancel={() => {
            setPendingCopy(null);
            copyPickRef.current = copiedFrom?.id ?? null;
            setCopyFromId(copiedFrom?.id ?? null);
          }}
        />
      ) : null}
    </form>
  );
}

interface RouteCardOpRowProps {
  idx: number;
  op: RouteCardFormOpDraft;
  machinesList: Machine[];
  machineGroupCodeById: Map<string, string>;
  onChange: (patch: Partial<RouteCardFormOpDraft>) => void;
  onMachineChange: (code: string) => void;
  onGroupChange: (groupId: string | null) => void;
  onVendorChange: (vendor: Vendor | null) => void;
  onRemove: () => void;
}

function RouteCardOpRow(props: RouteCardOpRowProps): React.JSX.Element {
  const {
    idx,
    op,
    machinesList,
    machineGroupCodeById,
    onChange,
    onMachineChange,
    onGroupChange,
    onVendorChange,
    onRemove,
  } = props;
  // The machines this row may offer: the whole list until a group is chosen,
  // then only that group's — narrowed in the browser, as SO Planning does.
  const rowMachines = op.machineGroupId
    ? machinesList.filter((m) => m.machineGroupId === op.machineGroupId)
    : machinesList;
  const groupCode = op.machineGroupId
    ? (machineGroupCodeById.get(op.machineGroupId) ?? null)
    : null;
  const rowBg =
    op.opType === 'qc' ? 'var(--green3)' : op.opType === 'outsource' ? 'var(--purple3)' : undefined;
  const accent =
    op.opType === 'qc'
      ? 'var(--green)'
      : op.opType === 'outsource'
        ? 'var(--purple)'
        : 'var(--text3)';
  const machineLabel = op.machineId
    ? machinesList.find((m) => m.id === op.machineId)?.name
    : op.machineCodeText.trim()
      ? `⚠ "${op.machineCodeText.trim()}" is not in the master — pick again`
      : null;
  // Warning only — the vendor NAME is shown in the picker field itself (CODE — Name).
  const vendorLabel = !op.ospVendorId && op.ospVendorCodeText.trim() ? '⚠ Not in master' : null;
  // The "▸ More" drawer holds the op's Remarks — long free text, which as a
  // column either squeezes the grid or gets cut. Copied from Create PO's line
  // row, including the rule that it opens by itself when the row already
  // carries a remark, so nothing the card holds is hidden on arrival.
  //
  // DERIVED, not seeded. A lazy `useState(() => …)` initialiser runs only when
  // the component for that INDEX first mounts, and these rows are keyed by
  // index — so a card whose ops arrive later would never open its drawers.
  // "Copy ops from Route Card…" is exactly that case: the form starts with one
  // blank row, and the copied remarks would have stayed invisible. Null means
  // "the user has not decided for this row", so until they click, the drawer
  // follows the data.
  const [userToggled, setUserToggled] = useState<boolean | null>(null);
  const moreOpen = userToggled ?? Boolean(op.remarks?.trim());
  return (
    <Fragment>
      <tr style={{ background: rowBg }}>
        <td className="mono fw-700" style={{ color: accent }}>
          {opSrNo(idx + 1)}
        </td>
        <td>
          {op.opType === 'qc' ? (
            <span className="badge b-green" style={{ fontSize: 11 }}>
              🔬 QC
            </span>
          ) : op.opType === 'outsource' ? (
            <span
              className="badge"
              style={{
                fontSize: 11,
                color: 'var(--purple)',
                background: 'var(--purple3)',
                border: '1px solid var(--purple)',
              }}
            >
              🏭 OSP
            </span>
          ) : (
            <MachineGroupPicker
              id={`rc-mgrp-${idx}`}
              valueId={op.machineGroupId}
              valueText={groupCode}
              onChange={onGroupChange}
            />
          )}
        </td>
        <td>
          {op.opType === 'outsource' ? (
            <>
              <RouteCardVendorCell id={`rc-vend-${idx}`} op={op} onChange={onVendorChange} />
              {vendorLabel ? (
                <div className="text3" style={{ fontSize: 11, marginTop: 2 }}>
                  {vendorLabel}
                </div>
              ) : null}
            </>
          ) : op.opType === 'qc' ? (
            <span className="badge b-green" style={{ fontSize: 11 }}>
              QC
            </span>
          ) : (
            <>
              {/* Master-only machine picker (2026-09-28 audit), like the Group and
                Vendor boxes: a machine not in the Machine Master cannot be
                picked, so loading and costing always see the op. */}
              <SearchableSelect
                id={`rc-mach-${idx}`}
                value={op.machineId || null}
                onChange={(id) =>
                  onMachineChange(id ? (machinesList.find((m) => m.id === id)?.code ?? '') : '')
                }
                options={rowMachines.map((m) => ({ id: m.id, code: m.code, name: m.name }))}
                placeholder={op.machineGroupId ? '🔍 Machine in group' : '🔍 Machine'}
                emptyText="No machine in the master"
                valueLabel={
                  op.machineId
                    ? (machinesList.find((m) => m.id === op.machineId)?.code ?? op.machineCodeText)
                    : undefined
                }
                selectedLabel={(o) => o.code ?? o.name}
              />
              {machineLabel ? (
                <div className="text3" style={{ fontSize: 11, marginTop: 2 }}>
                  {machineLabel}
                </div>
              ) : null}
            </>
          )}
        </td>
        <td>
          {op.opType === 'qc' ? (
            // QC operation must come from the QC Process Master (searchable, master-only),
            // the same picker Job Card / SO Planning use. Stores the process name.
            <QcProcessPicker
              id={`rc-qcproc-${idx}`}
              value={op.operation}
              onChange={(code) => onChange({ operation: code })}
            />
          ) : (
            <input
              className="innovic-input"
              value={op.operation}
              onChange={(e) => onChange({ operation: e.target.value })}
              placeholder={
                op.opType === 'outsource' ? 'Coating / Painting / HT…' : 'od turn, mill, drill…'
              }
            />
          )}
        </td>
        {/* A cell a row's KIND cannot use shows a dash that says why, instead of
          an empty input nobody should fill — an empty box reads as a required
          field somebody forgot. Whatever the cell held stays in state
          untouched: dimming must never silently edit the card.
          Dimmed for OUTSOURCED steps ONLY. An inspection keeps both boxes on
          purpose: the QC Process Master carries a Default Cycle Time (min)
          that SO Planning fills a QC op from, and this card is the master a
          plan copies — so inspection time has to be typeable here. A CMM
          program is a real program number on an inspection too. */}
        <td className="td-num">
          {op.opType !== 'outsource' ? (
            <input
              type="number"
              min="0"
              step="0.01"
              className="innovic-input"
              value={op.cycleTimeMin}
              onChange={(e) => onChange({ cycleTimeMin: e.target.value })}
              placeholder="min"
            />
          ) : (
            <span
              className="text3"
              title="An outsourced step has no machine cycle time — it carries Lead Days instead"
            >
              —
            </span>
          )}
        </td>
        <td>
          {op.opType !== 'outsource' ? (
            <input
              className="innovic-input"
              value={op.program}
              onChange={(e) => onChange({ program: e.target.value })}
              placeholder="PRG-001"
              style={{ color: 'var(--blue)' }}
            />
          ) : (
            <span className="text3" title="A program number belongs to an in-house step">
              —
            </span>
          )}
        </td>
        <td className="td-num">
          {op.opType === 'outsource' ? (
            <input
              type="number"
              min="0"
              step="1"
              className="innovic-input"
              value={op.ospLeadDays}
              onChange={(e) => onChange({ ospLeadDays: e.target.value })}
              placeholder="days"
            />
          ) : (
            <span className="text3" title="Lead Days applies to an outsourced step only">
              —
            </span>
          )}
        </td>
        <td style={{ whiteSpace: 'nowrap' }}>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            aria-expanded={moreOpen}
            aria-label={`${moreOpen ? 'Hide' : 'Show'} more fields, operation ${opSrNo(idx + 1)}`}
            onClick={() => setUserToggled(!moreOpen)}
          >
            {moreOpen ? '▾' : '▸'} More
          </button>{' '}
          <button
            type="button"
            className="btn btn-danger btn-sm btn-icon"
            onClick={onRemove}
            title="Remove operation"
            aria-label={`Remove operation ${opSrNo(idx + 1)}`}
          >
            <Trash2 size={12} />
          </button>
        </td>
      </tr>

      {/* The leading empty <td> is deliberate: it indents the drawer past the
          Op column, the shape Create PO's line detail row uses. */}
      {moreOpen ? (
        <tr style={{ background: rowBg }}>
          <td />
          <td colSpan={RC_OP_COL_COUNT - 1} style={{ whiteSpace: 'normal' }}>
            <FormGrid>
              <FormField label="Remarks" size="full" htmlFor={`rc-op-rmk-${idx}`}>
                <input
                  id={`rc-op-rmk-${idx}`}
                  className="innovic-input"
                  autoComplete="off"
                  aria-label={`Remarks, operation ${opSrNo(idx + 1)}`}
                  value={op.remarks}
                  onChange={(e) => onChange({ remarks: e.target.value })}
                  placeholder="What the operator or the vendor must know about this step…"
                />
              </FormField>
            </FormGrid>
          </td>
        </tr>
      ) : null}
    </Fragment>
  );
}

/** The Route Card's RM ITEM + RM Qty per piece, as two ordinary cells on this
 *  form's 12-column grid (md + xs, so they finish Row 2 under Item Name and
 *  Plan Type). Behaviour, queries and state keys are the shared
 *  `RmItemFields`': only Raw Material / Component items are offered, the
 *  server checks the same rule, and the qty box stays disabled until an item is
 *  picked. The shared component wraps its own `.form-grp` boxes and is used by
 *  the BOM, Job Card and Plan forms unchanged — this twin only re-sizes the two
 *  fields for this grid. */
function RouteCardRmItemFields(props: {
  value: RmItemValue;
  onChange: (v: RmItemValue) => void;
}): React.JSX.Element {
  const { value, onChange } = props;
  const [search, setSearch] = useState('');
  // Two server-filtered queries (Raw Material, Component) — filtering 50 mixed
  // rows in the browser could hide every raw material behind assemblies.
  const term = search.trim() || undefined;
  const rm = useItemsList({ search: term, itemType: 'raw_material', limit: 30, offset: 0 });
  const comp = useItemsList({ search: term, itemType: 'component', limit: 30, offset: 0 });
  const all = useMemo(
    () => [...(rm.data?.items ?? []), ...(comp.data?.items ?? [])],
    [rm.data, comp.data],
  );
  const options = useMemo(
    () =>
      all
        .filter((it) => ITEM_TYPE_RULES[it.itemType as ItemType]?.jobMaterial)
        .map((it) => ({ id: it.id, code: it.code, name: it.name })),
    [all],
  );
  return (
    <>
      <FormField label="RM Item" size="md">
        <SearchableSelect
          id="rc-rm-item"
          value={value.rawMaterialItemId}
          valueLabel={value.rawMaterialItemCode ?? undefined}
          onChange={(id) => {
            const it = all.find((x) => x.id === id);
            onChange({
              ...value,
              rawMaterialItemId: id,
              rawMaterialItemCode: it?.code ?? null,
              rmQtyPerPiece: id ? value.rmQtyPerPiece : '',
            });
          }}
          options={options}
          onSearch={setSearch}
          loading={rm.isFetching || comp.isFetching}
          placeholder="🔍 Raw Material / Component item…"
          emptyText="No Raw Material / Component item"
        />
      </FormField>
      <FormField label="RM Qty per piece" size="xs" htmlFor="rc-rm-qty">
        <input
          id="rc-rm-qty"
          className="innovic-input mono"
          type="number"
          step="any"
          min={0}
          disabled={!value.rawMaterialItemId}
          value={value.rmQtyPerPiece}
          placeholder={value.rawMaterialItemId ? 'e.g. 0.25' : 'pick the RM item first'}
          onWheel={(e) => (e.target as HTMLInputElement).blur()}
          onChange={(e) => onChange({ ...value, rmQtyPerPiece: e.target.value })}
        />
      </FormField>
    </>
  );
}

// Raw material for the create/update payload. Always emits all four keys, so
// clearing a picker sends an explicit null and the clear actually sticks —
// omitting the key would leave the stored value untouched.
export function rawMaterialToInput(header: RouteCardFormHeaderDraft): {
  rawMaterialGradeId: string | null;
  rawMaterialGradeText: string | null;
  rawMaterialSizeId: string | null;
  rawMaterialSizeText: string | null;
  rawMaterialItemId: string | null;
  rmQtyPerPiece: number | null;
} {
  return {
    rawMaterialGradeId: header.rawMaterialGradeId,
    rawMaterialGradeText: header.rawMaterialGradeText,
    rawMaterialSizeId: header.rawMaterialSizeId,
    rawMaterialSizeText: header.rawMaterialSizeText,
    ...rmItemToInput(header),
  };
}

export function opsToInput(ops: RouteCardFormOpDraft[]): CreateRouteCardOpInput[] {
  return ops.map((o) => ({
    machineId: o.opType === 'process' ? o.machineId || null : null,
    machineCodeText:
      o.opType === 'process'
        ? o.machineId
          ? null
          : o.machineCodeText.trim() || null
        : o.opType === 'qc'
          ? o.machineCodeText.trim() || 'QC'
          : null,
    operation: o.operation.trim(),
    opType: o.opType,
    cycleTimeMin: Number(o.cycleTimeMin) || 0,
    program: o.program.trim() || null,
    // Not rendered any more, but still sent: an old card's tool number must
    // survive an edit made on the new form.
    toolNo: o.toolNo.trim() || null,
    toolDetails: o.toolDetails.trim() || null,
    remarks: o.remarks.trim() || null,
    qcRequired: o.qcRequired,
    ospVendorId: o.opType === 'outsource' ? o.ospVendorId || null : null,
    ospVendorCodeText:
      o.opType === 'outsource' ? (o.ospVendorId ? null : o.ospVendorCodeText.trim() || null) : null,
    ospLeadDays:
      o.opType === 'outsource' && o.ospLeadDays.trim() ? Number(o.ospLeadDays) || null : null,
  }));
}

/** The OSP row's Vendor box. Searches the vendor master on the server as the
 *  user types (`?search=`, 50 per page), the same way the shared VendorPicker
 *  does — the old version loaded the first 200 vendors in code order and only
 *  filtered those in the browser, so any vendor after them could never be
 *  picked. The table cell has no room for VendorPicker's label/field-group
 *  wrapper, hence this cell-sized twin. */
function RouteCardVendorCell({
  id,
  op,
  onChange,
}: {
  id: string;
  op: RouteCardFormOpDraft;
  onChange: (vendor: Vendor | null) => void;
}): React.JSX.Element {
  const [search, setSearch] = useState('');
  // Active vendors only (A10) — the server refuses a newly linked inactive one.
  const { data, isFetching } = useVendorsList({
    ...(search.trim() ? { search: search.trim() } : {}),
    isActive: true,
    limit: 50,
    offset: 0,
  });
  const vendors = data?.vendors ?? [];
  const code = op.ospVendorCodeText.trim();
  const name = op.ospVendorName?.trim() ?? '';
  // "CODE — Name" for the picked vendor, from the row's own snapshot so it
  // still reads correctly when that vendor is not on the current search page.
  const valueLabel = code ? (name ? `${code} — ${name}` : code) : undefined;
  return (
    <SearchableSelect
      id={id}
      value={op.ospVendorId || null}
      onChange={(next) => onChange(next ? (vendors.find((v) => v.id === next) ?? null) : null)}
      onSearch={setSearch}
      loading={isFetching}
      options={vendors.map((v) => ({ id: v.id, code: v.code, name: v.name }))}
      placeholder="🔍 Vendor"
      valueLabel={valueLabel}
      selectedLabel={(v) => (v.code ? `${v.code} — ${v.name}` : v.name)}
    />
  );
}
