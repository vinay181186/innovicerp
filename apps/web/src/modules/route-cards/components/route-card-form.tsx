// Shared Route Card form used by create + edit routes.
//
// Header: RC No (auto on create), Item picker (one active RC per item),
// optional notes, revision indicator.
//
// Op editor: per-row Machine / Operation / Cycle(h) / Program /
// Tool fields + Add Op / Add OSP Op / Add QC Op buttons. Mirrors legacy
// rcOpsHtml (L10208), which is the single op renderer shared by BOTH
// legacy entry points — addRouteCard() (L6939, via _rcCheckExisting
// L6994) and editRouteCard() (L10169, direct call at L10198). That
// shared renderer is why legacy's two modes are field-identical.

import type { CreateRouteCardOpInput, Item, Machine, RouteCard, Vendor } from '@innovic/shared';
import { Plus, Trash2 } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useItemsList } from '@/modules/items/api';
import { useMachinesList } from '@/modules/machines/api';
import { useVendorsList } from '@/modules/vendors/api';
import { useNextRouteCardCode } from '../api';

export type RouteCardOpType = 'process' | 'qc' | 'outsource';

export interface RouteCardFormOpDraft {
  // Resolved on machine-code change (or null when QC/OSP).
  machineId: string;
  machineCodeText: string; // displayed value; also stored as fallback
  operation: string;
  opType: RouteCardOpType;
  cycleTimeMin: string; // legacy unit: HOURS
  program: string;
  toolNo: string;
  toolDetails: string;
  qcRequired: boolean;
  // OSP-only fields. Resolved on vendor-code change.
  ospVendorId: string;
  ospVendorCodeText: string;
  ospLeadDays: string;
}

export interface RouteCardFormHeaderDraft {
  code: string;
  itemId: string;
  itemCodeText: string; // displayed value
  notes: string;
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
}

const OP_TYPE_OPTIONS: ReadonlyArray<{ value: RouteCardOpType; label: string }> = [
  { value: 'process', label: '⚙️ Process' },
  { value: 'qc', label: '🔬 QC' },
  { value: 'outsource', label: '🏭 OSP' },
];

