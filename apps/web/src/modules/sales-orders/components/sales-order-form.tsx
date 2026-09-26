// Sales Order form — header + type-branching body. Mirror of legacy
// soHeaderForm (L12183) / _soLinesHtml (L12158) / _soLineRowHtml (L11985) /
// _soTotalsHtml (L12366) / _soMilestonesHtml (L12392).
//
// Verified legacy delegation chain (soForm L12634 and editSO L12528 are both
// one-line delegates and render nothing themselves):
//   create → addSO(existingSoNo) L12413 → showModalLg(title, soHeaderForm(prefill))
//   edit   → _editFullSO(soNo)   L12531 → showModalLg(title, soHeaderForm(first))
//            (editSOLine L12465 edits ONE line — legacy stores one row per SO
//             line; our edit route loads the whole SO, so _editFullSO is the
//             true counterpart.)
// Both modes call the SAME builder, so legacy is field-identical across modes
// by construction, and both derive the footer label "Save SO" from the modal
// title via showModalLg L28034 — hence one shared submit label here.
//
// `isEquip` is NOT a mode branch: legacy derives it from the record's type
// (L12186) and re-toggles it live on change (_onSoTypeChangeFull L12175), which
// is what watch('header.type') does here.
//
// Deliberate, user-approved deviations from the HTML:
//   • Status + Cost Center are NOT on the form (removed by product decision;
//     Finance derives the cost centre from the SO No.). Legacy's 2-option
//     Status select could not represent our 5 SO_STATUSES anyway.
//   • Item Code on a component line MUST come from Item Master — enforced by a
//     server-searched picker (you can only pick a master item), matching the
//     legacy _badIC "Item not in Item Master" rule (L12443).
//   • Equipment value is captured ₹/unit (total = rate × qty), not an absolute.
//   • Due Date is captured once on the header and applied to every line on save;
//     legacy captures it per line (see the Due Date column at L12164).
//
// Everything else mirrors the HTML: searchable client + item pickers, line
// table with per-line Amount, SO totals (subtotal / GST / grand + item·pcs
// count), delivery milestones, in-form Excel template/import, equipment BOM.

import {
  type CreateSalesOrderInput,
  type ListItemsResponse,
  normalizeRevision,
  revisionBackwardsMessage,
  revisionGoesBackwards,
  type SalesOrderDetail,
  SELECTABLE_SO_TYPES,
  SO_GST_DEFAULT,
  SO_GST_PERCENTS,
  type SoStatus,
  type SoType,
  type UpdateSalesOrderInput,
  type Uom,
} from '@innovic/shared';
import { Link } from '@tanstack/react-router';
import { Loader2, Plus, Trash2 } from 'lucide-react';
import { Fragment, useEffect, useRef, useState } from 'react';
import {
  useFieldArray,
  useForm,
  type UseFormRegisterReturn,
  type UseFormReturn,
} from 'react-hook-form';
import { DocNumberInput } from '@/components/shared/doc-number-input';
import { todayLocal } from '@/lib/date';
import { SearchableSelect } from '@/components/shared/searchable-select';
import { Panel } from '@/ui/data';
import { Banner } from '@/ui/feedback';
import { FormField, FormGrid } from '@/ui/forms';
import { PageHeader, useSaveShortcut } from '@/ui/layout';
import { apiFetch } from '@/lib/api';
import { cascadeField, useFieldCascade } from '@/lib/use-field-cascade';
import { inrFormat } from '@/lib/print/doc-print';
import { useBomMastersList } from '@/modules/bom-master/api';
import { useClientsList, useCreateClient } from '@/modules/clients/api';
import { useItemsList } from '@/modules/items/api';
import { downloadSoLineTemplate, parseSoLineFile } from '../lib/import-export';
import { SO_TYPE_LABEL } from '../lib/so-status-label';
import { SoLineDrawingCell } from './so-line-drawing-cell';

interface LineFormValue {
  id?: string | undefined;
  itemId?: string | undefined;
  itemCodeText: string;
  partName: string;
  material?: string | undefined;
  drawingNo?: string | undefined;
  /** The CUSTOMER'S drawing revision, exactly as printed on the drawing they
   *  sent — 'A', 'B', 'R1', '0'. Text and not a number, because a revision is a
   *  label on a piece of paper and is a letter as often as a digit. Typed by the
   *  person entering the order and compulsory. It says nothing about whether a
   *  drawing FILE is attached: migration 0119 split the two, because while the
   *  server owned this it bumped on every upload and so invented revisions that
   *  were never printed on any drawing. */
  revision: string;
  drawingFilePath?: string | undefined;
  uom: Uom;
  orderQty: number;
  rate: number;
  dueDate?: string | undefined;
  clientPoLineNo?: string | undefined;
  status?: SoStatus | undefined;
}

interface MilestoneFormValue {
  id?: string | undefined;
  lotNo: number;
  qty: number;
  dueDate?: string | undefined;
  remarks?: string | undefined;
}

interface FormValues {
  header: {
    code: string;
    soDate: string;
    type: SoType;
    status: SoStatus;
    gstPercent: number;
    clientId?: string;
    customerName?: string;
    clientPoNo?: string;
    bomMasterId?: string;
    bomStatus?: string;
    remarks?: string;
    // SO-level due date (UI only) — applied to every line on save. Not stored on
    // the SO header (due_date lives per line); the form captures it once.
    dueDate?: string;
  };
  lines: LineFormValue[];
  milestones: MilestoneFormValue[];
}

const HEADER_DEFAULTS: FormValues['header'] = {
  code: '',
  soDate: todayLocal(),
  type: 'component_manufacturing',
  status: 'open',
  gstPercent: SO_GST_DEFAULT,
};
// A fresh line starts with an EMPTY Rev, deliberately. Pre-filling '0' made a
// revision nobody had read off a drawing look like one somebody had confirmed,
// and a box that already holds a plausible value is a box people tab straight
// past. Empty plus the compulsory check below forces the question to be asked
// once per line, which is the whole point of making it compulsory.
const NEW_LINE: LineFormValue = {
  itemCodeText: '',
  partName: '',
  uom: 'NOS',
  orderQty: 1,
  rate: 0,
  revision: '',
};
const NEW_MILESTONE: MilestoneFormValue = { lotNo: 1, qty: 0 };

/** ADR-177: the Rev box capitalises AS TYPED ('b' shows as 'B' at once), so what
 *  the person sees is what the form holds and the server stores. Wraps the
 *  register() props so the box is upper-cased BEFORE react-hook-form reads it
 *  (its own `onChange` option runs after the read, which would leave the form
 *  value lowercase). The caret is put back where it was so typing in the middle
 *  of "R1" does not jump to the end. Only the case changes — trim and the
 *  character rule stay with the schema / `pattern`. */
function upperCaseRevField<T extends string>(
  field: UseFormRegisterReturn<T>,
): UseFormRegisterReturn<T> {
  return {
    ...field,
    onChange: (e: { target: HTMLInputElement; type?: unknown }) => {
      const el = e.target;
      const upper = el.value.toUpperCase();
      if (upper !== el.value) {
        const { selectionStart, selectionEnd } = el;
        el.value = upper;
        if (selectionStart !== null && selectionEnd !== null)
          el.setSelectionRange(selectionStart, selectionEnd);
      }
      return field.onChange(e);
    },
  };
}
/** HTML `pattern` mirror of REVISION_PATTERN — the box is already upper-case.
 *  Browsers compile `pattern` with the `v` flag, where `/` and `-` inside a
 *  class must be escaped or the whole pattern is silently ignored. */
const REV_INPUT_PATTERN = '[A-Z0-9][A-Z0-9.\\/\\-]{0,31}';
const REV_INPUT_TITLE = 'Drawing Rev: letters, digits, . - / only';

/** Page chrome. The form renders the sticky PageHeader itself so the Save
 *  buttons stay inside <form> (type="submit" + their disabled rules); the page
 *  only names the title and where Back goes. */
