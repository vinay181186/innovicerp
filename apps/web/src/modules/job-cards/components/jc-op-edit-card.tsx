// Operations Detail — per-op CARD (EDITABLE).
//
// DESIGN-ONLY port of the JC Status edit branch's Operations Detail table row
// (jc-status-content.tsx, edit branch). Every input, badge, button, disabled
// rule and read-only value is copied from that table unchanged — the row's 15
// columns are re-laid-out as a card:
//
//   table column          → card slot
//   ─────────────────────────────────────────────────────────────────
//   Op / Machine / Operation → header line (seq chip, machine picker, operation input)
//   Status                   → header-right badge (+ left accent bar)
//   (move / remove)          → header-right ▲ ▼ ✕
//   Order/Completed/Pending/At Vendor/In QC → QUANTITIES tile row (read-only)
//   Cycle / Prog / Tool      → SETUP field row (editable)
//   QC                       → QC YES tag in the header
//   Outsource                → OUTSOURCE block (checkbox / balance button / vendor / cost)
//   Recent Logs              → collapsible RECENT LOGS strip (read-only)
//
// The edit table has no Start / Log / QC action cell — so this card has no
// footer either. No logic, no calculation and no API call changed.
import type { JcOpEnriched, JobCardListItem, OpLog } from '@innovic/shared';
import { useState } from 'react';
import { QcProcessPicker } from '@/components/shared/qc-process-picker';
import { SearchableSelect } from '@/components/shared/searchable-select';
import { OP_STATUS, opAccentColor } from '../lib/jc-op-labels';
import { QtyTile, SetupField, secLabel } from './jc-op-card-parts';

/** Editable op row shape. `hasStarted` locks re-sequence/removal/retype;
 *  `available` drives the ADR-081 outsource-balance action. Structurally the
 *  same values `buildJcWriteInput` consumes. */
export interface JcOpEditValues {
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
  // null = money hidden for this viewer (masked server-side); the cost input is
  // then not drawn.
  outsourceCost: number | null;
  hasStarted: boolean;
  available: number;
}

const iconBtn: React.CSSProperties = { padding: '2px 6px' };

