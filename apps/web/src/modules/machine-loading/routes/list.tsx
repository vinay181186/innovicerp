// Machine Loading (Production Wave 3). Ports legacy renderLoading (HTML L5021):
// machine cards + the open-operations table + Capacity Summary.
//
// The old "Job Queue View" toggle is gone (2026-09-26): it drew a second copy
// of the Job Queue screen. There is now ONE queue screen — the "Job Queue →"
// button opens /job-queue?machine=<code> for the picked machine (or all).
// Legacy chrome (.panel / .innovic-table / .badge); cards use inline tokens
// (.mach-card not ported to theme).

import type { MachineLoadCard, MachineLoadOp, MachineLoadStatus } from '@innovic/shared';
import { opSrNo } from '@innovic/shared';
import { Link, createRoute } from '@tanstack/react-router';
import { Loader2, Printer } from 'lucide-react';
import { useMemo, useState } from 'react';
import { z } from 'zod';
import { fmtDate } from '@/lib/date';
import { ActualMachineLine } from '@/components/shared/machine-split';
import { itemCodeWithRev } from '@/lib/item-code';
import { authenticatedRoute } from '@/routes/_authenticated';
import { ListHeader } from '@/ui/layout';
import { useMyCompany } from '../../settings/api';
import { useMachineLoading } from '../api';
import { printMachineQueue } from '../lib/print-machine-queue';

const searchSchema = z.object({
  m: z.string().uuid().optional(),
  // Kept only so an old bookmarked ?view=queue link still parses; the queue
  // itself now lives on /job-queue (see the file header).
  view: z.enum(['ops', 'queue']).optional(),
});

export const machineLoadingRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: 'machine-loading',
  validateSearch: searchSchema,
  component: MachineLoadingPage,
});

// Legacy badge() (HTML L1959-1970) maps load status → colour:
// Overloaded→b-red · High Load→b-amber · Manageable→b-green · Clear→b-green.
function loadBadgeClass(status: MachineLoadStatus): string {
  if (status === 'Overloaded') return 'b-red';
  if (status === 'High Load') return 'b-amber';
  return 'b-green'; // Manageable + Clear (legacy L1963)
}

// Legacy badge() op-status map (L1961-1963). `b-yellow` (In Progress) and
// `b-running` (Running) are declared ONLY in legacy's print-only <style> block
// (L10559-10561), never in its main sheet at L10 — so legacy renders both as an
// unstyled `.badge` pill on screen. Empty class here reproduces that exactly;
// neither class exists in our theme either.
// Wave 2 (owner, 2026-09-26) overrides the legacy note above: in_progress now
// reads "Partly Completed" (amber) and running (an open session) is green.
const OP_STATUS_BADGES: Record<string, { label: string; cls: string }> = {
  complete: { label: 'Completed', cls: 'b-green' },
  in_progress: { label: 'Partly Completed', cls: 'b-amber' },
  running: { label: 'Running', cls: 'b-green' },
  available: { label: 'Available', cls: 'b-blue' },
  waiting: { label: 'Waiting', cls: 'b-grey' },
  qc_pending: { label: 'QC Pending', cls: 'b-amber' },
};

function OpStatusBadge({ status }: { status: string }): React.JSX.Element {
  const known = OP_STATUS_BADGES[status];
  // Legacy's fallback is `m[status] || 'b-grey'` with the raw status text.
  const label = known?.label ?? status.replaceAll('_', ' ');
  const cls = known ? known.cls : 'b-grey';
  return <span className={cls ? `badge ${cls}` : 'badge'}>{label}</span>;
}

function barColor(pct: number): string {
  if (pct > 100) return 'var(--red)';
  if (pct > 70) return 'var(--amber)';
  if (pct > 0) return 'var(--green)';
  return 'var(--bg5)';
}

// Legacy progBar() (L1972-1975) — .prog-wrap/.prog-bar are ported to our theme
// (innovic-theme.css L763/L769); only the width+colour are inline, as in legacy.
function ProgBar({ pct }: { pct: number }): React.JSX.Element {
  return (
    <div className="prog-wrap">
      <div
        className="prog-bar"
        style={{ width: `${Math.min(100, pct)}%`, background: barColor(pct) }}
      />
    </div>
  );
}

