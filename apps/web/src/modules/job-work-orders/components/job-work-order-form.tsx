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
  SO_STATUSES,
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
    materialReceivedDate?: string;
    materialReceivedQty?: number;
  };
  lines: LineFormValue[];
}

const HEADER_DEFAULTS: FormValues['header'] = {
  code: '',
  jwDate: new Date().toISOString().slice(0, 10),
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
  const { fields, append, remove } = useFieldArray({ control, name: 'lines' });

  // ── Searchable client picker (server-searched; scales past the 200 cap) ──
  const [clientSearch, setClientSearch] = useState('');
  const { data: clientsData, isFetching: clientsFetching } = useClientsList({
    ...(clientSearch.trim() ? { search: clientSearch.trim() } : {}),
    limit: 50,
    offset: 0,
  });
  const clients = clientsData?.clients ?? [];

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

  /** On item-code change, fill empty line fields from the master (fill-only, so
   *  manual edits are never clobbered); UOM mirrors the master. */
  function fillLineFromItem(idx: number, codeValue: string): void {
    const it = itemsByCode.get(codeValue.trim().toUpperCase());
    if (!it) return;
    if (!getValues(`lines.${idx}.partName`)) setValue(`lines.${idx}.partName`, it.name);
    if (!getValues(`lines.${idx}.material`)) setValue(`lines.${idx}.material`, it.material ?? '');
    if (!getValues(`lines.${idx}.drawingNo`)) setValue(`lines.${idx}.drawingNo`, it.drawingNo ?? '');
    setValue(`lines.${idx}.uom`, it.uom);
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
      for (const r of rows) append({ ...NEW_LINE, ...r });
      setImportMsg(`Added ${rows.length} line(s)${errs.length ? ` · ${errs.length} skipped` : ''}.`);
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
      materialReceivedDate: h.materialReceivedDate || undefined,
      materialReceivedQty:
        h.materialReceivedQty !== undefined && !Number.isNaN(Number(h.materialReceivedQty))
          ? Number(h.materialReceivedQty)
          : undefined,
    };

    const linesOut = values.lines.map((l) => {
      const trimmedCode = l.itemCodeText.trim();
      const refs: { itemId?: string; itemCodeText?: string } = trimmedCode
        ? { itemCodeText: trimmedCode }
        : l.itemId
          ? { itemId: l.itemId }
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

      {/* Header */}
      <div className="form-grid form-grid-3" style={{ marginBottom: 16 }}>
        <DocNumberInput
          type="job_work_order"
          label="JWSO No."
          required={isCreate}
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
            <select id="status" className="innovic-select" {...register('header.status')}>
              {SO_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
        ) : null}

        <div className="form-grp form-full">
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

        <div className="form-grp">
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
                    style={{ color: 'var(--cyan)', fontSize: 10, background: 'none', border: 'none', cursor: 'pointer', textDecoration: 'underline', padding: 0 }}
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
                <span className="mono" style={{ color: 'var(--cyan)' }}>📎 {poFileName}</span>
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
        <div className="form-grid form-grid-3">
          <div className="form-grp form-full">
            <label className="form-label">Client Material (Party Supplied Item)</label>
            <div style={{ display: 'flex', gap: 6 }}>
              <input className="innovic-input" style={{ flex: 1 }} autoComplete="off" list="dlRmItems" placeholder="🔍 Search -rm items…" {...register('header.clientMaterial')} />
              <Link to="/items/new" className="btn btn-ghost btn-sm" title="Create a new -rm item" style={{ whiteSpace: 'nowrap' }}>+ New</Link>
            </div>
          </div>
          <div className="form-grp">
            <label className="form-label">Material Qty (Client Supplied)</label>
            <input type="number" min={0} step="0.01" className="innovic-input" placeholder="0" {...register('header.clientMaterialQty', { valueAsNumber: true })} />
          </div>
          <div className="form-grp">
            <label className="form-label">Material Received Date</label>
            <input type="date" className="innovic-input" {...register('header.materialReceivedDate')} />
          </div>
          <div className="form-grp">
            <label className="form-label">Material Received Qty</label>
            <input type="number" min={0} step="0.01" className="innovic-input" placeholder="0" {...register('header.materialReceivedQty', { valueAsNumber: true })} />
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
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => append({ ...NEW_LINE })}><Plus size={13} /> Add line</button>
        </div>
      </div>
      {importMsg ? <div className="text3" style={{ fontSize: 11, marginBottom: 8 }}>{importMsg} <button type="button" className="btn btn-ghost btn-sm" style={{ fontSize: 10 }} onClick={() => setImportMsg(null)}>✕</button></div> : null}

      {fields.length === 0 ? (
        <div className="empty-state" style={{ padding: 24, border: '1px dashed var(--border)' }}>No lines yet. Click <strong>Add line</strong> — at least one is required.</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {fields.map((field, idx) => {
            const amt = (Number(watchedLines?.[idx]?.orderQty) || 0) * (Number(watchedLines?.[idx]?.rate) || 0);
            return (
              <div key={field.id} style={{ border: '1px solid var(--border)', borderRadius: 8, padding: 10, background: 'var(--bg2)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8, fontSize: 11, color: 'var(--text3)', fontFamily: 'var(--mono)', textTransform: 'uppercase', fontWeight: 700 }}>
                  <span>Line {idx + 1}</span>
                  <span style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                    <span style={{ color: 'var(--green)' }}>Amount ₹{amt.toFixed(2)}</span>
                    <button type="button" className="btn btn-danger btn-sm btn-icon" onClick={() => remove(idx)} aria-label={`Remove line ${idx + 1}`}><Trash2 size={12} /></button>
                  </span>
                </div>
                <div className="form-grid form-grid-3">
                  <div className="form-grp">
                    <label className="form-label">Item Code</label>
                    <input className="innovic-input" autoComplete="off" list="dlJwItems" placeholder="🔍 ITM-001" {...register(`lines.${idx}.itemCodeText` as const, { onChange: (e) => fillLineFromItem(idx, e.target.value) })} />
                  </div>
                  <div className="form-grp">
                    <label className="form-label">Part Name<span className="req">★</span></label>
                    <input className="innovic-input" autoComplete="off" {...register(`lines.${idx}.partName` as const, { required: 'Part name is required' })} />
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
          <button type="submit" className="btn btn-primary" disabled={formState.isSubmitting || (isCreate && !docNoValid)}>
            {formState.isSubmitting ? <Loader2 size={13} className="animate-spin" /> : null}
            {props.submitLabel ?? (isEdit ? 'Save changes' : 'Create JWSO')}
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
      <div className="mono" style={{ fontSize: bold ? 18 : 14, fontWeight: 700, color: bold ? 'var(--green)' : 'var(--text)' }}>₹{value.toFixed(2)}</div>
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
      ...(detail.materialReceivedDate ? { materialReceivedDate: detail.materialReceivedDate } : {}),
      ...(detail.materialReceivedQty !== null ? { materialReceivedQty: Number(detail.materialReceivedQty) } : {}),
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
          }))
        : [{ ...NEW_LINE }],
  };
}
