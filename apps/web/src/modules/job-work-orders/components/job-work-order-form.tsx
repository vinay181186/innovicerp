// Job Work Order form — header + a header-level CLIENT MATERIAL DETAILS section
// (client supplies raw material → we process → deliver finished parts) + line
// items with per-line Rate + Amount.
//
// The header mirrors the Sales Order header for parity (user request): a
// live-checked JWSO No. (DocNumberInput), a server-searched Client picker with
// inline quick-add, GST %, a header-level Due Date applied to every line, and a
// Client PO No. that is required OR satisfied by an attached Email Ref. Status is
// hidden on create (defaults to 'open') and only shown on edit. What stays
// JWSO-specific: the free-text line editor + the Client Material Details block.

import {
  type CreateJobWorkOrderInput,
  type JobWorkOrderDetail,
  type ListItemsResponse,
  type SoStatus,
  type UpdateJobWorkOrderInput,
  type Uom,
  UOMS,
} from '@innovic/shared';
import { Link } from '@tanstack/react-router';
import { Loader2, Plus, Trash2 } from 'lucide-react';
import { useRef, useState } from 'react';
import { useFieldArray, useForm } from 'react-hook-form';
import { DocNumberInput } from '@/components/shared/doc-number-input';
import { SearchableSelect } from '@/components/shared/searchable-select';
import { useBomMastersList } from '@/modules/bom-master/api';
import { apiFetch } from '@/lib/api';
import { todayLocal } from '@/lib/date';
import { inrFormat } from '@/lib/print/doc-print';
import { useClientsList, useCreateClient } from '@/modules/clients/api';
import { useItemsList } from '@/modules/items/api';
import { downloadJwLineTemplate, parseJwLineFile } from '../lib/import-export';

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
  status?: SoStatus | undefined;
  /** Assembly line: the BOM whose components make up this part (0086). */
  sourceBomMasterId?: string | undefined;
}

interface FormValues {
  header: {
    code: string;
    jwDate: string;
    status: SoStatus;
    gstPercent: number;
    clientId?: string;
    customerName?: string;
    clientPoNo?: string;
    remarks?: string;
    // Header-level Due Date (UI only) — applied to every line on save, matching
    // the Sales Order header. Not stored on the JWSO header (due_date lives per
    // line); the form captures it once.
    dueDate?: string;
    clientMaterial?: string;
    clientMaterialQty?: number;
  };
  lines: LineFormValue[];
}

const HEADER_DEFAULTS: FormValues['header'] = {
  code: '',
  jwDate: todayLocal(),
  status: 'open',
  gstPercent: 18,
};
const NEW_LINE: LineFormValue = { itemCodeText: '', partName: '', uom: 'NOS', orderQty: 1, rate: 0 };

type CreateMode = {
  mode: 'create';
  onSubmit: (values: CreateJobWorkOrderInput) => Promise<void> | void;
  submitLabel?: string;
  submitError?: string | null;
  onCancel?: () => void;
  /** Client PO document picked below Client PO No. (uploaded after save). */
  onPoFileChange?: (file: File | null) => void;
  /** Email reference attached against the Client PO (uploaded after save). */
  onEmailFileChange?: (file: File | null) => void;
};
type EditMode = {
  mode: 'edit';
  detail: JobWorkOrderDetail;
  onSubmit: (values: UpdateJobWorkOrderInput) => Promise<void> | void;
  submitLabel?: string;
  submitError?: string | null;
  onCancel?: () => void;
  /** Client PO document picked below Client PO No. (uploaded on save). */
  onPoFileChange?: (file: File | null) => void;
  onEmailFileChange?: (file: File | null) => void;
};
export type JobWorkOrderFormProps = CreateMode | EditMode;