function MachineLoadingPage(): React.JSX.Element {
  const search = machineLoadingRoute.useSearch();
  const navigate = machineLoadingRoute.useNavigate();
  const { data, isLoading, isFetching, isError, error } = useMachineLoading();
  const { data: company } = useMyCompany();

  const selMachineId = search.m ?? null;

  const machines = data?.machines ?? [];
  const allOps = data?.ops ?? [];

  function onPrintQueue(machineId: string | null): void {
    if (!printMachineQueue({ machines, ops: allOps, company, machineId })) {
      window.alert('Allow popups to print.');
    }
  }

  // Operation View re-applies legacy's narrow ops filter (renderLoading L5060:
  // available > 0 OR In Progress). The service now returns the wider Job-Queue
  // set (all non-complete ops) so the Job Queue View can surface waiting /
  // qc_pending / running (ISSUE-068); this keeps the ops table unchanged.
  // Client-side search over the columns the ops table shows — JC no., POL,
  // item code / name, SO no., operation. One fetch, so every row is here.
  const [searchInput, setSearchInput] = useState('');
  const term = searchInput.trim().toLowerCase();
  const filteredOps = useMemo(
    () =>
      allOps.filter(
        (o) =>
          (selMachineId ? o.machineId === selMachineId : true) &&
          (o.available > 0 || o.computedStatus === 'in_progress') &&
          (term === '' ||
            [
              o.jobCardCode,
              o.clientPoLineNo,
              itemCodeWithRev(o.itemCode, o.itemRevision, ''),
              o.itemName,
              o.soCode,
              o.operation,
            ].some((v) => v != null && String(v).toLowerCase().includes(term))),
      ),
    [allOps, selMachineId, term],
  );

  // Legacy's selMach IS the machine code (its PK); ours is a uuid, so the panel
  // title (legacy L5179: `${selMach} — Job Queue`) needs a lookup.
  const selMachineCode = selMachineId
    ? (machines.find((m) => m.machineId === selMachineId)?.machineCode ?? null)
    : null;

  function selectMachine(id: string): void {
    void navigate({
      search: (prev) => ({ ...prev, m: id, view: undefined }),
      replace: true,
    });
  }
  function clearFilter(): void {
    void navigate({ search: (prev) => ({ ...prev, m: undefined }), replace: true });
  }

  return (
    <div>
      <ListHeader
        title="Machine Loading"
        icon="▣"
        count={isLoading ? undefined : filteredOps.length}
        noun="open operation"
        filterNote={selMachineCode ?? undefined}
        search={searchInput}
        onSearch={setSearchInput}
        searchPlaceholder="Search JC no., POL, item, SO no., operation…"
        updating={isFetching && !isLoading}
        // The machine load cards below stay (they ARE this page's content —
        // load bars, hours, days to clear); a card click still picks the
        // machine. Clear resets that pick and the search (it replaced the old
        // "All Machines ×" button — owner's filter-bar decision 2026-09-26).
        onClearFilters={() => {
          setSearchInput('');
          clearFilter();
        }}
        filtersActive={term !== '' || selMachineId != null}
        tools={
          <>
            {/* ONE queue screen: the Job Queue, filtered to the picked machine. */}
            <Link
              to="/job-queue"
              search={selMachineCode ? { machine: selMachineCode } : {}}
              className="btn btn-ghost"
              title={
                selMachineCode
                  ? `Open the Job Queue for ${selMachineCode}`
                  : 'Open the Job Queue for every machine'
              }
            >
              Job Queue →
            </Link>
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => onPrintQueue(selMachineId)}
              disabled={machines.length === 0}
              title={selMachineId ? 'Print this machine queue' : 'Print all machine queues'}
            >
              <Printer size={13} /> Print Queue
            </button>
          </>
        }
      />

      {isLoading ? (
        <div className="panel">
          <div className="empty-state">
            <Loader2 className="mr-2 inline h-4 w-4 animate-spin" /> Loading machine load…
          </div>
        </div>
      ) : isError ? (
        <div className="panel">
          <div className="empty-state" style={{ color: 'var(--red2)' }}>
            {error instanceof Error ? error.message : 'Could not load machine loading. Try again.'}
          </div>
        </div>
      ) : (
        <>
          {/* Machine cards — legacy .mach-cards (L221): 5 fixed columns, gap 10,
              margin-bottom 16. Not ported to our theme, so inlined verbatim. */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(5, 1fr)',
              gap: 10,
              marginBottom: 16,
            }}
          >
            {machines.map((m) => (
              <MachineLoadCardView
                key={m.machineId}
                card={m}
                selected={m.machineId === selMachineId}
                onClick={() => selectMachine(m.machineId)}
              />
            ))}
            {machines.length === 0 ? (
              <div className="text3" style={{ fontSize: 12 }}>
                No machines configured.
              </div>
            ) : null}
          </div>

          <OperationView
            ops={filteredOps}
            selMachineCode={selMachineCode}
            searching={term !== ''}
          />

          <CapacitySummary machines={machines} />
        </>
      )}
    </div>
  );
}

