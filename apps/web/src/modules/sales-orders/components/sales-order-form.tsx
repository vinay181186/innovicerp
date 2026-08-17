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
  type SalesOrderDetail,
  SELECTABLE_SO_TYPES,
  type SoStatus,
  type SoType,
  type UpdateSalesOrderInput,
  type Uom,
} from '@innovic/shared';
import { Link } from '@tanstack/react-router';
import { Loader2, Plus, Trash2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useFieldArray, useForm, type UseFormReturn } from 'react-hook-form';
import { DocNumberInput } from '@/components/shared/doc-number-input';
import { todayLocal } from '@/lib/date';
import { SearchableSelect } from '@/components/shared/searchable-select';
import { apiFetch } from '@/lib/api';
import { cascadeField, useFieldCascade } from '@/lib/use-field-cascade';
import { inrFormat } from '@/lib/print/doc-print';
import { useBomMastersList } from '@/modules/bom-master/api';
import { useClientsList, useCreateClient } from '@/modules/clients/api';
import { useItemsList } from '@/modules/items/api';
import { downloadSoLineTemplate, parseSoLineFile } from '../lib/import-export';

interface LineFormValue {
  id?: string | undefined;
  itemId?: string | undefined;
  itemCodeText: string;
  partName: string;
  material?: string | undefined;
  drawingNo?: string | undefined;
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
  gstPercent: 18,
};
const NEW_LINE: LineFormValue = { itemCodeText: '', partName: '', uom: 'NOS', orderQty: 1, rate: 0 };
const NEW_MILESTONE: MilestoneFormValue = { lotNo: 1, qty: 0 };

/** Chrome for the form's own action bar. The Back link, title and breadcrumb are
 *  the page's to name, but the Save buttons must stay inside <form> to keep
 *  type="submit" and their disabled state — so the page hands its chrome down
 *  rather than rendering a separate header row above. */
