// Edit Job Card — one operation ROW (+ its ▸ detail row) of the editable
// operations table (jc-edit-ops-table.tsx).
//
// The per-op editor that used to be a card (the old editable op card, since
// deleted — Create has its own table, jc-create-ops-table.tsx) laid out as a
// table row, the shape the detail page's operations table has. Every input,
// picker id, placeholder, disabled rule and read-only figure is the card's,
// unchanged:
//
//   card slot                          → here
//   ──────────────────────────────────────────────────────────────────────
//   seq chip                           → Op
//   operation input / QC process       → Operation            (row)
//   Machine Group picker               → Group                (row)
//   machine picker / OSP vendor        → Machine / Vendor     (row)
//   Cycle Time (min) · Program         → their columns        (row)
//   Outsource tick / 🏭 Outsource Available → Outsource       (row)
//   status badge                       → Op Status            (row)
//   ▲ ▼ ✕                              → ⋯ (Move up · Move down · Remove)
//   Tool No. · Tool details · ₹ Cost/pc → ▸ detail            (inputs)
//   Quantities · QC Required · Recent Logs → ▸ detail         (read-only)
//
// Rules kept from the card:
//   - started op: no re-sequence, no removal
//   - started op: in-house ↔ outsource retype locked (ADR-081)
//   - started in-house op with available > 0: 🏭 Outsource Available opens the
//     Outsource balance modal instead of the tick (ADR-081)
//   - QC op: no machine, no program / tool fields, no outsource
// Added by ADR-227:
//   - the trailing system-added Final Inspection: the WHOLE row is read-only —
//     name, Cycle Time and type — and Remove plus the swaps that would displace
//     it are greyed with the reason. The server re-derives that op on every save
//     and strips it out of the edit comparison altogether, so ANY box left
//     writable on it is a box whose typing is thrown away: with the approval
//     gate ON the save dies as "Nothing changed to approve", with the gate OFF
//     the same keystroke saves. Nothing on this row may be editable.
//   - OSP op: no machine; vendor + cost; cost hidden when the server masks
//     money for this viewer (outsourceCost === null)
//   - group narrows the machine list
import type { JcOpEnriched, OpLog } from '@innovic/shared';
import { fmtOpSrNo, SHIFT_LABELS } from '@innovic/shared';
import { QcProcessPicker } from '@/components/shared/qc-process-picker';
import { SearchableSelect } from '@/components/shared/searchable-select';
import { fmtDate } from '@/lib/date';
import { MachineGroupPicker } from '@/modules/machines/components/machine-group-picker';
import { RowMenu } from '@/ui/data';
import { cx } from '@/ui/forms/class-names';
import { OP_STATUS } from '../lib/jc-op-labels';

/** Editable op row shape. `hasStarted` locks re-sequence/removal/retype;
 *  `available` drives the ADR-081 outsource-balance action. Structurally the
 *  same values `buildJcWriteInput` consumes — it maps the fields it saves one
 *  by one, so the display-only `rowKey` and `machineGroupId` never reach the
 *  server. */
export interface JcOpEditValues {
  /** DISPLAY-ONLY, never saved: a stable React key for the row — the op id for
   *  a saved op, a client-made `new-N` for one added on this screen — so a
   *  row's ▸ open state and its inputs move with it on Move up / down instead
   *  of staying at the position (as Create's JcCreateOp.rowKey). */
  rowKey: string;
  id?: string;
  /** DISPLAY-ONLY, never saved: the op's STORED `jc_ops.op_seq`, as loaded.
   *  Absent on a row added on this screen (it has no stored number yet). This
   *  is what the Op No. cell shows, because every refusal the server sends back
   *  quotes the STORED number — "Cannot move Op 20 — it already has logged
   *  work." — and a number worked out from the row's position on screen would
   *  point the person at a different row than the message means. Save renumbers
   *  the routing from the on-screen order, so this value can go stale the moment
   *  a row is removed; that is accepted, because it is the number the server
   *  will name until the save succeeds. */
  opSeq?: number;
  // DISPLAY-ONLY, never saved: the Machine GROUP that narrows this row's machine
  // list, exactly as SO Planning / Route Card do. jc_ops has no group column —
  // the machine carries its group in the master, so the group is re-read from the
  // picked machine each time the screen opens (the host back-fills it on load).
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
  // null = money hidden for this viewer (masked server-side); the cost input is
  // then not drawn.
  outsourceCost: number | null;
  hasStarted: boolean;
  available: number;
}

