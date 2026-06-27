// Sales Order form — header + type-branching body. 1:1 mirror of legacy
// soHeaderForm (L12183) / _soLinesHtml (L12158) / _soLineRowHtml (L11985) /
// addSO (L12413), with three deliberate, user-approved deviations from the HTML:
//   • Status + Cost Center are NOT on the create form (removed by product
//     decision; Finance derives the cost centre from the SO No.).
//   • Item Code on a component line MUST come from Item Master — enforced by a
//     server-searched picker (you can only pick a master item), matching the
//     legacy _badIC "Item not in Item Master" rule (L12443).
//   • Equipment value is captured ₹/unit (total = rate × qty), not an absolute.
//
// Everything else mirrors the HTML: searchable client + item pickers, line
// table with per-line Amount, SO totals (subtotal / GST / grand + item·pcs
// count), delivery milestones, in-form Excel template/import, equipment BOM.

import {
  type CreateSalesOrderInput,
  type SalesOrderDetail,
  SELECTABLE_SO_TYPES,
  type SoStatus,
  type SoType,
  type UpdateSalesOrderInput,
  type Uom,
  UOMS,
} from '@innovic/shared';
import { Loader2, Plus, Trash2 } from 'lucide-react';
import { useRef, useState } from 'react';
import { useFieldArray, useForm } from 'react-hook-form';
import { SearchableSelect } from '@/components/shared/searchable-select';
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
  };
  lines: LineFormValue[];
  milestones: MilestoneFormValue[];
}

const HEADER_DEFAULTS: FormValues['header'] = {
  code: '',
  soDate: new Date().toISOString().slice(0, 10),
  type: 'component_manufacturing',
  status: 'open',
  gstPercent: 18,
};
const NEW_LINE: LineFormValue = { itemCodeText: '', partName: '', uom: 'NOS', orderQty: 1, rate: 0 };
const NEW_MILESTONE: MilestoneFormValue = { lotNo: 1, qty: 0 };

