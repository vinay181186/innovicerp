// New Job Card — the operations editor, as ONE table (screen-layout-method
// rule 9: line items are always a table, on create as on view).
//
// It replaces the per-op cards (the old editable op card) the create form used to
// stack. Every control, rule and wording those cards had on a NEW Job Card is
// kept; only the arrangement changed:
//
//   card slot                         → table
//   ──────────────────────────────────────────────────────────────────────
//   seq chip                          → Op (10, 20, 30 — opSrNo)
//   Machine Group picker / QC / OSP   → Group (badge for a QC / outsource row)
//   Machine picker / Vendor picker    → Machine / Vendor ★ ("CODE — Name" in
//                                       the box; the machine's name used to be
//                                       a second cyan line under the picker)
//   Operation input / QC process      → Operation ★ (+ the "QC Required" tag)
//   Setup: Cycle Time (min), Program  → Cycle Time (min), Program No.
//   Setup: Tool No., Tool details     → ▸ More drawer (Create PO's pattern, as
//                                       the Route Card form does)
//   Outsource checkbox · ₹ Cost/pc    → Outsource, Cost/pc
//   ▲ ▼ ✕                             → the actions cell, beside ▸ More
//
// Not carried over, because a NEW Job Card has nothing to show in them: the
// op status badge and the Completed / Pending / QC Pending tiles (every one
// read "—" until the card is saved), and the started-op locks and the
// "Outsource Available" (ADR-081) button, which need a saved, started op.
import type { Machine } from '@innovic/shared';
import { opSrNo } from '@innovic/shared';
import { Fragment, useState } from 'react';
import { QcProcessPicker } from '@/components/shared/qc-process-picker';
import { MachineGroupPicker } from '@/modules/machines/components/machine-group-picker';
import { FormField, SearchableSelect } from '@/ui/forms';

/** One operation row on the create form. Structurally what
 *  `buildJcWriteInput` consumes (it maps the fields it saves one by one, so the
 *  display-only `rowKey` and `machineGroupId` never reach the server). */
export interface JcCreateOp {
  /** DISPLAY-ONLY: a stable React key, so a row's ▸ More drawer and its
   *  pickers move with the row on ▲ / ▼ instead of staying at the index. */
  rowKey: string;
  /** DISPLAY-ONLY, never saved: the Machine GROUP that narrows this row's
   *  machine list (SO Planning / Route Card parity). */
  machineGroupId: string | null;
  machineCode: string;
  operation: string;
  opType: 'process' | 'qc' | 'outsource';
  cycleTimeMin: number;
  program: string;
  toolNo: string;
  toolDetails: string;
  qcRequired: boolean;
  outsourceVendorCode: string;
  outsourceCost: number | null;
}

/** Op, Group, Machine / Vendor, Operation, Cycle Time (min), Program No.,
 *  Outsource, Cost/pc, actions. The ▸ More row spans all but the first. */
const COLS = 9;

type MachineOption = { id: string; code: string; name: string; machineGroupId: string | null };
type VendorOption = { id: string; code: string; name: string };

export interface JcCreateOpsTableProps {
  ops: JcCreateOp[];
  machines: Machine[];
  /** Search-filtered machine options (the host's shared machine search). */
  machineOptions: MachineOption[];
  machineGroupCodeById: Map<string, string>;
  onMachineSearch: (term: string) => void;
  onMachineChange: (idx: number, code: string) => void;
  onGroupChange: (idx: number, groupId: string | null) => void;
  vendorOptions: VendorOption[];
  onVendorSearch: (term: string) => void;
  vendorsLoading: boolean;
  onChange: (idx: number, patch: Partial<JcCreateOp>) => void;
  onMove: (idx: number, dir: -1 | 1) => void;
  onRemove: (idx: number) => void;
}

export function JcCreateOpsTable(props: JcCreateOpsTableProps): React.JSX.Element {
  const { ops } = props;
  return (
    <table className="innovic-table tbl-ctr tbl-edit tbl-fixed jcc-ops">
      <colgroup>
        <col style={{ width: 48 }} />
        <col style={{ width: 112 }} />
        <col style={{ width: 230 }} />
        <col />
        <col style={{ width: 124 }} />
        <col style={{ width: 120 }} />
        <col style={{ width: 104 }} />
        <col style={{ width: 92 }} />
        <col style={{ width: 172 }} />
      </colgroup>
      <thead>
        <tr>
          <th>Op</th>
          <th>Group</th>
          <th>
            Machine / Vendor<span className="req">★</span>
          </th>
          <th>
            Operation<span className="req">★</span>
          </th>
          <th className="th-num">Cycle Time (min)</th>
          <th>Program No.</th>
          <th>Outsource</th>
          <th className="th-num">Cost/pc</th>
          <th aria-label="Actions" />
        </tr>
      </thead>
      <tbody>
        {ops.length === 0 ? (
          <tr>
            <td colSpan={COLS} className="empty-state">
              No operations yet.
            </td>
          </tr>
        ) : (
          ops.map((op, idx) => (
            <OpRow
              key={op.rowKey}
              {...props}
              op={op}
              idx={idx}
              isFirst={idx === 0}
              isLast={idx === ops.length - 1}
            />
          ))
        )}
      </tbody>
    </table>
  );
}