function MachineLoadCardView({
  card,
  selected,
  onClick,
}: {
  card: MachineLoadCard;
  selected: boolean;
  onClick: () => void;
}): React.JSX.Element {
  const pct = Math.min(150, Math.round(card.loadPct * 100));
  return (
    // Legacy .mach-card (L222) + .mach-card.sel (L223) inlined — neither is in
    // our theme. Selected state mirrors legacy's own intent: renderLoading emits
    // `.selected`, which legacy never defines (only `.sel`), so its selected card
    // gets no highlight; renderJobQueue (L10371) works around the same bug by
    // inlining the border/shadow. We keep the highlight — see report.
    <button
      type="button"
      onClick={onClick}
      style={{
        textAlign: 'left',
        background: 'var(--bg2)',
        border: '1px solid var(--border)',
        borderColor: selected ? 'var(--cyan)' : 'var(--border)',
        boxShadow: selected ? '0 0 0 1px var(--cyan)' : undefined,
        borderRadius: 'var(--radius2)',
        padding: 14,
        cursor: 'pointer',
        position: 'relative',
      }}
    >
      {/* Legacy .mach-id (L224) is not in our theme — inline approximation kept. */}
      <div className="mono fw-700" style={{ color: 'var(--cyan)', fontSize: 13 }}>
        {card.machineCode}
      </div>
      <div className="text3" style={{ fontSize: 11, marginBottom: 2 }}>
        {card.name}
      </div>
      <div className="text3 mono" style={{ fontSize: 11, marginBottom: 8 }}>
        {card.machineType ?? '—'}
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
        <Num val={card.totalAvailQty} lbl="Available" color="var(--amber)" />
        <Num val={card.pendingHrs} lbl="Hrs" color="var(--red)" />
        <Num val={card.daysToClear} lbl="Days" />
      </div>
      <ProgBar pct={pct} />
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          marginTop: 4,
          alignItems: 'center',
        }}
      >
        <span className="mono text3" style={{ fontSize: 11 }}>
          {pct}%
        </span>
        <span className={`badge ${loadBadgeClass(card.loadStatus)}`}>{card.loadStatus}</span>
      </div>
    </button>
  );
}

function Num({ val, lbl, color }: { val: number; lbl: string; color?: string }): React.JSX.Element {
  return (
    <div style={{ textAlign: 'center' }}>
      <div className="mono fw-700" style={{ fontSize: 14, color: color ?? 'var(--text)' }}>
        {val}
      </div>
      <div className="text3" style={{ fontSize: 11 }}>
        {lbl}
      </div>
    </div>
  );
}

function OpRow({ op, idx }: { op: MachineLoadOp; idx: number }): React.JSX.Element {
  return (
    <tr>
      <td className="td-ctr mono text3">{idx + 1}</td>
      <OpRowCells op={op} />
    </tr>
  );
}

function OpRowCells({ op }: { op: MachineLoadOp }): React.JSX.Element {
  return (
    <>
      {/* The JC number opens that card. The cell keeps its mono + cyan identity
          and the link inherits it, so a reachable code does not read as a
          different kind of value from the one that was here before. */}
      <td className="td-code cyan">
        <Link
          to="/job-cards/$id"
          params={{ id: op.jobCardId }}
          title="View job card status"
          style={{ color: 'inherit', textDecoration: 'none', whiteSpace: 'nowrap' }}
        >
          {op.jobCardCode}
        </Link>
      </td>
      {/* POL — the line number on the CUSTOMER's own purchase order; '—' when
          no sales order sits behind this job card. */}
      <td className="mono fw-700" style={{ color: 'var(--purple)' }}>
        {op.clientPoLineNo ?? '—'}
      </td>
      {/* Code on one line; the item NAME wraps (sheet rule). */}
      <td style={{ fontSize: 11, textAlign: 'left' }}>
        <span style={{ whiteSpace: 'nowrap' }}>
          {itemCodeWithRev(op.itemCode, op.itemRevision, '')}
        </span>
        {op.itemName ? ` — ${op.itemName}` : ''}
      </td>
      <td className="td-ctr mono text3" style={{ fontSize: 11, whiteSpace: 'nowrap' }}>
        {op.soCode ?? '—'}
      </td>
      <td className="td-ctr mono" style={{ whiteSpace: 'nowrap' }}>
        {opSrNo(op.opSeq)}
      </td>
      <td>{op.operation}</td>
      <td>
        <span className={`badge ${op.priority === 'high' ? 'b-amber' : 'b-grey'}`}>
          {op.priority === 'high' ? 'High' : 'Normal'}
        </span>
      </td>
      <td className="text2 td-ctr" style={{ fontSize: 11, whiteSpace: 'nowrap' }}>
        {fmtDate(op.dueDate)}
      </td>
      <td className="mono td-num">{op.orderQty}</td>
      <td className="green mono fw-700 td-num">
        {op.completedQty}
        {/* ADR-164 — the op is listed under its PLANNED machine (the card /
            queue names the plan), so say which machine ACTUALLY made this
            figure: always drawn, same name when nothing changed, amber when it
            differs, with the per-machine breakdown for a 2+ machine split. */}
        <ActualMachineLine planned={op.machineCode} machines={op.machines} />
      </td>
      <td className="td-num">
        <span
          className="mono fw-700"
          style={{ fontSize: 15, color: op.available > 0 ? 'var(--amber)' : 'var(--text3)' }}
        >
          {op.available}
        </span>
      </td>
      <td className="td-num">
        <span className="mono fw-700" style={{ color: 'var(--red2)' }}>
          {op.pendingHrs}h
        </span>
      </td>
      <td>
        <OpStatusBadge status={op.computedStatus} />
      </td>
    </>
  );
}

