// Assembly Tracker detail (PL-5). Per-Equipment-SO BOM readiness rollup +
// per-unit assembly + dispatch actions.
//
// Legacy counterpart: renderAssemblyTracker's per-SO EXPANDED BODY
// (L28788–28884) — legacy has no standalone per-SO renderer; the detail hides
// inside the list accordion. list.tsx ports the collapsed card header
// (L28782–28787); this route ports the body. Header block here mirrors
// L28783–28787 so the route stands alone.
//
// Colour note — legacy writes `var(--teal)` for the ASSEMBLED stat, the unit #,
// the units heading, the 100% progress fill and the card border, but `--teal`
// is defined in NEITHER legacy's stylesheet NOR our tokens (ISSUE-126), so every
// one of those declarations is invalid → inert in legacy. They are therefore NOT
// painted teal here. The one real teal is legacy's literal `#14b8a6` on the
// "Done" badge (L28781) → `.b-teal`.

import type {
  AssemblyComponentRow,
  AssemblyRollup,
  AssemblyTrackerResponse,
  AssemblyUnitRow,
} from '@innovic/shared';
import { Link, createRoute } from '@tanstack/react-router';
import { ArrowLeft, Loader2, Plus, RotateCcw, Truck } from 'lucide-react';
import { useState } from 'react';
import { authenticatedRoute } from '@/routes/_authenticated';
import {
  useAssemblyTracker,
  useMarkUnitAssembled,
  useMarkUnitDispatched,
  useSetReadinessOverride,
  useUndoLastUnit,
} from '../api';

export const assemblyDetailRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: 'assemblies/$soId',
  component: AssemblyDetailPage,
});

function AssemblyDetailPage(): React.JSX.Element {
  const { soId } = assemblyDetailRoute.useParams();
  const { data, isLoading, isError, error } = useAssemblyTracker(soId);
  const mark = useMarkUnitAssembled(soId);
  const undo = useUndoLastUnit(soId);
  const [actionError, setActionError] = useState<string | null>(null);
  const [serial, setSerial] = useState('');
  const [assembledBy, setAssembledBy] = useState('');

  if (isLoading) {
    return (
      <div>
        <Loader2 className="inline h-4 w-4 animate-spin" /> Loading assembly…
      </div>
    );
  }
  if (isError || !data) {
    return (
      <div className="panel">
        <div className="panel-body">
          <Link to="/assemblies" className="btn btn-ghost btn-sm" style={{ marginBottom: 8 }}>
            <ArrowLeft size={14} /> Back
          </Link>
          <div className="empty-state" style={{ color: 'var(--red)' }}>
            {error instanceof Error ? error.message : 'Assembly tracker not found'}
          </div>
        </div>
      </div>
    );
  }

  const onAssemble = (): void => {
    setActionError(null);
    mark.mutate(
      { serialNo: serial || undefined, assembledBy: assembledBy || undefined },
      {
        onSuccess: () => {
          setSerial('');
        },
        onError: (e) => setActionError(e instanceof Error ? e.message : 'Mark failed'),
      },
    );
  };
  const onUndo = (): void => {
    setActionError(null);
    undo.mutate(undefined, {
      onError: (e) => setActionError(e instanceof Error ? e.message : 'Undo failed'),
    });
  };

  return (
    <div>
      <Link to="/assemblies" className="btn btn-ghost btn-sm" style={{ marginBottom: 10 }}>
        <ArrowLeft size={14} /> Back to list
      </Link>

      <HeaderPanel data={data} />
      <RollupPanel rollup={data.rollup} components={data.components} />

      {actionError ? (
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
          {actionError}
        </div>
      ) : null}

      <ComponentsPanel components={data.components} soId={soId} orderQty={data.rollup.orderQty} />

      <div className="panel">
        <div className="panel-hdr">
          <div className="panel-title">Assemble next unit</div>
        </div>
        <div
          className="panel-body"
          style={{ display: 'flex', gap: 10, alignItems: 'flex-end' }}
        >
          <div>
            <label
              className="text3"
              style={{
                display: 'block',
                fontSize: 10,
                textTransform: 'uppercase',
                letterSpacing: '0.05em',
                marginBottom: 4,
              }}
            >
              Serial #
            </label>
            <input
              className="innovic-input"
              style={{ width: 180 }}
              value={serial}
              onChange={(e) => setSerial(e.target.value)}
              placeholder="optional"
            />
          </div>
          <div>
            <label
              className="text3"
              style={{
                display: 'block',
                fontSize: 10,
                textTransform: 'uppercase',
                letterSpacing: '0.05em',
                marginBottom: 4,
              }}
            >
              Assembled by
            </label>
            <input
              className="innovic-input"
              style={{ width: 160 }}
              value={assembledBy}
              onChange={(e) => setAssembledBy(e.target.value)}
              placeholder="optional"
            />
          </div>
          <button
            type="button"
            className="btn btn-primary btn-sm"
            onClick={onAssemble}
            disabled={mark.isPending || data.rollup.balanceQty === 0}
            title={
              data.rollup.balanceQty === 0
                ? 'All required units assembled'
                : 'Insert a new assembly unit'
            }
          >
            {mark.isPending ? <Loader2 size={13} className="animate-spin" /> : <Plus size={13} />}
            Assemble unit
          </button>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={onUndo}
            disabled={undo.isPending || data.rollup.assembledQty === 0}
            title="Undo the latest non-dispatched unit"
          >
            {undo.isPending ? <Loader2 size={13} className="animate-spin" /> : <RotateCcw size={13} />}
            Undo Last Unit
          </button>
        </div>
      </div>

      <UnitsPanel units={data.units} />
    </div>
  );
}