/** "CODE — Name", the picker's own row format, so the name reads in the box
 *  and the row stays one control high. */
function codeAndName(code: string, name: string | null | undefined): string {
  return name?.trim() ? `${code} — ${name.trim()}` : code;
}

function OpRow({
  op,
  idx,
  isFirst,
  isLast,
  machines,
  machineOptions,
  machineGroupCodeById,
  onMachineSearch,
  onMachineChange,
  onGroupChange,
  vendorOptions,
  onVendorSearch,
  vendorsLoading,
  onChange,
  onMove,
  onRemove,
}: JcCreateOpsTableProps & {
  op: JcCreateOp;
  idx: number;
  isFirst: boolean;
  isLast: boolean;
}): React.JSX.Element {
  const isQc = op.opType === 'qc';
  const isOut = op.opType === 'outsource';
  const sr = opSrNo(idx + 1);
  const set = (patch: Partial<JcCreateOp>): void => onChange(idx, patch);
  const machine = op.machineCode ? machines.find((m) => m.code === op.machineCode) : undefined;
  const vendor = op.outsourceVendorCode
    ? vendorOptions.find((v) => v.code === op.outsourceVendorCode)
    : undefined;
  // ▸ More holds Tool No. / Tool Details — a QC row carries neither (the op
  // card drew "—" there), so it has no drawer. It opens by itself when the
  // row already holds one of them (a Route Card copy), so nothing the card
  // will save is hidden on arrival. Derived until the user clicks.
  const [userToggled, setUserToggled] = useState<boolean | null>(null);
  const moreOpen = !isQc && (userToggled ?? Boolean(op.toolNo.trim() || op.toolDetails.trim()));
  const rowCls = isQc ? 'jcc-op-qc' : isOut ? 'jcc-op-osp' : undefined;
  const dash = (title: string): React.JSX.Element => (
    <span className="text3" title={title}>
      —
    </span>
  );

  return (
    <Fragment>
      <tr className={rowCls}>
        <td className="mono fw-700 jcc-op-no">{sr}</td>
        <td>
          {isQc ? (
            <span className="badge b-green">🔬 QC</span>
          ) : isOut ? (
            <span className="badge jcc-osp-badge">🏭 OSP</span>
          ) : (
            <MachineGroupPicker
              id={`jc-edit-mgrp-${idx}`}
              valueId={op.machineGroupId}
              valueText={
                op.machineGroupId ? (machineGroupCodeById.get(op.machineGroupId) ?? null) : null
              }
              onChange={(gid) => onGroupChange(idx, gid)}
            />
          )}
        </td>
        <td>
          {isQc ? (
            dash('An inspection has no machine')
          ) : isOut ? (
            <SearchableSelect
              id={`jc-edit-vend-${idx}`}
              value={vendor?.id ?? null}
              onChange={(id) =>
                set({
                  outsourceVendorCode: id
                    ? (vendorOptions.find((v) => v.id === id)?.code ?? '')
                    : '',
                })
              }
              onSearch={onVendorSearch}
              loading={vendorsLoading}
              options={vendorOptions}
              placeholder="🔍 Vendor"
              // "CODE — Name" for the picked vendor, so the name is visible
              // after selection, not just the code.
              valueLabel={
                op.outsourceVendorCode
                  ? vendor
                    ? codeAndName(vendor.code, vendor.name)
                    : op.outsourceVendorCode
                  : undefined
              }
              selectedLabel={(v) => (v.code ? codeAndName(v.code, v.name) : v.name)}
            />
          ) : (
            <SearchableSelect
              id={`jc-edit-mach-${idx}`}
              value={machine?.id ?? null}
              onChange={(id) =>
                onMachineChange(idx, id ? (machines.find((m) => m.id === id)?.code ?? '') : '')
              }
              onSearch={onMachineSearch}
              // Narrowed to the row's group once one is chosen — as SO Planning
              // does — so the planner cannot pick a lathe under a VMC group.
              options={
                op.machineGroupId
                  ? machineOptions.filter((m) => m.machineGroupId === op.machineGroupId)
                  : machineOptions
              }
              placeholder={op.machineGroupId ? '🔍 Machine in group ★' : '🔍 Machine ★'}
              valueLabel={
                op.machineCode
                  ? machine
                    ? codeAndName(machine.code, machine.name)
                    : op.machineCode
                  : undefined
              }
              selectedLabel={(m) => (m.code ? codeAndName(m.code, m.name) : (m.name ?? ''))}
            />
          )}
        </td>
        <td>
          {/* A QC step's name comes from the QC Process master; an in-house
              or outsourced operation name stays free text. */}
          {isQc ? (
            <QcProcessPicker
              id={`jc-edit-qcproc-${idx}`}
              value={op.operation}
              onChange={(code) => set({ operation: code })}
            />
          ) : (
            <div className="jcc-op-name">
              <input
                className="innovic-input"
                value={op.operation}
                placeholder="Operation name ★"
                aria-label={`Operation, op ${sr}`}
                onChange={(e) => set({ operation: e.target.value })}
              />
              {op.qcRequired ? <span className="tag jcc-qc-tag">QC Required</span> : null}
            </div>
          )}
        </td>
        <td className="td-num">
          <input
            type="number"
            min={0}
            step="0.01"
            className="innovic-input"
            aria-label={`Cycle Time (min), op ${sr}`}
            value={op.cycleTimeMin || ''}
            onChange={(e) => set({ cycleTimeMin: Number(e.target.value) })}
          />
        </td>
        <td>
          {/* QC rows carry no program / tool details (legacy `emptyCells`). */}
          {isQc ? (
            dash('An inspection carries no program')
          ) : (
            <input
              className="innovic-input"
              value={op.program}
              placeholder="CNC program"
              aria-label={`Program No., op ${sr}`}
              onChange={(e) => set({ program: e.target.value })}
            />
          )}
        </td>
        <td>
          {isQc ? (
            dash('An inspection is not outsourced')
          ) : (
            <label
              className={`jcc-osp-tick${isOut ? ' is-on' : ''}`}
              title="Outsource this operation"
            >
              <input
                type="checkbox"
                checked={isOut}
                onChange={(e) => set({ opType: e.target.checked ? 'outsource' : 'process' })}
              />
              Outsource
            </label>
          )}
        </td>
        <td className="td-num">
          {/* null = money hidden for this viewer: the cost box is not drawn. */}
          {isOut && op.outsourceCost !== null ? (
            <input
              type="number"
              min={0}
              step="0.01"
              className="innovic-input"
              value={op.outsourceCost || ''}
              placeholder="₹ Cost/pc"
              aria-label={`Cost/pc, op ${sr}`}
              onChange={(e) => set({ outsourceCost: Number(e.target.value) })}
            />
          ) : (
            dash('Cost/pc belongs to an outsourced operation')
          )}
        </td>
        <td className="jcc-op-act">
          <button
            type="button"
            className="btn btn-ghost btn-sm btn-icon"
            disabled={isFirst}
            onClick={() => onMove(idx, -1)}
            title="Move up"
            aria-label={`Move operation ${sr} up`}
          >
            ▲
          </button>
          <button
            type="button"
            className="btn btn-ghost btn-sm btn-icon"
            disabled={isLast}
            onClick={() => onMove(idx, 1)}
            title="Move down"
            aria-label={`Move operation ${sr} down`}
          >
            ▼
          </button>
          {!isQc ? (
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              aria-expanded={moreOpen}
              aria-label={`${moreOpen ? 'Hide' : 'Show'} more fields, operation ${sr}`}
              onClick={() => setUserToggled(!moreOpen)}
            >
              {moreOpen ? '▾' : '▸'} More
            </button>
          ) : null}
          <button
            type="button"
            className="btn btn-danger btn-sm btn-icon"
            onClick={() => onRemove(idx)}
            title="Remove"
            aria-label={`Remove operation ${sr}`}
          >
            ✕
          </button>
        </td>
      </tr>
      {/* The leading empty <td> indents the drawer past the Op column — the
          shape Create PO's line detail row and the Route Card form use. */}
      {moreOpen ? (
        <tr className={rowCls}>
          <td />
          <td colSpan={COLS - 1} className="jcc-op-drw">
            <div className="jcc-op-drw-in">
              {/* `jc_ops.tool_no` — the write path (build-jc-write-input)
                  carries it; 120 is the box's limit, as on the op card. */}
              <FormField
                label="Tool No."
                htmlFor={`jc-op-tool-${op.rowKey}`}
                className="jcc-tool-no"
              >
                <input
                  id={`jc-op-tool-${op.rowKey}`}
                  className="innovic-input"
                  value={op.toolNo}
                  placeholder="Tool no."
                  maxLength={120}
                  autoComplete="off"
                  onChange={(e) => set({ toolNo: e.target.value })}
                />
              </FormField>
              <FormField
                label="Tool Details"
                htmlFor={`jc-op-tooldet-${op.rowKey}`}
                className="jcc-tool-det"
              >
                <input
                  id={`jc-op-tooldet-${op.rowKey}`}
                  className="innovic-input"
                  value={op.toolDetails}
                  placeholder="Insert, fixtures, setup notes"
                  autoComplete="off"
                  onChange={(e) => set({ toolDetails: e.target.value })}
                />
              </FormField>
            </div>
          </td>
        </tr>
      ) : null}
    </Fragment>
  );
}