function OperationView({
  ops,
  selMachineCode,
  searching,
}: {
  ops: MachineLoadOp[];
  selMachineCode: string | null;
  searching: boolean;
}): React.JSX.Element {
  return (
    <div className="panel">
      <div className="panel-hdr">
        <span className="panel-title">
          {selMachineCode
            ? `${selMachineCode} — Job Queue`
            : 'All Open Operations — sorted by Priority → Due Date'}
        </span>
        <span className="mono" style={{ color: 'var(--amber2)', fontSize: 12 }}>
          {ops.length} ops
        </span>
      </div>
      <div className="tbl-wrap">
        <table className="innovic-table tbl-grid">
          <thead>
            <tr>
              <th>Sr No</th>
              <th>JC No.</th>
              {/* POL — the CUSTOMER's own PO line number, before the item. */}
              <th style={{ color: 'var(--purple)' }}>POL</th>
              <th>Item Code</th>
              <th>SO No.</th>
              <th>Op</th>
              <th>Operation</th>
              <th>Priority</th>
              <th>Due Date</th>
              <th className="th-num">Order Qty</th>
              <th className="th-num">Completed</th>
              <th className="th-num" style={{ color: 'var(--amber2)' }}>
                Available
              </th>
              <th className="th-num" style={{ color: 'var(--red2)' }}>
                Pending Hrs
              </th>
              <th>Op Status</th>
            </tr>
          </thead>
          <tbody>
            {ops.length === 0 ? (
              <tr>
                <td colSpan={14} className="empty-state">
                  {searching ? 'No open operations match this search' : 'No pending operations'}
                </td>
              </tr>
            ) : (
              ops.map((op, i) => <OpRow key={op.jcOpId} op={op} idx={i} />)
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function CapacitySummary({ machines }: { machines: MachineLoadCard[] }): React.JSX.Element {
  return (
    // Legacy `<div class="panel mt-16">` (L5189); .mt-16 (L268) is not in our theme.
    <div className="panel" style={{ marginTop: 16 }}>
      <div className="panel-hdr">
        <span className="panel-title">Capacity Summary</span>
      </div>
      <div className="tbl-wrap">
        <table className="innovic-table tbl-grid">
          <thead>
            <tr>
              <th>Machine</th>
              <th>Name</th>
              <th>Machine Type</th>
              <th className="th-num">Open Ops</th>
              <th className="th-num">Available</th>
              <th className="th-num">Pending Hrs</th>
              <th className="th-num">Daily Cap</th>
              <th className="th-num">Days to Clear</th>
              <th className="th-num">Loading %</th>
              <th>Load Status</th>
            </tr>
          </thead>
          <tbody>
            {machines.length === 0 ? (
              <tr>
                <td colSpan={10} className="empty-state">
                  No machines
                </td>
              </tr>
            ) : (
              machines.map((m) => (
                <tr key={m.machineId}>
                  <td className="td-code" style={{ whiteSpace: 'nowrap' }}>
                    {m.machineCode}
                  </td>
                  <td>{m.name}</td>
                  <td className="text2">{m.machineType ?? '—'}</td>
                  <td className="mono td-num">{m.openOps}</td>
                  <td className="mono fw-700 amber td-num">{m.totalAvailQty}</td>
                  <td className="td-num">
                    <span className="mono fw-700" style={{ color: 'var(--red2)' }}>
                      {m.pendingHrs}h
                    </span>
                  </td>
                  <td className="mono green td-num">{m.dailyCap}h</td>
                  <td className="mono td-num">{m.daysToClear}d</td>
                  <td className="mono fw-700 td-num">{Math.round(m.loadPct * 100)}%</td>
                  <td>
                    <span className={`badge ${loadBadgeClass(m.loadStatus)}`}>{m.loadStatus}</span>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