// Legacy L28778–28781. `done` uses legacy's literal #14b8a6 → .b-teal.
function StatusBadge({
  rollup,
  readyCount,
  totalCount,
}: {
  rollup: AssemblyRollup;
  readyCount: number;
  totalCount: number;
}): React.JSX.Element {
  switch (rollup.status) {
    case 'ready':
      return <span className="badge b-green">ALL READY ✓</span>;
    case 'assembling':
      return (
        <span className="badge b-cyan">
          Assembling {rollup.assembledQty}/{rollup.orderQty}
        </span>
      );
    case 'done':
      return (
        <span className="badge b-teal">
          Done ✓ {rollup.assembledQty}/{rollup.orderQty}
        </span>
      );
    case 'waiting':
      return (
        <span className="badge b-amber">
          Waiting — {readyCount}/{totalCount}
        </span>
      );
  }
}

// Mirrors legacy's collapsed card header L28783–28787. Legacy's meta line also
// carries `Rev <revision>` and `Due: <dueDate>`; neither is on
// AssemblyTrackerResponse.header, so both are omitted rather than fabricated.
function HeaderPanel({ data }: { data: AssemblyTrackerResponse }): React.JSX.Element {
  const { header, rollup, components } = data;
  const readyCount = components.filter((c) => c.status === 'ready').length;
  // Legacy L28786: teal when all units built (inert — see file header), else
  // green at 100% component readiness, else amber.
  const pct = components.length ? Math.round((readyCount / components.length) * 100) : 0;
  const countColor =
    rollup.assembledQty >= rollup.orderQty ? undefined : pct === 100 ? 'var(--green)' : 'var(--amber)';
  return (
    <div className="panel">
      <div className="panel-hdr">
        <div>
          <div style={{ fontSize: 14, fontWeight: 700 }}>
            {header.soCode} — {header.bomName ?? '—'}{' '}
            <span className="text3" style={{ fontWeight: 400, fontSize: 12 }}>
              × {header.orderQty} nos
            </span>
          </div>
          <div className="text2" style={{ fontSize: 12, marginTop: 2 }}>
            Customer: {header.customerName ?? ''} | BOM: {header.bomCode ?? '—'} |{' '}
            <StatusBadge rollup={rollup} readyCount={readyCount} totalCount={components.length} />
          </div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontSize: 22, fontWeight: 700, color: countColor }}>
            {rollup.assembledQty}/{rollup.orderQty}
          </div>
          <div className="text3" style={{ fontSize: 10 }}>
            assembled
          </div>
        </div>
      </div>
    </div>
  );
}

