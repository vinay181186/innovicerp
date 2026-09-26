// QC Command Center (legacy renderQCCommandCenter L18613). 5-tab QC control
// board: Queue / First-Pass Yield / Rejection Pareto / Inspector Performance /
// Rework. All five tabs + stats come from /qc-command (op_log QC groups +
// qc_assignments + nc_register) — Pareto + Inspector are now real legacy-parity
// reports, no longer reusing /qc-dashboard. Legacy chrome.

import type { QcCommandQueueRow } from '@innovic/shared';
import { createRoute } from '@tanstack/react-router';
import { Loader2 } from 'lucide-react';
import { useState } from 'react';
import { z } from 'zod';
import { effectiveFormPerms, useMyAccess } from '@/lib/access-control';
import { authenticatedRoute } from '@/routes/_authenticated';
import { StatStrip } from '@/ui/data';
import { ListHeader } from '@/ui/layout';
import { usePickUpQc, useQcCommand } from '../api';
import { AssignModal } from '../components/AssignModal';
import { FpyTab } from '../components/FpyTab';
import { InspectorTab } from '../components/InspectorTab';
import { ParetoTab } from '../components/ParetoTab';
import { QueueTab } from '../components/QueueTab';
import { ReworkTab } from '../components/ReworkTab';

const searchSchema = z.object({
  tab: z.enum(['queue', 'fpy', 'pareto', 'inspector', 'rework']).optional(),
});

export const qcCommandRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: 'qc-command',
  validateSearch: searchSchema,
  component: QcCommandPage,
});

type Tab = 'queue' | 'fpy' | 'pareto' | 'inspector' | 'rework';
const TABS: { id: Tab; label: string }[] = [
  { id: 'queue', label: 'Assign Inspector' },
  { id: 'fpy', label: 'First-Pass Yield' },
  { id: 'pareto', label: 'Top Rejection Reasons' },
  { id: 'inspector', label: 'Inspector Performance' },
  { id: 'rework', label: 'Rework Cycles' },
];

function fpyColor(pct: number): string {
  if (pct >= 95) return 'var(--green2)';
  if (pct >= 85) return 'var(--amber2)';
  return 'var(--red2)';
}

