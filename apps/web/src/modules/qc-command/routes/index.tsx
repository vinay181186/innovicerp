// QC Command Center (legacy renderQCCommandCenter L18613). 5-tab QC control
// board: Queue / First-Pass Yield / Rejection Pareto / Inspector Performance /
// Rework. Queue + FPY + Rework + stats come from /qc-command (op_log QC groups
// + qc_assignments). Pareto + Inspector reuse /qc-dashboard. Legacy chrome.

import type { QcCommandQueueRow } from '@innovic/shared';
import { createRoute } from '@tanstack/react-router';
import { Loader2 } from 'lucide-react';
import { useState } from 'react';
import { z } from 'zod';
import { useQcDashboard } from '@/modules/qc-dashboard/api';
import { useSession } from '@/lib/session';
import { authenticatedRoute } from '@/routes/_authenticated';
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
  { id: 'queue', label: '📝 QC Queue' },
  { id: 'fpy', label: '📈 First-Pass Yield' },
  { id: 'pareto', label: '📊 Rejection Pareto' },
  { id: 'inspector', label: '👤 Inspector Performance' },
  { id: 'rework', label: '🔄 Rework Cycles' },
];

function fpyColor(pct: number): string {
  if (pct >= 95) return 'var(--green)';
  if (pct >= 85) return 'var(--amber)';
  return 'var(--red)';
}

function QcCommandPage(): React.JSX.Element {
  const search = qcCommandRoute.useSearch();
  const navigate = qcCommandRoute.useNavigate();
  const tab: Tab = search.tab ?? 'queue';

  const cmd = useQcCommand();
  const dash = useQcDashboard({});
  const { data: me } = useSession();
  const pickUp = usePickUpQc();

  const isAdmin = me?.role === 'admin';
  const canPickUp = me?.role === 'admin' || me?.role === 'manager' || me?.role === 'qc';

  const [assignRow, setAssignRow] = useState<QcCommandQueueRow | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  function setTab(t: Tab): void {
    void navigate({ search: () => (t === 'queue' ? {} : { tab: t }), replace: true });
  }

  function handlePickUp(jcOpId: string): void {
    setBusyId(jcOpId);
    pickUp.mutate({ jcOpId }, { onSettled: () => setBusyId(null) });
  }

  const stats = cmd.data?.stats;
  const loading = cmd.isLoading;

  return (
    <div>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: 16,
        }}
      >
        <div className="section-hdr" style={{ marginBottom: 0 }}>
          🔬 QC Command Center
        </div>
        {cmd.isFetching ? (
          <span className="text3" style={{ fontSize: 11, fontFamily: 'var(--mono)' }}>
            <Loader2 className="inline h-3 w-3 animate-spin" />
          </span>
        ) : null}
      </div>

      {loading ? (
        <div className="panel">
          <div className="empty-state">
            <Loader2 className="mr-2 inline h-4 w-4 animate-spin" /> Loading command center…
          </div>
        </div>
      ) : (
        <>
          {/* Stats strip (legacy: Pending / Overdue / Oldest / Rework / FPY) */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
              gap: 10,
              marginBottom: 16,
            }}
          >
            <Stat label="QC Pending" value={stats?.pendingOps ?? 0} color="var(--red)" />
            <Stat label="Overdue" value={stats?.overdue ?? 0} color="var(--red)" />
            <Stat label="Oldest" value={`${stats?.oldestAgeDays ?? 0}d`} color="var(--amber)" />
            <Stat label="Rework Items" value={stats?.reworkItems ?? 0} color="var(--purple)" />
            <Stat
              label="First-Pass Yield"
              value={`${stats?.fpyPct ?? 0}%`}
              color={fpyColor(stats?.fpyPct ?? 0)}
            />
          </div>

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
              isAdmin={isAdmin}
              busyId={busyId}
              onPickUp={handlePickUp}
              onAssign={setAssignRow}
            />
          ) : null}
          {tab === 'fpy' && cmd.data ? <FpyTab fpy={cmd.data.fpy} /> : null}
          {tab === 'rework' ? <ReworkTab rework={cmd.data?.rework ?? []} /> : null}
          {tab === 'pareto' ? <ParetoTab reasons={dash.data?.topRejectionReasons ?? []} /> : null}
          {tab === 'inspector' ? <InspectorTab perf={dash.data?.engineerPerf ?? []} /> : null}
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

function Stat(props: { label: string; value: number | string; color: string }): React.JSX.Element {
  return (
    <div
      style={{
        textAlign: 'center',
        padding: 14,
        borderRadius: 10,
        background: 'var(--bg3)',
        border: '1px solid var(--border)',
      }}
    >
      <div className="text3" style={{ fontSize: 10 }}>
        {props.label}
      </div>
      <div className="mono fw-700" style={{ fontSize: 26, color: props.color }}>
        {props.value}
      </div>
    </div>
  );
}
