// Shared Route Card form used by create + edit routes.
//
// 2026-10-06 layout (owner-approved mock-up pro-routecard-create-edit-mockup.html,
// frames 4 "Route Card — Create" and 5 "Route Card — Edit / Revise"): the whole
// form fits one 1440×810 screen with no page scroll, in the detail page's
// order so Create, Edit and View line up (screen-layout-method rule 8):
//   header      ← Back · [code] · New / Edit Route Card · Rev N → N+1 badge …
//               the first validation message (why Save is off) · Cancel · Save
//   identity    RC No. · Item Code ★ (the one decision) · item name · the
//               "prefilled from plan" note (DocIdent)
//   facts       Route (Plan Type ★ · Operations split · Last Updated) ·
//               Material (RM Item · RM Grade · RM Size · RM Qty per piece) ·
//               Notes (Route Card Remarks, + Revision Note on Edit) — the
//               ClusterGrid, one line each, controls in place of values
//   ops panel   "Operation Sequence (n)" — Copy ops… (Create), + Outsourced op,
//               + Inspection, + Add Operation; the one block that takes the
//               height left (`page-fill rc-form` + <Panel fill>), its table
//               scrolling inside with the header row and Total held.
// Validation, save payloads, copy-ops, op numbering and every message are the
// ADR-204 form's, unchanged. Tool No. / Tool Details are still NOT rendered
// (owner, 2026-10-06 — "no Tool No. / Tool Details anywhere on the form"), and
// still carried on every draft and every save, so an old card's tool numbers
// survive an edit (see RouteCardFormOpDraft / opsToInput).
//
// The op editor mirrors legacy rcOpsHtml (L10208), the single op renderer
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
import { opSrNo, qcAfterOutsourceError } from '@innovic/shared';
import { Link } from '@tanstack/react-router';
import { ArrowLeft } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { rmItemToInput } from '@/components/shared/rm-item-fields';
import { fmtDate } from '@/lib/date';
import { useItemsList } from '@/modules/items/api';
import { useMachineGroupsList, useMachinesList } from '@/modules/machines/api';
import { usePlansList } from '@/modules/plans/api';
import {
  MaterialGradePicker,
  MaterialSizePicker,
} from '@/modules/raw-material/components/raw-material-pickers';
import { Panel } from '@/ui/data';
import { Banner, ConfirmDialog } from '@/ui/feedback';
import {
  Cluster,
  ClusterFact,
  ClusterGrid,
  DocIdent,
  FormField,
  IdentSep,
  SearchableSelect,
} from '@/ui/forms';
import { useSaveShortcut } from '@/ui/layout';
import { useFetchRouteCard, useNextRouteCardCode, useRouteCardsList } from '../api';
import { RouteCardOpsEditor } from './rc-form-ops';
import { RouteCardRmItemField } from './rc-form-rm-item';
import './rc-form.css';

