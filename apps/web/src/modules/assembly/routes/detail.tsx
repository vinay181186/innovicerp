// Assembly Tracker detail (PL-5). Per-Equipment-SO BOM readiness rollup +
// per-unit assembly + dispatch actions. Mirrors legacy renderAssemblyTracker
// HTML L28738.

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
      <RollupPanel rollup={data.rollup} />

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

      <ComponentsPanel components={data.components} soId={soId} />

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
            Undo last
          </button>
        </div>
      </div>

      <UnitsPanel units={data.units} />
    </div>
  );
}

function HeaderPanel({ data }: { data: AssemblyTrackerResponse }): React.JSX.Element {
  const { header } = data;
  return (
    <div className="panel">
      <div className="panel-hdr">
        <div>
          <div className="td-code" style={{ color: 'var(--cyan)', fontSize: 16, fontWeight: 700 }}>
            {header.soCode}
          </div>
          <div className="panel-title" style={{ marginTop: 2 }}>
            {header.customerName ?? '—'}
          </div>
        </div>
        <div className="text3" style={{ fontSize: 11, fontFamily: 'var(--mono)', textAlign: 'right' }}>
          <div>
            BOM <b style={{ color: 'var(--text)' }}>{header.bomCode ?? '—'}</b>
          </div>
          <div>
            Required <b style={{ color: 'var(--text)' }}>{header.orderQty}</b> units
          </div>
        </div>
      </div>
    </div>
  );
}

function RollupPanel({ rollup }: { rollup: AssemblyRollup }): React.JSX.Element {
  const statusColor: Record<AssemblyRollup['status'], string> = {
    waiting: 'var(--text3)',
    ready: 'var(--blue)',
    assembling: 'var(--amber2)',
    done: 'var(--green2)',
  };
  const tiles: Array<{ label: string; val: number | string; color?: string }> = [
    { label: 'Required', val: rollup.orderQty, color: 'var(--text)' },
    { label: 'Assembled', val: rollup.assembledQty, color: 'var(--green2)' },
    { label: 'Dispatched', val: rollup.dispatchedQty, color: 'var(--cyan)' },
    { label: 'Balance', val: rollup.balanceQty, color: 'var(--red2)' },
    { label: 'Can assemble', val: rollup.canAssembleAdditional, color: 'var(--text)' },
    { label: 'Status', val: rollup.status, color: statusColor[rollup.status] },
  ];
  return (
    <div className="panel" style={{ marginBottom: 12 }}>
      <div
        className="panel-body"
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))',
          gap: 10,
        }}
      >
        {tiles.map((t) => (
          <div
            key={t.label}
            style={{
              border: '1px solid var(--border)',
              borderRadius: 6,
              padding: '8px 10px',
              background: 'var(--bg2)',
            }}
          >
            <div
              className="text3"
              style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.05em' }}
            >
              {t.label}
            </div>
            <div
              style={{
                fontFamily: 'var(--mono)',
                fontSize: 18,
                fontWeight: 700,
                color: t.color,
                marginTop: 2,
                textTransform: 'capitalize',
              }}
            >
              {t.val}
            </div>
          </div>
        ))}
      </div>
      {rollup.bottleneck && rollup.bottleneck.enoughForUnits < rollup.orderQty ? (
        <div
          className="panel-body"
          style={{
            borderTop: '1px solid var(--border)',
            paddingTop: 8,
            fontSize: 12,
          }}
        >
          🚧 Bottleneck:{' '}
          <b style={{ fontFamily: 'var(--mono)' }}>{rollup.bottleneck.childItemCode}</b>{' '}
          (enough for{' '}
          <b style={{ color: 'var(--amber2)' }}>{rollup.bottleneck.enoughForUnits}</b> units)
        </div>
      ) : null}
    </div>
  );
}

function ComponentsPanel({
  components,
  soId,
}: {
  components: AssemblyComponentRow[];
  soId: string;
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
              <th>Item</th>
              <th>Type</th>
              <th className="td-right">Qty/Set</th>
              <th className="td-right">Need</th>
              <th className="td-right">Stock</th>
              <th className="td-right">Auto Ready</th>
              <th className="td-right">Override</th>
              <th className="td-right">Final Ready</th>
              <th className="td-right">Shortfall</th>
              <th className="td-right">Enough For</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {components.map((c) => (
              <tr key={c.childItemCode}>
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
                  <span className="text3" style={{ fontSize: 12 }}>
                    {c.bomType === 'manufacture' ? '🏭 Mfg' : c.bomType === 'purchase' ? '🛒 Buy' : '📦 Outsrc'}
                  </span>
                </td>
                <td className="td-right">{c.qtyPerSet}</td>
                <td className="td-right">{c.totalNeed}</td>
                <td className="td-right" style={{ color: 'var(--green2)' }}>
                  {c.stockQty}
                </td>
                <td className="td-right">{c.autoReadyQty}</td>
                <td className="td-right">
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
                <td className="td-right" style={{ fontWeight: 700 }}>
                  {c.finalReadyQty}
                </td>
                <td className="td-right" style={{ color: c.shortfall > 0 ? 'var(--red2)' : 'var(--text3)' }}>
                  {c.shortfall}
                </td>
                <td className="td-right">{c.enoughForUnits}</td>
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
  const map: Record<AssemblyComponentRow['status'], { cls: string; label: string }> = {
    ready: { cls: 'b-green', label: 'Ready' },
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
        <div className="panel-title">Assembled units ({units.length})</div>
      </div>
      {error ? (
        <div style={{ color: 'var(--red)', padding: '6px 10px', fontSize: 12 }}>{error}</div>
      ) : null}
      <div className="tbl-wrap">
        <table className="innovic-table">
          <thead>
            <tr>
              <th>#</th>
              <th>Serial</th>
              <th>Assembled</th>
              <th>By</th>
              <th>Dispatched</th>
              <th>Remarks</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {units.map((u) => (
              <tr key={u.id}>
                <td>{u.unitNo}</td>
                <td>
                  <span className="td-code">{u.serialNo ?? '—'}</span>
                </td>
                <td>
                  <span className="text3" style={{ fontSize: 12 }}>
                    {u.assemblyDate}
                  </span>
                </td>
                <td>
                  <span className="text3" style={{ fontSize: 12 }}>
                    {u.assembledBy ?? '—'}
                  </span>
                </td>
                <td>
                  {u.dispatched ? (
                    <span className="badge b-cyan">
                      ✓ {u.dispatchDate ?? ''}
                    </span>
                  ) : (
                    <span className="text3" style={{ fontSize: 12 }}>
                      —
                    </span>
                  )}
                </td>
                <td>
                  <span className="text3" style={{ fontSize: 12 }}>
                    {u.remarks ?? '—'}
                  </span>
                </td>
                <td>
                  {!u.dispatched ? (
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      onClick={() => onDispatch(u.id)}
                      disabled={dispatch.isPending}
                      title="Mark dispatched"
                    >
                      {dispatch.isPending ? (
                        <Loader2 size={13} className="animate-spin" />
                      ) : (
                        <Truck size={13} />
                      )}
                    </button>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