// Legacy L28790–28799: progress bar + the inline stats strip, in legacy's order
// (ORDER QTY · CAN ASSEMBLE · ASSEMBLED · DISPATCHED · BALANCE · COMPONENTS ·
// BOTTLENECK). Legacy carries no Status stat here — the status is the header
// badge (L28778–28781), where it is now rendered.
function RollupPanel({
  rollup,
  components,
}: {
  rollup: AssemblyRollup;
  components: AssemblyComponentRow[];
}): React.JSX.Element {
  const readyCount = components.filter((c) => c.status === 'ready').length;
  const pctAssembled = rollup.orderQty > 0 ? Math.round((rollup.assembledQty / rollup.orderQty) * 100) : 0;
  // Legacy L28792 colours CAN ASSEMBLE green when stock covers the requirement.
  // Legacy's `assembliesPossible` is the TOTAL buildable; ours is headroom on top
  // of what is already built (service.ts canAssembleAdditional), so the
  // equivalent "covers what's still owed" test is against balanceQty.
  const canAssembleColor =
    rollup.canAssembleAdditional >= rollup.balanceQty ? 'var(--green)' : 'var(--amber)';
  return (
    <div className="panel" style={{ marginBottom: 12 }}>
      <div className="panel-body">
        {/* Legacy L28790. Legacy switches the fill to var(--teal) at 100%, but
            --teal is undefined there → invalid → the bar renders EMPTY when
            complete. Ported as cyan throughout rather than copying that bug. */}
        <div className="prog-wrap" style={{ marginBottom: 10 }}>
          <div className="prog-bar" style={{ width: `${pctAssembled}%`, background: 'var(--cyan)' }} />
        </div>
        <div
          style={{
            display: 'flex',
            gap: 16,
            flexWrap: 'wrap',
            padding: '10px 14px',
            background: 'var(--bg)',
            borderRadius: 8,
            border: '1px solid var(--border)',
          }}
        >
          <div>
            <span className="text3" style={{ fontSize: 10 }}>
              ORDER QTY
            </span>
            <br />
            <b style={{ fontSize: 18 }}>{rollup.orderQty}</b>
          </div>
          <div>
            <span className="text3" style={{ fontSize: 10 }}>
              CAN ASSEMBLE
            </span>
            <br />
            <b style={{ fontSize: 18, color: canAssembleColor }}>{rollup.canAssembleAdditional}</b>
          </div>
          <div>
            <span style={{ fontSize: 10 }}>ASSEMBLED</span>
            <br />
            <b style={{ fontSize: 18 }}>{rollup.assembledQty}</b>
          </div>
          <div>
            <span style={{ fontSize: 10, color: 'var(--cyan)' }}>DISPATCHED</span>
            <br />
            <b style={{ fontSize: 18, color: 'var(--cyan)' }}>{rollup.dispatchedQty}</b>
          </div>
          <div>
            <span className="text3" style={{ fontSize: 10 }}>
              BALANCE
            </span>
            <br />
            <b style={{ fontSize: 18, color: rollup.balanceQty > 0 ? 'var(--red)' : 'var(--green)' }}>
              {rollup.balanceQty}
            </b>
          </div>
          <div>
            <span className="text3" style={{ fontSize: 10 }}>
              COMPONENTS
            </span>
            <br />
            <b style={{ fontSize: 18 }}>
              {readyCount}/{components.length} ready
            </b>
          </div>
          {rollup.bottleneck && rollup.bottleneck.enoughForUnits < rollup.orderQty ? (
            <div>
              <span style={{ fontSize: 10, color: 'var(--red)' }}>BOTTLENECK</span>
              <br />
              {/* Legacy prints childName||childCode; the rollup carries only the code. */}
              <b style={{ color: 'var(--red)' }}>{rollup.bottleneck.childItemCode}</b>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

// Legacy L28804–28805 (type label + colour map).
const TYPE_META: Record<AssemblyComponentRow['bomType'], { label: string; color: string }> = {
  manufacture: { label: '🏭 Mfg', color: 'var(--cyan)' },
  purchase: { label: '🛒 Buy', color: 'var(--green)' },
  outsource: { label: '🔧 JW', color: 'var(--amber)' },
};

function ComponentsPanel({
  components,
  soId,
  orderQty,
}: {
  components: AssemblyComponentRow[];
  soId: string;
  orderQty: number;
}): React.JSX.Element {
  const setOverride = useSetReadinessOverride(soId);
  const [editing, setEditing] = useState<{ code: string; value: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (components.length === 0) {
    return (
      <div className="panel">
        <div className="panel-body">
          <div className="empty-state">
            <div className="empty-icon">📦</div>
            No BOM linked. Set a BOM master on the sales order to populate components.
          </div>
        </div>
      </div>
    );
  }

  const onSave = (childCode: string, val: number): void => {
    setError(null);
    setOverride.mutate(
      { childCode, input: { readyQtyOverride: val } },
      {
        onSuccess: () => {
          setEditing(null);
        },
        onError: (e) => setError(e instanceof Error ? e.message : 'Override failed'),
      },
    );
  };

  return (
    <div className="panel">
      <div className="panel-hdr">
        <div className="panel-title">Components ({components.length})</div>
      </div>
      {error ? (
        <div
          style={{
            color: 'var(--red)',
            padding: '6px 10px',
            fontSize: 12,
          }}
        >
          {error}
        </div>
      ) : null}
      <div className="tbl-wrap">
        <table className="innovic-table">
          <thead>
            <tr>
              <th>#</th>
              <th>Child Item</th>
              <th>Type</th>
              {/* Qty/Set + Stock have no legacy counterpart — kept (live system). */}
              <th style={{ textAlign: 'center' }}>Qty/Set</th>
              <th style={{ textAlign: 'center' }}>Need</th>
              <th style={{ textAlign: 'center' }}>Stock</th>
              <th style={{ textAlign: 'center' }}>Auto Ready</th>
              <th style={{ textAlign: 'center', color: 'var(--amber)' }}>Override</th>
              <th style={{ textAlign: 'center' }}>Final Ready</th>
              <th style={{ textAlign: 'center', color: 'var(--red)' }}>Short</th>
              <th style={{ textAlign: 'center' }}>Enough For</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {components.map((c, i) => (
              <tr
                key={c.childItemCode}
                style={{ background: c.status === 'ready' ? 'rgba(34,197,94,0.04)' : undefined }}
              >
                <td className="td-ctr">{i + 1}</td>
                <td>
                  <div className="td-code" style={{ color: 'var(--purple)' }}>
                    {c.childItemCode}
                  </div>
                  {c.childItemName ? (
                    <div className="text3" style={{ fontSize: 11, marginTop: 2 }}>
                      {c.childItemName}
                    </div>
                  ) : null}
                </td>
                <td>
                  <span style={{ fontSize: 11, fontWeight: 700, color: TYPE_META[c.bomType].color }}>
                    {TYPE_META[c.bomType].label}
                  </span>
                </td>
                <td className="td-ctr">{c.qtyPerSet}</td>
                <td className="td-ctr fw-700">{c.totalNeed}</td>
                <td className="td-ctr" style={{ color: 'var(--green2)' }}>
                  {c.stockQty}
                </td>
                <td className="td-ctr" style={{ color: 'var(--cyan)', fontWeight: 600 }}>
                  {c.autoReadyQty}
                </td>
                <td className="td-ctr">
                  {editing?.code === c.childItemCode ? (
                    <div style={{ display: 'flex', gap: 4 }}>
                      <input
                        type="number"
                        min={0}
                        className="innovic-input"
                        style={{ width: 64 }}
                        value={editing.value}
                        onChange={(e) => setEditing({ code: c.childItemCode, value: e.target.value })}
                      />
                      <button
                        type="button"
                        className="btn btn-primary btn-sm"
                        onClick={() => onSave(c.childItemCode, Math.max(0, Number(editing.value) || 0))}
                        disabled={setOverride.isPending}
                      >
                        ✓
                      </button>
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        onClick={() => setEditing(null)}
                      >
                        ✗
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      style={{ padding: '0 6px' }}
                      onClick={() =>
                        setEditing({ code: c.childItemCode, value: String(c.overrideQty) })
                      }
                      title="Manual override (planner declares N ready)"
                    >
                      {c.overrideQty}
                    </button>
                  )}
                </td>
                {/* Legacy L28826 suffixes ✏ when a manual override exists.
                    overrideQty is non-nullable here (0 == "no override"), so the
                    marker is omitted rather than shown on every zero row. */}
                <td
                  className="td-ctr fw-700"
                  style={{ color: c.finalReadyQty >= c.totalNeed ? 'var(--green)' : 'var(--amber)' }}
                >
                  {c.finalReadyQty}
                </td>
                <td
                  className="td-ctr fw-700"
                  style={{ color: c.shortfall > 0 ? 'var(--red)' : 'var(--green)' }}
                >
                  {c.shortfall}
                </td>
                <td
                  className="td-ctr"
                  style={{
                    fontWeight: 600,
                    color: c.enoughForUnits >= orderQty ? 'var(--green)' : 'var(--amber)',
                  }}
                >
                  {c.enoughForUnits >= orderQty ? `${c.enoughForUnits} ✓` : `${c.enoughForUnits} / ${orderQty}`}
                </td>
                <td>
                  <ComponentStatusBadge status={c.status} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ComponentStatusBadge({
  status,
}: {
  status: AssemblyComponentRow['status'];
}): React.JSX.Element {
  // Legacy L28806-28809 has four states (ready / in production / GRN pending /
  // pending) driven by JC + GRN lookups; our server derives three
  // (deriveComponentStatus). Only `ready` maps 1:1 — legacy's `Ready ✓`. The
  // other two keep our labels rather than fabricate a production/GRN state we
  // have no server source for.
  const map: Record<AssemblyComponentRow['status'], { cls: string; label: string }> = {
    ready: { cls: 'b-green', label: 'Ready ✓' },
    enough_for_some: { cls: 'b-amber', label: 'Partial' },
    shortage: { cls: 'b-red', label: 'Shortage' },
  };
  const m = map[status];
  return <span className={`badge ${m.cls}`}>{m.label}</span>;
}

function UnitsPanel({ units }: { units: AssemblyUnitRow[] }): React.JSX.Element {
  const dispatch = useMarkUnitDispatched();
  const [error, setError] = useState<string | null>(null);

  if (units.length === 0) {
    return (
      <div className="panel">
        <div className="panel-body">
          <div className="empty-state">
            <div className="empty-icon">🔧</div>
            No units assembled yet.
          </div>
        </div>
      </div>
    );
  }

  const onDispatch = (unitId: string): void => {
    setError(null);
    dispatch.mutate(
      { unitId, input: {} },
      {
        onError: (e) => setError(e instanceof Error ? e.message : 'Dispatch failed'),
      },
    );
  };

  return (
    <div className="panel">
      <div className="panel-hdr">
        <div className="panel-title">📦 Assembled Units ({units.length})</div>
      </div>
      {error ? (
        <div style={{ color: 'var(--red)', padding: '6px 10px', fontSize: 12 }}>{error}</div>
      ) : null}
      <div className="tbl-wrap">
        <table className="innovic-table">
          <thead>
            <tr>
              <th style={{ textAlign: 'center' }}>Unit #</th>
              <th>Serial No.</th>
              <th>Assembly Date</th>
              <th>Assembled By</th>
              <th>Remarks</th>
              <th style={{ textAlign: 'center' }}>Dispatch Status</th>
              <th style={{ textAlign: 'center' }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {/* Server returns units already ordered by unitNo asc (service.ts). */}
            {units.map((u) => (
              <tr key={u.id}>
                <td className="td-ctr fw-700" style={{ fontSize: 16 }}>
                  {u.unitNo}
                </td>
                <td className="mono" style={{ fontSize: 12, color: 'var(--cyan)', fontWeight: 700 }}>
                  {u.serialNo ?? '—'}
                </td>
                <td className="mono" style={{ fontSize: 12 }}>
                  {u.assemblyDate}
                </td>
                <td style={{ fontSize: 12 }}>{u.assembledBy ?? '—'}</td>
                <td className="text3" style={{ fontSize: 12 }}>
                  {u.remarks ?? '—'}
                </td>
                <td className="td-ctr">
                  {u.dispatched ? (
                    <span className="badge b-green">Dispatched ✓</span>
                  ) : (
                    <span className="badge b-amber">Pending</span>
                  )}
                  {u.dispatchDate ? (
                    <span className="text3" style={{ fontSize: 10 }}>
                      {' '}
                      {u.dispatchDate}
                    </span>
                  ) : null}
                </td>
                <td className="td-ctr">
                  {!u.dispatched ? (
                    <button
                      type="button"
                      className="btn btn-sm btn-success"
                      onClick={() => onDispatch(u.id)}
                      disabled={dispatch.isPending}
                      title="Mark dispatched"
                    >
                      {dispatch.isPending ? (
                        <Loader2 size={13} className="animate-spin" />
                      ) : (
                        <Truck size={13} />
                      )}
                      Dispatch
                    </button>
                  ) : (
                    <span className="text3" style={{ fontSize: 11 }}>
                      —
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