export function emptyProcessOp(): RouteCardFormOpDraft {
  return {
    machineId: '',
    machineCodeText: '',
    operation: '',
    opType: 'process',
    // Legacy renders `${op.cycleTime||''}` with a "hrs" placeholder (L10216 /
    // L10240) — a blank cell, not a literal 0. opsToInput coerces '' → 0.
    cycleTimeMin: '',
    program: '',
    toolNo: '',
    toolDetails: '',
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
  } = props;
  const [header, setHeader] = useState<RouteCardFormHeaderDraft>(initialHeader);
  const [ops, setOps] = useState<RouteCardFormOpDraft[]>(initialOps);
  const [revisionNote, setRevisionNote] = useState('');

  const { data: itemsList } = useItemsList({ limit: 1000, offset: 0 });
  const { data: machinesList } = useMachinesList({ limit: 500, offset: 0 });
  const { data: vendorsList } = useVendorsList({ limit: 500, offset: 0 });

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

  const itemsByCode = useMemo(() => {
    const m = new Map<string, Item>();
    for (const i of itemsList?.items ?? []) m.set(i.code.toUpperCase(), i);
    return m;
  }, [itemsList]);

  const machinesByCode = useMemo(() => {
    const m = new Map<string, Machine>();
    for (const x of machinesList?.machines ?? []) m.set(x.code.toUpperCase(), x);
    return m;
  }, [machinesList]);

  const vendorsByCode = useMemo(() => {
    const m = new Map<string, Vendor>();
    for (const x of vendorsList?.vendors ?? []) m.set(x.code.toUpperCase(), x);
    return m;
  }, [vendorsList]);

  const onItemCodeChange = (code: string): void => {
    const match = itemsByCode.get(code.trim().toUpperCase());
    setHeader({ ...header, itemCodeText: code, itemId: match?.id ?? '' });
  };

  const updateOp = (idx: number, patch: Partial<RouteCardFormOpDraft>): void => {
    setOps((prev) => prev.map((o, i) => (i === idx ? { ...o, ...patch } : o)));
  };

  const onOpMachineChange = (idx: number, code: string): void => {
    const match = machinesByCode.get(code.trim().toUpperCase());
    updateOp(idx, { machineCodeText: code, machineId: match?.id ?? '' });
  };

  const onOpVendorChange = (idx: number, code: string): void => {
    const match = vendorsByCode.get(code.trim().toUpperCase());
    updateOp(idx, { ospVendorCodeText: code, ospVendorId: match?.id ?? '' });
  };

  const addOp = (kind: RouteCardOpType): void => {
    setOps((prev) => [
      ...prev,
      kind === 'qc' ? emptyQcOp() : kind === 'outsource' ? emptyOspOp() : emptyProcessOp(),
    ]);
  };
  const removeOp = (idx: number): void => setOps((prev) => prev.filter((_, i) => i !== idx));

  const validationError = useMemo<string | null>(() => {
    if (!header.itemId) return 'Pick an item code from the master list';
    if (ops.length === 0) return 'Add at least one operation';
    for (let i = 0; i < ops.length; i++) {
      const o = ops[i]!;
      if (!o.operation.trim()) return `Op ${i + 1}: operation name is required`;
      if (o.opType === 'process' && !o.machineId && !o.machineCodeText.trim()) {
        return `Op ${i + 1}: process steps need a machine`;
      }
      if (o.opType === 'outsource' && !o.ospVendorId && !o.ospVendorCodeText.trim()) {
        return `Op ${i + 1}: outsource steps need a vendor`;
      }
      const cycle = Number(o.cycleTimeMin);
      if (!Number.isFinite(cycle) || cycle < 0) {
        return `Op ${i + 1}: cycle time must be a non-negative number`;
      }
      if (o.ospLeadDays.trim()) {
        const lead = Number(o.ospLeadDays);
        if (!Number.isInteger(lead) || lead < 0) {
          return `Op ${i + 1}: lead days must be a non-negative integer`;
        }
      }
    }
    return null;
  }, [header, ops]);

  const submit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    if (validationError) return;
    await onSubmit(
      header,
      ops,
      mode === 'edit' && revisionNote.trim() ? revisionNote.trim() : null,
    );
  };

  return (
    <form onSubmit={(e) => void submit(e)}>
      <div className="panel">
        <div className="panel-hdr">
          <div className="panel-title">
            {mode === 'create'
              ? '➕ New Route Card'
              : `Edit Route Card — ${routeCard?.code ?? ''}`}
          </div>
        </div>
        <div className="panel-body">
          <div className="form-grid">
            <div className="form-grp">
              <span className="form-label">RC No.</span>
              <input
                className="innovic-input"
                value={header.code}
                onChange={(e) => setHeader({ ...header, code: e.target.value })}
                placeholder={mode === 'create' ? 'IN-RC-NNNNN (auto if blank)' : ''}
              />
            </div>
            <div className="form-grp">
              <span className="form-label">
                Item Code<span className="req">★</span>
              </span>
              <input
                className="innovic-input"
                list="rc-items-dl"
                value={header.itemCodeText}
                onChange={(e) => onItemCodeChange(e.target.value)}
                placeholder="🔍 Search item code or name…"
              />
              {header.itemId ? (
                <div className="text3" style={{ fontSize: 11, marginTop: 2 }}>
                  ✓ {(itemsList?.items ?? []).find((i) => i.id === header.itemId)?.name ?? ''}
                </div>
              ) : header.itemCodeText.trim() ? (
                <div style={{ color: 'var(--red)', fontSize: 11, marginTop: 2 }}>
                  ⚠ not found in item master
                </div>
              ) : null}
            </div>
            <div className="form-grp form-full">
              <span className="form-label">Notes</span>
              <input
                className="innovic-input"
                value={header.notes}
                onChange={(e) => setHeader({ ...header, notes: e.target.value })}
                placeholder="Optional manufacturing notes…"
              />
            </div>
            {mode === 'edit' && routeCard ? (
              <div className="form-grp">
                <span className="form-label">Revision</span>
                <div
                  className="mono fw-700"
                  style={{ color: 'var(--amber)', paddingTop: 7, fontSize: 14 }}
                >
                  Rev {routeCard.currentRevision} →{' '}
                  <span style={{ color: 'var(--green)' }}>Rev {routeCard.currentRevision + 1}</span>
                </div>
              </div>
            ) : null}
          </div>
        </div>
      </div>

      <div className="panel">
        <div className="panel-hdr">
          <div className="panel-title">⚙️ Route Sequence ({ops.length})</div>
          <div style={{ display: 'flex', gap: 6 }}>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => addOp('process')}>
              <Plus size={13} /> Add Op
            </button>
            <button
              type="button"
              className="btn btn-sm"
              style={{
                background: 'rgba(124,58,237,0.08)',
                color: 'var(--purple)',
                border: '1px solid rgba(124,58,237,0.25)',
              }}
              onClick={() => addOp('outsource')}
            >
              <Plus size={13} /> Add OSP Op
            </button>
            <button
              type="button"
              className="btn btn-sm"
              style={{
                background: 'rgba(34,197,94,0.08)',
                color: 'var(--green)',
                border: '1px solid rgba(34,197,94,0.25)',
              }}
              onClick={() => addOp('qc')}
            >
              <Plus size={13} /> Add QC Op
            </button>
          </div>
        </div>
        <div className="tbl-wrap">
          <table className="innovic-table">
            <thead>
              <tr>
                <th style={{ width: 36 }}>#</th>
                <th style={{ width: 100 }}>Type</th>
                <th style={{ width: 150 }}>Machine / Vendor ★</th>
                <th>Operation ★</th>
                <th className="text3" style={{ width: 90 }}>
                  Cycle(h)
                </th>
                <th style={{ width: 90 }}>Program / Lead</th>
                <th className="cyan" style={{ width: 90 }}>
                  Tool No.
                </th>
                <th>Tool Details</th>
                <th style={{ width: 44 }}></th>
              </tr>
            </thead>
            <tbody>
              {ops.length === 0 ? (
                <tr>
                  <td colSpan={9} className="empty-state">
                    No operations yet — click <strong>+ Add Op</strong> / <strong>+ QC Step</strong>{' '}
                    / <strong>+ OSP Step</strong>.
                  </td>
                </tr>
              ) : (
                ops.map((op, idx) => (
                  <RouteCardOpRow
                    key={idx}
                    idx={idx}
                    op={op}
                    machinesList={machinesList?.machines ?? []}
                    vendorsList={vendorsList?.vendors ?? []}
                    onChange={(patch) => updateOp(idx, patch)}
                    onMachineChange={(code) => onOpMachineChange(idx, code)}
                    onVendorChange={(code) => onOpVendorChange(idx, code)}
                    onRemove={() => removeOp(idx)}
                  />
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      <datalist id="rc-items-dl">
        {(itemsList?.items ?? []).map((i) => (
          <option key={i.id} value={i.code}>
            {i.name}
          </option>
        ))}
      </datalist>
      <datalist id="rc-machines-dl">
        {(machinesList?.machines ?? []).map((m) => (
          <option key={m.id} value={m.code}>
            {m.name}
          </option>
        ))}
      </datalist>
      <datalist id="rc-vendors-dl">
        {(vendorsList?.vendors ?? []).map((v) => (
          <option key={v.id} value={v.code}>
            {v.name}
          </option>
        ))}
      </datalist>

      {mode === 'edit' ? (
        <div className="panel">
          <div className="panel-hdr">
            <div className="panel-title">📋 Revision Note</div>
          </div>
          <div className="panel-body">
            <textarea
              className="innovic-textarea"
              rows={2}
              value={revisionNote}
              onChange={(e) => setRevisionNote(e.target.value)}
              placeholder="Auto-generated diff note will be used if blank. Override here for ECO numbers etc."
            />
          </div>
        </div>
      ) : null}

      {validationError ? <div className="form-error">{validationError}</div> : null}
      {submitError ? <div className="form-error">{submitError}</div> : null}

      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 6 }}>
        <button type="button" className="btn btn-ghost" onClick={onCancel}>
          Cancel
        </button>
        <button
          type="submit"
          className="btn btn-primary"
          disabled={Boolean(validationError) || submitting}
        >
          {submitting ? 'Saving…' : '✓ Save Route Card'}
        </button>
      </div>
    </form>
  );
}