export function JobWorkOrderForm(props: JobWorkOrderFormProps): React.JSX.Element {
  const isEdit = props.mode === 'edit';
  const isCreate = !isEdit;
  const defaults: FormValues = isEdit
    ? detailToFormValues(props.detail)
    : { header: HEADER_DEFAULTS, lines: [{ ...NEW_LINE }] };

  const form = useForm<FormValues>({ defaultValues: defaults });
  const { register, control, handleSubmit, formState, watch, setValue, getValues } = form;
  const errors = formState.errors;
  const { fields, append, remove, replace } = useFieldArray({ control, name: 'lines' });

  // ── Searchable client picker (server-searched; scales past the 200 cap) ──
  const [clientSearch, setClientSearch] = useState('');
  const { data: clientsData, isFetching: clientsFetching } = useClientsList({
    ...(clientSearch.trim() ? { search: clientSearch.trim() } : {}),
    limit: 50,
    offset: 0,
  });
  const clients = clientsData?.clients ?? [];

  // Active BOMs, offered per line as "Assembly BOM". Deliberately NOT filtered
  // to BOMs free of bought parts — the list endpoint doesn't carry line types,
  // and the server already refuses such a BOM on a job-work order with a
  // message naming the offending parts. Filtering here would hide the reason.
  const { data: bomData } = useBomMastersList({ status: 'active', limit: 200, offset: 0 });
  const jwUsableBoms = bomData?.items ?? [];

  const { data: itemsData } = useItemsList({ limit: 200, offset: 0 });
  const items = itemsData?.items ?? [];
  const rmItems = items.filter((it) => it.code.toLowerCase().includes('-rm'));
  // Code → master item, for auto-filling the line from the item master (bug 2.1).
  const itemsByCode = new Map(items.map((it) => [it.code.trim().toUpperCase(), it]));

  // ── JWSO No.: live duplicate/format check (parity with the SO form). ──
  const [docNoValid, setDocNoValid] = useState(true);

  // ── Client select label + inline quick-add ──
  const selectedClientId = watch('header.clientId') ?? null;
  const selectedClient = clients.find((c) => c.id === selectedClientId);
  const [clientLabel, setClientLabel] = useState<string>(
    props.mode === 'edit' ? (props.detail.customerName ?? '') : '',
  );
  const [showAddClient, setShowAddClient] = useState(false);
  function onClientCreated(id: string, label: string): void {
    setValue('header.clientId', id, { shouldValidate: true });
    setClientLabel(label);
    setShowAddClient(false);
  }

  const gstPercent = Number(watch('header.gstPercent')) || 0;

  // Legacy `_jwFillRmItem` (L12746): resolve the typed Client Material code
  // against the item master to confirm the pick inline.
  const clientMaterialCode = watch('header.clientMaterial') ?? '';
  const matchedRmItem = clientMaterialCode.trim()
    ? itemsByCode.get(clientMaterialCode.trim().toUpperCase())
    : undefined;

  // Per-line memory of the master code we last auto-filled a line from, keyed by
  // the react-hook-form field id (stable as lines are added/removed). This is
  // how we tell an AUTO-FILLED value (safe to refresh or reset) from a value the
  // user hand-typed on an OFF-MASTER line (must never be wiped).
  //
  // Why this stays inline rather than moving to the shared `useFieldCascade`
  // (which does support a synchronous resolver, so a fetch race is not the
  // reason): the JWSO line accepts off-master free text, and its reset rule is
  // LINE-LEVEL — reset the derived fields IFF this line was ever auto-filled,
  // signalled here by `prevMatchedCodeRef` OR an edit-mode-loaded `itemId`. The
  // hook's preservation is FIELD-LEVEL (a dependent is reset only while it still
  // equals what the hook itself last wrote). It never wrote the values an edit
  // form loaded, so it would PRESERVE a stale saved Part Name when the code is
  // changed to off-master — losing the documented edit-mode reset — and seeding
  // it to fix that would then wipe genuinely hand-typed off-master lines. The
  // hook's model cannot express this signal, so the cascade lives here inline.
  // (The SO line has no off-master/hand-typed case and DOES route through the
  // hook — see LineItemCascade in sales-order-form.tsx.)
  const prevMatchedCodeRef = useRef<Record<string, string>>({});

  /** Item Code is the unique key for a line; the master-derived fields (Part
   *  Name, Material, Drawing No, UOM) follow it on every change:
   *   - resolves to a master item  → REPLACE all four with the master's values
   *     (overwrite, mirroring the SO form's line auto-fill), and remember the
   *     matched code for this line;
   *   - cleared / no longer matches → RESET all four (and drop the stale master
   *     link) ONLY IF this line was previously auto-filled from a master, so no
   *     stale master data lingers. A pure off-master line the user typed by hand
   *     is left exactly as typed.
   *  Rate and Qty are always user-entered and are never touched here. */
  function fillLineFromItem(idx: number, codeValue: string): void {
    const lineKey = fields[idx]?.id ?? String(idx);
    const it = itemsByCode.get(codeValue.trim().toUpperCase());
    if (it) {
      // Matched a master item — the code is the key, so the master wins: refresh
      // all four derived fields (replace, not fill-only), even across a change
      // from one valid code to another.
      setValue(`lines.${idx}.partName`, it.name);
      setValue(`lines.${idx}.material`, it.material ?? '');
      setValue(`lines.${idx}.drawingNo`, it.drawingNo ?? '');
      setValue(`lines.${idx}.uom`, it.uom);
      // Keep the hidden master link in step with the visible code so save uses
      // the item now shown, not a stale itemId from a prior pick or an edit-mode
      // load (fixes the edit-mode "swap to another master code" mismatch). The
      // reset branch below already drops itemId when the code stops matching.
      setValue(`lines.${idx}.itemId`, it.id);
      prevMatchedCodeRef.current[lineKey] = it.code.trim().toUpperCase();
      return;
    }
    // No master match. Reset the derived fields only if THIS line was previously
    // auto-filled from a master — either matched earlier in this session, or
    // loaded in edit mode as a master-linked line (itemId set). A hand-typed
    // off-master line has neither signal and is left untouched, so manual Part
    // Name / Material / Drawing entered on a non-master code is never wiped.
    const wasAutoFilled =
      prevMatchedCodeRef.current[lineKey] !== undefined ||
      Boolean(getValues(`lines.${idx}.itemId`));
    if (!wasAutoFilled) return;
    setValue(`lines.${idx}.partName`, '');
    setValue(`lines.${idx}.material`, '');
    setValue(`lines.${idx}.drawingNo`, '');
    setValue(`lines.${idx}.uom`, NEW_LINE.uom);
    // The code no longer resolves to a master, so drop the stale master link too
    // — leaving it would save blank/new text against the old item.
    setValue(`lines.${idx}.itemId`, undefined);
    delete prevMatchedCodeRef.current[lineKey];
  }

  const watchedLines = watch('lines');
  const subtotal = (watchedLines ?? []).reduce(
    (s, l) => s + (Number(l.orderQty) || 0) * (Number(l.rate) || 0),
    0,
  );
  const gstAmt = subtotal * (gstPercent / 100);
  const grand = subtotal + gstAmt;
  const lineCount = (watchedLines ?? []).length;
  const totalPcs = (watchedLines ?? []).reduce((s, l) => s + (Number(l.orderQty) || 0), 0);

  // Client PO document upload (#8). File is handed to the parent, which uploads
  // it to Storage + registers metadata against the JWSO after save.
  const poFileRef = useRef<HTMLInputElement>(null);
  const [poFileName, setPoFileName] = useState<string | null>(null);
  const [poFileError, setPoFileError] = useState<string | null>(null);
  const onPoFileChange = 'onPoFileChange' in props ? props.onPoFileChange : undefined;
  function onPickPoFile(e: React.ChangeEvent<HTMLInputElement>): void {
    const f = e.target.files?.[0] ?? null;
    if (f && f.size > 20 * 1024 * 1024) {
      setPoFileError('PO document must be 20 MB or smaller.');
      if (poFileRef.current) poFileRef.current.value = '';
      return;
    }
    setPoFileError(null);
    setPoFileName(f?.name ?? null);
    onPoFileChange?.(f);
  }
  function clearPoFile(): void {
    setPoFileName(null);
    setPoFileError(null);
    if (poFileRef.current) poFileRef.current.value = '';
    onPoFileChange?.(null);
  }

  // Email reference attached against the Client PO (parity with the SO form).
  // Keep a local object URL so the just-attached file can be viewed before save.
  const onEmailFileChange = 'onEmailFileChange' in props ? props.onEmailFileChange : undefined;
  const [emailFileName, setEmailFileName] = useState<string | null>(null);
  const [emailFileUrl, setEmailFileUrl] = useState<string | null>(null);
  const [poEmailError, setPoEmailError] = useState<string | null>(null);
  function onPickEmailFile(e: React.ChangeEvent<HTMLInputElement>): void {
    const f = e.target.files?.[0];
    if (!f) return;
    if (f.size > 20 * 1024 * 1024) {
      setPoFileError('Email reference file too large (max 20MB).');
      e.target.value = '';
      return;
    }
    if (emailFileUrl) URL.revokeObjectURL(emailFileUrl);
    setEmailFileName(f.name);
    setEmailFileUrl(URL.createObjectURL(f));
    setPoEmailError(null);
    onEmailFileChange?.(f);
  }
  function clearEmailFile(): void {
    if (emailFileUrl) URL.revokeObjectURL(emailFileUrl);
    setEmailFileName(null);
    setEmailFileUrl(null);
    onEmailFileChange?.(null);
  }

  // In-form line import (appends lines to the JW being created/edited).
  const lineFileRef = useRef<HTMLInputElement>(null);
  const [importMsg, setImportMsg] = useState<string | null>(null);
  async function onImportLines(file: File): Promise<void> {
    try {
      const { rows, errors: errs } = await parseJwLineFile(file);
      // Every Item Code in the sheet must exist in Item Master (parity with the
      // SO form). The in-memory `items` list is only the current 200-row page,
      // so resolve each unique code against the server (search + exact-code
      // match) rather than silently accepting unknown codes as item_id=null.
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
        // Item Code drives the row: link the master item + auto-fill Part Name
        // and UOM from master; material / drawing fall back to master when the
        // sheet cell is blank. Unresolved rows are dropped, never appended.
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
        // If the grid still holds only untouched blank starter row(s), replace
        // them so imports fill from Line 1 instead of after an empty row.
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

  const onValid = async (values: FormValues): Promise<void> => {
    setPoEmailError(null);
    // Require proof of the client order: a Client PO No. OR an attached email
    // reference (create form only; edit keeps whatever the JWSO already has).
    if (isCreate && !values.header.clientPoNo?.trim() && !emailFileName) {
      setPoEmailError('Enter a Client PO No. or attach an Email Ref — at least one is required.');
      return;
    }

    const h = values.header;
    // Header-level Due Date applied to every line (parity with the SO form).
    const soDue = h.dueDate?.trim() || undefined;
    const headerOut = {
      ...h,
      // Code is generated server-side in series; never send a client value on
      // create (an empty string would fail the schema's min-length check).
      code: h.code?.trim() || undefined,
      // customerName is snapshotted server-side from the client master.
      customerName: undefined,
      gstPercent: Number(h.gstPercent) || 0,
      clientId: h.clientId || undefined,
      clientPoNo: h.clientPoNo?.trim() || undefined,
      remarks: h.remarks?.trim() || undefined,
      clientMaterial: h.clientMaterial?.trim() || undefined,
      clientMaterialQty:
        h.clientMaterialQty !== undefined && !Number.isNaN(Number(h.clientMaterialQty))
          ? Number(h.clientMaterialQty)
          : undefined,
    };

    const linesOut = values.lines.map((l) => {
      const trimmedCode = l.itemCodeText.trim();
      // Prefer a resolved master itemId (mirrors the SO form) so a picked/
      // imported item is never discarded in favour of stale text; fall back to
      // the raw code only when the row has no master link.
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
        rate: Number(l.rate) || 0,
        dueDate: soDue,
        ...(l.status ? { status: l.status } : {}),
        ...(l.sourceBomMasterId ? { sourceBomMasterId: l.sourceBomMasterId } : {}),
      };
    });

    if (isEdit) {
      const { code: _drop, ...headerNoCode } = headerOut;
      void _drop;
      await props.onSubmit({ header: headerNoCode, lines: linesOut });
    } else {
      await props.onSubmit({ header: headerOut, lines: linesOut } as CreateJobWorkOrderInput);
    }
  };

  return (
    <form onSubmit={handleSubmit(onValid)}>
      <datalist id="dlJwItems">
        {items.map((it) => (
          <option key={it.id} value={it.code}>{it.name}</option>
        ))}
      </datalist>
      <datalist id="dlRmItems">
        {rmItems.map((it) => (
          <option key={it.id} value={it.code}>{it.name}{it.material ? ` [${it.material}]` : ''}</option>
        ))}
      </datalist>

      {/* Header — 4-up grid (matches the SO form's `.form-grid-4`): the four
          short fields (JWSO No · Date · Due Date · GST %) fit on ONE row instead
          of two 2-up rows. `.form-full` still spans the whole row; the rich
          Client PO No. block takes `.form-span-2` to keep room for its controls. */}
      <div className="form-grid-4" style={{ marginBottom: 16 }}>
        {/* No ★: `code` is `.optional()` and the server generates the next
            IN-JW-##### in series when omitted — the field's own help text says
            "leave blank to auto-generate on save", and useDocNumber treats empty
            as valid, so nothing enforces a star here. Matches the PO form. */}
        <DocNumberInput
          type="job_work_order"
          label="JWSO No."
          readOnly={isEdit}
          value={watch('header.code') ?? ''}
          onChange={(v) => setValue('header.code', v)}
          onValidityChange={setDocNoValid}
        />
        <div className="form-grp">
          <label className="form-label" htmlFor="jwDate">Date<span className="req">★</span></label>
          <input id="jwDate" type="date" className="innovic-input" {...register('header.jwDate', { required: 'Date is required' })} />
        </div>
        <div className="form-grp">
          <label className="form-label" htmlFor="jwDueDate">Due Date</label>
          <input id="jwDueDate" type="date" className="innovic-input" {...register('header.dueDate')} />
        </div>

        <div className="form-grp">
          <label className="form-label" htmlFor="gstPercent" style={{ color: 'var(--green)' }}>GST %</label>
          <select id="gstPercent" className="innovic-select" {...register('header.gstPercent', { valueAsNumber: true })}>
            {[0, 5, 12, 18, 28].map((g) => <option key={g} value={g}>{g}%</option>)}
          </select>
        </div>
        {isEdit ? (
          <div className="form-grp">
            <label className="form-label" htmlFor="status">Status</label>
            {/* Status is read-only on edit: it is driven by the JC-completion
                cascade (open→closed), the JW-Return cascade (→dispatched) and
                soft-delete for cancel — a manual edit only causes drift, and the
                server ignores any status in the update payload. */}
            <input id="status" className="innovic-input" readOnly {...register('header.status')} />
          </div>
        ) : null}

        <div className="form-grp form-span-2">
          <label className="form-label">Client<span className="req">★</span> (type to search)</label>
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
                placeholder="🔍 Type client code or name…"
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
          <div className="form-help">
            Job Work orders must reference a client from the master. Not listed? Use <b>+ New</b>.
          </div>
        </div>

        <div className="form-grp form-span-2">
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 4 }}>
            <label className="form-label" htmlFor="clientPoNo" style={{ marginBottom: 0 }}>
              Client PO No. {isCreate ? <span className="req">★</span> : null}
            </label>
            <span style={{ fontSize: 11, color: 'var(--text3)', fontWeight: 600 }}>or</span>
            {emailFileName ? (
              <span style={{ fontSize: 11, color: 'var(--green)', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                📧 <span style={{ maxWidth: 140, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{emailFileName}</span>
                {emailFileUrl ? (
                  <button
                    type="button"
                    onClick={() => window.open(emailFileUrl, '_blank', 'noopener')}
                    style={{ color: 'var(--blue)', fontSize: 10, background: 'none', border: 'none', cursor: 'pointer', textDecoration: 'underline', padding: 0 }}
                  >
                    👁 View
                  </button>
                ) : null}
                <button type="button" onClick={clearEmailFile} style={{ color: 'var(--red)', fontSize: 10, background: 'none', border: 'none', cursor: 'pointer', textDecoration: 'underline' }}>✕</button>
              </span>
            ) : (
              <label style={{ fontSize: 10, padding: '2px 8px', borderRadius: 4, border: '1px dashed var(--border)', color: 'var(--text3)', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 3 }}>
                📧 Attach Email Ref
                <input type="file" accept=".eml,.msg,.pdf,.jpg,.jpeg,.png,.webp" style={{ display: 'none' }} onChange={onPickEmailFile} />
              </label>
            )}
          </div>
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
          {/* Upload PO Doc (#8) — reflects on the JWSO after save. */}
          <div style={{ marginTop: 6 }}>
            <input
              ref={poFileRef}
              type="file"
              accept=".pdf,.jpg,.jpeg,.png,.webp,.doc,.docx,.xls,.xlsx"
              style={{ display: 'none' }}
              onChange={onPickPoFile}
            />
            {poFileName ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12 }}>
                <span className="mono" style={{ color: 'var(--blue)' }}>📎 {poFileName}</span>
                <button type="button" className="btn btn-ghost btn-sm" style={{ fontSize: 10 }} onClick={clearPoFile} aria-label="Remove PO document">✕</button>
              </div>
            ) : (
              <button type="button" className="btn btn-ghost btn-sm" style={{ fontSize: 11 }} onClick={() => poFileRef.current?.click()}>
                📤 Upload PO Doc
              </button>
            )}
            {poFileError ? <div className="form-error">{poFileError}</div> : null}
          </div>
          {poEmailError ? (
            <div style={{ marginTop: 4, fontSize: 11, color: 'var(--red)' }}>⚠ {poEmailError}</div>
          ) : null}
        </div>

        <div className="form-grp form-full">
          <label className="form-label" htmlFor="remarks">Remarks</label>
          <textarea id="remarks" className="innovic-textarea" rows={2} {...register('header.remarks')} />
        </div>
      </div>

      {/* Client Material Details (legacy L12839) */}
      <div style={{ border: '1px solid rgba(34,197,94,0.3)', borderRadius: 8, padding: 12, margin: '0 0 16px', background: 'rgba(34,197,94,0.04)' }}>
        <div style={{ fontSize: 11, color: 'var(--green)', fontFamily: 'var(--mono)', fontWeight: 700, letterSpacing: '.08em', marginBottom: 8 }}>▸ CLIENT MATERIAL DETAILS</div>
        <div className="form-grid">
          <div className="form-grp">
            <label className="form-label">Client Material (Party Supplied Item)</label>
            <div style={{ display: 'flex', gap: 6 }}>
              <input className="innovic-input" style={{ flex: 1 }} autoComplete="off" list="dlRmItems" placeholder="🔍 Search -rm items…" {...register('header.clientMaterial')} />
              <Link to="/items/new" className="btn btn-ghost btn-sm" title="Create a new -rm item" style={{ whiteSpace: 'nowrap' }}>+ New</Link>
            </div>
            {/* Legacy `fJwRmItemInfo` (L12849 / _jwFillRmItem L12746): confirms the
                typed code against the item master. Legacy also shows a "⚠ Item not
                found in master" branch; that is NOT ported — legacy searched the
                whole client-side `db.items`, whereas `items` here is one 200-row
                page, so absence from the page does not prove absence from the
                master and the warning would fire falsely. Positive match only. */}
            {matchedRmItem ? (
              <div className="form-help" style={{ color: 'var(--green)' }}>
                ✅ <b>{matchedRmItem.name}</b>{matchedRmItem.material ? ` [${matchedRmItem.material}]` : ''}
              </div>
            ) : null}
          </div>
          <div className="form-grp">
            <label className="form-label">Material Qty (Client Supplied)</label>
            <input type="number" min={0} step="0.01" className="innovic-input" placeholder="0" {...register('header.clientMaterialQty', { valueAsNumber: true })} />
          </div>
        </div>
      </div>

      {/* Line items */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <div className="form-label" style={{ fontSize: 12, marginBottom: 0, textTransform: 'uppercase' }}>▸ JWSO Line Items</div>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <button type="button" className="btn btn-ghost btn-sm" style={{ fontSize: 11 }} onClick={() => downloadJwLineTemplate()}>⬇ Template</button>
          <button type="button" className="btn btn-ghost btn-sm" style={{ fontSize: 11 }} onClick={() => lineFileRef.current?.click()}>📄 Import Excel</button>
          <input ref={lineFileRef} type="file" accept=".xlsx,.xls" style={{ display: 'none' }} onChange={(e) => { const f = e.target.files?.[0]; if (f) void onImportLines(f); }} />
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => append({ ...NEW_LINE })}><Plus size={13} /> Add Line</button>
        </div>
      </div>
      {importMsg ? (() => {
        // Warn styling (amber) when the sheet carried codes missing from Item
        // Master — mirrors the SO form's "missing codes" banner.
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

      {fields.length === 0 ? (
        <div className="empty-state" style={{ padding: 24, border: '1px dashed var(--border)' }}>No lines yet — click <strong>+ Add Line</strong>. At least one is required.</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {fields.map((field, idx) => {
            const amt = (Number(watchedLines?.[idx]?.orderQty) || 0) * (Number(watchedLines?.[idx]?.rate) || 0);
            // On-master item → name is derived + read-only; off-master (free
            // text code with no master match) keeps the name editable.
            const lineItemCode = (watchedLines?.[idx]?.itemCodeText ?? '').trim().toUpperCase();
            const lineOnMaster = lineItemCode ? itemsByCode.has(lineItemCode) : false;
            return (
              <div key={field.id} style={{ border: '1px solid var(--border)', borderRadius: 8, padding: 10, background: 'var(--bg2)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8, fontSize: 11, color: 'var(--text3)', fontFamily: 'var(--mono)', textTransform: 'uppercase', fontWeight: 700 }}>
                  <span>Line {idx + 1}</span>
                  <span style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                    <span style={{ color: 'var(--green)' }}>Amount ₹{inrFormat(amt)}</span>
                    <button type="button" className="btn btn-danger btn-sm btn-icon" onClick={() => remove(idx)} aria-label={`Remove line ${idx + 1}`}><Trash2 size={12} /></button>
                  </span>
                </div>
                <div className="form-grid form-grid-4">
                  <div className="form-grp">
                    <label className="form-label">Item Code</label>
                    <input className="innovic-input" autoComplete="off" list="dlJwItems" placeholder="🔍 ITM-001" {...register(`lines.${idx}.itemCodeText` as const, { onChange: (e) => fillLineFromItem(idx, e.target.value) })} />
                  </div>
                  <div className="form-grp">
                    <label className="form-label">Part Name<span className="req">★</span></label>
                    <input className="innovic-input" autoComplete="off" readOnly={lineOnMaster} title={lineOnMaster ? 'Auto-filled from Item Master (item code is the key)' : undefined} style={lineOnMaster ? { background: 'var(--bg4)', color: 'var(--text3)' } : undefined} {...register(`lines.${idx}.partName` as const, { required: 'Part name is required' })} />
                    {errors.lines?.[idx]?.partName?.message ? <div className="form-error">{errors.lines[idx]?.partName?.message}</div> : null}
                  </div>
                  <div className="form-grp">
                    <label className="form-label">Material</label>
                    <input className="innovic-input" autoComplete="off" {...register(`lines.${idx}.material` as const)} />
                  </div>
                  <div className="form-grp">
                    <label className="form-label">Drawing No.</label>
                    <input className="innovic-input" autoComplete="off" {...register(`lines.${idx}.drawingNo` as const)} />
                  </div>
                  <div className="form-grp">
                    <label className="form-label">UOM</label>
                    <select className="innovic-select" {...register(`lines.${idx}.uom` as const)}>
                      {UOMS.map((u) => <option key={u} value={u}>{u}</option>)}
                    </select>
                  </div>
                  <div className="form-grp">
                    <label className="form-label">Qty<span className="req">★</span></label>
                    <input type="number" min={1} className="innovic-input" {...register(`lines.${idx}.orderQty` as const, { valueAsNumber: true, min: { value: 1, message: 'Min 1' } })} />
                  </div>
                  <div className="form-grp">
                    <label className="form-label" style={{ color: 'var(--green)' }}>Rate ₹</label>
                    <input type="number" step="0.01" min={0} className="innovic-input" {...register(`lines.${idx}.rate` as const, { valueAsNumber: true })} />
                  </div>
                  {/* Assembly (0086). Picking a BOM turns this line into an
                      assembly: one Job Card is raised per component on save,
                      and readiness/return then follow the WEAKEST component
                      rather than this line's own output. Only BOMs made
                      entirely of machined/outsourced parts are offered — job
                      work runs on client-supplied material, so a BOM with a
                      bought part is rejected server-side anyway. */}
                  <div className="form-grp">
                    <label className="form-label">Assembly BOM</label>
                    <select className="innovic-select" {...register(`lines.${idx}.sourceBomMasterId` as const)}>
                      <option value="">— none (plain machining) —</option>
                      {jwUsableBoms.map((b) => (
                        <option key={b.id} value={b.id}>{b.bomNo} — {b.bomName}</option>
                      ))}
                    </select>
                    <div className="form-hint">Leave blank unless the client ships parts for you to assemble.</div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* JWSO Totals (parity with the SO form) */}
      <div style={{ marginTop: 12, border: '2px solid var(--green)', borderRadius: 8, padding: '10px 16px', background: 'rgba(34,197,94,0.03)' }}>
        <div style={{ display: 'flex', gap: 28, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
          <Tot label="Subtotal" value={subtotal} />
          <Tot label={`GST (${gstPercent}%)`} value={gstAmt} />
          <Tot label="Grand Total" value={grand} bold />
        </div>
        <div className="text3" style={{ fontSize: 10, textAlign: 'right', marginTop: 4 }}>{lineCount} item{lineCount === 1 ? '' : 's'} • {totalPcs} total pcs</div>
      </div>

      <div style={{ marginTop: 16 }}>
        {props.submitError ? (
          <div style={{ color: 'var(--red)', background: 'var(--red3)', border: '1px solid #fca5a5', borderRadius: 6, padding: '6px 10px', fontSize: 12, marginBottom: 10 }}>{props.submitError}</div>
        ) : null}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 6 }}>
          {props.onCancel ? <button type="button" className="btn btn-ghost" onClick={props.onCancel}>Cancel</button> : null}
          {/* Footer derived from the legacy call sites: addJW L12890 and editJW
              L12926 both call showModalLg(title, body, onSave) with NO saveLabel,
              so L28034 derives it from the title — both titles contain "JW" →
              "Save JW" — and L28044 renders `&#10003; ${_saveLabel}` on
              .btn-success. Same label in both modes, by construction. */}
          <button type="submit" className="btn btn-success" disabled={formState.isSubmitting || (isCreate && !docNoValid)}>
            {formState.isSubmitting ? <Loader2 size={13} className="animate-spin" /> : null}
            {props.submitLabel ?? '✓ Save JW'}
          </button>
        </div>
      </div>

      {showAddClient ? (
        <QuickAddClient onClose={() => setShowAddClient(false)} onCreated={onClientCreated} />
      ) : null}
    </form>
  );
}

/** Minimal client quick-add modal (mirrors the SO form's QuickAddClient). Name
 *  is the only required field; the server auto-generates the CLI-### code. */
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

function Tot({ label, value, bold }: { label: string; value: number; bold?: boolean }): React.JSX.Element {
  return (
    <div style={{ textAlign: 'right' }}>
      <div className="text3" style={{ fontSize: 10, textTransform: 'uppercase' }}>{label}</div>
      <div className="mono" style={{ fontSize: bold ? 18 : 14, fontWeight: 700, color: bold ? 'var(--green)' : 'var(--text)' }}>₹{inrFormat(value)}</div>
    </div>
  );
}

function detailToFormValues(detail: JobWorkOrderDetail): FormValues {
  return {
    header: {
      code: detail.code,
      jwDate: detail.jwDate,
      status: detail.status,
      gstPercent: Number(detail.gstPercent),
      ...(detail.clientId ? { clientId: detail.clientId } : {}),
      ...(detail.customerName ? { customerName: detail.customerName } : {}),
      ...(detail.clientPoNo ? { clientPoNo: detail.clientPoNo } : {}),
      ...(detail.remarks ? { remarks: detail.remarks } : {}),
      // Header-level Due Date = the earliest line due date (lines all share it now).
      ...(() => {
        const due = detail.lines.map((l) => l.dueDate).filter((d): d is string => Boolean(d)).sort()[0];
        return due ? { dueDate: due } : {};
      })(),
      ...(detail.clientMaterial ? { clientMaterial: detail.clientMaterial } : {}),
      ...(detail.clientMaterialQty !== null ? { clientMaterialQty: Number(detail.clientMaterialQty) } : {}),
    },
    lines:
      detail.lines.length > 0
        ? detail.lines.map((l): LineFormValue => ({
            id: l.id,
            ...(l.itemId ? { itemId: l.itemId } : {}),
            itemCodeText: l.itemCodeText ?? '',
            partName: l.partName,
            ...(l.material ? { material: l.material } : {}),
            ...(l.drawingNo ? { drawingNo: l.drawingNo } : {}),
            uom: l.uom,
            orderQty: l.orderQty,
            rate: Number(l.rate),
            ...(l.dueDate ? { dueDate: l.dueDate } : {}),
            status: l.status,
            ...(l.sourceBomMasterId ? { sourceBomMasterId: l.sourceBomMasterId } : {}),
          }))
        : [{ ...NEW_LINE }],
  };
}