/** Columns of the edit table — the ▸ detail row spans them all. */
export const EDIT_COLS = 10;

export interface JcEditOpRowProps {
  op: JcOpEditValues;
  index: number;
  /** The op's STORED sequence (`jc_ops.op_seq`), shown in tens (ADR-227), or
   *  null for a row added on this screen — which shows no number at all.
   *
   *  It is deliberately NOT the row's position. Every refusal the server sends
   *  back names the STORED op ("Cannot move Op 20 — it already has logged
   *  work."), so a position-derived number can point at the wrong row: remove
   *  the first of [Turning 10, Milling 20 (started), Final Inspection 30] and
   *  positions renumber Milling to 10 and the inspection to 20 — the refusal
   *  about Milling then reads as if it were about the inspection. A misleading
   *  number on an error is worse than a repeated one on a label. A brand-new row
   *  has no stored number, so it shows none rather than borrowing a position. */
  seqLabel: number | null;
  enriched: JcOpEnriched | undefined;
  /** Latest first, already cut to 3 (as the card showed). */
  logs: OpLog[];
  machines: { id: string; code: string; name: string }[];
  machineOptions: { id: string; code: string; name: string; machineGroupId: string | null }[];
  machineGroupCodeById: Map<string, string>;
  onMachineSearch: (term: string) => void;
  vendorOptions: { id: string; code: string; name: string }[];
  onVendorSearch: (term: string) => void;
  vendorsLoading: boolean;
  isFirst: boolean;
  isLast: boolean;
  /** ADR-227: this row IS the trailing system-added Final Inspection. The system
   *  appends it, re-derives it on save and needs it last, so this one flag turns
   *  off everything the server would refuse on it: Move up (it would come off the
   *  end of the routing), Remove, and editing its Operation / type. The rest of
   *  the row (cycle time, the started-op rules) behaves as any other row. */
  isPinnedFinalQc: boolean;
  /** ADR-227: the row directly BELOW this one is that Final Inspection — so Move
   *  down would push this operation past the inspection. */
  isAbovePinnedFinalQc: boolean;
  open: boolean;
  flash: boolean;
  rowRef: ((el: HTMLTableRowElement | null) => void) | undefined;
  onToggle: () => void;
  onChange: (patch: Partial<JcOpEditValues>) => void;
  onMachineChange: (code: string) => void;
  onGroupChange: (groupId: string | null) => void;
  onMove: (dir: -1 | 1) => void;
  onRemove: () => void;
  onOutsourceBalance: () => void;
}

/** ADR-227: the ONE reason the pinned Final Inspection row gives for the three
 *  things it will not let the person do — rename it, change its type, remove it.
 *  The server's own words for all three are "Final Inspection is added by the
 *  system and cannot be renamed / removed here." */
const PINNED_FINAL_QC_REASON = 'Final Inspection is added by the system';

/** "CODE — Name", the picker's own row format, so a row stays one line high. */
function codeAndName(code: string, name: string | null | undefined): string {
  return name?.trim() ? `${code} — ${name.trim()}` : code;
}

