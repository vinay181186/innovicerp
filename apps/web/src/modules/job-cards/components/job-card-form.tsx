// Job Card create/edit form.
//
// Legacy counterpart: `jcModalBody(jc)` L5943 — the ONE body builder both entry
// points pass to showModalLg: addJC L6025 calls `jcModalBody(null)`, editJC
// L6086 calls `jcModalBody(jc)`. Both pass the explicit saveLabel 'Save Job
// Card', so showModalLg L28042-44 renders Cancel (.btn-ghost) + .btn-success
// with the `&#10003;` prefix → "✓ Save Job Card". jcModalOpsHtml L5868 and
// jcModalDocsHtml L5809 are delegates called from inside jcModalBody (L6012 /
// L6016), not counterparts. renderJobCards L5739 is the LIST, not this form.
//
// Legacy section order: JOB CARD DETAILS → DRAWING ATTACHMENT → OPERATION
// ROUTING → QC DOCUMENTS. Mirrored below.
//
// Started ops (hasStarted) are locked from removal/retype, mirroring
// _hasOpStarted L6151.

import type { JobCardEditModel, JobCardSourceOption } from '@innovic/shared';
import { useNavigate } from '@tanstack/react-router';
import { Loader2 } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { todayLocal } from '@/lib/date';
import { uploadFile } from '@/lib/storage';
import { useSession } from '@/lib/session';
import { useItemsList } from '@/modules/items/api';
import { useMachinesList } from '@/modules/machines/api';
import { useVendorsList } from '@/modules/vendors/api';
import {
  useCreateJobCard,
  useJobCardSourceOptions,
  useNextJcCode,
  useUpdateJobCard,
} from '../api';
import { buildJcWriteInput } from '../lib/build-jc-write-input';
import { JcOpEditCard } from './jc-op-edit-card';
import { OutsourceBalanceModal } from './outsource-balance-modal';

const QC_DOC_TYPES = [
  'MIR',
  'MCR',
  'Inspection Report Protocol',
  'Inspection Report',
  'Drawing',
  'Certificate',
  'Other',
];

// The local OP_STATUS copy that used to live here is gone: the op card reads
// the shared map (lib/jc-op-labels.ts), so there is no second copy to drift.

interface FormOp {
  id?: string;
  machineCode: string;
  operation: string;
  opType: 'process' | 'qc' | 'outsource';
  cycleTimeMin: number;
  program: string;
  toolNo: string;
  toolDetails: string;
  qcRequired: boolean;
  outsourceVendorCode: string;
  outsourceCost: number;
  hasStarted: boolean;
  /** Remaining qty cleared for this op (from the edit model). Drives the
   *  "Outsource balance" action for a STARTED in-house process op. */
  available: number;
  /** Read-only per-op live progress (from the edit model / v_jc_op_status),
   *  mirroring the JC Status page. Display-only — never sent on save. */
  inputAvail: number;
  completedQty: number;
  qcAcceptedQty: number;
  computedStatus: string;
}

interface FormDoc {
  id?: string;
  docType: string;
  fileName: string;
  storagePath: string;
  fileSize: number | null;
}

const today = (): string => todayLocal();

function sourceLabel(o: JobCardSourceOption): string {
  const tag = o.type === 'jw' ? '[JWSO]' : '[SO]';
  const ln = o.lineNo && o.lineNo !== 1 ? ` / L${o.lineNo}` : '';
  const part = o.partName ? ` (${o.partName})` : '';
  return `${tag} ${o.code}${ln} — ${o.customerName ?? ''}${part} [Avail: ${o.remaining}]`;
}