export type RouteCardOpType = 'process' | 'qc' | 'outsource';

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

  // ADR-224: the create-mode RC No. is a PREVIEW and nothing more — the server
  // numbers the card inside the save transaction under its series lock
  // (lib/doc-series-lock), which is the guarantee ERPNext's Naming Series
  // gives. So this follows whatever the backend last answered instead of
  // latching the first value it sees: the old `codePrefilled` ref consumed the
  // CACHED answer on mount and then ignored the fresh one that arrived
  // milliseconds later, which is how the number the previous save had already
  // used stayed on screen. The box is read-only on create (see the RC No.
  // input below), so following the server can never overwrite typing.
  const { data: nextCodeData } = useNextRouteCardCode({ enabled: mode === 'create' });
  useEffect(() => {
    if (mode !== 'create') return;
    const next = nextCodeData?.code;
    if (!next) return;
    setHeader((prev) => (prev.code === next ? prev : { ...prev, code: next }));
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

  // The Operations split, counted live from the rows below — process =
  // in-house, outsource = OSP, qc = QC. Same count the detail page shows.
  const inHouseCount = ops.filter((o) => o.opType === 'process').length;
  const ospCount = ops.filter((o) => o.opType === 'outsource').length;
  const qcCount = ops.filter((o) => o.opType === 'qc').length;

  return (
    <form className="page-fill rc-form" onSubmit={(e) => void submit(e)}>
      {/* Header: which card, the revision this save creates, why Save is off,
          and the next step (Save) as the one primary button. */}
      <div className="rc-form-hd">
        <button type="button" className="btn btn-ghost" onClick={onBack ?? onCancel}>
          <ArrowLeft size={14} /> Back
        </button>
        {mode === 'edit' && routeCard ? (
          <span className="td-code" style={{ color: 'var(--blue)', fontSize: 'var(--fs-md)' }}>
            {routeCard.code}
          </span>
        ) : null}
        <h1 className="panel-title" style={{ margin: 0 }}>
          {mode === 'create' ? 'New Route Card' : 'Edit Route Card'}
        </h1>
        {/* Every save of an existing card is a new revision — say which. */}
        {mode === 'edit' && routeCard ? (
          <span className="badge b-amber">
            Route Card Rev {routeCard.currentRevision} →{' '}
            <span style={{ color: 'var(--green2)' }}>{routeCard.currentRevision + 1}</span>
          </span>
        ) : null}
        <span className="rc-form-sp" />
        {/* Why Save is disabled — on Save's own row, the same text as before.
            Full text on hover when the row is too narrow for it. */}
        {validationError ? (
          <span className="form-error rc-why" title={validationError}>
            {validationError}
          </span>
        ) : null}
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
      </div>
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

      <Panel>
        {/* WHICH item this route is for — the one decision on this screen. The
            same place the detail page shows RC No. and the item. */}
        <DocIdent>
          <label className="rc-id-lb" htmlFor="rc-code">
            RC No.
          </label>
          <input
            id="rc-code"
            className="innovic-input mono rc-id-code"
            value={header.code}
            // Create: a preview the server re-decides on save, so it is not
            // typeable. Edit: the code IS renameable — updateRouteCard checks
            // the new one for duplicates (service.ts) — so it stays editable.
            readOnly={mode === 'create'}
            title={mode === 'create' ? 'Numbered automatically when you save' : undefined}
            onChange={(e) => setHeader({ ...header, code: e.target.value })}
            placeholder={mode === 'create' ? 'IN-RC-NNNNN' : ''}
          />
          <IdentSep />
          <label className="rc-id-lb" htmlFor="rc-item">
            Item Code<span className="req">★</span>
          </label>
          {/* The same master-only picker Create SO uses (SearchableSelect),
              not a free-text datalist: it lists "CODE — Name", shows the code
              in the field once picked, and only lets a real master item be
              chosen. */}
          <SearchableSelect
            id="rc-item"
            className="rc-id-item"
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
          {/* Item Name — read-only, follows the picked item. */}
          <span className="rc-id-name" title={header.itemName || undefined}>
            {header.itemName || '—'}
          </span>
          {rmPrefillFrom ? (
            <span
              className="rc-id-note"
              title={`Raw material prefilled from plan ${rmPrefillFrom} — change it if the routing calls for something else.`}
            >
              Raw material prefilled from plan <b className="mono">{rmPrefillFrom}</b> — change it
              if the routing calls for something else.
            </span>
          ) : null}
        </DocIdent>

        <ClusterGrid>
          {/* How the item is made, and how many steps of each kind. */}
          <Cluster name="Route">
            {/* Plan Type — the same choice SO Planning asks for every plan,
                recorded once here as the item's default. A plain Select,
                exactly as Create SO asks for SO Type. ADR-171: `direct_purchase`
                shows only on a card that already holds it, and saves unchanged;
                the note says where the flag lives now. */}
            <FormField
              label="Plan Type"
              required
              htmlFor="rc-plantype"
              help={
                header.planType === 'direct_purchase'
                  ? "Old setting — set the item's Source to Buy instead."
                  : undefined
              }
            >
              <select
                id="rc-plantype"
                className="innovic-select cl-cap-md"
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
            <ClusterFact
              span={2}
              label="Operations"
              value={
                <>
                  <span className="mono fw-700">{ops.length}</span>
                  {ops.length > 0 ? (
                    <span className="mono text3 rc-ops-split">
                      {inHouseCount} in-house · {ospCount} OSP · {qcCount} QC
                    </span>
                  ) : null}
                </>
              }
            />
            {mode === 'edit' && routeCard ? (
              <ClusterFact num label="Last Updated" value={fmtDate(routeCard.updatedAt)} />
            ) : (
              <ClusterFact empty label="Last Updated" value="— set on save" />
            )}
          </Cluster>

          {/* WHAT the part is cut from — the detail page's order. All four
              optional (no ★). The same pickers Planning and the Job Card form
              use, so the route card names the same stock they do. */}
          <Cluster name="Material">
            <RouteCardRmItemField
              value={{
                rawMaterialItemId: header.rawMaterialItemId,
                rawMaterialItemCode: header.rawMaterialItemCode,
                rmQtyPerPiece: header.rmQtyPerPiece,
              }}
              onChange={(v) => setHeader((prev) => ({ ...prev, ...v }))}
            />
            <FormField label="RM Grade" htmlFor="rc-rm-grade">
              <MaterialGradePicker
                id="rc-rm-grade"
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
            <FormField label="RM Size" htmlFor="rc-rm-size">
              <MaterialSizePicker
                id="rc-rm-size"
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
            <FormField label="RM Qty per piece" htmlFor="rc-rm-qty">
              <input
                id="rc-rm-qty"
                className="innovic-input mono cl-num cl-cap"
                type="number"
                step="any"
                min={0}
                disabled={!header.rawMaterialItemId}
                value={header.rmQtyPerPiece}
                placeholder={header.rawMaterialItemId ? 'e.g. 0.25' : 'pick the RM item first'}
                onWheel={(e) => (e.target as HTMLInputElement).blur()}
                onChange={(e) => setHeader((prev) => ({ ...prev, rmQtyPerPiece: e.target.value }))}
              />
            </FormField>
          </Cluster>

          {/* "Route Card Remarks" not "Remarks": the per-operation field in the
              "▸ More" drawer is already called Remarks, and one word cannot name
              two facts on one screen (CLAUDE.md §18). Same column as before
              (route_cards.notes). On Edit, Revision Note — why THIS revision
              exists (route_card_revisions.notes), a different fact — sits
              beside it instead of in a panel at the foot of the page. */}
          <Cluster name="Notes">
            <FormField
              label="Route Card Remarks"
              htmlFor="rc-remarks"
              className={mode === 'edit' ? 'cl-span-2' : 'cl-span-4'}
            >
              {/* A one-row textarea, not an <input>: it looks like one line (so
                  the page stays on one screen) but Enter adds a line instead of
                  submitting the form, and saved line breaks survive an edit. */}
              <textarea
                id="rc-remarks"
                className="innovic-input rc-one-row"
                rows={1}
                maxLength={2000}
                value={header.notes}
                title={header.notes || undefined}
                onChange={(e) => setHeader({ ...header, notes: e.target.value })}
                placeholder="Optional manufacturing notes…"
              />
            </FormField>
            {mode === 'edit' ? (
              <FormField label="Revision Note" htmlFor="rc-rev-note" className="cl-span-2">
                <textarea
                  id="rc-rev-note"
                  className="innovic-input rc-one-row"
                  rows={1}
                  maxLength={2000}
                  value={revisionNote}
                  onChange={(e) => setRevisionNote(e.target.value)}
                  placeholder="Optional — auto-filled if blank"
                />
              </FormField>
            ) : null}
          </Cluster>
        </ClusterGrid>
      </Panel>

      {blockingCard ? null : (
        <Panel
          fill
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
                  planner presses most. */}
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
          <RouteCardOpsEditor
            ops={ops}
            machines={machinesList?.machines ?? []}
            machineGroupCodeById={machineGroupCodeById}
            totalCycleMin={totalCycleMin}
            totalLeadDays={totalLeadDays}
            onChange={updateOp}
            onMachineChange={onOpMachineChange}
            onGroupChange={onOpGroupChange}
            onVendorChange={onOpVendorChange}
            onRemove={removeOp}
          />
        </Panel>
      )}

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