export function JcEditOpRow(props: JcEditOpRowProps): React.JSX.Element {
  const {
    op,
    index,
    seqLabel,
    enriched: en,
    machines,
    machineOptions,
    machineGroupCodeById,
    onMachineSearch,
    vendorOptions,
    onVendorSearch,
    vendorsLoading,
    isFirst,
    isLast,
    isPinnedFinalQc,
    isAbovePinnedFinalQc,
    open,
    flash,
    rowRef,
    onToggle,
    onChange,
    onMachineChange,
    onGroupChange,
    onMove,
    onRemove,
    onOutsourceBalance,
  } = props;
  const isQc = op.opType === 'qc';
  const isOut = op.opType === 'outsource';
  const kind = isQc ? 'qc' : isOut ? 'osp' : 'mc';
  const key = op.id ?? index;
  const st = en
    ? (OP_STATUS[en.computedStatus] ?? { label: en.computedStatus, cls: 'b-grey' })
    : null;
  const machine = machines.find((m) => m.code === op.machineCode);
  const vendor = vendorOptions.find((v) => v.code === op.outsourceVendorCode);
  // The Op No. shown in the cell: the stored number in tens, or an em dash on a
  // row that has never been saved (it gets its number when Save renumbers the
  // routing). `opRef` is how the row is NAMED in hover text, field labels and
  // the ⋯ menu, so a numberless row still reads as a sentence.
  const opNo = seqLabel == null ? '—' : fmtOpSrNo(seqLabel);
  const opRef = seqLabel == null ? 'the new operation' : `operation ${opNo}`;
  const menuLabel = seqLabel == null ? 'New operation actions' : `Op ${opNo} actions`;

  return (
    <>
      <tr
        ref={rowRef}
        className={cx(isQc && 'jc-ops-qc', isOut && 'jc-ops-osp', flash && 'jc-edit-flash')}
      >
        <td className="jc-ops-exp">
          <button
            type="button"
            aria-expanded={open}
            aria-label={`${open ? 'Hide' : 'Show'} more for ${opRef}`}
            title={
              open ? 'Hide detail' : 'Tool No., tool details, cost, quantities and recent logs'
            }
            onClick={onToggle}
          >
            {open ? '▾' : '▸'}
          </button>
        </td>
        <td className={`mono fw-700 jc-ops-opn jc-ops-k-${kind}`}>
          {seqLabel == null ? (
            <span className="text3" title="This operation is numbered when you Save">
              —
            </span>
          ) : (
            opNo
          )}
        </td>
        <td>
          {/* A QC step's name comes from the QC Process master; an in-house
              or outsource operation name is free text (no master for it).
              ADR-227: the system's own trailing Final Inspection is the one
              exception — the server appends it and re-derives its name on every
              save, so a rename is refused ("Final Inspection is added by the
              system and cannot be renamed here."). It is therefore shown the way
              every other value the person may not change is shown: the app's
              read-only field (grey fill, full-strength text), not a picker that
              could only fail at Save. */}
          {isQc ? (
            isPinnedFinalQc ? (
              <input
                className="innovic-input"
                readOnly
                value={op.operation}
                aria-label={`Operation name, ${opRef}`}
                title={PINNED_FINAL_QC_REASON}
              />
            ) : (
              <QcProcessPicker
                id={`jc-edit-qcproc-${key}`}
                value={op.operation}
                onChange={(code) => onChange({ operation: code })}
              />
            )
          ) : (
            <input
              className="innovic-input"
              value={op.operation}
              placeholder="Operation name ★"
              aria-label={`Operation name, ${opRef}`}
              onChange={(e) => onChange({ operation: e.target.value })}
            />
          )}
        </td>
        <td>
          {isQc ? (
            // The op's TYPE. A QC step already shows it as a fixed badge (only a
            // machining op can be retyped, via the Outsource tick, and that tick
            // is not drawn on a QC row) — on the pinned Final Inspection the
            // hover text says WHY it is fixed (ADR-227: retyping it is refused
            // by the same server check as renaming it).
            <span
              className="badge b-green"
              title={isPinnedFinalQc ? PINNED_FINAL_QC_REASON : undefined}
            >
              QC
            </span>
          ) : isOut ? (
            <span className="badge b-purple">Outsource</span>
          ) : (
            // Display-only: narrows the machine list; never saved.
            <MachineGroupPicker
              id={`jc-edit-mgrp-${key}`}
              valueId={op.machineGroupId}
              valueText={
                op.machineGroupId ? (machineGroupCodeById.get(op.machineGroupId) ?? null) : null
              }
              onChange={onGroupChange}
            />
          )}
        </td>
        <td>
          {isQc ? (
            <span className="text3" title="A QC step has no machine">
              —
            </span>
          ) : isOut ? (
            <SearchableSelect
              id={`jc-edit-vend-${key}`}
              value={vendor?.id ?? null}
              onChange={(id) =>
                onChange({
                  outsourceVendorCode: id
                    ? (vendorOptions.find((v) => v.id === id)?.code ?? '')
                    : '',
                })
              }
              onSearch={onVendorSearch}
              loading={vendorsLoading}
              options={vendorOptions}
              placeholder="🔍 Vendor"
              valueLabel={
                op.outsourceVendorCode
                  ? vendor
                    ? `${vendor.code} — ${vendor.name}`
                    : op.outsourceVendorCode
                  : undefined
              }
              selectedLabel={(v) => (v.code ? `${v.code} — ${v.name}` : v.name)}
            />
          ) : (
            <SearchableSelect
              id={`jc-edit-mach-${key}`}
              value={machine?.id ?? null}
              onChange={(id) =>
                onMachineChange(id ? (machines.find((m) => m.id === id)?.code ?? '') : '')
              }
              onSearch={onMachineSearch}
              options={
                op.machineGroupId
                  ? machineOptions.filter((m) => m.machineGroupId === op.machineGroupId)
                  : machineOptions
              }
              placeholder={op.machineGroupId ? '🔍 Machine in group ★' : '🔍 Machine ★'}
              valueLabel={op.machineCode ? codeAndName(op.machineCode, machine?.name) : undefined}
              selectedLabel={(m) => (m.code ? codeAndName(m.code, m.name) : m.name)}
            />
          )}
        </td>
        <td className="td-num">
          {/* ADR-227: read-only on the pinned Final Inspection, like its
              Operation box. The server strips that op out of the edit
              comparison by id, so with the approval gate ON a cycle time typed
              here is thrown away and the save dies as "Nothing changed to
              approve", while the same keystroke with the gate OFF just saves —
              the gate-on / gate-off split this change exists to remove.
              `readOnly` (grey fill, full-strength text) rather than `disabled`,
              which would half-fade the value. */}
          <input
            type="number"
            min={0}
            step="0.01"
            className="innovic-input"
            aria-label={`Cycle Time (min), ${opRef}`}
            value={op.cycleTimeMin || ''}
            readOnly={isPinnedFinalQc}
            title={isPinnedFinalQc ? PINNED_FINAL_QC_REASON : undefined}
            onChange={(e) => onChange({ cycleTimeMin: Number(e.target.value) })}
          />
        </td>
        <td>
          {isQc ? (
            <span className="text3" title="A QC step carries no program">
              —
            </span>
          ) : (
            <input
              className="innovic-input"
              value={op.program}
              placeholder="CNC program"
              aria-label={`Program, ${opRef}`}
              onChange={(e) => onChange({ program: e.target.value })}
            />
          )}
        </td>
        <td>
          {isQc ? (
            <span className="text3">—</span>
          ) : op.hasStarted && !isOut && op.available > 0 && op.id ? (
            <button
              type="button"
              className="btn btn-sm jc-edit-bal"
              title={`Outsource the ${op.available} pcs available on this operation`}
              onClick={onOutsourceBalance}
            >
              🏭 Outsource Available
            </button>
          ) : (
            <label
              className={cx('jc-edit-osp', isOut && 'is-on', op.hasStarted && 'is-locked')}
              title={op.hasStarted ? 'Operation started — locked' : 'Outsource this operation'}
            >
              <input
                type="checkbox"
                checked={isOut}
                disabled={op.hasStarted}
                onChange={(e) => onChange({ opType: e.target.checked ? 'outsource' : 'process' })}
              />
              {op.hasStarted ? 'Outsource 🔒' : 'Outsource'}
            </label>
          )}
        </td>
        <td>
          {st ? (
            <span className={`badge ${st.cls}`}>{st.label}</span>
          ) : (
            <span className="text3" title="Not saved yet">
              —
            </span>
          )}
        </td>
        <td>
          <RowMenu
            label={menuLabel}
            items={[
              {
                key: 'up',
                label: 'Move up',
                onSelect: () => onMove(-1),
                disabledReason: op.hasStarted
                  ? 'Started op — cannot re-sequence'
                  : isFirst
                    ? 'Already first'
                    : isPinnedFinalQc
                      ? 'Final Inspection stays last'
                      : undefined,
              },
              {
                key: 'down',
                label: 'Move down',
                onSelect: () => onMove(1),
                disabledReason: op.hasStarted
                  ? 'Started op — cannot re-sequence'
                  : isLast
                    ? 'Already last'
                    : isAbovePinnedFinalQc
                      ? 'Final Inspection stays last'
                      : undefined,
              },
              {
                key: 'remove',
                label: 'Remove',
                icon: 'trash-2',
                group: 'danger',
                onSelect: onRemove,
                // ADR-227: the system's own Final Inspection is re-derived by
                // the writer, so taking it out is refused ("…cannot be removed
                // here") — greyed with the reason, as Move up / Move down are.
                disabledReason: op.hasStarted
                  ? 'Started op — cannot remove'
                  : isPinnedFinalQc
                    ? PINNED_FINAL_QC_REASON
                    : undefined,
              },
            ]}
          />
        </td>
      </tr>
      {open ? (
        <tr className="jc-ops-det">
          <td colSpan={EDIT_COLS}>
            <JcEditOpDetail {...props} opRef={opRef} />
          </td>
        </tr>
      ) : null}
    </>
  );
}