type FormChrome = {
  headerBack?: React.ReactNode;
  headerTitle?: React.ReactNode;
  headerCrumb?: React.ReactNode;
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

  const [itemSearch, setItemSearch] = useState('');
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
   *  fields (Part Name / Material / Drawing No. / UOM) are refilled/reset by the
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

  // Equipment Part No. uses a free datalist (legacy allows off-master parts).
  const itemsByCode = new Map(items.map((it) => [it.code.trim().toUpperCase(), it]));

  // The equipment datalist is fed by the same 50-row page as the line-item
  // picker. Without pushing the typed code into the search term, an item past
  // that page would never resolve — and the BOM note below would stay silent
  // instead of saying anything. Debounced so a 12-character code is one fetch.
  const equipSearchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  function queueEquipSearch(term: string): void {
    if (equipSearchTimer.current) clearTimeout(equipSearchTimer.current);
    equipSearchTimer.current = setTimeout(() => setItemSearch(term.trim()), 250);
  }

  function fillEquipFromItem(codeValue: string): void {
    queueEquipSearch(codeValue);
    const it = itemsByCode.get(codeValue.trim().toUpperCase());
    if (!it) return;
    if (!getValues('lines.0.partName')) setValue('lines.0.partName', it.name);
  }

  // ── Equipment → its BOM ──────────────────────────────────────────────────
  // A BOM now names the parent item it builds (ADR-108), so picking the
  // equipment is enough to find its BOM. Derived from render state rather than
  // computed inside the keystroke handler: the item often resolves only AFTER
  // the debounced search lands, and an imperative handler would already have
  // run and left the note blank.
  const equipCodeText = watch('lines.0.itemCodeText') ?? '';
  const equipItem = isEquip
    ? (itemsByCode.get(equipCodeText.trim().toUpperCase()) ?? null)
    : null;
  const equipBom = equipItem ? (boms.find((b) => b.parentItemId === equipItem.id) ?? null) : null;

  // Attach (or detach) as the resolved parent changes. Keyed on the item id so
  // it fires once per real change, not once per keystroke. On an EDIT form the
  // first resolution is skipped — the saved SO already carries a BOM choice and
  // silently overwriting it would lose a deliberate manual pick.
  const lastEquipItemId = useRef<string | null>(isEdit ? '__initial__' : null);
  useEffect(() => {
    if (!isEquip) return;
    const id = equipItem?.id ?? null;
    if (lastEquipItemId.current === '__initial__') {
      lastEquipItemId.current = id;
      return;
    }
    if (lastEquipItemId.current === id) return;
    lastEquipItemId.current = id;
    if (!id) return;
    // Never leave the previous parent's BOM attached to a different item.
    setValue('header.bomMasterId', equipBom?.id ?? '', { shouldDirty: true });
  }, [isEquip, equipItem, equipBom, setValue]);

  // What the (read-only) BOM field shows. Read off the attached id rather than
  // off equipBom: an edit form keeps whatever BOM was saved, which may not be
  // the one the parent item resolves to today. A saved id we can't look up
  // (inactive BOM, or past the list page) still reports as attached — claiming
  // "BOM Pending" for an SO that has one would be the worse lie.
  const attachedBomId = watch('header.bomMasterId') ?? '';
  const attachedBom = attachedBomId ? (boms.find((b) => b.id === attachedBomId) ?? null) : null;
  const attachedBomLabel = attachedBom
    ? `${attachedBom.bomNo} — ${attachedBom.bomName} (Rev ${attachedBom.revision}, ${attachedBom.lineCount} items)`
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
        // (falling back to master for material / drawing when the cell is blank).
        newLines.push({
          ...NEW_LINE,
          ...r,
          itemId: master.id,
          itemCodeText: master.code,
          partName: master.name,
          material: r.material ?? master.material ?? '',
          drawingNo: r.drawingNo ?? master.drawingNo ?? '',
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
      setImportMsg(e instanceof Error ? e.message : 'Import failed');
    } finally {
      if (lineFileRef.current) lineFileRef.current.value = '';
    }
  }

  const lineCount = (watchedLines ?? []).length;
  const totalPcs = (watchedLines ?? []).reduce((s, l) => s + (Number(l.orderQty) || 0), 0);
  const subtotal = (watchedLines ?? []).reduce(
    (s, l) => s + (Number(l.orderQty) || 0) * (Number(l.rate) || 0),
    0,
  );
  const gstAmt = subtotal * (gstPercent / 100);
  const grand = subtotal + gstAmt;

  // `asDraft` (#3): the "Save as draft" button submits with status 'draft';
  // the normal submit keeps the header status (defaults to 'open'). Captured
  // per-handler so there is no shared mutable flag to leak across submits.
  const onValid = (asDraft: boolean) => async (values: FormValues): Promise<void> => {
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
    }

    const headerOut = {
      ...values.header,
      status: asDraft ? ('draft' as SoStatus) : values.header.status,
      code: values.header.code?.trim() || undefined,
      customerName: undefined,
      clientId: values.header.clientId || undefined,
      clientPoNo: values.header.clientPoNo?.trim() || undefined,
      bomMasterId: equip ? values.header.bomMasterId?.trim() || undefined : undefined,
      bomStatus: equip ? (values.header.bomMasterId?.trim() ? 'BOM Assigned' : 'BOM Pending') : undefined,
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
        drawingNo: l.drawingNo?.trim() || undefined,
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

  return (
    <form onSubmit={handleSubmit(onValid(false))}>
      {/* Action bar — Back · title · breadcrumb on the left, the save actions on
          the right, all on one row. The buttons live here (not in a footer) but
          are still inside <form>, so submit and the disabled rules are unchanged. */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          flexWrap: 'wrap',
          paddingBottom: 10,
          marginBottom: 12,
          borderBottom: '1px solid var(--border)',
        }}
      >
        {props.headerBack ?? null}
        {props.headerTitle ? (
          <div className="panel-title" style={{ fontSize: 16 }}>{props.headerTitle}</div>
        ) : null}
        {props.headerCrumb ? (
          <div className="text3" style={{ fontSize: 11 }}>{props.headerCrumb}</div>
        ) : null}
        {/* Always rendered, chrome or not — this row owns the submit button, so
            gating the whole bar on the optional title would lose it. */}
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 6, alignItems: 'center' }}>
          {props.onCancel ? (
            <button type="button" className="btn btn-ghost btn-sm" onClick={props.onCancel}>Cancel</button>
          ) : null}
          {isCreate ? (
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              style={{ borderColor: 'var(--amber)', color: 'var(--amber)' }}
              disabled={formState.isSubmitting || !docNoValid}
              onClick={() => void handleSubmit(onValid(true))()}
              title="Save this Sales Order as a draft (status: draft)"
            >
              Save as draft
            </button>
          ) : null}
          <button type="submit" className="btn btn-success btn-sm" disabled={formState.isSubmitting || (isCreate && !docNoValid)}>
            {formState.isSubmitting ? <Loader2 size={13} className="animate-spin" /> : null}
            {props.submitLabel ?? 'Save SO'}
          </button>
        </div>
      </div>

      {/* Header — legacy soHeaderForm L12196 renders the fields in the order
          SO/WO No. · Date · Type · Client · Client PO No. · Remarks · GST %.
          Laid out 4-up: doc no · date · due date · type, then client (wide) ·
          client PO · GST, then remarks across the full width. */}
      <div className="form-grid-4" style={{ marginBottom: 10 }}>
        <DocNumberInput
          type="sales_order"
          label="SO/WO No."
          required={isCreate}
          readOnly={isEdit}
          value={watch('header.code') ?? ''}
          onChange={(v) => setValue('header.code', v)}
          onValidityChange={setDocNoValid}
        />
        <div className="form-grp">
          <label className="form-label" htmlFor="soDate">Date<span className="req">★</span></label>
          <input id="soDate" type="date" className="innovic-input" {...register('header.soDate', { required: 'Date is required' })} />
        </div>
        <div className="form-grp">
          <label className="form-label" htmlFor="soDueDate">Due Date</label>
          <input id="soDueDate" type="date" className="innovic-input" {...register('header.dueDate')} />
        </div>
        <div className="form-grp">
          <label className="form-label" htmlFor="type">Type<span className="req">★</span></label>
          <select id="type" className="innovic-select" {...register('header.type')}>
            {SELECTABLE_SO_TYPES.map((t) => <option key={t} value={t}>{t.replaceAll('_', ' ')}</option>)}
          </select>
        </div>

        <div className="form-grp form-span-2">
          <label className="form-label">Client<span className="req">★</span></label>
          <div style={{ display: 'flex', gap: 6, alignItems: 'flex-start' }}>
            <div style={{ flex: 1 }}>
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
                placeholder="🔍 Type client code or name..."
                valueLabel={
                  selectedClient ? `${selectedClient.code} — ${selectedClient.name}` : clientLabel || undefined
                }
              />
            </div>
            <button type="button" className="btn btn-ghost btn-sm" title="Add a new client without leaving this form" style={{ whiteSpace: 'nowrap' }} onClick={() => setShowAddClient(true)}>+ New</button>
          </div>
          <input type="hidden" {...register('header.clientId', { required: 'Pick a client from the master' })} />
          {errors.header?.clientId?.message ? (
            <div className="form-error">{errors.header.clientId.message}</div>
          ) : null}
        </div>

        <div className="form-grp">
          {/* No ★: clientPoNo is schema-optional (max(64).optional()) and legacy
              stars neither mode — an attached Email Ref satisfies the rule. */}
          <label className="form-label" htmlFor="clientPoNo">Client PO No.</label>
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
          {poEmailError ? (
            <div className="form-error">{poEmailError}</div>
          ) : null}
        </div>

        <div className="form-grp">
          <label className="form-label" htmlFor="gstPercent" style={{ color: 'var(--green)' }}>GST %</label>
          <select id="gstPercent" className="innovic-select" {...register('header.gstPercent', { valueAsNumber: true })}>
            {[0, 5, 12, 18, 28].map((g) => <option key={g} value={g}>{g}%</option>)}
          </select>
        </div>

        <div className="form-grp form-full">
          <label className="form-label" htmlFor="remarks">Remarks</label>
          <textarea id="remarks" className="innovic-textarea" rows={2} placeholder="Notes" {...register('header.remarks')} />
        </div>
      </div>

      {/* One helper line under the header carries what used to be scattered
          through it: the client rule, plus the two attachment pickers that sat
          as dashed pills inside the Client PO group. Same inputs, same handlers. */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap', fontSize: 11, marginBottom: 14 }}>
        <span className="text3">
          Client must exist in master — use <b style={{ color: 'var(--blue)' }}>+ New</b> if not listed.
        </span>
        {poFileName ? (
          <span style={{ color: 'var(--green)', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            <span style={{ maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{poFileName}</span>
            <button type="button" onClick={clearPoFile} style={{ color: 'var(--red)', fontSize: 10, background: 'none', border: 'none', cursor: 'pointer', textDecoration: 'underline', padding: 0 }}>✕</button>
          </span>
        ) : (
          <label style={{ color: 'var(--blue)', fontWeight: 600, cursor: 'pointer' }}>
            Upload PO Doc
            <input type="file" accept=".pdf,.jpg,.jpeg,.png,.webp" style={{ display: 'none' }} onChange={onPickPoFile} />
          </label>
        )}
        {emailFileName ? (
          <span style={{ color: 'var(--green)', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            <span style={{ maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{emailFileName}</span>
            {emailFileUrl ? (
              <button
                type="button"
                onClick={() => window.open(emailFileUrl, '_blank', 'noopener')}
                style={{ color: 'var(--cyan)', fontSize: 10, background: 'none', border: 'none', cursor: 'pointer', textDecoration: 'underline', padding: 0 }}
              >
                View
              </button>
            ) : null}
            <button type="button" onClick={clearEmailFile} style={{ color: 'var(--red)', fontSize: 10, background: 'none', border: 'none', cursor: 'pointer', textDecoration: 'underline', padding: 0 }}>✕</button>
          </span>
        ) : (
          <label style={{ color: 'var(--blue)', fontWeight: 600, cursor: 'pointer' }}>
            Attach Email Ref
            <input type="file" accept=".eml,.msg,.pdf,.jpg,.jpeg,.png,.webp" style={{ display: 'none' }} onChange={onPickEmailFile} />
          </label>
        )}
      </div>

      {isEquip ? (
        /* ── Equipment Details (legacy L12258) ── */
        <div>
          <div style={{ fontSize: 11, color: 'var(--cyan)', fontFamily: 'var(--mono)', fontWeight: 700, letterSpacing: '0.06em', margin: '4px 0 8px' }}>EQUIPMENT DETAILS</div>
          <div className="form-grid">
            <div className="form-grp">
              {/* "Parent Item" not "Part No.": this is the assembly a BOM
                  builds (ADR-108), and naming it the same on both screens is
                  what makes the auto-attach below make sense. */}
              <label className="form-label">Equipment / Parent Item<span className="req">★</span></label>
              <input className="innovic-input" autoComplete="off" list="dlSoEquipItems" placeholder="Parent item code" {...register('lines.0.itemCodeText', { required: isEquip ? 'Parent item is required' : false, onChange: (e) => fillEquipFromItem(e.target.value) })} />
              <datalist id="dlSoEquipItems">
                {items.map((it) => <option key={it.id} value={it.code}>{it.name}</option>)}
              </datalist>
            </div>
            <div className="form-grp">
              <label className="form-label">Description<span className="req">★</span></label>
              <input className="innovic-input" autoComplete="off" placeholder="Equipment description" {...register('lines.0.partName', { required: isEquip ? 'Description is required' : false })} />
            </div>
            <div className="form-grp">
              <label className="form-label">Order Qty<span className="req">★</span></label>
              <input type="number" min={1} className="innovic-input" {...register('lines.0.orderQty', { valueAsNumber: true, min: { value: 1, message: 'Min 1' } })} />
            </div>
            <div className="form-grp">
              <label className="form-label" style={{ color: 'var(--green)' }}>SO Value (₹ / unit)</label>
              <input type="number" step="0.01" min={0} className="innovic-input" style={{ fontWeight: 700, color: 'var(--green)' }} {...register('lines.0.rate', { valueAsNumber: true })} />
            </div>
            <div className="form-grp">
              <label className="form-label">BOM (Bill of Materials)</label>
              {/* Read-only, not a picker. The parent item decides the BOM
                  (ADR-108), so the auto-attach above is the only correct
                  answer — offering the whole BOM list here only invited a
                  pick that contradicts it. The value still travels with the
                  form through the hidden input, so submit and edit-load are
                  unchanged. */}
              <input
                className="innovic-input"
                readOnly
                tabIndex={-1}
                value={attachedBomLabel}
              />
              <input type="hidden" {...register('header.bomMasterId')} />
              {/* Say which BOM was attached, or that none exists — and in that
                  case hand the user the way out rather than leaving them to
                  find BOM Master themselves. Silent while the code is still
                  half-typed: no item resolved, nothing to report yet. */}
              {equipItem ? (
                <div
                  style={{
                    marginTop: 6,
                    padding: '8px 10px',
                    borderRadius: 6,
                    fontSize: 11,
                    background: equipBom ? 'rgba(34,197,94,0.10)' : 'rgba(245,158,11,0.10)',
                    border: `1px solid ${equipBom ? 'rgba(34,197,94,0.35)' : 'rgba(245,158,11,0.35)'}`,
                    color: equipBom ? 'var(--green)' : 'var(--amber)',
                  }}
                >
                  {equipBom ? (
                    <>
                      ✓ {equipBom.bomNo} — {equipBom.bomName} (Rev {equipBom.revision},{' '}
                      {equipBom.lineCount} parts) attached automatically for {equipItem.code}.
                    </>
                  ) : (
                    <>
                      ⚠ No BOM exists for {equipItem.code} — {equipItem.name}. Create one in BOM
                      Master first, then come back and re-pick this item.
                      <Link
                        to="/bom-masters/new"
                        className="btn btn-ghost btn-sm"
                        style={{ fontSize: 10, marginLeft: 6 }}
                      >
                        Go to BOM Master →
                      </Link>
                    </>
                  )}
                </div>
              ) : null}
              <div className="form-help">Attached automatically from the parent item — only active BOMs are matched. Equipment value total = SO Value × Order Qty.</div>
            </div>
          </div>
        </div>
      ) : (
        /* ── Component / With-Material line items (legacy L12278) ── */
        <div>
          {/* One field-cascade host per line (renders nothing): Item Code drives
              Part Name / Material / Drawing No. / UOM. Kept out of the <table>
              body so it never lands between rows. */}
          {fields.map((field, idx) => (
            <LineItemCascade
              key={`casc-${field.id}`}
              form={form}
              idx={idx}
              itemId={watchedLines?.[idx]?.itemId ?? null}
              itemsById={itemsById}
            />
          ))}
          {/* Legacy L12279 styles this heading exactly like ▸ EQUIPMENT DETAILS.
              The "items must exist in Item Master" rule sits inline with the
              heading rather than as a separate note under the table. */}
          <div style={{ margin: '4px 0 8px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 11, color: 'var(--cyan)', fontFamily: 'var(--mono)', fontWeight: 700, letterSpacing: '0.06em' }}>SO LINE ITEMS</span>
              <span className="text3" style={{ fontSize: 11 }}>Items must exist in Item Master</span>
            </div>
            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => downloadSoLineTemplate()}>Template</button>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => lineFileRef.current?.click()}>Import Excel</button>
              <input ref={lineFileRef} type="file" accept=".xlsx,.xls" style={{ display: 'none' }} onChange={(e) => { const f = e.target.files?.[0]; if (f) void onImportLines(f); }} />
              <button type="button" className="btn btn-primary btn-sm" onClick={() => append({ ...NEW_LINE })}><Plus size={13} /> Add Line</button>
            </div>
          </div>
          {importMsg ? (() => {
            const isWarn = importMsg.includes('not found in Item Master');
            return (
              <div
                className={isWarn ? undefined : 'text3'}
                style={{
                  fontSize: 11,
                  marginBottom: 8,
                  ...(isWarn
                    ? {
                        padding: '8px 10px',
                        borderRadius: 6,
                        background: 'rgba(245,158,11,0.10)',
                        border: '1px solid rgba(245,158,11,0.35)',
                        color: 'var(--amber)',
                      }
                    : {}),
                }}
              >
                {isWarn ? '⚠ ' : ''}{importMsg}{' '}
                <button type="button" className="btn btn-ghost btn-sm" style={{ fontSize: 10 }} onClick={() => setImportMsg(null)}>✕</button>
              </div>
            );
          })() : null}

          {/* overflow:visible (not auto) so the per-line item-picker dropdown is
              not clipped by the scroll container; the table sizes naturally and
              the page scrolls horizontally when narrow. */}
          {/* Fixed layout so every column gets exactly its share — the percentage
              widths are balanced to each field's data and scale with the panel. */}
          <div style={{ overflow: 'visible', border: '1px solid var(--border)', borderRadius: 8, borderBottomLeftRadius: 0, borderBottomRightRadius: 0, borderBottom: 'none' }}>
            <table className="innovic-table" style={{ width: '100%', tableLayout: 'fixed', minWidth: 940 }}>
              <thead>
                {/* Legacy column order (L12163): # · Item Code ★ · Part Name ·
                    Material · Drawing No. · Client PO Ln · Qty ★ · Rate ₹ · Amount.
                    UOM is ours (legacy carries it invisibly) — kept, not dropped. */}
                <tr>
                  <th style={{ width: '5%' }}>#</th>
                  <th style={{ width: '20%' }}>Item Code <span className="req">★</span></th>
                  <th style={{ width: '15%' }}>Part Name</th>
                  <th style={{ width: '9%' }}>Material</th>
                  <th style={{ width: '11%' }}>Drawing No.</th>
                  <th style={{ width: '9%' }}>Client PO Ln</th>
                  <th style={{ width: '6%' }}>UOM</th>
                  <th style={{ width: '8%' }} className="td-ctr">Qty <span className="req">★</span></th>
                  <th style={{ width: '8%', color: 'var(--green)' }}>Rate ₹</th>
                  <th style={{ width: '6%', color: 'var(--green)' }}>Amount</th>
                  <th style={{ width: '4%' }} />
                </tr>
              </thead>
              <tbody>
                {fields.length === 0 ? (
                  /* colSpan 11 = the real column count; legacy's colspan="10"
                     (L12166) undercounts its own 11 columns — bug not copied. */
                  <tr><td colSpan={11} className="empty-state" style={{ padding: 14 }}>No lines yet — click &ldquo;+ Add Line&rdquo;</td></tr>
                ) : (
                  fields.map((field, idx) => {
                    const ln = watchedLines?.[idx];
                    const amt = (Number(ln?.orderQty) || 0) * (Number(ln?.rate) || 0);
                    return (
                      <tr key={field.id}>
                        <td className="td-ctr mono fw-700" style={{ color: 'var(--cyan)' }}>{idx + 1}</td>
                        <td>
                          <SearchableSelect
                            id={`soln-ic-${idx}`}
                            value={ln?.itemId ?? null}
                            onChange={(id) => pickItem(idx, id)}
                            onSearch={setItemSearch}
                            loading={itemsFetching}
                            options={items.map((it) => ({ id: it.id, code: it.code, name: it.name }))}
                            placeholder="🔍 Search item code or name..."
                            valueLabel={ln?.itemCodeText || undefined}
                            // Show only the code in the field once picked; the dropdown
                            // still lists "CODE — Name".
                            selectedLabel={(o) => o.code ?? o.name}
                          />
                        </td>
                        {/* Auto-filled from the item master — read-only (set by pickItem).
                            `.innovic-input[readonly]` already carries the affordance. */}
                        <td><input className="innovic-input" autoComplete="off" readOnly {...register(`lines.${idx}.partName` as const)} /></td>
                        <td><input className="innovic-input" autoComplete="off" readOnly {...register(`lines.${idx}.material` as const)} /></td>
                        <td><input className="innovic-input" autoComplete="off" readOnly {...register(`lines.${idx}.drawingNo` as const)} /></td>
                        <td><input className="innovic-input" autoComplete="off" placeholder="PO Line#" style={{ color: 'var(--purple)', fontWeight: 600 }} {...register(`lines.${idx}.clientPoLineNo` as const)} /></td>
                        <td><input className="innovic-input" autoComplete="off" readOnly {...register(`lines.${idx}.uom` as const)} /></td>
                        <td><input type="number" min={1} placeholder="Qty" className="innovic-input" style={{ textAlign: 'center', fontSize: 12, fontWeight: 700, color: 'var(--cyan)', padding: '4px 4px' }} {...register(`lines.${idx}.orderQty` as const, { valueAsNumber: true })} /></td>
                        <td><input type="number" step="0.01" min={0} placeholder="₹ Rate" className="innovic-input" style={{ textAlign: 'right', fontSize: 12, color: 'var(--green)', padding: '4px 4px' }} {...register(`lines.${idx}.rate` as const, { valueAsNumber: true })} /></td>
                        <td className="mono" style={{ fontSize: 11, color: 'var(--green)', fontWeight: 700, textAlign: 'right' }}>{amt > 0 ? `₹${inrFormat(amt)}` : '—'}</td>
                        <td><button type="button" className="btn btn-sm" style={{ background: 'transparent', color: 'var(--red)', border: '1px solid var(--red)', padding: '3px 8px' }} onClick={() => remove(idx)} aria-label={`Remove line ${idx + 1}`}>Del</button></td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
          {/* SO Totals (legacy L12291 / _soTotalsHtml L12366) — one strip closing
              the line table: the item/pcs count on the left, the money on the
              right, so the grand total lands in the corner the eye already
              tracks down the Amount column. */}
          <div
            style={{
              border: '1px solid var(--border)',
              borderTop: '1px solid var(--border2)',
              borderRadius: '0 0 8px 8px',
              background: 'var(--green3)',
              padding: '8px 14px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 14,
              flexWrap: 'wrap',
            }}
          >
            <span className="text3" style={{ fontSize: 11 }}>{lineCount} items · {totalPcs} total pcs</span>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 18, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 12 }}>
                <span className="text3">Subtotal </span>
                <span className="mono fw-700 text2">₹{inrFormat(subtotal)}</span>
              </span>
              <span style={{ fontSize: 12 }}>
                <span className="text3">GST {gstPercent}% </span>
                <span className="mono fw-700 amber">₹{inrFormat(gstAmt)}</span>
              </span>
              <span style={{ fontSize: 12 }}>
                <span className="green" style={{ fontWeight: 800 }}>GRAND TOTAL </span>
                <span className="mono fw-700 green" style={{ fontSize: 16 }}>₹{inrFormat(grand)}</span>
              </span>
            </div>
          </div>

          {/* Delivery Schedule / Milestones (ISSUE-015, legacy L12294 /
              _soMilestonesHtml L12392). Empty is the normal case — full qty on
              the due date — so it collapses to a single line that says so,
              rather than an empty box demanding attention. `--purple` is a real
              token with no utility class → inline. */}
          <div style={{ border: '1px solid var(--border)', borderRadius: 8, padding: msFields.length === 0 ? '8px 14px' : 12, marginTop: 12, background: 'var(--bg3)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: msFields.length === 0 ? 0 : 8 }}>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
                <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--purple)', letterSpacing: '0.04em' }}>DELIVERY SCHEDULE / MILESTONES</span>
                {msFields.length === 0 ? (
                  <span className="text3" style={{ fontSize: 11 }}>No lots — full qty on the due date. Add lots for staggered delivery.</span>
                ) : null}
              </div>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => appendMs({ ...NEW_MILESTONE, lotNo: msFields.length + 1 })}><Plus size={13} /> Add Lot</button>
            </div>
            {msFields.length === 0 ? null : (
              <table className="innovic-table" style={{ width: '100%' }}>
                <thead>
                  <tr>
                    <th>Lot</th>
                    <th>Qty</th>
                    <th>Due Date</th>
                    <th>Remarks</th>
                    <th style={{ width: 30 }} />
                  </tr>
                </thead>
                <tbody>
                  {msFields.map((field, idx) => (
                    <tr key={field.id}>
                      {/* Legacy prints the row index here; ours keeps the editable
                          Lot # the save reads (`lotNo`) — feature retained. */}
                      <td style={{ width: 80 }}><input type="number" min={1} className="innovic-input td-ctr mono fw-700" style={{ color: 'var(--purple)' }} {...register(`milestones.${idx}.lotNo` as const, { valueAsNumber: true })} /></td>
                      <td><input type="number" min={0} placeholder="Qty" className="innovic-input" style={{ width: 80, textAlign: 'center', fontSize: 13, fontWeight: 700, color: 'var(--cyan)' }} {...register(`milestones.${idx}.qty` as const, { valueAsNumber: true })} /></td>
                      <td><input type="date" className="innovic-input" style={{ fontSize: 11 }} {...register(`milestones.${idx}.dueDate` as const)} /></td>
                      <td><input className="innovic-input" autoComplete="off" placeholder="e.g. 1st lot" style={{ fontSize: 11 }} {...register(`milestones.${idx}.remarks` as const)} /></td>
                      <td><button type="button" className="btn btn-danger btn-sm btn-icon" onClick={() => removeMs(idx)} aria-label={`Remove lot ${idx + 1}`}><Trash2 size={12} /></button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}

      {/* Errors stay at the bottom, next to the fields that caused them. The
          save actions moved to the action bar at the top of the form.
          Legacy footer: addSO L12427 / editSOLine L12476 / _editFullSO L12619
          all reach showModalLg (L28032) with no explicit saveLabel, so the
          title-derived label is "Save SO" in BOTH modes, on .btn-success. */}
      {lineError || props.submitError ? (
        <div style={{ marginTop: 16 }}>
          {lineError ? (
            <div style={{ color: 'var(--red)', background: 'var(--red3)', border: '1px solid #fca5a5', borderRadius: 6, padding: '6px 10px', fontSize: 12, marginBottom: 10 }}>{lineError}</div>
          ) : null}
          {props.submitError ? (
            <div style={{ color: 'var(--red)', background: 'var(--red3)', border: '1px solid #fca5a5', borderRadius: 6, padding: '6px 10px', fontSize: 12 }}>{props.submitError}</div>
          ) : null}
        </div>
      ) : null}

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
      setErr('Client name is required.');
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
      setErr(e instanceof Error ? e.message : 'Failed to create client.');
    }
  }

  return (
    <div
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 200 }}
      onClick={onClose}
    >
      <div
        style={{ background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 8, padding: 20, width: 'min(420px, 94vw)' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="section-hdr" style={{ marginBottom: 12 }}>🏢 New Client</div>
        <div className="form-grp">
          <label className="form-label">Client Name<span className="req">★</span></label>
          <input className="innovic-input" autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="Company / client name" />
        </div>
        <div className="form-grp">
          <label className="form-label">Contact Person</label>
          <input className="innovic-input" value={contactPerson} onChange={(e) => setContactPerson(e.target.value)} placeholder="Optional" />
        </div>
        <div className="form-grp">
          <label className="form-label">Phone</label>
          <input className="innovic-input" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="Optional" />
        </div>
        <div className="form-grp">
          <label className="form-label">GST No.</label>
          <input className="innovic-input" value={gstNumber} onChange={(e) => setGstNumber(e.target.value)} placeholder="Optional" />
        </div>
        <div className="form-help">Code auto-generates (CLI-###).</div>
        {err ? <div className="form-error" style={{ marginTop: 6 }}>{err}</div> : null}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 6, marginTop: 14 }}>
          <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button type="button" className="btn btn-primary" disabled={create.isPending} onClick={() => void onSave()}>
            {create.isPending ? <Loader2 size={13} className="animate-spin" /> : null} Add Client
          </button>
        </div>
      </div>
    </div>
  );
}

/** Hosts the shared field-cascade for one SO line (renders nothing). Item Code
 *  (itemId) is the controller; on a fresh pick the master's Part Name / Material
 *  / Drawing No. / UOM REPLACE the row's values, on a clear they RESET. Qty,
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
      cascadeField(`lines.${idx}.drawingNo`, (it) => it.drawingNo ?? '', ''),
      cascadeField(`lines.${idx}.uom`, (it) => it.uom, NEW_LINE.uom),
    ],
    userEntered: [
      `lines.${idx}.orderQty`,
      `lines.${idx}.rate`,
      `lines.${idx}.clientPoLineNo`,
      `lines.${idx}.status`,
      `lines.${idx}.itemId`,
      `lines.${idx}.itemCodeText`,
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
        const due = detail.lines.map((l) => l.dueDate).filter((d): d is string => Boolean(d)).sort()[0];
        return due ? { dueDate: due } : {};
      })(),
    },
    lines:
      detail.lines.length > 0
        ? detail.lines.map((l): LineFormValue => ({
            id: l.id,
            ...(l.itemId ? { itemId: l.itemId } : {}),
            itemCodeText: l.itemCode ?? l.itemCodeText ?? '',
            partName: l.partName,
            ...(l.material ? { material: l.material } : {}),
            ...(l.drawingNo ? { drawingNo: l.drawingNo } : {}),
            uom: l.uom,
            orderQty: l.orderQty,
            rate: Number(l.rate),
            ...(l.dueDate ? { dueDate: l.dueDate } : {}),
            ...(l.clientPoLineNo ? { clientPoLineNo: l.clientPoLineNo } : {}),
            status: l.status,
          }))
        : [{ ...NEW_LINE }],
    milestones: detail.milestones.map((m): MilestoneFormValue => ({
      id: m.id,
      lotNo: m.lotNo,
      qty: m.qty,
      ...(m.dueDate ? { dueDate: m.dueDate } : {}),
      ...(m.remarks ? { remarks: m.remarks } : {}),
    })),
  };
}