function QcCommandPage(): React.JSX.Element {
  const search = qcCommandRoute.useSearch();
  const navigate = qcCommandRoute.useNavigate();
  const tab: Tab = search.tab ?? 'queue';

  const cmd = useQcCommand();
  const pickUp = usePickUpQc();

  // Tier-driven, per department (qc_submit sits in QC) — these were global role
  // checks (admin / manager / qc), which ignored the QC tier entirely.
  //   Pick Up  = `entry`: you are creating your own allocation.
  //   Assign   = `edit`:  re-assigning someone else's queue changes an
  //                       allocation that is already saved, so L3 Editor and up,
  //                       not the L2 hand who may only take work for themselves.
  const { data: eff } = useMyAccess();
  const qcPerms = effectiveFormPerms(eff, 'qc_submit');
  const canPickUp = qcPerms.entry;
  const canAssign = qcPerms.edit;

  const [assignRow, setAssignRow] = useState<QcCommandQueueRow | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  function setTab(t: Tab): void {
    void navigate({ search: () => (t === 'queue' ? {} : { tab: t }), replace: true });
  }

  function handlePickUp(jcOpId: string): void {
    setBusyId(jcOpId);
    // Picked up = it is yours to inspect now, so go straight to the QC Call
    // Register with ?op= — its deep link opens the Inspect popup on this call.
    pickUp.mutate(
      { jcOpId },
      {
        onSettled: () => setBusyId(null),
        onSuccess: () => {
          void navigate({ to: '/qc-call-register', search: { op: jcOpId } });
        },
      },
    );
  }

  const stats = cmd.data?.stats;
  const loading = cmd.isLoading;

  // "Hide page" (Access Control → Config): once access has loaded, a user whose
  // VIEW was removed for this page sees the no-access panel, not the page. `eff`
  // is undefined only while access loads — don't block then, or every legitimate
  // user flashes this panel on cold load.
  if (eff && !qcPerms.view) {
    return (
      <div className="empty-state" style={{ color: 'var(--amber2)', padding: 40 }}>
        You do not have permission to view QC Center. Ask an admin.
      </div>
    );
  }

  return (
    <div>
      <ListHeader
        title="QC Center"
        icon="🔬"
        count={cmd.data ? cmd.data.queue.length : undefined}
        noun="call in queue"
        nounPlural="calls in queue"
        updating={cmd.isFetching && !loading}
      >
        {/* Stats strip (legacy: Pending / Overdue / Oldest / Rework / FPY) */}
        {!loading ? (
          <StatStrip
            items={[
              {
                key: 'pending',
                label: 'QC Pending',
                count: stats?.pendingOps ?? 0,
                color: 'var(--amber2)',
              },
              {
                key: 'overdue',
                label: 'Overdue',
                count: stats?.overdue ?? 0,
                color: 'var(--red2)',
              },
              {
                key: 'oldest',
                label: 'Oldest (Days Waiting)',
                count: daysText(stats?.oldestAgeDays ?? 0),
                color: 'var(--amber2)',
              },
              {
                key: 'rework',
                label: 'Rework Items',
                count: stats?.reworkItems ?? 0,
                color: 'var(--purple2)',
              },
              {
                key: 'fpy',
                label: 'First-Pass Yield',
                count: `${stats?.fpyPct ?? 0}%`,
                color: fpyColor(stats?.fpyPct ?? 0),
              },
            ]}
          />
        ) : null}
      </ListHeader>

      {loading ? (
        <div className="panel">
          <div className="empty-state">
            <Loader2 className="mr-2 inline h-4 w-4 animate-spin" /> Loading QC Center…
          </div>
        </div>
      ) : (
        <>
          {/* Tabs */}
          <div
            style={{
              display: 'flex',
              gap: 4,
              borderBottom: '1px solid var(--border)',
              marginBottom: 14,
              flexWrap: 'wrap',
            }}
          >
            {TABS.map((t) => (
              <div
                key={t.id}
                onClick={() => setTab(t.id)}
                style={{
                  padding: '10px 16px',
                  cursor: 'pointer',
                  fontSize: 12,
                  fontWeight: 600,
                  borderBottom: `2px solid ${tab === t.id ? 'var(--red)' : 'transparent'}`,
                  color: tab === t.id ? 'var(--red)' : 'var(--text3)',
                }}
              >
                {t.label}
              </div>
            ))}
          </div>

          {tab === 'queue' ? (
            <QueueTab
              rows={cmd.data?.queue ?? []}
              canPickUp={canPickUp}
              canAssign={canAssign}
              busyId={busyId}
              onPickUp={handlePickUp}
              onAssign={setAssignRow}
            />
          ) : null}
          {tab === 'fpy' && cmd.data ? <FpyTab fpy={cmd.data.fpy} /> : null}
          {tab === 'rework' ? <ReworkTab rework={cmd.data?.rework ?? []} /> : null}
          {tab === 'pareto' && cmd.data ? <ParetoTab pareto={cmd.data.pareto} /> : null}
          {tab === 'inspector' ? <InspectorTab perf={cmd.data?.inspectorPerf ?? []} /> : null}
        </>
      )}

      {assignRow ? (
        <AssignModal
          row={assignRow}
          inspectors={cmd.data?.inspectors ?? []}
          onClose={() => setAssignRow(null)}
        />
      ) : null}
    </div>
  );
}

/** "1 day" / "3 days" — the one waiting-time format on every QC screen. */
function daysText(n: number): string {
  return `${n} ${n === 1 ? 'day' : 'days'}`;
}