/** The ▸ detail: the op's remaining editable fields, then the read-only
 *  figures, QC Required and the latest three logs the old card showed. */
function JcEditOpDetail({
  op,
  index,
  enriched: en,
  logs,
  onChange,
  opRef,
}: JcEditOpRowProps & { opRef: string }): React.JSX.Element {
  const isQc = op.opType === 'qc';
  const isOut = op.opType === 'outsource';
  const key = op.id ?? index;
  const doneQty = en ? (isQc ? en.qcAcceptedQty : en.completedQty) : 0;
  // Pending is the server's (v_jc_op_status.pending_qty); a new op reads "—".
  const pendingQty = en ? en.pendingQty : 0;
  return (
    <>
      <div className="jc-edit-detf">
        {isQc ? (
          <div className="jc-ops-f jc-span-2">
            <span className="jc-ops-k">A QC step carries no program or tool details.</span>
          </div>
        ) : (
          <>
            <label className="jc-ops-f" htmlFor={`jc-edit-toolno-${key}`}>
              <span className="jc-ops-k">Tool No.</span>
              <input
                id={`jc-edit-toolno-${key}`}
                className="innovic-input jc-in-qty"
                value={op.toolNo}
                placeholder="Tool no."
                maxLength={120}
                onChange={(e) => onChange({ toolNo: e.target.value })}
              />
            </label>
            <label className="jc-ops-f" htmlFor={`jc-edit-tooldet-${key}`}>
              <span className="jc-ops-k">Tool details</span>
              <input
                id={`jc-edit-tooldet-${key}`}
                className="innovic-input"
                value={op.toolDetails}
                placeholder="Tool details"
                onChange={(e) => onChange({ toolDetails: e.target.value })}
              />
            </label>
          </>
        )}
        {isOut && op.outsourceCost !== null ? (
          <label className="jc-ops-f" htmlFor={`jc-edit-cost-${key}`}>
            <span className="jc-ops-k">Cost/pc (₹)</span>
            <input
              id={`jc-edit-cost-${key}`}
              type="number"
              min={0}
              step="0.01"
              className="innovic-input jc-in-qty"
              value={op.outsourceCost || ''}
              placeholder="₹ Cost/pc"
              onChange={(e) => onChange({ outsourceCost: Number(e.target.value) })}
            />
          </label>
        ) : (
          <div />
        )}
        <div className="jc-ops-f">
          {!isQc && op.qcRequired ? <span className="badge b-green">QC Required</span> : null}
        </div>

        <div className="jc-ops-f">
          <span className="jc-ops-k">Completed</span>
          <span className="jc-ops-v mono">
            {!en ? '—' : doneQty}
            {en && isQc ? <span className="jc-ops-sub jc-ops-good"> ✓ accepted</span> : null}
            {en && isQc && en.qcRejectedQty > 0 ? (
              <span className="jc-ops-sub jc-ops-bad"> ✗{en.qcRejectedQty} deviated</span>
            ) : null}
            {en && !isQc && en.qcRequired && en.qcAcceptedQty > 0 ? (
              <span className="jc-ops-sub jc-ops-good"> ✓{en.qcAcceptedQty} accepted</span>
            ) : null}
          </span>
        </div>
        <div className="jc-ops-f">
          <span className="jc-ops-k">Pending</span>
          <span className={cx('jc-ops-v', 'mono', en && pendingQty > 0 && 'jc-ops-warn')}>
            {!en ? '—' : pendingQty}
          </span>
        </div>
        <div className="jc-ops-f">
          <span className="jc-ops-k">QC Pending</span>
          <span className={cx('jc-ops-v', 'mono', en && en.qcPending > 0 && 'jc-ops-warn')}>
            {!en ? '—' : en.qcPending}
          </span>
        </div>
        {isOut ? (
          <div className="jc-ops-f">
            <span className="jc-ops-k">At Vendor</span>
            <span className="jc-ops-v mono">{!en ? '—' : en.atVendorQty}</span>
            <span className="jc-ops-k">Back from Vendor</span>
            <span className="jc-ops-v mono">{!en ? '—' : en.inQcQty}</span>
          </div>
        ) : (
          <div />
        )}
      </div>
      <div className="jc-ops-logs" aria-label={`Recent logs, ${opRef}`}>
        <span className="jc-ops-lk">Recent Logs</span>
        {logs.length === 0 ? (
          <span className="text3">No entries</span>
        ) : (
          logs.map((l) => (
            <span key={l.id}>
              <span className="mono text3">{fmtDate(l.logDate)}</span> · {SHIFT_LABELS[l.shift]} ·{' '}
              <b className="jc-ops-good">+{l.qty}</b> · {l.operatorName ?? ''}
            </span>
          ))
        )}
      </div>
    </>
  );
}