type CreateMode = {
  mode: 'create';
  onSubmit: (values: CreateSalesOrderInput) => Promise<void> | void;
  submitLabel?: string;
  submitError?: string | null;
  onCancel?: () => void;
  /** Client-PO document chosen in the form; uploaded by the page after save. */
  onPoFileChange?: (file: File | null) => void;
};
type EditMode = {
  mode: 'edit';
  detail: SalesOrderDetail;
  onSubmit: (values: UpdateSalesOrderInput) => Promise<void> | void;
  submitLabel?: string;
  submitError?: string | null;
  onCancel?: () => void;
  onPoFileChange?: (file: File | null) => void;
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
  const { fields, append, remove } = useFieldArray({ control, name: 'lines' });
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

  /** Pick a master item into a line — fill name/material/drawing/uom (fill-only
   *  for the text fields so manual edits survive; UOM mirrors the master). */
  function pickItem(idx: number, id: string | null): void {
    setValue(`lines.${idx}.itemId`, id ?? undefined);
    if (!id) {
      setValue(`lines.${idx}.itemCodeText`, '');
      return;
    }
    const it = itemsById.get(id);
    if (!it) return;
    setValue(`lines.${idx}.itemCodeText`, it.code);
    if (!getValues(`lines.${idx}.partName`)) setValue(`lines.${idx}.partName`, it.name);
    if (!getValues(`lines.${idx}.material`)) setValue(`lines.${idx}.material`, it.material ?? '');
    if (!getValues(`lines.${idx}.drawingNo`)) setValue(`lines.${idx}.drawingNo`, it.drawingNo ?? '');
    setValue(`lines.${idx}.uom`, it.uom);
  }

  // Equipment Part No. uses a free datalist (legacy allows off-master parts).
  const itemsByCode = new Map(items.map((it) => [it.code.trim().toUpperCase(), it]));
  function fillEquipFromItem(codeValue: string): void {
    const it = itemsByCode.get(codeValue.trim().toUpperCase());
    if (!it) return;
    if (!getValues('lines.0.partName')) setValue('lines.0.partName', it.name);
  }

  const [lineError, setLineError] = useState<string | null>(null);
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

  // In-form line import.
  const lineFileRef = useRef<HTMLInputElement>(null);
  const [importMsg, setImportMsg] = useState<string | null>(null);
  async function onImportLines(file: File): Promise<void> {
    try {
      const { rows, errors: errs } = await parseSoLineFile(file);
      for (const r of rows) append({ ...NEW_LINE, ...r });
      setImportMsg(`Added ${rows.length} line(s)${errs.length ? ` · ${errs.length} skipped` : ''}.`);
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

  const onValid = async (values: FormValues): Promise<void> => {
    setLineError(null);
    const equip = values.header.type === 'equipment';

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
        dueDate: l.dueDate || undefined,
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
    <form onSubmit={handleSubmit(onValid)}>
      {/* Header */}
      <div className="form-grid form-grid-3" style={{ marginBottom: 16 }}>
        <div className="form-grp">
          <label className="form-label" htmlFor="code">SO/WO No.</label>
          <input id="code" className="innovic-input" autoComplete="off" readOnly placeholder={isEdit ? undefined : 'Auto-generated on save'} {...register('header.code')} />
          <div className="form-help">{isEdit ? 'Code cannot be changed after creation.' : 'Generated automatically in series (IN-SO-…) when you save.'}</div>
        </div>
        <div className="form-grp">
          <label className="form-label" htmlFor="soDate">Date<span className="req">★</span></label>
          <input id="soDate" type="date" className="innovic-input" {...register('header.soDate', { required: 'Date is required' })} />
        </div>
        <div className="form-grp">
          <label className="form-label" htmlFor="type">Type<span className="req">★</span></label>
          <select id="type" className="innovic-select" {...register('header.type')}>
            {SELECTABLE_SO_TYPES.map((t) => <option key={t} value={t}>{t.replaceAll('_', ' ')}</option>)}
          </select>
        </div>

        <div className="form-grp">
          <label className="form-label" htmlFor="gstPercent" style={{ color: 'var(--green)' }}>GST %</label>
          <select id="gstPercent" className="innovic-select" {...register('header.gstPercent', { valueAsNumber: true })}>
            {[0, 5, 12, 18, 28].map((g) => <option key={g} value={g}>{g}%</option>)}
          </select>
        </div>

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
          <div className="form-help">Sales Orders must reference a client from the master. Not listed? Use <b>+ New</b>.</div>
        </div>

        <div className="form-grp">
          <label className="form-label" htmlFor="clientPoNo">Client PO No.</label>
          <input id="clientPoNo" className="innovic-input" autoComplete="off" placeholder="Client PO reference" {...register('header.clientPoNo')} />
          <div style={{ marginTop: 4, display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
            {poFileName ? (
              <span style={{ fontSize: 11, color: 'var(--green)', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                📄 <span style={{ maxWidth: 140, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{poFileName}</span>
                <button type="button" onClick={clearPoFile} style={{ color: 'var(--red)', fontSize: 10, background: 'none', border: 'none', cursor: 'pointer', textDecoration: 'underline' }}>✕</button>
              </span>
            ) : (
              <label style={{ fontSize: 10, padding: '2px 8px', borderRadius: 4, border: '1px dashed var(--border)', color: 'var(--text3)', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 3 }}>
                📤 Upload PO Doc
                <input type="file" accept=".pdf,.jpg,.jpeg,.png,.webp" style={{ display: 'none' }} onChange={onPickPoFile} />
              </label>
            )}
          </div>
        </div>

        <div className="form-grp form-full">
          <label className="form-label" htmlFor="remarks">Remarks</label>
          <textarea id="remarks" className="innovic-textarea" rows={2} placeholder="Notes" {...register('header.remarks')} />
        </div>
      </div>

      {isEquip ? (
        /* ── Equipment Details (legacy L12258) ── */
        <div>
          <div style={{ fontSize: 11, color: 'var(--cyan)', fontFamily: 'var(--mono)', fontWeight: 700, margin: '4px 0 8px' }}>▸ EQUIPMENT DETAILS</div>
          <div className="form-grid form-grid-3">
            <div className="form-grp">
              <label className="form-label">Equipment / Part No.<span className="req">★</span></label>
              <input className="innovic-input" autoComplete="off" list="dlSoEquipItems" placeholder="Equipment ID" {...register('lines.0.itemCodeText', { required: isEquip ? 'Part No. is required' : false, onChange: (e) => fillEquipFromItem(e.target.value) })} />
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
              <label className="form-label">Due Date</label>
              <input type="date" className="innovic-input" {...register('lines.0.dueDate')} />
            </div>
            <div className="form-grp">
              <label className="form-label" style={{ color: 'var(--green)' }}>💰 SO Value (₹ / unit)</label>
              <input type="number" step="0.01" min={0} className="innovic-input" style={{ fontWeight: 700, color: 'var(--green)' }} {...register('lines.0.rate', { valueAsNumber: true })} />
            </div>
            <div className="form-grp">
              <label className="form-label">📦 BOM (Bill of Materials)</label>
              <select className="innovic-select" {...register('header.bomMasterId')}>
                <option value="">— No BOM (BOM Pending) —</option>
                {boms.map((b) => <option key={b.id} value={b.id}>{b.bomNo} — {b.bomName} (Rev {b.revision}, {b.lineCount} items)</option>)}
              </select>
              <div className="form-help">Select an active BOM from BOM Master. Equipment value total = SO Value × Order Qty.</div>
            </div>
          </div>
        </div>
      ) : (
        /* ── Component / With-Material line items (legacy L12278) ── */
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <div className="form-label" style={{ fontSize: 12, marginBottom: 0, textTransform: 'uppercase' }}>▸ SO Line Items</div>
            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <button type="button" className="btn btn-ghost btn-sm" style={{ fontSize: 11 }} onClick={() => downloadSoLineTemplate()}>⬇ Template</button>
              <button type="button" className="btn btn-ghost btn-sm" style={{ fontSize: 11 }} onClick={() => lineFileRef.current?.click()}>📄 Import Excel</button>
              <input ref={lineFileRef} type="file" accept=".xlsx,.xls" style={{ display: 'none' }} onChange={(e) => { const f = e.target.files?.[0]; if (f) void onImportLines(f); }} />
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => append({ ...NEW_LINE })}><Plus size={13} /> Add Line</button>
            </div>
          </div>
          {importMsg ? <div className="text3" style={{ fontSize: 11, marginBottom: 8 }}>{importMsg} <button type="button" className="btn btn-ghost btn-sm" style={{ fontSize: 10 }} onClick={() => setImportMsg(null)}>✕</button></div> : null}

          <div style={{ overflowX: 'auto', border: '1px solid var(--border)', borderRadius: 8 }}>
            <table className="innovic-table" style={{ minWidth: 880 }}>
              <thead>
                <tr>
                  <th style={{ width: 30 }}>#</th>
                  <th style={{ minWidth: 190 }}>Item Code <span className="req">★</span></th>
                  <th style={{ minWidth: 120 }}>Part Name</th>
                  <th style={{ minWidth: 90 }}>Material</th>
                  <th style={{ minWidth: 90 }}>Drawing No.</th>
                  <th style={{ minWidth: 80 }}>Client PO Ln</th>
                  <th style={{ width: 64 }}>UOM</th>
                  <th style={{ width: 80 }} className="td-ctr">Qty <span className="req">★</span></th>
                  <th style={{ width: 90, color: 'var(--green)' }}>Rate ₹</th>
                  <th style={{ width: 90, color: 'var(--green)' }}>Amount</th>
                  <th style={{ width: 120 }}>Due Date</th>
                  <th style={{ width: 30 }} />
                </tr>
              </thead>
              <tbody>
                {fields.length === 0 ? (
                  <tr><td colSpan={12} className="empty-state" style={{ padding: 14 }}>No lines yet — click <strong>+ Add Line</strong> or import from Excel.</td></tr>
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
                            placeholder="🔍 Search item…"
                            valueLabel={ln?.itemCodeText || undefined}
                          />
                        </td>
                        <td><input className="innovic-input" autoComplete="off" placeholder="Part name" {...register(`lines.${idx}.partName` as const)} /></td>
                        <td><input className="innovic-input" autoComplete="off" placeholder="Material" {...register(`lines.${idx}.material` as const)} /></td>
                        <td><input className="innovic-input" autoComplete="off" placeholder="Drg.No" {...register(`lines.${idx}.drawingNo` as const)} /></td>
                        <td><input className="innovic-input" autoComplete="off" placeholder="PO Line#" {...register(`lines.${idx}.clientPoLineNo` as const)} /></td>
                        <td>
                          <select className="innovic-select" {...register(`lines.${idx}.uom` as const)}>
                            {UOMS.map((u) => <option key={u} value={u}>{u}</option>)}
                          </select>
                        </td>
                        <td><input type="number" min={1} className="innovic-input" style={{ textAlign: 'center', fontWeight: 700, color: 'var(--cyan)' }} {...register(`lines.${idx}.orderQty` as const, { valueAsNumber: true })} /></td>
                        <td><input type="number" step="0.01" min={0} className="innovic-input" style={{ textAlign: 'right', color: 'var(--green)' }} {...register(`lines.${idx}.rate` as const, { valueAsNumber: true })} /></td>
                        <td className="mono" style={{ fontSize: 11, color: 'var(--green)', fontWeight: 700, textAlign: 'right' }}>{amt > 0 ? `₹${amt.toFixed(2)}` : '—'}</td>
                        <td><input type="date" className="innovic-input" {...register(`lines.${idx}.dueDate` as const)} /></td>
                        <td><button type="button" className="btn btn-danger btn-sm btn-icon" onClick={() => remove(idx)} aria-label={`Remove line ${idx + 1}`}><Trash2 size={12} /></button></td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
          <div className="text3" style={{ fontSize: 11, marginTop: 6 }}>ⓘ Items must exist in Item Master first — pick from the search list. Use <b>⬇ Template</b> → fill in Excel → <b>📄 Import Excel</b> to bulk-add.</div>

          {/* SO Totals (legacy L12291 / _soTotalsHtml L12366) */}
          <div style={{ marginTop: 12, border: '2px solid var(--green)', borderRadius: 8, padding: '10px 16px', background: 'rgba(34,197,94,0.03)' }}>
            <div style={{ display: 'flex', gap: 28, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
              <Tot label="Subtotal" value={subtotal} />
              <Tot label={`GST (${gstPercent}%)`} value={gstAmt} />
              <Tot label="Grand Total" value={grand} bold />
            </div>
            <div className="text3" style={{ fontSize: 10, textAlign: 'right', marginTop: 4 }}>{lineCount} item{lineCount === 1 ? '' : 's'} • {totalPcs} total pcs</div>
          </div>

          {/* Delivery Schedule / Milestones (ISSUE-015, legacy L12294) */}
          <div style={{ marginTop: 16 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <div className="form-label" style={{ fontSize: 12, marginBottom: 0, textTransform: 'uppercase' }}>📅 Delivery Schedule / Milestones</div>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => appendMs({ ...NEW_MILESTONE, lotNo: msFields.length + 1 })}><Plus size={13} /> Add Lot</button>
            </div>
            {msFields.length === 0 ? (
              <div className="text3" style={{ fontSize: 11 }}>No delivery lots planned. Optional — click <strong>Add Lot</strong> to schedule partial deliveries.</div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {msFields.map((field, idx) => (
                  <div key={field.id} style={{ border: '1px solid var(--border)', borderRadius: 8, padding: 10, background: 'var(--bg2)', display: 'flex', gap: 10, alignItems: 'flex-end', flexWrap: 'wrap' }}>
                    <div className="form-grp" style={{ width: 80 }}>
                      <label className="form-label">Lot #</label>
                      <input type="number" min={1} className="innovic-input" {...register(`milestones.${idx}.lotNo` as const, { valueAsNumber: true })} />
                    </div>
                    <div className="form-grp" style={{ width: 110 }}>
                      <label className="form-label">Qty</label>
                      <input type="number" min={0} className="innovic-input" {...register(`milestones.${idx}.qty` as const, { valueAsNumber: true })} />
                    </div>
                    <div className="form-grp" style={{ width: 160 }}>
                      <label className="form-label">Due Date</label>
                      <input type="date" className="innovic-input" {...register(`milestones.${idx}.dueDate` as const)} />
                    </div>
                    <div className="form-grp" style={{ flex: 1, minWidth: 160 }}>
                      <label className="form-label">Remarks</label>
                      <input className="innovic-input" autoComplete="off" placeholder="e.g. 1st lot" {...register(`milestones.${idx}.remarks` as const)} />
                    </div>
                    <button type="button" className="btn btn-danger btn-sm btn-icon" onClick={() => removeMs(idx)} aria-label={`Remove lot ${idx + 1}`}><Trash2 size={12} /></button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      <div style={{ marginTop: 16 }}>
        {lineError ? (
          <div style={{ color: 'var(--red)', background: 'var(--red3)', border: '1px solid #fca5a5', borderRadius: 6, padding: '6px 10px', fontSize: 12, marginBottom: 10 }}>{lineError}</div>
        ) : null}
        {props.submitError ? (
          <div style={{ color: 'var(--red)', background: 'var(--red3)', border: '1px solid #fca5a5', borderRadius: 6, padding: '6px 10px', fontSize: 12, marginBottom: 10 }}>{props.submitError}</div>
        ) : null}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 6 }}>
          {props.onCancel ? <button type="button" className="btn btn-ghost" onClick={props.onCancel}>Cancel</button> : null}
          <button type="submit" className="btn btn-primary" disabled={formState.isSubmitting}>
            {formState.isSubmitting ? <Loader2 size={13} className="animate-spin" /> : null}
            {props.submitLabel ?? (isEdit ? 'Save changes' : 'Create SO')}
          </button>
        </div>
      </div>

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

function Tot({ label, value, bold }: { label: string; value: number; bold?: boolean }): React.JSX.Element {
  return (
    <div style={{ textAlign: 'right' }}>
      <div className="text3" style={{ fontSize: 10, textTransform: 'uppercase' }}>{label}</div>
      <div className="mono" style={{ fontSize: bold ? 18 : 14, fontWeight: 700, color: bold ? 'var(--green)' : 'var(--text)' }}>₹{value.toFixed(2)}</div>
    </div>
  );
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