interface RouteCardOpRowProps {
  idx: number;
  op: RouteCardFormOpDraft;
  machinesList: Machine[];
  vendorsList: Vendor[];
  onChange: (patch: Partial<RouteCardFormOpDraft>) => void;
  onMachineChange: (code: string) => void;
  onVendorChange: (code: string) => void;
  onRemove: () => void;
}

function RouteCardOpRow(props: RouteCardOpRowProps): React.JSX.Element {
  const {
    idx,
    op,
    machinesList,
    vendorsList,
    onChange,
    onMachineChange,
    onVendorChange,
    onRemove,
  } = props;
  const rowBg =
    op.opType === 'qc'
      ? 'rgba(34,197,94,0.06)'
      : op.opType === 'outsource'
        ? 'rgba(124,58,237,0.06)'
        : undefined;
  const accent =
    op.opType === 'qc'
      ? 'var(--green)'
      : op.opType === 'outsource'
        ? 'var(--purple)'
        : 'var(--text3)';
  const machineLabel = op.machineId
    ? machinesList.find((m) => m.id === op.machineId)?.name
    : op.machineCodeText.trim()
      ? '⚠ not in master'
      : null;
  const vendorLabel = op.ospVendorId
    ? vendorsList.find((v) => v.id === op.ospVendorId)?.name
    : op.ospVendorCodeText.trim()
      ? '⚠ not in master'
      : null;
  return (
    <tr style={{ background: rowBg }}>
      <td className="td-ctr mono fw-700" style={{ color: accent }}>
        {idx + 1}
      </td>
      <td>
        <select
          className="innovic-select"
          value={op.opType}
          onChange={(e) => onChange({ opType: e.target.value as RouteCardOpType })}
          style={{ fontSize: 11 }}
        >
          {OP_TYPE_OPTIONS.map((t) => (
            <option key={t.value} value={t.value}>
              {t.label}
            </option>
          ))}
        </select>
      </td>
      <td>
        {op.opType === 'outsource' ? (
          <>
            <input
              className="innovic-input"
              list="rc-vendors-dl"
              value={op.ospVendorCodeText}
              onChange={(e) => onVendorChange(e.target.value)}
              placeholder="🔍 Vendor code"
              style={{ fontSize: 12, color: 'var(--purple)' }}
            />
            {vendorLabel ? (
              <div className="text3" style={{ fontSize: 10, marginTop: 2 }}>
                {vendorLabel}
              </div>
            ) : null}
          </>
        ) : op.opType === 'qc' ? (
          <span className="badge b-green" style={{ fontSize: 10 }}>
            QC
          </span>
        ) : (
          <>
            <input
              className="innovic-input"
              list="rc-machines-dl"
              value={op.machineCodeText}
              onChange={(e) => onMachineChange(e.target.value)}
              placeholder="🔍 Machine code"
              style={{ fontSize: 12 }}
            />
            {machineLabel ? (
              <div className="text3" style={{ fontSize: 10, marginTop: 2 }}>
                {machineLabel}
              </div>
            ) : null}
          </>
        )}
      </td>
      <td>
        <input
          className="innovic-input"
          value={op.operation}
          onChange={(e) => onChange({ operation: e.target.value })}
          placeholder={
            op.opType === 'qc'
              ? 'DIR / MIR / TPI…'
              : op.opType === 'outsource'
                ? 'Coating / Painting / HT…'
                : 'od turn, mill, drill…'
          }
          style={{ fontSize: 12 }}
        />
      </td>
      <td>
        <input
          type="number"
          min="0"
          step="0.01"
          className="innovic-input"
          value={op.cycleTimeMin}
          onChange={(e) => onChange({ cycleTimeMin: e.target.value })}
          placeholder="hrs"
          style={{ textAlign: 'right' }}
        />
      </td>
      <td>
        {op.opType === 'outsource' ? (
          <input
            type="number"
            min="0"
            step="1"
            className="innovic-input"
            value={op.ospLeadDays}
            onChange={(e) => onChange({ ospLeadDays: e.target.value })}
            placeholder="days"
            style={{ textAlign: 'right' }}
            title="Lead time in days"
          />
        ) : (
          <input
            className="innovic-input"
            value={op.program}
            onChange={(e) => onChange({ program: e.target.value })}
            placeholder="PRG-001"
            style={{ fontSize: 12, color: 'var(--blue)' }}
          />
        )}
      </td>
      <td>
        <input
          className="innovic-input"
          value={op.toolNo}
          onChange={(e) => onChange({ toolNo: e.target.value })}
          placeholder="T01"
          style={{ fontSize: 12, color: 'var(--cyan)' }}
        />
      </td>
      <td>
        <input
          className="innovic-input"
          value={op.toolDetails}
          onChange={(e) => onChange({ toolDetails: e.target.value })}
          placeholder="Setup notes…"
          style={{ fontSize: 12, color: 'var(--text2)' }}
        />
      </td>
      <td>
        <button
          type="button"
          className="btn btn-danger btn-sm btn-icon"
          onClick={onRemove}
          title="Remove operation"
        >
          <Trash2 size={12} />
        </button>
      </td>
    </tr>
  );
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
    toolNo: o.toolNo.trim() || null,
    toolDetails: o.toolDetails.trim() || null,
    qcRequired: o.qcRequired,
    ospVendorId: o.opType === 'outsource' ? o.ospVendorId || null : null,
    ospVendorCodeText:
      o.opType === 'outsource' ? (o.ospVendorId ? null : o.ospVendorCodeText.trim() || null) : null,
    ospLeadDays:
      o.opType === 'outsource' && o.ospLeadDays.trim() ? Number(o.ospLeadDays) || null : null,
  }));
}