type FormChrome = {
  title: string;
  backLabel?: string | undefined;
  onBack?: (() => void) | undefined;
};
type CreateMode = FormChrome & {
  mode: 'create';
  onSubmit: (values: CreateSalesOrderInput) => Promise<void> | void;
  submitLabel?: string;
  submitError?: string | null;
  onCancel?: () => void;
  /** Client-PO document chosen in the form; uploaded by the page after save. */
  onPoFileChange?: (file: File | null) => void;
  /** Email reference (e.g. .eml/.msg/pdf) attached against the Client PO. */
  onEmailFileChange?: (file: File | null) => void;
};
type EditMode = FormChrome & {
  mode: 'edit';
  detail: SalesOrderDetail;
  onSubmit: (values: UpdateSalesOrderInput) => Promise<void> | void;
  submitLabel?: string;
  submitError?: string | null;
  onCancel?: () => void;
  onPoFileChange?: (file: File | null) => void;
  onEmailFileChange?: (file: File | null) => void;
};
export type SalesOrderFormProps = CreateMode | EditMode;

export function SalesOrderForm(props: SalesOrderFormProps): React.JSX.Element {
  const isEdit = props.mode === 'edit';
  const defaults: FormValues = isEdit
    ? detailToFormValues(props.detail)
    : { header: HEADER_DEFAULTS, lines: [{ ...NEW_LINE }], milestones: [] };

  const form = useForm<FormValues>({ defaultValues: defaults });
  const { register, control, handleSubmit, formState, watch, setValue, getValues } = form;
  const errors = formState.errors;
  const { fields, append, remove, replace } = useFieldArray({ control, name: 'lines' });
  const {
    fields: msFields,
    append: appendMs,
    remove: removeMs,
  } = useFieldArray({ control, name: 'milestones' });

  // ── Searchable master pickers (server-searched; scales past the 200 cap) ──
  const [clientSearch, setClientSearch] = useState('');
  const { data: clientsData, isFetching: clientsFetching } = useClientsList({
    ...(clientSearch.trim() ? { search: clientSearch.trim() } : {}),
    limit: 50,
    offset: 0,
  });
  const clients = clientsData?.clients ?? [];

  // Seeded on an EDIT form from the SO's own first-line item code. `items` is
  // one 50-row page, so a saved equipment parent outside it never landed in
  // `itemsById`: `equipItem` stayed null and the whole section quietly
  // misbehaved — Description unlocked (it is a master snapshot and must stay
  // locked) and the BOM note went silent on an SO that plainly has a parent.
  // Asking the server for that code puts the row on the first page. Harmless
  // for the line table: SearchableSelect re-issues onSearch with its OWN text
  // every time a picker opens, so an empty picker still gets page 1.
  const [itemSearch, setItemSearch] = useState(
    props.mode === 'edit' && props.detail.type === 'equipment'
      ? (props.detail.lines[0]?.itemCode ?? props.detail.lines[0]?.itemCodeText ?? '')
      : '',
  );
  const { data: itemsData, isFetching: itemsFetching } = useItemsList({
    ...(itemSearch.trim() ? { search: itemSearch.trim() } : {}),
    limit: 50,
    offset: 0,
  });
  const items = itemsData?.items ?? [];
  const itemsById = new Map(items.map((it) => [it.id, it]));

  const { data: bomsData } = useBomMastersList({ status: 'active', limit: 200, offset: 0 });
  const boms = bomsData?.items ?? [];

  const headerType = watch('header.type');
  const isEquip = headerType === 'equipment';
  const watchedLines = watch('lines');
  const gstPercent = Number(watch('header.gstPercent')) || 0;

  // ── SO No.: reusable document-number field (prefill + live duplicate check) ──
  const isCreate = !isEdit;
  const [docNoValid, setDocNoValid] = useState(true);
  const selectedClientId = watch('header.clientId') ?? null;
  const selectedClient = clients.find((c) => c.id === selectedClientId);
  // Keep a stable label for the selected client even when it scrolls out of the
  // current search page (edit mode / after typing a different term).
  const [clientLabel, setClientLabel] = useState<string>(
    props.mode === 'edit' ? (props.detail.customerName ?? '') : '',
  );
  // Inline client quick-add (legacy addClientQuick) — add + select without
  // leaving the SO form.
  const [showAddClient, setShowAddClient] = useState(false);
  function onClientCreated(id: string, label: string): void {
    setValue('header.clientId', id, { shouldValidate: true });
    setClientLabel(label);
    setShowAddClient(false);
  }

  /** Controller side of the line cascade: Item Code (itemId) is the key. Picking
   *  sets the master link + its visible code; clearing drops both. The dependent
   *  fields (Part Name / Material / UOM) are refilled/reset by the
   *  shared `useFieldCascade` hook, hosted per line in <LineItemCascade> below —
   *  so a fresh pick REPLACES them, a clear RESETS them, and Qty / Rate /
   *  Client PO Ln stay exactly as the user typed. */
  function pickItem(idx: number, id: string | null): void {
    const opt = { shouldDirty: true } as const;
    if (!id) {
      setValue(`lines.${idx}.itemId`, undefined, opt);
      setValue(`lines.${idx}.itemCodeText`, '', opt);
      return;
    }
    setValue(`lines.${idx}.itemId`, id, opt);
    const it = itemsById.get(id);
    if (it) setValue(`lines.${idx}.itemCodeText`, it.code, opt);
  }

  // Still needed to resolve an EDIT form's saved line, which carries only the
  // code text when the SO predates the master-only picker.
  const itemsByCode = new Map(items.map((it) => [it.code.trim().toUpperCase(), it]));

  // Equipment parent: same pick path as a component line, plus the master name
  // snapshot. CONVENTIONS "Item pickers" — a picked code ALWAYS overwrites the
  // description from the master. The old handler filled it only when blank, so
  // re-picking a different parent left the previous equipment's description
  // sitting under the new code.
  function pickEquipItem(id: string | null): void {
    pickItem(0, id);
    // Clearing the code (typing over a pick clears it too) drops the
    // description with it — the same RESET <LineItemCascade> gives a component
    // line, which this branch does not render. Leaving the old master's name
    // sitting under an empty code let a stale description ride into the save.
    if (!id) {
      setValue('lines.0.partName', '', { shouldDirty: true });
      return;
    }
    const it = itemsById.get(id);
    if (it) setValue('lines.0.partName', it.name, { shouldDirty: true });
  }

  // ── Equipment → its BOM ──────────────────────────────────────────────────
  // A BOM now names the parent item it builds (ADR-108), so picking the
  // equipment is enough to find its BOM. Prefer the picked id; fall back to the
  // code text so an SO saved before this field became a master-only picker
  // still resolves on the edit form.
  const equipCodeText = watch('lines.0.itemCodeText') ?? '';
  const equipItemId = watch('lines.0.itemId') ?? null;
  const equipItem = isEquip
    ? ((equipItemId ? itemsById.get(equipItemId) : undefined) ??
      itemsByCode.get(equipCodeText.trim().toUpperCase()) ??
      null)
    : null;
  const equipBom = equipItem ? (boms.find((b) => b.parentItemId === equipItem.id) ?? null) : null;

  // Attach (or detach) as the resolved parent changes. Keyed on the item id so
  // it fires once per real change, not once per keystroke. On an EDIT form the
  // first resolution is skipped — the saved SO already carries a BOM choice and
  // silently overwriting it would lose a deliberate manual pick.
  // The BOM list must have ANSWERED before this may write. While its query is
  // in flight `boms` is empty, so an early run reads "this parent has no BOM",
  // writes '' — and the "already handled this id" guard below then blocks the
  // re-run, so the real BOM never attached once the list arrived.
  const bomsLoaded = Boolean(bomsData);
  const lastEquipItemId = useRef<string | null>(isEdit ? '__initial__' : null);
  useEffect(() => {
    if (!isEquip || !bomsLoaded) return;
    const id = equipItem?.id ?? null;
    if (lastEquipItemId.current === '__initial__') {
      // Stay armed until the saved parent actually RESOLVES. Disarming on the
      // first run — when the items page is still loading and id is null — made
      // the resolution that followed look like a fresh user pick, and it
      // overwrote the BOM the SO was saved with (detaching it outright
      // whenever the auto-match came up empty).
      if (!id) return;
      lastEquipItemId.current = id;
      return;
    }
    if (lastEquipItemId.current === id) return;
    lastEquipItemId.current = id;
    // Never leave the previous parent's BOM attached to a different item — and
    // that includes clearing the parent outright, which used to keep the old
    // BOM (and so a "BOM Assigned" status) on an SO with no equipment on it.
    setValue('header.bomMasterId', id ? (equipBom?.id ?? '') : '', { shouldDirty: true });
  }, [isEquip, bomsLoaded, equipItem, equipBom, setValue]);

  // What the (read-only) BOM field shows. Read off the attached id rather than
  // off equipBom: an edit form keeps whatever BOM was saved, which may not be
  // the one the parent item resolves to today. A saved id we can't look up
  // (inactive BOM, or past the list page) still reports as attached — claiming
  // "BOM Pending" for an SO that has one would be the worse lie.
  const attachedBomId = watch('header.bomMasterId') ?? '';
  const attachedBom = attachedBomId ? (boms.find((b) => b.id === attachedBomId) ?? null) : null;
  const attachedBomLabel = attachedBom
    ? `${attachedBom.bomNo} — ${attachedBom.bomName} (BOM Rev ${attachedBom.revision}, ${attachedBom.lineCount} items)`
    : attachedBomId
      ? 'BOM attached'
      : '— No BOM (BOM Pending) —';

  const [lineError, setLineError] = useState<string | null>(null);
  // At least one of Client PO No. / Email Ref must be provided (create form).
  const [poEmailError, setPoEmailError] = useState<string | null>(null);
  // Client-PO document (legacy _cpoFileSelected L12315) — captured here, the
  // page uploads it after the SO is saved (matches addSO L12459).
  const [poFileName, setPoFileName] = useState<string | null>(null);
  function onPickPoFile(e: React.ChangeEvent<HTMLInputElement>): void {
    const f = e.target.files?.[0];
    if (!f) return;
    if (f.size > 20 * 1024 * 1024) {
      setLineError('Client PO file too large (max 20MB).');
      e.target.value = '';
      return;
    }
    setPoFileName(f.name);
    props.onPoFileChange?.(f);
  }
  function clearPoFile(): void {
    setPoFileName(null);
    props.onPoFileChange?.(null);
  }

  // Email reference attached against the Client PO (legacy parity with PO doc).
  // Keep a local object URL so the just-attached file can be viewed before save.
  const [emailFileName, setEmailFileName] = useState<string | null>(null);
  const [emailFileUrl, setEmailFileUrl] = useState<string | null>(null);
  function onPickEmailFile(e: React.ChangeEvent<HTMLInputElement>): void {
    const f = e.target.files?.[0];
    if (!f) return;
    if (f.size > 20 * 1024 * 1024) {
      setLineError('Email reference file too large (max 20MB).');
      e.target.value = '';
      return;
    }
    if (emailFileUrl) URL.revokeObjectURL(emailFileUrl);
    setEmailFileName(f.name);
    setEmailFileUrl(URL.createObjectURL(f));
    setPoEmailError(null);
    props.onEmailFileChange?.(f);
  }
  function clearEmailFile(): void {
    if (emailFileUrl) URL.revokeObjectURL(emailFileUrl);
    setEmailFileName(null);
    setEmailFileUrl(null);
    props.onEmailFileChange?.(null);
  }

  // In-form line import.
  const lineFileRef = useRef<HTMLInputElement>(null);
  const [importMsg, setImportMsg] = useState<string | null>(null);
  async function onImportLines(file: File): Promise<void> {
    try {
      const { rows, errors: errs } = await parseSoLineFile(file);
      // Every Item Code in the sheet must exist in Item Master. The in-memory
      // `items` list is only the current 50-row search page, so resolve each
      // unique code against the server (search + exact-code match).
      const uniqueCodes = Array.from(
        new Set(
          rows
            .map((r) => r.itemCodeText.trim())
            .filter(Boolean)
            .map((c) => c.toUpperCase()),
        ),
      );
      const masterByCode = new Map<string, ListItemsResponse['items'][number]>();
      await Promise.all(
        uniqueCodes.map(async (code) => {
          try {
            const res = await apiFetch<ListItemsResponse>(
              `/items?search=${encodeURIComponent(code)}&limit=50&offset=0`,
            );
            const hit = res.items.find((it) => it.code.trim().toUpperCase() === code);
            if (hit) masterByCode.set(code, hit);
          } catch {
            /* leave unresolved → reported as missing below */
          }
        }),
      );

      const missing: string[] = [];
      const newLines: LineFormValue[] = [];
      for (const r of rows) {
        const code = r.itemCodeText.trim();
        const master = code ? masterByCode.get(code.toUpperCase()) : undefined;
        if (!master) {
          if (code) missing.push(code);
          continue;
        }
        // Item Code drives the row: link the master item, auto-fetch Part Name
        // (and UOM) from master; the remaining details come from the sheet
        // (falling back to master for material when the cell is blank).
        newLines.push({
          ...NEW_LINE,
          ...r,
          itemId: master.id,
          itemCodeText: master.code,
          partName: master.name,
          material: r.material ?? master.material ?? '',
          // Drawing No. is a fact of THIS order's line, not of the item master
          // (user decision 2026-09-21): it comes from the sheet or stays blank
          // for the person to type — never from the item.
          drawingNo: r.drawingNo ?? '',
          // Set explicitly AFTER the `...r` spread, never through it: an absent
          // Rev column spreads `revision: undefined` over the value below.
          // A sheet with no Rev column leaves the box EMPTY, exactly like a
          // hand-added line — the compulsory check then makes the person fill it
          // in rather than letting fifty imported lines inherit a revision that
          // nobody read off a drawing.
          revision: r.revision?.trim() || NEW_LINE.revision,
          uom: master.uom,
        });
      }

      const added = newLines.length;
      if (added) {
        // If the grid still holds only the untouched blank starter row(s), replace
        // them so imports fill from Sr No. 1 instead of appending after an empty row.
        const current = getValues('lines') ?? [];
        const allBlank = current.every(
          (l) => !l.itemId && !l.itemCodeText?.trim() && !l.partName?.trim(),
        );
        if (allBlank) replace(newLines);
        else for (const l of newLines) append(l);
      }

      const parts: string[] = [];
      if (added) parts.push(`Added ${added} line(s).`);
      if (missing.length) {
        const uniq = Array.from(new Set(missing));
        parts.push(
          `${uniq.length} item code(s) not found in Item Master: ${uniq.join(', ')}. ` +
            `Please add ${uniq.length > 1 ? 'each' : 'it'} (item code + item name) in Item Master first, then re-import.`,
        );
      }
      if (errs.length) parts.push(`${errs.length} row(s) skipped.`);
      setImportMsg(parts.join(' ') || 'No rows found in the sheet.');
    } catch (e) {
      setImportMsg(e instanceof Error ? e.message : 'Could not import file. Try again.');
    } finally {
      if (lineFileRef.current) lineFileRef.current.value = '';
    }
  }

  const lineCount = (watchedLines ?? []).length;
  const totalPcs = (watchedLines ?? []).reduce((s, l) => s + (Number(l.orderQty) || 0), 0);
  // A cancelled line adds nothing — the same rule as the server's SO totals.
  const subtotal = (watchedLines ?? [])
    .filter((l) => l.status !== 'cancelled')
    .reduce((s, l) => s + (Number(l.orderQty) || 0) * (Number(l.rate) || 0), 0);
  const gstAmt = subtotal * (gstPercent / 100);
  const grand = subtotal + gstAmt;

  // `asDraft` (#3): the "Save as draft" button submits with status 'draft';
  // the normal submit keeps the header status (defaults to 'open'). Captured
  // per-handler so there is no shared mutable flag to leak across submits.
  const onValid =
    (asDraft: boolean) =>
    async (values: FormValues): Promise<void> => {
      setLineError(null);
      setPoEmailError(null);
      // Require proof of the client order: either a Client PO No. or an attached
      // email reference. Enforced on the create form (edit keeps whatever the SO
      // already has). At least one must be present.
      if (isCreate && !values.header.clientPoNo?.trim() && !emailFileName) {
        setPoEmailError('Enter a Client PO No. or attach an Email Ref — at least one is required.');
        return;
      }
      // SO No. validity is enforced by DocNumberInput (save disabled while invalid);
      // the server UNIQUE constraint is the final backstop.
      const equip = values.header.type === 'equipment';
      // SO-level due date applied to every line (the field lives at the top now).
      const soDue = values.header.dueDate?.trim() || undefined;

      // Item-Master enforcement (legacy L12443): every component line must carry a
      // master item (the picker guarantees an itemId). Equipment part No. is free.
      if (!equip) {
        const badIdx = values.lines.findIndex((l) => !l.itemId);
        if (badIdx >= 0) {
          setLineError(`Line ${badIdx + 1}: pick an Item Code from Item Master.`);
          return;
        }
        const badQty = values.lines.findIndex((l) => !(Number(l.orderQty) >= 1));
        if (badQty >= 0) {
          setLineError(`Line ${badQty + 1}: Qty must be ≥ 1.`);
          return;
        }
        // Rev is compulsory since migration 0119. Caught here, in the same
        // lineError strip as the two rules above, so the user is told which line
        // is wrong instead of being handed the API's raw schema rejection.
        const badRev = values.lines.findIndex((l) => !String(l.revision ?? '').trim());
        if (badRev >= 0) {
          setLineError(
            `Line ${badRev + 1}: enter the Drawing Rev — the revision printed on the customer's drawing.`,
          );
          return;
        }
        // ADR-177: a saved line's Rev never goes backwards (B → A, 2 → 1). Checked
        // here against the revision the SO was loaded with, with the same sentence
        // the API answers, so the person is told before the round trip. A change
        // of kind (1 → A) cannot be ordered and is allowed.
        if (props.mode === 'edit') {
          const savedById = new Map(props.detail.lines.map((d) => [d.id, d]));
          for (const l of values.lines) {
            const saved = l.id ? savedById.get(l.id) : undefined;
            if (!saved) continue;
            const typed = String(l.revision ?? '');
            if (revisionGoesBackwards(saved.revision, typed)) {
              setLineError(revisionBackwardsMessage(saved.lineNo, saved.revision, typed));
              return;
            }
          }
        }
      }

      const headerOut = {
        ...values.header,
        status: asDraft ? ('draft' as SoStatus) : values.header.status,
        code: values.header.code?.trim() || undefined,
        customerName: undefined,
        clientId: values.header.clientId || undefined,
        clientPoNo: values.header.clientPoNo?.trim() || undefined,
        bomMasterId: equip ? values.header.bomMasterId?.trim() || undefined : undefined,
        bomStatus: equip
          ? values.header.bomMasterId?.trim()
            ? 'BOM Assigned'
            : 'BOM Pending'
          : undefined,
        remarks: values.header.remarks?.trim() || undefined,
      };

      const srcLines = equip ? values.lines.slice(0, 1) : values.lines;
      const linesOut = srcLines.map((l) => {
        const trimmedCode = l.itemCodeText.trim();
        const refs: { itemId?: string; itemCodeText?: string } = l.itemId
          ? { itemId: l.itemId }
          : trimmedCode
            ? { itemCodeText: trimmedCode }
            : {};
        return {
          ...(l.id ? { id: l.id } : {}),
          ...refs,
          partName: l.partName.trim(),
          material: l.material?.trim() || undefined,
          // null, not undefined: the server merges only PRESENT keys on update, so a
          // Drawing No. the user cleared must be sent as null to actually clear it.
          drawingNo: l.drawingNo?.trim() || null,
          // null, not undefined: JSON.stringify drops undefined keys, so clearing
          // a drawing sent nothing at all and the server kept the old file. An
          // explicit null is what tells it the drawing was removed — and what
          // makes the removal show up in the drawing history.
          drawingFilePath: l.drawingFilePath || null,
          // Trimmed and always sent; the form is the only source of it and the API
          // requires a non-empty string. The '0' fallback is unreachable for a
          // component line — the compulsory check above has already refused the
          // save — and exists only for the EQUIPMENT path, which has no Rev box of
          // its own and so has nobody to ask.
          revision: normalizeRevision(String(l.revision ?? '')) || '0',
          uom: l.uom,
          orderQty: Number(l.orderQty),
          rate: Number(l.rate),
          dueDate: soDue,
          clientPoLineNo: l.clientPoLineNo?.trim() || undefined,
          ...(l.status ? { status: l.status } : {}),
        };
      });

      const milestonesOut = equip
        ? []
        : (values.milestones ?? [])
            // Legacy _getSoBaseData L12310 keeps only lots with a real qty.
            .filter((m) => Number(m.qty) > 0)
            .map((m, i) => ({
              ...(m.id ? { id: m.id } : {}),
              lotNo: Number(m.lotNo) || i + 1,
              qty: Number(m.qty) || 0,
              dueDate: m.dueDate || undefined,
              remarks: m.remarks?.trim() || undefined,
            }));

      if (isEdit) {
        const { code: _drop, ...headerNoCode } = headerOut;
        void _drop;
        await props.onSubmit({ header: headerNoCode, lines: linesOut, milestones: milestonesOut });
      } else {
        await props.onSubmit({
          header: headerOut,
          lines: linesOut,
          milestones: milestonesOut,
        } as CreateSalesOrderInput);
      }
    };

  // ── Page chrome: sticky PageHeader (Cancel · Save as Draft · Save), dirty
  // pill, Ctrl+S, and ONE error summary right under the header so the person
  // sees what blocked the save where the Save button is. ──
  const saveDisabled = formState.isSubmitting || (isCreate && !docNoValid);
  const draftDisabled = formState.isSubmitting || !docNoValid;
  const isDirty = formState.isDirty || poFileName !== null || emailFileName !== null;
  useSaveShortcut(() => void handleSubmit(onValid(false))(), !saveDisabled);

  const summaryErrors = [lineError, poEmailError, props.submitError ?? null].filter(
    (m): m is string => Boolean(m),
  );
  const hasFieldErrors = Object.keys(errors).length > 0;

  // "▸ More" per line: which rows have their detail row open (keyed by the
  // field-array id, so deleting a line never opens its neighbour).
  const [openLines, setOpenLines] = useState<ReadonlySet<string>>(() => new Set());
  function toggleLine(key: string): void {
    setOpenLines((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  const attachButtons = (
    <>
      {poFileName ? (
        <span
          className="green"
          style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--sp-1)' }}
        >
          <span
            title={poFileName}
            style={{
              maxWidth: 160,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {poFileName}
          </span>
          <button
            type="button"
            className="btn btn-ghost btn-sm red"
            onClick={clearPoFile}
            aria-label="Remove PO document"
          >
            ✕
          </button>
        </span>
      ) : (
        <label className="btn btn-ghost btn-sm">
          Upload PO Doc
          <input
            type="file"
            accept=".pdf,.jpg,.jpeg,.png,.webp"
            style={{ display: 'none' }}
            onChange={onPickPoFile}
          />
        </label>
      )}
      {emailFileName ? (
        <span
          className="green"
          style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--sp-1)' }}
        >
          <span
            title={emailFileName}
            style={{
              maxWidth: 160,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {emailFileName}
          </span>
          {emailFileUrl ? (
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => window.open(emailFileUrl, '_blank', 'noopener')}
            >
              View
            </button>
          ) : null}
          <button
            type="button"
            className="btn btn-ghost btn-sm red"
            onClick={clearEmailFile}
            aria-label="Remove email reference"
          >
            ✕
          </button>
        </span>
      ) : (
        <label className="btn btn-ghost btn-sm">
          Attach Email Ref
          <input
            type="file"
            accept=".eml,.msg,.pdf,.jpg,.jpeg,.png,.webp"
            style={{ display: 'none' }}
            onChange={onPickEmailFile}
          />
        </label>
      )}
    </>
  );

  return (
    <form onSubmit={handleSubmit(onValid(false))}>
      {/* Sticky page header — the save actions live here, still inside <form>,
          so type="submit" and the disabled rules are unchanged. */}
      <PageHeader
        sticky
        title={props.title}
        backLabel={props.backLabel}
        onBack={props.onBack}
        dirty={isDirty}
        actions={
          <>
            {props.onCancel ? (
              <button type="button" className="btn btn-ghost" onClick={props.onCancel}>
                Cancel
              </button>
            ) : null}
            {isCreate ? (
              <button
                type="button"
                className="btn btn-ghost"
                disabled={draftDisabled}
                onClick={() => void handleSubmit(onValid(true))()}
                title="Save as Draft — not yet released to planning"
              >
                Save as Draft
              </button>
            ) : null}
            {/* Legacy footer: addSO L12427 / _editFullSO L12619 reach showModalLg
                with no explicit saveLabel, so the label is "Save SO". */}
            <button type="submit" className="btn btn-primary" disabled={saveDisabled}>
              {formState.isSubmitting ? <Loader2 size={13} className="animate-spin" /> : null}
              {props.submitLabel ?? (isCreate ? 'Save SO' : 'Save Changes')}
            </button>
          </>
        }
      >
        {summaryErrors.length > 0 || hasFieldErrors ? (
          <Banner tone="error" role="alert" flush>
            {summaryErrors.map((m) => (
              <div key={m}>{m}</div>
            ))}
            {hasFieldErrors ? (
              <div>Some fields are missing or wrong — see the red notes below.</div>
            ) : null}
          </Banner>
        ) : null}
      </PageHeader>

      {/* Header — customer first, then the document no. / dates / type, then
          remarks. Row 1: Customer 6 + Client PO 4 + GST 2; row 2: SO No. 3 +
          SO Date 3 + Due Date 3 + SO Type 3; Remarks full width. */}
      <Panel title="Order Details" actions={attachButtons}>
        <FormGrid>
          <FormField label="Customer" required size="lg" error={errors.header?.clientId?.message}>
            <div style={{ display: 'flex', gap: 'var(--sp-1)', alignItems: 'flex-start' }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <SearchableSelect
                  id="clientId"
                  value={selectedClientId}
                  onChange={(id) => {
                    setValue('header.clientId', id ?? undefined, { shouldValidate: true });
                    const c = clients.find((x) => x.id === id);
                    setClientLabel(c ? `${c.code} — ${c.name}` : '');
                  }}
                  onSearch={setClientSearch}
                  loading={clientsFetching}
                  options={clients.map((c) => ({ id: c.id, code: c.code, name: c.name }))}
                  placeholder="🔍 Type customer code or name..."
                  valueLabel={
                    selectedClient
                      ? `${selectedClient.code} — ${selectedClient.name}`
                      : clientLabel || undefined
                  }
                />
              </div>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                title="Add a new customer without leaving this form"
                onClick={() => setShowAddClient(true)}
              >
                + New
              </button>
            </div>
            <input
              type="hidden"
              {...register('header.clientId', { required: 'Customer is required' })}
            />
          </FormField>

          {/* No ★: clientPoNo is schema-optional (max(64).optional()) and legacy
              stars neither mode — an attached Email Ref satisfies the rule. */}
          <FormField label="Client PO No." size="md" htmlFor="clientPoNo" error={poEmailError}>
            <input
              id="clientPoNo"
              className="innovic-input"
              autoComplete="off"
              placeholder="Client PO reference"
              {...register('header.clientPoNo', {
                onChange: (e) => {
                  if (e.target.value.trim()) setPoEmailError(null);
                },
              })}
            />
          </FormField>

          <FormField label="GST %" size="xs" htmlFor="gstPercent">
            <select
              id="gstPercent"
              className="innovic-select"
              {...register('header.gstPercent', { valueAsNumber: true })}
            >
              {SO_GST_PERCENTS.map((g) => (
                <option key={g} value={g}>
                  {g}%
                </option>
              ))}
            </select>
          </FormField>

          <div className="f-sm">
            <DocNumberInput
              type="sales_order"
              label="SO No."
              required={isCreate}
              readOnly={isEdit}
              value={watch('header.code') ?? ''}
              onChange={(v) => setValue('header.code', v)}
              onValidityChange={setDocNoValid}
            />
          </div>
          <FormField
            label="SO Date"
            required
            size="sm"
            htmlFor="soDate"
            error={errors.header?.soDate?.message}
          >
            <input
              id="soDate"
              type="date"
              className="innovic-input"
              {...register('header.soDate', { required: 'SO Date is required.' })}
            />
          </FormField>
          <FormField label="Due Date" size="sm" htmlFor="soDueDate">
            <input
              id="soDueDate"
              type="date"
              className="innovic-input"
              {...register('header.dueDate')}
            />
          </FormField>
          <FormField label="SO Type" required size="sm" htmlFor="type">
            <select id="type" className="innovic-select" {...register('header.type')}>
              {SELECTABLE_SO_TYPES.map((t) => (
                <option key={t} value={t}>
                  {SO_TYPE_LABEL[t]}
                </option>
              ))}
            </select>
          </FormField>

          <FormField label="Remarks" size="full" htmlFor="remarks">
            <textarea
              id="remarks"
              className="innovic-textarea"
              rows={2}
              placeholder="Notes"
              {...register('header.remarks')}
            />
          </FormField>
        </FormGrid>
      </Panel>

      {isEquip ? (
        /* ── Equipment Details (legacy L12258) — same 12-column grid. ── */
        <Panel title="Equipment Details">
          <FormGrid>
            {/* "Parent Item" not "Part No.": this is the assembly a BOM builds
                (ADR-108), and naming it the same on both screens is what makes
                the auto-attach below make sense. */}
            <FormField
              label="Equipment / Parent Item"
              required
              size="lg"
              htmlFor="so-equip-item"
              error={errors.lines?.[0]?.itemCodeText?.message}
            >
              {/* The same master-only picker the line table uses, not a
                  hand-rolled <datalist>: a typo'd off-master code matched no
                  item and the BOM then silently never attached. */}
              <SearchableSelect
                id="so-equip-item"
                value={equipItemId}
                onChange={pickEquipItem}
                onSearch={setItemSearch}
                loading={itemsFetching}
                options={items.map((it) => ({ id: it.id, code: it.code, name: it.name }))}
                placeholder="🔍 Search item code or name..."
                valueLabel={equipCodeText || undefined}
                // Show only the code in the field once picked; the dropdown
                // still lists "CODE — Name".
                selectedLabel={(o) => o.code ?? o.name}
              />
              {/* The picker writes through setValue, so RHF needs the field
                  registered somewhere to keep enforcing `required`. */}
              <input
                type="hidden"
                {...register('lines.0.itemCodeText', {
                  required: isEquip ? 'Parent item is required' : false,
                })}
              />
            </FormField>
            {/* Auto-filled from the master and locked once a parent resolves
                (CONVENTIONS "Item pickers"). Editable while nothing resolves — an
                edit form holding an off-master legacy row still needs it typed. */}
            <FormField
              label="Item Name"
              required
              size="lg"
              htmlFor="so-equip-desc"
              error={errors.lines?.[0]?.partName?.message}
            >
              <input
                id="so-equip-desc"
                className="innovic-input"
                autoComplete="off"
                readOnly={!!equipItem}
                placeholder="Equipment name"
                {...register('lines.0.partName', {
                  required: isEquip ? 'Item Name is required.' : false,
                })}
              />
            </FormField>
            {/* A whole number ≥ 1 — exactly what the server stores. Guarded on
                isEquip so a component SO is never blocked by this rule. */}
            <FormField
              label="Order Qty"
              required
              size="sm"
              htmlFor="so-equip-qty"
              error={errors.lines?.[0]?.orderQty?.message}
            >
              <input
                id="so-equip-qty"
                type="number"
                min={1}
                step={1}
                className="innovic-input"
                {...register('lines.0.orderQty', {
                  valueAsNumber: true,
                  validate: (v) =>
                    !isEquip ||
                    (Number.isInteger(v) && v >= 1) ||
                    'Order Qty must be a whole number, 1 or more',
                })}
              />
            </FormField>
            {/* No ★ — the server defaults this to 0; `setValueAs` turns a cleared
                box into 0 instead of NaN (which went over the wire as null). */}
            <FormField
              label="Rate (₹)"
              size="sm"
              htmlFor="so-equip-rate"
              error={errors.lines?.[0]?.rate?.message}
            >
              <input
                id="so-equip-rate"
                type="number"
                step="0.01"
                min={0}
                className="innovic-input fw-700 green"
                {...register('lines.0.rate', {
                  setValueAs: (v: string | number | null | undefined) =>
                    v === '' || v === null || v === undefined ? 0 : Number(v),
                  validate: (v) =>
                    !isEquip || (Number.isFinite(v) && v >= 0) || 'Rate cannot be negative.',
                })}
              />
            </FormField>
            {/* Read-only, not a picker: the parent item decides the BOM
                (ADR-108). The value still travels through the hidden input. */}
            <FormField
              label="BOM (Bill of Materials)"
              size="lg"
              htmlFor="so-equip-bom"
              help="Auto-filled from the parent item."
            >
              <input
                id="so-equip-bom"
                className="innovic-input"
                readOnly
                tabIndex={-1}
                value={attachedBomLabel}
              />
              <input type="hidden" {...register('header.bomMasterId')} />
              {/* Say which BOM was attached, or that none exists — and hand the
                  user the way out. Silent while no item has resolved yet. */}
              {equipItem ? (
                <Banner tone={equipBom ? 'success' : 'warn'} flush>
                  {equipBom ? (
                    <>
                      ✓ {equipBom.bomNo} — {equipBom.bomName} (BOM Rev {equipBom.revision},{' '}
                      {equipBom.lineCount} parts) attached automatically for {equipItem.code}.
                    </>
                  ) : (
                    <>
                      ⚠ No BOM exists for {equipItem.code} — {equipItem.name}. Create one in BOM
                      Master first, then come back and re-pick this item.{' '}
                      <Link to="/bom-masters/new" className="btn btn-ghost btn-sm">
                        Go to BOM Master →
                      </Link>
                    </>
                  )}
                </Banner>
              ) : null}
            </FormField>
          </FormGrid>
        </Panel>
      ) : (
        /* ── Component / With-Material line items (legacy L12278) ── */
        <>
          {/* One field-cascade host per line (renders nothing): Item Code drives
              Part Name / Material / UOM. Kept out of the <table> body. */}
          {fields.map((field, idx) => (
            <LineItemCascade
              key={`casc-${field.id}`}
              form={form}
              idx={idx}
              itemId={watchedLines?.[idx]?.itemId ?? null}
              itemsById={itemsById}
            />
          ))}
          <Panel
            title="Line Items"
            bodyPadding="none"
            actions={
              <>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={() => downloadSoLineTemplate()}
                >
                  Template
                </button>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={() => lineFileRef.current?.click()}
                >
                  Import Excel
                </button>
                <input
                  ref={lineFileRef}
                  type="file"
                  accept=".xlsx,.xls"
                  style={{ display: 'none' }}
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) void onImportLines(f);
                  }}
                />
                <button
                  type="button"
                  className="btn btn-primary btn-sm"
                  onClick={() => append({ ...NEW_LINE })}
                >
                  <Plus size={13} /> Add Line
                </button>
              </>
            }
          >
            {importMsg ? (
              <div style={{ padding: 'var(--sp-2) var(--sp-3) 0' }}>
                <Banner
                  tone={importMsg.includes('not found in Item Master') ? 'warn' : 'info'}
                  onDismiss={() => setImportMsg(null)}
                >
                  {importMsg}
                </Banner>
              </div>
            ) : null}

            {/* The table scrolls inside its own wrapper, never the page. The item
                picker's dropdown is portalled, so the wrapper cannot clip it.
                Visible: # · Item Code + Drawing Rev · Item Name · POL · UOM · Qty
                · Rate · Amount. Material, Drawing No. and Drawing File sit in the
                row's "▸ More" detail row. */}
            <div className="tbl-wrap">
              <table
                className="innovic-table tbl-ctr"
                style={{ tableLayout: 'fixed', minWidth: 900 }}
              >
                <thead>
                  <tr>
                    <th style={{ width: '4%' }}>Ln</th>
                    <th style={{ width: '24%' }}>
                      Item Code <span className="req">★</span> · Drawing Rev{' '}
                      <span className="req">★</span>
                    </th>
                    <th style={{ width: '17%' }}>Item Name</th>
                    <th style={{ width: '7%' }}>POL</th>
                    <th style={{ width: '6%' }}>UOM</th>
                    <th className="th-num" style={{ width: '8%' }}>
                      Order Qty <span className="req">★</span>
                    </th>
                    <th className="th-num" style={{ width: '9%' }}>
                      Rate (₹)
                    </th>
                    <th className="th-num" style={{ width: '10%' }}>
                      Amount
                    </th>
                    <th style={{ width: '15%' }} />
                  </tr>
                </thead>
                <tbody>
                  {fields.length === 0 ? (
                    <tr>
                      <td colSpan={9} className="empty-state">
                        No lines yet — click &ldquo;+ Add Line&rdquo;
                      </td>
                    </tr>
                  ) : (
                    fields.map((field, idx) => {
                      const ln = watchedLines?.[idx];
                      const amt = (Number(ln?.orderQty) || 0) * (Number(ln?.rate) || 0);
                      const open = openLines.has(field.id);
                      return (
                        <Fragment key={field.id}>
                          <tr>
                            <td className="mono fw-700 cyan">{idx + 1}</td>
                            <td>
                              <div
                                style={{
                                  display: 'flex',
                                  gap: 'var(--sp-1)',
                                  alignItems: 'center',
                                }}
                              >
                                <div style={{ flex: 1, minWidth: 0 }}>
                                  <SearchableSelect
                                    id={`soln-ic-${idx}`}
                                    value={ln?.itemId ?? null}
                                    onChange={(id) => pickItem(idx, id)}
                                    onSearch={setItemSearch}
                                    loading={itemsFetching}
                                    options={items.map((it) => ({
                                      id: it.id,
                                      code: it.code,
                                      name: it.name,
                                    }))}
                                    placeholder="🔍 Search item code or name..."
                                    valueLabel={ln?.itemCodeText || undefined}
                                    // Show only the code in the field once picked; the
                                    // dropdown still lists "CODE — Name".
                                    selectedLabel={(o) => o.code ?? o.name}
                                  />
                                </div>
                                {/* The customer's drawing revision, typed exactly as it
                                    reads on their print ('A', 'B', 'R1', '0'). Independent
                                    of the Drawing File in both directions. Compulsory —
                                    onValid refuses the save when it is blank. */}
                                <input
                                  className="innovic-input fw-xs"
                                  autoComplete="off"
                                  placeholder="Rev"
                                  aria-label={`Drawing Rev, line ${idx + 1}`}
                                  maxLength={32}
                                  style={{ textTransform: 'uppercase' }}
                                  pattern={REV_INPUT_PATTERN}
                                  title={REV_INPUT_TITLE}
                                  {...upperCaseRevField(register(`lines.${idx}.revision` as const))}
                                />
                              </div>
                            </td>
                            {/* Auto-filled from the item master — read-only (set by pickItem). */}
                            <td>
                              <input
                                className="innovic-input"
                                autoComplete="off"
                                readOnly
                                title={ln?.partName || undefined}
                                {...register(`lines.${idx}.partName` as const)}
                              />
                            </td>
                            <td>
                              <input
                                className="innovic-input"
                                autoComplete="off"
                                placeholder="POL"
                                style={{ color: 'var(--purple)', fontWeight: 600 }}
                                {...register(`lines.${idx}.clientPoLineNo` as const)}
                              />
                            </td>
                            <td>
                              <input
                                className="innovic-input"
                                autoComplete="off"
                                readOnly
                                {...register(`lines.${idx}.uom` as const)}
                              />
                            </td>
                            <td className="td-num">
                              <input
                                type="number"
                                min={1}
                                placeholder="Qty"
                                className="innovic-input fw-700 cyan"
                                {...register(`lines.${idx}.orderQty` as const, {
                                  valueAsNumber: true,
                                })}
                              />
                            </td>
                            <td className="td-num">
                              <input
                                type="number"
                                step="0.01"
                                min={0}
                                placeholder="₹ Rate"
                                className="innovic-input green"
                                {...register(`lines.${idx}.rate` as const, { valueAsNumber: true })}
                              />
                            </td>
                            <td className="td-num mono fw-700 green">
                              {amt > 0 ? `₹${inrFormat(amt)}` : '—'}
                            </td>
                            <td>
                              <div
                                style={{
                                  display: 'flex',
                                  gap: 'var(--sp-1)',
                                  justifyContent: 'center',
                                }}
                              >
                                <button
                                  type="button"
                                  className="btn btn-ghost btn-sm"
                                  aria-expanded={open}
                                  title="Material, Drawing No. and Drawing File"
                                  onClick={() => toggleLine(field.id)}
                                >
                                  {open ? '▾' : '▸'} More
                                </button>
                                <button
                                  type="button"
                                  className="btn btn-ghost btn-sm red"
                                  onClick={() => remove(idx)}
                                  aria-label={`Remove line ${idx + 1}`}
                                >
                                  Delete
                                </button>
                              </div>
                            </td>
                          </tr>
                          {open ? (
                            <tr>
                              <td colSpan={9} style={{ background: 'var(--bg3)' }}>
                                <FormGrid>
                                  <FormField label="Material" size="md" htmlFor={`soln-mat-${idx}`}>
                                    <input
                                      id={`soln-mat-${idx}`}
                                      className="innovic-input"
                                      autoComplete="off"
                                      readOnly
                                      {...register(`lines.${idx}.material` as const)}
                                    />
                                  </FormField>
                                  {/* Drawing No. is TYPED per line, exactly as it reads on
                                      the customer's drawing for THIS order (user decision
                                      2026-09-21). Re-picking the item never overwrites it. */}
                                  <FormField
                                    label="Drawing No."
                                    size="md"
                                    htmlFor={`soln-dwg-${idx}`}
                                  >
                                    <input
                                      id={`soln-dwg-${idx}`}
                                      className="innovic-input"
                                      autoComplete="off"
                                      placeholder="Drawing No."
                                      maxLength={64}
                                      {...register(`lines.${idx}.drawingNo` as const)}
                                    />
                                  </FormField>
                                  <FormField label="Drawing File" size="md">
                                    <SoLineDrawingCell
                                      value={watch(`lines.${idx}.drawingFilePath` as const)}
                                      onChange={(p) =>
                                        setValue(`lines.${idx}.drawingFilePath` as const, p, {
                                          shouldDirty: true,
                                        })
                                      }
                                      // For the drawing access log only. On a brand-new SO
                                      // the code is still blank, so the row number is all
                                      // there is to say.
                                      refCode={`${watch('header.code') || 'new SO'} L${idx + 1}`}
                                    />
                                  </FormField>
                                </FormGrid>
                              </td>
                            </tr>
                          ) : null}
                        </Fragment>
                      );
                    })
                  )}
                </tbody>
                {/* SO Totals (legacy _soTotalsHtml L12366): Subtotal · GST · Grand
                    Total under the Amount column, right-aligned. */}
                <tfoot>
                  <tr>
                    <td colSpan={5} className="text3">
                      {lineCount} items · {totalPcs} total pcs
                    </td>
                    <td colSpan={2} className="td-num text3">
                      Subtotal
                    </td>
                    <td className="td-num mono fw-700">₹{inrFormat(subtotal)}</td>
                    <td />
                  </tr>
                  <tr>
                    <td colSpan={5} />
                    <td colSpan={2} className="td-num text3">
                      GST {gstPercent}%
                    </td>
                    <td className="td-num mono fw-700 amber">₹{inrFormat(gstAmt)}</td>
                    <td />
                  </tr>
                  <tr>
                    <td colSpan={5} />
                    <td colSpan={2} className="td-num fw-700 green">
                      Grand Total
                    </td>
                    <td className="td-num mono fw-700 green" style={{ fontSize: 'var(--fs-md)' }}>
                      ₹{inrFormat(grand)}
                    </td>
                    <td />
                  </tr>
                </tfoot>
              </table>
            </div>
          </Panel>

          {/* Delivery Schedule / Milestones (ISSUE-015, legacy _soMilestonesHtml
              L12392). Empty is the normal case — full qty on the due date. */}
          <Panel
            title="Delivery Schedule"
            bodyPadding={msFields.length === 0 ? 'default' : 'none'}
            actions={
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => appendMs({ ...NEW_MILESTONE, lotNo: msFields.length + 1 })}
              >
                <Plus size={13} /> Add Lot
              </button>
            }
          >
            {msFields.length === 0 ? (
              <span className="text3">Full qty on the Due Date.</span>
            ) : (
              <div className="tbl-wrap">
                <table className="innovic-table tbl-ctr">
                  <thead>
                    <tr>
                      <th style={{ width: 80 }}>Lot No.</th>
                      <th className="th-num">Qty</th>
                      <th>Due Date</th>
                      <th>Remarks</th>
                      <th style={{ width: 40 }} />
                    </tr>
                  </thead>
                  <tbody>
                    {msFields.map((field, idx) => (
                      <tr key={field.id}>
                        {/* Legacy prints the row index here; ours keeps the editable
                            Lot # the save reads (`lotNo`) — feature retained. */}
                        <td>
                          <input
                            type="number"
                            min={1}
                            className="innovic-input mono fw-700"
                            style={{ color: 'var(--purple)' }}
                            {...register(`milestones.${idx}.lotNo` as const, {
                              valueAsNumber: true,
                            })}
                          />
                        </td>
                        <td className="td-num">
                          <input
                            type="number"
                            min={0}
                            placeholder="Qty"
                            className="innovic-input fw-700 cyan"
                            {...register(`milestones.${idx}.qty` as const, { valueAsNumber: true })}
                          />
                        </td>
                        <td>
                          <input
                            type="date"
                            className="innovic-input"
                            {...register(`milestones.${idx}.dueDate` as const)}
                          />
                        </td>
                        <td>
                          <input
                            className="innovic-input"
                            autoComplete="off"
                            placeholder="e.g. 1st lot"
                            {...register(`milestones.${idx}.remarks` as const)}
                          />
                        </td>
                        <td>
                          <button
                            type="button"
                            className="btn btn-danger btn-sm btn-icon"
                            onClick={() => removeMs(idx)}
                            aria-label={`Remove lot ${idx + 1}`}
                          >
                            <Trash2 size={12} />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Panel>
        </>
      )}

      {showAddClient ? (
        <QuickAddClient onClose={() => setShowAddClient(false)} onCreated={onClientCreated} />
      ) : null}
    </form>
  );
}

/** Minimal client quick-add modal (legacy addClientQuick). Name is the only
 *  required field; the server auto-generates the CLI-### code. */
function QuickAddClient({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (id: string, label: string) => void;
}): React.JSX.Element {
  const create = useCreateClient();
  const [name, setName] = useState('');
  const [contactPerson, setContactPerson] = useState('');
  const [phone, setPhone] = useState('');
  const [gstNumber, setGstNumber] = useState('');
  const [err, setErr] = useState<string | null>(null);

  async function onSave(): Promise<void> {
    setErr(null);
    if (!name.trim()) {
      setErr('Customer is required.');
      return;
    }
    try {
      const c = await create.mutateAsync({
        name: name.trim(),
        ...(contactPerson.trim() ? { contactPerson: contactPerson.trim() } : {}),
        ...(phone.trim() ? { phone: phone.trim() } : {}),
        ...(gstNumber.trim() ? { gstNumber: gstNumber.trim() } : {}),
        isActive: true,
      });
      onCreated(c.id, `${c.code} — ${c.name}`);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not save Customer. Try again.');
    }
  }

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.5)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 200,
      }}
      onClick={onClose}
    >
      <div
        style={{
          background: 'var(--bg)',
          border: '1px solid var(--border)',
          borderRadius: 8,
          padding: 20,
          width: 'min(420px, 94vw)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="section-hdr" style={{ marginBottom: 12 }}>
          🏢 New Customer
        </div>
        <div className="form-grp">
          <label className="form-label">
            Customer<span className="req">★</span>
          </label>
          <input
            className="innovic-input"
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Company / customer name"
          />
        </div>
        <div className="form-grp">
          <label className="form-label">Contact Person</label>
          <input
            className="innovic-input"
            value={contactPerson}
            onChange={(e) => setContactPerson(e.target.value)}
            placeholder="Optional"
          />
        </div>
        <div className="form-grp">
          <label className="form-label">Phone</label>
          <input
            className="innovic-input"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="Optional"
          />
        </div>
        <div className="form-grp">
          <label className="form-label">GSTIN</label>
          <input
            className="innovic-input"
            value={gstNumber}
            onChange={(e) => setGstNumber(e.target.value)}
            placeholder="Optional"
          />
        </div>
        <div className="form-help">Code auto-generates (CLI-###).</div>
        {err ? (
          <div className="form-error" style={{ marginTop: 6 }}>
            {err}
          </div>
        ) : null}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 6, marginTop: 14 }}>
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="btn btn-primary"
            disabled={create.isPending}
            onClick={() => void onSave()}
          >
            {create.isPending ? <Loader2 size={13} className="animate-spin" /> : null} Add Customer
          </button>
        </div>
      </div>
    </div>
  );
}

/** Hosts the shared field-cascade for one SO line (renders nothing). Item Code
 *  (itemId) is the controller; on a fresh pick the master's Part Name / Material
 *  / UOM REPLACE the row's values, on a clear they RESET. Qty, Drawing No., Rev,
 *  Rate, Client PO Ln, status and the master link itself are user/picker-owned
 *  and are hard-blocked via `userEntered`. A synchronous Map lookup backs the
 *  resolve, so nothing is fetched here and no stale reply can land — the hook's
 *  request-id guard covers it regardless. One instance per line satisfies the
 *  Rules of Hooks for a react-hook-form field array. */
function LineItemCascade({
  form,
  idx,
  itemId,
  itemsById,
}: {
  form: UseFormReturn<FormValues>;
  idx: number;
  itemId: string | null;
  itemsById: Map<string, ListItemsResponse['items'][number]>;
}): null {
  useFieldCascade<FormValues, ListItemsResponse['items'][number]>({
    form,
    value: itemId,
    resolve: (id) => itemsById.get(id) ?? null,
    fields: [
      cascadeField(`lines.${idx}.partName`, (it) => it.name, ''),
      cascadeField(`lines.${idx}.material`, (it) => it.material ?? '', ''),
      cascadeField(`lines.${idx}.uom`, (it) => it.uom, NEW_LINE.uom),
    ],
    userEntered: [
      `lines.${idx}.orderQty`,
      `lines.${idx}.rate`,
      `lines.${idx}.clientPoLineNo`,
      `lines.${idx}.status`,
      `lines.${idx}.itemId`,
      `lines.${idx}.itemCodeText`,
      // The drawing file is line-specific, uploaded by the user — never
      // auto-filled from the item master. Drawing No. and Rev are facts of the
      // same kind: they are what is printed on the customer's drawing for THIS
      // order, not a property of the item (the master no longer carries a
      // drawing no. — user decision 2026-09-21), so re-picking the item code
      // must never overwrite what was typed there.
      `lines.${idx}.drawingFilePath`,
      `lines.${idx}.drawingNo`,
      `lines.${idx}.revision`,
    ],
    setValueOptions: { shouldDirty: true },
  });
  return null;
}

function detailToFormValues(detail: SalesOrderDetail): FormValues {
  return {
    header: {
      code: detail.code,
      soDate: detail.soDate,
      type: detail.type,
      status: detail.status,
      gstPercent: Number(detail.gstPercent),
      ...(detail.clientId ? { clientId: detail.clientId } : {}),
      ...(detail.customerName ? { customerName: detail.customerName } : {}),
      ...(detail.clientPoNo ? { clientPoNo: detail.clientPoNo } : {}),
      ...(detail.bomMasterId ? { bomMasterId: detail.bomMasterId } : {}),
      ...(detail.bomStatus ? { bomStatus: detail.bomStatus } : {}),
      ...(detail.remarks ? { remarks: detail.remarks } : {}),
      // SO-level due date = the earliest line due date (lines all share it now).
      ...(() => {
        const due = detail.lines
          .map((l) => l.dueDate)
          .filter((d): d is string => Boolean(d))
          .sort()[0];
        return due ? { dueDate: due } : {};
      })(),
    },
    lines:
      detail.lines.length > 0
        ? detail.lines.map(
            (l): LineFormValue => ({
              id: l.id,
              ...(l.itemId ? { itemId: l.itemId } : {}),
              itemCodeText: l.itemCode ?? l.itemCodeText ?? '',
              partName: l.partName,
              ...(l.material ? { material: l.material } : {}),
              ...(l.drawingNo ? { drawingNo: l.drawingNo } : {}),
              // Upper-cased on load (ADR-177): a Rev stored as 'b' before the
              // capital rule would otherwise sit in the box as 'b' (shown as 'B'
              // by textTransform) and fail the input's `pattern`, blocking the
              // whole SO from saving until every such line was retyped.
              revision: normalizeRevision(l.revision),
              ...(l.drawingFilePath ? { drawingFilePath: l.drawingFilePath } : {}),
              uom: l.uom,
              orderQty: l.orderQty,
              rate: Number(l.rate),
              ...(l.dueDate ? { dueDate: l.dueDate } : {}),
              ...(l.clientPoLineNo ? { clientPoLineNo: l.clientPoLineNo } : {}),
              status: l.status,
            }),
          )
        : [{ ...NEW_LINE }],
    milestones: detail.milestones.map(
      (m): MilestoneFormValue => ({
        id: m.id,
        lotNo: m.lotNo,
        qty: m.qty,
        ...(m.dueDate ? { dueDate: m.dueDate } : {}),
        ...(m.remarks ? { remarks: m.remarks } : {}),
      }),
    ),
  };
}
