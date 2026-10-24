// The Route Card form's operations editor — the table inside the
// "Operation Sequence (n)" panel.
//
// Moved out of route-card-form.tsx for the 2026-10-06 fit-to-one-screen
// layout (pro-routecard-create-edit-mockup.html frames 4 + 5). The columns,
// the per-kind dimming, the "▸ More" drawer and its auto-open rule are the
// ADR-204 editor unchanged. What moved:
//   • the machine's name now sits INSIDE the picker ("CODE — Name", the
//     picker's own row format and the Vendor box's), not on a second line
//     under it, so every op is one line high;
//   • the drawer is one line (label left, box filling the rest);
//   • the Total row is held at the foot of the scrolling table (rc-form.css).
// Tool No. / Tool Details are still NOT rendered (2026-10-03; owner kept that
// on 2026-10-06) — they ride on the draft untouched, see RouteCardFormOpDraft.

import type { Machine, Vendor } from '@innovic/shared';
import { opSrNo } from '@innovic/shared';
import { Fragment, useState } from 'react';
import { QcProcessPicker } from '@/components/shared/qc-process-picker';
import { MachineGroupPicker } from '@/modules/machines/components/machine-group-picker';
import { useVendorsList } from '@/modules/vendors/api';
import { FormField, SearchableSelect } from '@/ui/forms';
import type { RouteCardFormOpDraft } from './route-card-form';

/** Columns in the operations table: Op, Group, Machine / Vendor, Operation,
 *  Cycle Time (min), Program No., Lead Days, actions. The "▸ More" drawer row
 *  spans all but the first, so the two have to agree. */
const RC_OP_COL_COUNT = 8;

interface RouteCardOpsTableProps {
  ops: RouteCardFormOpDraft[];
  machines: Machine[];
  machineGroupCodeById: Map<string, string>;
  totalCycleMin: number;
  totalLeadDays: number;
  onChange: (idx: number, patch: Partial<RouteCardFormOpDraft>) => void;
  onMachineChange: (idx: number, code: string) => void;
  onGroupChange: (idx: number, groupId: string | null) => void;
  onVendorChange: (idx: number, vendor: Vendor | null) => void;
  onRemove: (idx: number) => void;
}

export function RouteCardOpsEditor(props: RouteCardOpsTableProps): React.JSX.Element {
  const {
    ops,
    machines,
    machineGroupCodeById,
    totalCycleMin,
    totalLeadDays,
    onChange,
    onMachineChange,
    onGroupChange,
    onVendorChange,
    onRemove,
  } = props;
  return (
    <table className="innovic-table tbl-ctr tbl-edit tbl-fixed rc-ops">
      {/* Fixed widths from the mock-up; Operation takes what is left. */}
      <colgroup>
        <col style={{ width: 48 }} />
        <col style={{ width: 112 }} />
        <col style={{ width: 230 }} />
        <col />
        <col style={{ width: 124 }} />
        <col style={{ width: 120 }} />
        <col style={{ width: 92 }} />
        <col style={{ width: 116 }} />
      </colgroup>
      <thead>
        <tr>
          <th>Op</th>
          {/* Group replaces the old Type dropdown. The KIND of a row is
              decided by which Add button raised it (Op / OSP / QC) and is
              shown by the row's tint and by the QC / OSP badge in this
              column, exactly as SO Planning does. */}
          <th>Group</th>
          <th>
            Machine / Vendor<span className="req">★</span>
          </th>
          <th>
            Operation<span className="req">★</span>
          </th>
          <th className="th-num">Cycle Time (min)</th>
          <th>Program No.</th>
          <th className="th-num">Lead Days</th>
          <th aria-label="Actions"></th>
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
              machinesList={machines}
              machineGroupCodeById={machineGroupCodeById}
              onChange={(patch) => onChange(idx, patch)}
              onMachineChange={(code) => onMachineChange(idx, code)}
              onGroupChange={(gid) => onGroupChange(idx, gid)}
              onVendorChange={(v) => onVendorChange(idx, v)}
              onRemove={() => onRemove(idx)}
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

/** "CODE — Name", the picker's own row format, so the machine's name reads in
 *  the box itself and the row stays one line high. */
function codeAndName(code: string, name: string | null | undefined): string {
  return name?.trim() ? `${code} — ${name.trim()}` : code;
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
  const pickedMachine = op.machineId ? machinesList.find((m) => m.id === op.machineId) : undefined;
  // Only for an OLD row holding machine text that is not in the Machine
  // Master: the box is empty (nothing to pick), so the warning keeps its own
  // line. Save is off for such a row anyway, with the header naming it.
  const machineWarning =
    !op.machineId && op.machineCodeText.trim()
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
  // "Copy ops from Route Card…" is exactly that case. Null means "the user has
  // not decided for this row", so until they click, the drawer follows the data.
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
                    ? pickedMachine
                      ? codeAndName(pickedMachine.code, pickedMachine.name)
                      : op.machineCodeText
                    : undefined
                }
                selectedLabel={(o) => (o.code ? codeAndName(o.code, o.name) : o.name)}
              />
              {machineWarning ? (
                <div className="text3" style={{ fontSize: 11, marginTop: 2 }}>
                  {machineWarning}
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
          an empty input nobody should fill. Whatever the cell held stays in
          state untouched: dimming must never silently edit the card.
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
        <td className="rc-op-act">
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
            ✕
          </button>
        </td>
      </tr>

      {/* The leading empty <td> is deliberate: it indents the drawer past the
          Op column, the shape Create PO's line detail row uses. The drawer
          holds the op's Remarks only — Tool No. / Tool Details stay off the
          form (owner, 2026-10-06). */}
      {moreOpen ? (
        <tr style={{ background: rowBg }}>
          <td />
          <td colSpan={RC_OP_COL_COUNT - 1} className="rc-op-drw">
            <FormField label="Remarks" htmlFor={`rc-op-rmk-${idx}`}>
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
          </td>
        </tr>
      ) : null}
    </Fragment>
  );
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