export function JobCardForm({
  model,
  initialSourceLineId,
}: {
  model?: JobCardEditModel;
  // Create mode only: pre-select this SO/JW source line (deep-linked from
  // SO Status Review's "Create Job Card"). Cascades item/qty/due once the
  // source options load. Ignored in edit mode (model wins).
  initialSourceLineId?: string | undefined;
}): React.JSX.Element {
  const isEdit = Boolean(model);
  const navigate = useNavigate();
  const { data: me } = useSession();
  const companyId = me?.companyId ?? '';

  const { data: sourceOptions = [] } = useJobCardSourceOptions();
  const { data: itemsData } = useItemsList({ limit: 500, offset: 0 });
  // machines & vendors list-query schemas cap `limit` at 200 — 500 makes the
  // route 400, leaving the machine picker empty ("No matches"). Stay ≤ 200.
  const { data: machinesData } = useMachinesList({ limit: 200, offset: 0 });
  const { data: vendorsData } = useVendorsList({ limit: 200, offset: 0 });
  const items = itemsData?.items ?? [];
  const machines = machinesData?.machines ?? [];
  const vendors = (vendorsData?.vendors ?? []).filter((v) => v.isActive);

  // ISSUE-170: source-options lists only OPEN lines, so a JC linked to a CLOSED
  // order would lose its own source from the datalist/label/banner. The edit
  // model resolves that linked line (open or closed) as `linkedSourceOption`;
  // unshift it (legacy editJC L5947-50) when it isn't already present.
  const allSources = useMemo(() => {
    const linked = model?.linkedSourceOption ?? null;
    if (!linked) return sourceOptions;
    if (sourceOptions.some((o) => o.lineId === linked.lineId)) return sourceOptions;
    return [linked, ...sourceOptions];
  }, [sourceOptions, model?.linkedSourceOption]);

  // Governance: direct SO/item Job Cards are disabled. Manual creation is
  // JW-only — SO items go through Planning (execute a plan). Edit mode keeps
  // whatever source the JC already has (incl. legacy SO-linked JCs).
  const availableSources = isEdit ? allSources : allSources.filter((o) => o.type === 'jw');

  const create = useCreateJobCard();
  const update = useUpdateJobCard(model?.id ?? '');
  // Preview the next IN-JC-YY-##### on create so the JC No. is visible before
  // save (server still assigns authoritatively). Not fetched in edit mode.
  const { data: nextJc } = useNextJcCode(!isEdit);

  // ── Header state ──
  const initialSource = model?.sourceSoLineId
    ? allSources.find((o) => o.lineId === model.sourceSoLineId)
    : model?.sourceJwLineId
      ? allSources.find((o) => o.lineId === model.sourceJwLineId)
      : undefined;
  const [jcDate, setJcDate] = useState(model?.jcDate ?? today());
  const [sourceLineId, setSourceLineId] = useState<string | null>(
    model?.sourceSoLineId ?? model?.sourceJwLineId ?? null,
  );
  const [sourceType, setSourceType] = useState<'so' | 'jw' | null>(
    model?.sourceSoLineId ? 'so' : model?.sourceJwLineId ? 'jw' : null,
  );
  const [sourceText, setSourceText] = useState(initialSource ? sourceLabel(initialSource) : '');
  // ISSUE-169: `sourceText` above initialises from `initialSource`, which reads
  // `sourceOptions` — an empty array on the first render (the query hasn't
  // resolved). The initialiser runs once and never re-syncs, so the linked
  // SO/WO/JW label stays blank on every edit even though the balance banner
  // (driven by the inline `selectedSource`, which recomputes each render) shows
  // the order. This flag lets an effect below sync the display value once the
  // linked option resolves, and stops once the user edits the field.
  const [sourceTextSynced, setSourceTextSynced] = useState(false);
  const [itemCode, setItemCode] = useState(model?.itemCode ?? '');
  const [orderQty, setOrderQty] = useState<string>(model ? String(model.orderQty) : '');
  const [priority, setPriority] = useState<'normal' | 'high'>(model?.priority ?? 'normal');
  const [dueDate, setDueDate] = useState(model?.dueDate ?? '');
  const [drawingFilePath, setDrawingFilePath] = useState<string | null>(model?.drawingFilePath ?? null);
  const [remarks, setRemarks] = useState(model?.remarks ?? '');
  const [drawingName, setDrawingName] = useState<string>(model?.drawingFilePath ? 'Attached' : '');

  const [ops, setOps] = useState<FormOp[]>(
    (model?.ops ?? []).map((o) => ({
      id: o.id,
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
      inputAvail: o.inputAvail ?? 0,
      completedQty: o.completedQty ?? 0,
      qcAcceptedQty: o.qcAcceptedQty ?? 0,
      computedStatus: o.computedStatus ?? 'waiting',
    })),
  );
  const [docs, setDocs] = useState<FormDoc[]>(
    (model?.qcDocs ?? []).map((d) => ({
      id: d.id,
      docType: d.docType,
      fileName: d.fileName,
      storagePath: d.storagePath,
      fileSize: d.fileSize,
    })),
  );
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  // ADR-081 dual-lane: index of the started process op whose remaining qty is
  // being outsourced from this form (null = modal closed), plus a transient
  // success note shown after a balance is sent out.
  const [balanceOpIdx, setBalanceOpIdx] = useState<number | null>(null);
  const [balanceNote, setBalanceNote] = useState<string | null>(null);

  // Machine picker: the op card uses the shared SearchableSelect (same control
  // the JC edit screen already uses), replacing this form's <datalist>, which
  // collapsed on a pre-filled value (T32a). Only one row's dropdown is open at
  // a time, so a shared search term is fine.
  const [machineSearch, setMachineSearch] = useState('');
  const machineOptions = machines
    .filter(
      (m) =>
        !machineSearch.trim() ||
        `${m.code} ${m.name}`.toLowerCase().includes(machineSearch.trim().toLowerCase()),
    )
    .map((m) => ({ id: m.id, code: m.code, name: m.name }));

  const sourceByLabel = useMemo(() => {
    const m = new Map<string, JobCardSourceOption>();
    for (const o of availableSources) m.set(sourceLabel(o), o);
    return m;
  }, [availableSources]);
  const selectedSource = sourceLineId
    ? allSources.find((o) => o.lineId === sourceLineId)
    : undefined;

  // ISSUE-169 fix: once the linked source option resolves (edit mode), display
  // its label in the search field. Runs once, then yields to user edits.
  useEffect(() => {
    if (!isEdit || sourceTextSynced || !selectedSource) return;
    setSourceText(sourceLabel(selectedSource));
    setSourceTextSynced(true);
  }, [isEdit, sourceTextSynced, selectedSource]);

  // Ops counter (legacy jcModalOpsHtml L5927). Legacy pluralised "op(s)" off the
  // TOTAL row count while PRINTING the non-QC count, so 1 process op + 1 QC op
  // read "1 ops". That deviation is no longer mirrored — the plural now follows
  // the number actually shown.
  const opCount = ops.filter((o) => o.opType !== 'qc').length;
  const qcCount = ops.filter((o) => o.opType === 'qc').length;

  const onSourceChange = (val: string): void => {
    // User is editing the field — freeze the ISSUE-169 auto-sync effect so it
    // never overwrites what they type.
    setSourceTextSynced(true);
    setSourceText(val);
    const opt = sourceByLabel.get(val);
    if (!opt) {
      setSourceLineId(null);
      setSourceType(null);
      return;
    }
    setSourceLineId(opt.lineId);
    setSourceType(opt.type);
    // Cascade auto-fill (legacy _jcCascadeFromOrder): only fill empties.
    if (opt.itemCode && !itemCode) setItemCode(opt.itemCode);
    if (opt.remaining > 0 && !orderQty) setOrderQty(String(opt.remaining));
    if (opt.dueDate && !dueDate) setDueDate(opt.dueDate);
  };

  // One-time prefill when deep-linked with a source line (create mode). Waits
  // for source options to load, then applies the same cascade as a manual pick.
  const [appliedInitialSource, setAppliedInitialSource] = useState(false);
  useEffect(() => {
    if (isEdit || appliedInitialSource || !initialSourceLineId) return;
    const opt = sourceOptions.find((o) => o.lineId === initialSourceLineId);
    if (!opt) return;
    setSourceText(sourceLabel(opt));
    setSourceLineId(opt.lineId);
    setSourceType(opt.type);
    if (opt.itemCode && !itemCode) setItemCode(opt.itemCode);
    if (opt.remaining > 0 && !orderQty) setOrderQty(String(opt.remaining));
    if (opt.dueDate && !dueDate) setDueDate(opt.dueDate);
    setAppliedInitialSource(true);
  }, [
    isEdit,
    appliedInitialSource,
    initialSourceLineId,
    sourceOptions,
    itemCode,
    orderQty,
    dueDate,
  ]);

  const setOp = (i: number, patch: Partial<FormOp>): void => {
    setOps((prev) => prev.map((o, idx) => (idx === i ? { ...o, ...patch } : o)));
  };
  const moveOp = (i: number, dir: -1 | 1): void => {
    setOps((prev) => {
      const next = [...prev];
      const j = i + dir;
      if (j < 0 || j >= next.length) return prev;
      [next[i], next[j]] = [next[j]!, next[i]!];
      return next;
    });
  };
  const addOp = (qc = false): void => {
    setOps((prev) => [
      ...prev,
      {
        machineCode: '',
        operation: '',
        opType: qc ? 'qc' : 'process',
        cycleTimeMin: 0,
        program: '',
        toolNo: '',
        toolDetails: '',
        qcRequired: qc,
        outsourceVendorCode: '',
        outsourceCost: 0,
        hasStarted: false,
        available: 0,
        inputAvail: 0,
        completedQty: 0,
        qcAcceptedQty: 0,
        computedStatus: 'waiting',
      },
    ]);
  };

  const onDrawing = async (file: File | undefined): Promise<void> => {
    if (!file || !companyId) return;
    setError(null);
    setUploading(true);
    try {
      const path = await uploadFile(file, companyId, { folder: 'jc-drawings' });
      setDrawingFilePath(path);
      setDrawingName(file.name);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Drawing upload failed');
    } finally {
      setUploading(false);
    }
  };

  const onDocFile = async (i: number, file: File | undefined): Promise<void> => {
    if (!file || !companyId) return;
    setError(null);
    setUploading(true);
    try {
      const path = await uploadFile(file, companyId, { folder: 'qc-docs' });
      setDocs((prev) =>
        prev.map((d, idx) =>
          idx === i ? { ...d, fileName: file.name, storagePath: path, fileSize: file.size } : d,
        ),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Document upload failed');
    } finally {
      setUploading(false);
    }
  };

  const submitting = create.isPending || update.isPending || uploading;

  const onSubmit = async (): Promise<void> => {
    setError(null);
    // Validation + payload build shared with the JC Status edit branch.
    const result = buildJcWriteInput({
      isEdit,
      jcDate,
      sourceType,
      sourceLineId,
      itemCode,
      orderQty,
      priority,
      dueDate,
      drawingFilePath,
      remarks,
      ops,
      docs,
    });
    if (!result.ok) {
      setError(result.error);
      return;
    }
    try {
      if (isEdit && model) await update.mutateAsync(result.payload);
      else await create.mutateAsync(result.payload);
      void navigate({ to: '/job-cards' });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed');
    }
  };

  return (
    <div>
      <datalist id="dlJcItem">
        {items.map((i) => (
          <option key={i.id} value={i.code}>
            {i.code} — {i.name}
          </option>
        ))}
      </datalist>
      <datalist id="dlJcSource">
        {availableSources.map((o) => (
          <option key={o.lineId} value={sourceLabel(o)} />
        ))}
      </datalist>
      <datalist id="dlJcVendor">
        {vendors.map((v) => (
          <option key={v.id} value={v.code}>
            {v.code} — {v.name}
          </option>
        ))}
      </datalist>

      {/* ── JC DETAILS ── */}
      <div className="panel" style={{ marginBottom: 12 }}>
        <div className="panel-hdr">
          <div className="panel-title">▸ Job Card Details</div>
        </div>
        <div className="panel-body">
          <div className="form-grid">
            <div className="form-grp">
              <label className="form-label">JC No.</label>
              <input
                className="innovic-input"
                value={model?.code ?? nextJc?.code ?? '(auto on save)'}
                readOnly
              />
            </div>
            <div className="form-grp">
              <label className="form-label">
                Date <span className="text3">(auto: today)</span>
              </label>
              <input
                type="date"
                className="innovic-input"
                value={jcDate}
                onChange={(e) => setJcDate(e.target.value)}
              />
            </div>
            <div className="form-grp form-full">
              <label className="form-label">
                {isEdit ? 'SO / WO / JWSO No. (type to search)' : 'Job Work Sales Order (JWSO) No. (type to search)'}
                {!isEdit ? <span className="req">★</span> : null}
              </label>
              {!isEdit ? (
                <div
                  style={{
                    fontSize: 11,
                    color: 'var(--amber)',
                    marginBottom: 4,
                    fontWeight: 600,
                  }}
                >
                  ⓘ Manual Job Cards are for Job Work Sales Orders (JWSO) only. For Sales Order
                  items, use Planning → execute a plan.
                </div>
              ) : null}
              <input
                className="innovic-input"
                list={isEdit ? undefined : 'dlJcSource'}
                value={sourceText}
                readOnly={isEdit}
                placeholder={isEdit ? 'Source is fixed after creation' : '🔍 Search JWSO number…'}
                onChange={(e) => onSourceChange(e.target.value)}
                style={isEdit ? { background: 'var(--bg4)', color: 'var(--text3)' } : undefined}
                title={isEdit ? 'A Job Card’s source order cannot be changed after creation.' : undefined}
              />
              {/* Line display (legacy #fSoLineDisplay, _jcCascadeFromOrder L1883-87). */}
              {selectedSource ? (
                <div style={{ fontSize: 11, marginTop: 4 }}>
                  <span className="cyan fw-700">
                    {selectedSource.type === 'jw' ? '[JW] ' : ''}Line {selectedSource.lineNo || 1}
                  </span>
                  {selectedSource.clientPoLineNo ? (
                    <span style={{ color: 'var(--purple)', fontWeight: 700 }}>
                      {' '}
                      [CPO:{selectedSource.clientPoLineNo}]
                    </span>
                  ) : null}{' '}
                  — {selectedSource.code}
                  {selectedSource.partName ? (
                    <>
                      {' · '}
                      <b>{selectedSource.partName}</b>
                    </>
                  ) : null}{' '}
                  · <span className="text3">{selectedSource.customerName ?? ''}</span>
                </div>
              ) : null}
              {selectedSource ? (
                <div
                  style={{
                    marginTop: 6,
                    padding: '6px 10px',
                    borderRadius: 6,
                    fontSize: 12,
                    background:
                      selectedSource.remaining <= 0 ? 'var(--red3)' : 'rgba(34,197,94,0.06)',
                    border: `1px solid ${selectedSource.remaining <= 0 ? '#fca5a5' : 'rgba(34,197,94,0.2)'}`,
                    color: selectedSource.remaining <= 0 ? 'var(--red)' : 'var(--text2)',
                  }}
                >
                  <b style={{ color: 'var(--cyan)' }}>{selectedSource.code}:</b> Ordered{' '}
                  <b>{selectedSource.orderQty}</b> | Already in JCs <b>{selectedSource.inJc}</b> |{' '}
                  <b style={{ color: selectedSource.remaining <= 0 ? 'var(--red)' : 'var(--green)' }}>
                    Available: {selectedSource.remaining}
                  </b>
                </div>
              ) : null}
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
                list="dlJcItem"
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
            {/* Remarks has no legacy counterpart (jcModalBody has no such field),
                but job_cards.remarks is a real column the service persists —
                kept per "legacy has fewer fields than ours → keep ours". */}
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

      {/* ── DRAWING ATTACHMENT (legacy jcModalBody L5996-6006) ── */}
      <div className="panel" style={{ marginBottom: 12 }}>
        <div className="panel-hdr">
          <div className="panel-title">
            ▸ Drawing Attachment <span className="text3">(optional — image or PDF)</span>
          </div>
        </div>
        <div className="panel-body">
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <label
              style={{
                cursor: 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                padding: '6px 12px',
                background: 'var(--bg4)',
                border: '1px solid var(--border2)',
                borderRadius: 'var(--radius)',
                fontSize: 12,
                fontWeight: 600,
                color: 'var(--text2)',
              }}
            >
              📎 Attach Drawing
              <input
                type="file"
                accept="image/*,.pdf"
                style={{ display: 'none' }}
                onChange={(e) => void onDrawing(e.target.files?.[0])}
              />
            </label>
            <span className="text3" style={{ fontSize: 12 }}>
              {drawingName || 'No file attached'}
            </span>
            {drawingFilePath ? (
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => {
                  setDrawingFilePath(null);
                  setDrawingName('');
                }}
              >
                ✕ Remove
              </button>
            ) : null}
          </div>
        </div>
      </div>

      {/* ── OPERATION ROUTING (legacy jcModalBody L6007-6013 + jcModalOpsHtml L5868) ── */}
      <div className="panel" style={{ marginBottom: 12 }}>
        <div className="panel-hdr">
          <div className="panel-title">
            ▸ Operations — Routing Sequence{' '}
            <span className="text3" style={{ fontSize: 10, fontWeight: 400 }}>
              Program / Tool Details are per-operation
            </span>
          </div>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <span className="text3" style={{ fontSize: 11 }}>
              {opCount} op{opCount !== 1 ? 's' : ''}
              {qcCount > 0 ? ` + ${qcCount} QC` : ''}
            </span>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => addOp(false)}>
              + Add Op
            </button>
            <button
              type="button"
              className="btn btn-sm"
              style={{ color: 'var(--green)', border: '1px solid rgba(34,197,94,0.3)' }}
              onClick={() => addOp(true)}
            >
              + Add QC Op
            </button>
          </div>
        </div>
        <div className="panel-body">
          {ops.length === 0 ? (
            <div className="empty-state">
              No operations yet — click “+ Add Op” for machining steps or “+ Add QC Op” for QC
              inspection steps.
            </div>
          ) : (
            ops.map((o, i) => (
              <JcOpEditCard
                key={i}
                // Order Qty is typed on this screen; the other tiles have no
                // source until the JC is saved, so they render “—”.
                jc={{ orderQty: Number(orderQty) || 0 }}
                op={o}
                index={i}
                seqLabel={i + 1}
                enriched={undefined}
                machineName={machines.find((m) => m.code === o.machineCode)?.name ?? ''}
                machines={machines}
                machineOptions={machineOptions}
                onMachineSearch={setMachineSearch}
                vendorListId="dlJcVendor"
                toolDetailsPlaceholder="Insert, fixtures, setup notes"
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
            ))
          )}
        </div>
      </div>

      {/* ── QC DOCUMENTS (legacy jcModalBody L6014-6017 + jcModalDocsHtml L5809) ── */}
      <div className="panel" style={{ marginBottom: 12 }}>
        <div className="panel-hdr">
          <div className="panel-title">
            ▸ QC Documents{' '}
            <span className="text3" style={{ fontSize: 10, fontWeight: 400 }}>
              MIR • MCR • Inspection Reports &amp; other QC files
            </span>
          </div>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <span className="text3" style={{ fontSize: 11 }}>
              {docs.length} doc{docs.length !== 1 ? 's' : ''} attached
            </span>
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() =>
                setDocs((prev) => [
                  ...prev,
                  { docType: 'MIR', fileName: '', storagePath: '', fileSize: null },
                ])
              }
            >
              + Add Document
            </button>
          </div>
        </div>
        <div className="panel-body">
          {docs.length === 0 ? (
            <div className="empty-state" style={{ fontSize: 12 }}>
              No QC documents — click “+ Add Document” to attach MIR, MCR, Inspection Reports, etc.
            </div>
          ) : (
            <table className="innovic-table">
              <thead>
                <tr>
                  <th style={{ width: 200 }}>Document Type</th>
                  <th>Attached File</th>
                  <th style={{ width: 40 }} />
                </tr>
              </thead>
              <tbody>
                {docs.map((d, i) => (
                  <tr key={i}>
                    <td>
                      <select
                        className="innovic-select"
                        value={d.docType}
                        onChange={(e) =>
                          setDocs((prev) =>
                            prev.map((x, idx) => (idx === i ? { ...x, docType: e.target.value } : x)),
                          )
                        }
                        style={{ fontSize: 12 }}
                      >
                        {QC_DOC_TYPES.map((t) => (
                          <option key={t} value={t}>
                            {t}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td>
                      <label style={{ cursor: 'pointer', fontSize: 12 }}>
                        📎 {d.fileName || 'Attach File'}
                        <input
                          type="file"
                          accept="image/*,.pdf"
                          style={{ display: 'none' }}
                          disabled={Boolean(d.id)}
                          onChange={(e) => void onDocFile(i, e.target.files?.[0])}
                        />
                      </label>
                    </td>
                    <td>
                      <button
                        type="button"
                        className="btn btn-danger btn-sm btn-icon"
                        onClick={() => setDocs((prev) => prev.filter((_, idx) => idx !== i))}
                        title="Remove"
                      >
                        ✕
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

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
          jcId={model?.id ?? ''}
          jcCode={model?.code ?? ''}
          opId={ops[balanceOpIdx]!.id!}
          opSeq={balanceOpIdx + 1}
          operation={ops[balanceOpIdx]!.operation}
          itemCode={itemCode}
          available={ops[balanceOpIdx]!.available}
          defaultVendorCode={ops[balanceOpIdx]!.outsourceVendorCode}
          vendors={vendors}
          onClose={() => setBalanceOpIdx(null)}
          onDone={(qtyDone) => {
            const idx = balanceOpIdx;
            const op = ops[idx];
            if (op) setOp(idx, { available: Math.max(0, op.available - qtyDone) });
            setBalanceNote(`Outsourced ${qtyDone} pc(s) from Op${idx + 1} — JW OSP purchase request raised.`);
            setBalanceOpIdx(null);
          }}
        />
      ) : null}

      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 6 }}>
        <button
          type="button"
          className="btn btn-ghost"
          onClick={() => void navigate({ to: '/job-cards' })}
        >
          Cancel
        </button>
        {/* Footer derived from the CALL SITE: addJC L6073 and editJC L6124 both
            pass saveLabel 'Save Job Card' to showModalLg, whose L28042-44 footer
            is Cancel (.btn-ghost) + .btn-success rendering `&#10003; ${label}`
            — the ✓ prefixes even an explicitly-passed label. */}
        <button
          type="button"
          className="btn btn-success"
          disabled={submitting}
          onClick={() => void onSubmit()}
        >
          {submitting ? <Loader2 size={13} className="animate-spin" /> : null} ✓ Save Job Card
        </button>
      </div>
    </div>
  );
}