export function JcOpEditCard({
  jc,
  op,
  index,
  seqLabel,
  enriched,
  machineName,
  machines,
  machineOptions,
  onMachineSearch,
  vendorListId,
  logs,
  cycleLabel = 'Cycle (min)',
  toolDetailsPlaceholder = 'Tool details',
  isFirst,
  isLast,
  onChange,
  onMove,
  onRemove,
  onOutsourceBalance,
}: {
  /** Order qty comes from the JC header; undefined on create (no JC yet). */
  jc: Pick<JobCardListItem, 'orderQty'> | undefined;
  op: JcOpEditValues;
  index: number;
  /** Displayed op number — the caller decides (server opSeq, or position). */
  seqLabel: number;
  /** Live read-only progress for a SAVED op; undefined for a brand-new one. */
  enriched: JcOpEnriched | undefined;
  machineName: string;
  machines: { id: string; code: string; name: string }[];
  machineOptions: { id: string; code: string; name: string }[];
  onMachineSearch: (term: string) => void;
  /** id of the <datalist> holding the vendor options. */
  vendorListId: string;
  /** Already sliced to the latest 3 by the caller, exactly as the table did.
   *  Omit entirely (create screen) to hide the RECENT LOGS strip — the create
   *  form's table has no such column. */
  logs?: OpLog[];
  /** The cycle field's caption. Defaults to "Cycle (min)" — the column is
   *  `jc_ops.cycle_time_min`, so legacy's inherited "Cycle(h)" was the wrong
   *  unit on every screen that showed it. */
  cycleLabel?: string;
  /** Tool-details placeholder — differs between the two screens today. */
  toolDetailsPlaceholder?: string;
  isFirst: boolean;
  isLast: boolean;
  onChange: (patch: Partial<JcOpEditValues>) => void;
  onMove: (dir: -1 | 1) => void;
  onRemove: () => void;
  onOutsourceBalance: () => void;
}): React.JSX.Element {
  const [logsOpen, setLogsOpen] = useState(true);

  const isQc = op.opType === 'qc';
  const isOut = op.opType === 'outsource';
  const en = enriched;
  const st = en ? (OP_STATUS[en.computedStatus] ?? { label: en.computedStatus, cls: 'b-grey' }) : null;
  const doneQty = en ? (isQc ? en.qcAcceptedQty : en.completedQty) : 0;
  const orderQty = jc?.orderQty ?? 0;
  // Pending comes straight from the server (v_jc_op_status.pending_qty, 0087) —
  // see the note in jc-op-card.tsx for why this card no longer does its own
  // maths. Null enrichment (a brand-new unsaved op) still reads 0.
  const pendingQty = en ? en.pendingQty : 0;

  return (
    <div
      style={{
        display: 'flex',
        background: 'var(--bg2)',
        border: '1px solid var(--border)',
        borderRadius: 10,
        // NOT overflow:hidden — that clipped the Machine picker's absolute
        // dropdown to the card box, so it opened invisibly (e.g. OSP→in-house
        // edit). The accent bar rounds its own left corners to keep the look.
        marginBottom: 10,
      }}
    >
      <div
        style={{
          width: 4,
          flexShrink: 0,
          background: opAccentColor(st?.cls ?? ''),
          borderTopLeftRadius: 9,
          borderBottomLeftRadius: 9,
        }}
      />
      <div style={{ flex: 1, minWidth: 0, padding: '10px 14px' }}>
        {/* ── HEADER: seq · machine · operation · tags — status · move/remove ── */}
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, flexWrap: 'wrap' }}>
          <span
            className="mono fw-700"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              minWidth: 24,
              height: 28,
              padding: '0 6px',
              borderRadius: 6,
              background: 'var(--bg4)',
              border: '1px solid var(--border2)',
              fontSize: 12,
              color: 'var(--text2)',
            }}
          >
            {seqLabel}
          </span>

          {/* Machine — editable picker for in-house ops; inactive badge for
              QC and OSP (T32b: an OSP op has no machine). */}
          <div style={{ width: 172 }}>
            {isQc ? (
              <span className="badge b-green">🔬 QC</span>
            ) : isOut ? (
              <span
                className="badge"
                style={{
                  background: 'rgba(245,158,11,0.12)',
                  color: 'var(--amber)',
                  border: '1px solid rgba(245,158,11,0.35)',
                }}
              >
                🏭 OSP
              </span>
            ) : (
              <>
                <SearchableSelect
                  id={`jc-edit-mach-${op.id ?? index}`}
                  value={machines.find((m) => m.code === op.machineCode)?.id ?? null}
                  onChange={(id) =>
                    onChange({
                      machineCode: id ? (machines.find((m) => m.id === id)?.code ?? '') : '',
                    })
                  }
                  onSearch={onMachineSearch}
                  options={machineOptions}
                  placeholder="🔍 Machine ★"
                  valueLabel={op.machineCode || undefined}
                  selectedLabel={(m) => m.code ?? m.name ?? ''}
                />
                <div className="cyan" style={{ fontSize: 10, marginTop: 2, minHeight: 13 }}>
                  {machineName}
                </div>
              </>
            )}
          </div>

          {/* A QC step's name is no longer free text — it comes from the QC
              Process master, the same way the Machine beside it comes from the
              machine master. Both write the same plain string columns they
              always did; only the way the value is chosen changed. An in-house
              operation name stays free text: there is no master for it. */}
          {isQc ? (
            <div style={{ flex: '1 1 180px', minWidth: 160 }}>
              <QcProcessPicker
                id={`jc-edit-qcproc-${op.id ?? index}`}
                value={op.operation}
                onChange={(code) => onChange({ operation: code })}
              />
            </div>
          ) : (
            <input
              className="innovic-input"
              value={op.operation}
              placeholder="Operation name ★"
              onChange={(e) => onChange({ operation: e.target.value })}
              style={{ fontSize: 12, flex: '1 1 180px', minWidth: 160 }}
            />
          )}

          {isOut ? (
            <span className="tag" style={{ background: 'var(--amber3)', color: 'var(--amber2)' }}>OSP</span>
          ) : null}
          {isQc ? (
            <span className="tag" style={{ background: 'var(--green3)', color: 'var(--green2)' }}>QC YES</span>
          ) : null}

          <span style={{ flex: 1 }} />

          {st ? (
            <span className={`badge ${st.cls}`}>{st.label}</span>
          ) : (
            <span className="text3" style={{ fontSize: 10 }}>—</span>
          )}

          {/* Move / remove — started ops locked from re-sequence and removal
              (server also blocks OSP-committed ops). */}
          <span style={{ whiteSpace: 'nowrap' }}>
            <button
              type="button"
              className="btn btn-ghost btn-sm btn-icon"
              style={iconBtn}
              disabled={isFirst || op.hasStarted}
              onClick={() => onMove(-1)}
              title={op.hasStarted ? 'Started op — cannot re-sequence' : 'Move up'}
            >
              ▲
            </button>
            <button
              type="button"
              className="btn btn-ghost btn-sm btn-icon"
              style={iconBtn}
              disabled={isLast || op.hasStarted}
              onClick={() => onMove(1)}
              title={op.hasStarted ? 'Started op — cannot re-sequence' : 'Move down'}
            >
              ▼
            </button>
            <button
              type="button"
              className="btn btn-danger btn-sm btn-icon"
              style={iconBtn}
              disabled={op.hasStarted}
              onClick={onRemove}
              title={op.hasStarted ? 'Started op — cannot remove' : 'Remove'}
            >
              ✕
            </button>
          </span>
        </div>

        {/* ── BODY: quantities (read-only) · setup (editable) · outsource ── */}
        <div style={{ display: 'flex', gap: 22, flexWrap: 'wrap', alignItems: 'flex-start', marginTop: 10 }}>
          <div>
            <div style={secLabel}>Quantities</div>
            <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
              <QtyTile label="ORDER" value={orderQty} color="var(--text)" />
              <QtyTile
                label="DONE"
                value={!en ? '—' : doneQty}
                color={en ? 'var(--green)' : 'var(--text3)'}
                sub={
                  !en ? null : isQc ? (
                    <>
                      <div style={{ fontSize: 8, color: 'var(--green)' }}>✓ accepted</div>
                      {en.qcRejectedQty > 0 ? (
                        <div style={{ fontSize: 8, color: 'var(--red)' }}>✗{en.qcRejectedQty} rej</div>
                      ) : null}
                    </>
                  ) : en.qcRequired && en.qcAcceptedQty > 0 ? (
                    <div style={{ fontSize: 8, color: 'var(--green)' }}>✓{en.qcAcceptedQty} acc</div>
                  ) : null
                }
              />
              <QtyTile
                label="PENDING"
                value={!en ? '—' : pendingQty}
                color={en && pendingQty > 0 ? 'var(--amber)' : 'var(--text3)'}
                highlight={Boolean(en) && pendingQty > 0}
              />
              <QtyTile
                label="AT VENDOR"
                value={en && isOut ? en.atVendorQty : '—'}
                color={en && isOut && en.atVendorQty > 0 ? 'var(--blue)' : 'var(--text3)'}
              />
              <QtyTile
                label="IN QC"
                value={en && isOut ? en.inQcQty : '—'}
                color={en && isOut && en.inQcQty > 0 ? 'var(--cyan)' : 'var(--text3)'}
              />
            </div>
          </div>

          <div>
            <div style={secLabel}>Setup</div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <SetupField label={cycleLabel} width={72}>
                <input
                  type="number"
                  min={0}
                  step="0.01"
                  className="innovic-input"
                  value={op.cycleTimeMin || ''}
                  onChange={(e) => onChange({ cycleTimeMin: Number(e.target.value) })}
                  style={{ fontSize: 12, width: '100%' }}
                />
              </SetupField>
              {/* QC rows carry no program / tool details (legacy `emptyCells`). */}
              {isQc ? (
                <span className="text3" style={{ fontSize: 11, alignSelf: 'center' }}>—</span>
              ) : (
                <>
                  <SetupField label="Program" width={140}>
                    <input
                      className="innovic-input"
                      value={op.program}
                      placeholder="CNC program"
                      onChange={(e) => onChange({ program: e.target.value })}
                      style={{ fontSize: 11, width: '100%' }}
                    />
                  </SetupField>
                  {/* `jc_ops.tool_no` was save-wired, shown on the view card and
                      printed/exported, but had no input on any screen — so it
                      could never hold anything a user typed. Added here; the
                      write path (build-jc-write-input) already carries it. */}
                  <SetupField label="Tool No." width={110}>
                    <input
                      className="innovic-input"
                      value={op.toolNo}
                      placeholder="Tool no."
                      maxLength={120}
                      onChange={(e) => onChange({ toolNo: e.target.value })}
                      style={{ fontSize: 11, width: '100%' }}
                    />
                  </SetupField>
                  <SetupField label="Tool details" width={180}>
                    <input
                      className="innovic-input"
                      value={op.toolDetails}
                      placeholder={toolDetailsPlaceholder}
                      onChange={(e) => onChange({ toolDetails: e.target.value })}
                      style={{ fontSize: 11, width: '100%' }}
                    />
                  </SetupField>
                </>
              )}
            </div>
          </div>

          {/* OUTSOURCE — started process op with a remaining balance → the
              🏭 Outsource balance modal; otherwise the OUTSOURCE checkbox +
              vendor/cost inputs. */}
          <div style={{ minWidth: 150, marginLeft: 'auto' }}>
            <div style={secLabel}>Outsource</div>
            {isQc ? (
              <span className="text3" style={{ fontSize: 11 }}>—</span>
            ) : (
              <div>
                {op.hasStarted && !isOut && op.available > 0 && op.id ? (
                  <button
                    type="button"
                    className="btn btn-sm"
                    style={{
                      fontSize: 9,
                      fontWeight: 700,
                      color: 'var(--amber)',
                      border: '1px solid rgba(245,158,11,0.4)',
                      padding: '2px 6px',
                    }}
                    title={`Outsource the remaining ${op.available} pc(s) of this started operation`}
                    onClick={onOutsourceBalance}
                  >
                    🏭 Outsource balance
                  </button>
                ) : (
                  <label
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 4,
                      cursor: op.hasStarted ? 'not-allowed' : 'pointer',
                    }}
                    title={op.hasStarted ? 'Operation already started — locked' : 'Outsource this op'}
                  >
                    <input
                      type="checkbox"
                      checked={isOut}
                      disabled={op.hasStarted}
                      onChange={(e) => onChange({ opType: e.target.checked ? 'outsource' : 'process' })}
                    />
                    <span
                      style={{ fontSize: 9, fontWeight: 700, color: isOut ? 'var(--amber)' : 'var(--text3)' }}
                    >
                      {op.hasStarted ? 'OUTSRC 🔒' : 'OUTSOURCE'}
                    </span>
                  </label>
                )}
                {isOut ? (
                  <div style={{ marginTop: 4 }}>
                    <input
                      className="innovic-input"
                      list={vendorListId}
                      value={op.outsourceVendorCode}
                      placeholder="🔍 Vendor"
                      onChange={(e) => onChange({ outsourceVendorCode: e.target.value })}
                      style={{ fontSize: 10, marginBottom: 3, width: '100%' }}
                    />
                    {op.outsourceCost !== null ? (
                      <input
                        type="number"
                        min={0}
                        step="0.01"
                        className="innovic-input"
                        value={op.outsourceCost || ''}
                        placeholder="₹ Cost/pc"
                        onChange={(e) => onChange({ outsourceCost: Number(e.target.value) })}
                        style={{ fontSize: 10, width: '100%' }}
                      />
                    ) : null}
                  </div>
                ) : null}
              </div>
            )}
          </div>
        </div>

        {/* ── RECENT LOGS — read-only, same latest-3 the table showed. Absent
            on the create form, whose table has no logs column. ── */}
        {logs ? (
          <>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 10 }}>
          <span style={{ ...secLabel, marginBottom: 0 }}>Recent Logs</span>
          {logs.length === 0 ? (
            <span style={{ fontSize: 11, color: 'var(--text3)' }}>No entries</span>
          ) : (
            <>
              <button
                type="button"
                onClick={() => setLogsOpen((v) => !v)}
                style={{
                  background: 'none',
                  border: 'none',
                  padding: 0,
                  cursor: 'pointer',
                  fontSize: 11,
                  color: 'var(--blue)',
                  fontWeight: 600,
                }}
              >
                {`latest ${logs.length} log ${logs.length === 1 ? 'entry' : 'entries'}`}
              </button>
              <span style={{ flex: 1 }} />
              <button
                type="button"
                onClick={() => setLogsOpen((v) => !v)}
                aria-label={logsOpen ? 'Collapse logs' : 'Expand logs'}
                style={{
                  background: 'none',
                  border: 'none',
                  padding: 0,
                  cursor: 'pointer',
                  fontSize: 11,
                  color: 'var(--text3)',
                }}
              >
                {logsOpen ? '▲' : '▼'}
              </button>
            </>
          )}
        </div>
        {logs.length > 0 && logsOpen ? (
          <div
            style={{
              marginTop: 6,
              padding: '6px 10px',
              background: 'var(--bg3)',
              border: '1px solid var(--border)',
              borderRadius: 6,
            }}
          >
            {logs.map((l) => (
              <div key={l.id} style={{ fontSize: 11, color: 'var(--text2)', lineHeight: 1.9 }}>
                <span className="mono" style={{ color: 'var(--text3)' }}>
                  {l.logDate}
                </span>{' '}
                · {l.shift} · <b style={{ color: 'var(--green)' }}>+{l.qty}</b> ·{' '}
                {l.operatorName ?? ''}
              </div>
            ))}
          </div>
        ) : null}
          </>
        ) : null}
      </div>
    </div>
  );
}
