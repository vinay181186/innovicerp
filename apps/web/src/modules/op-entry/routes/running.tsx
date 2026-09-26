import { Link, createRoute } from '@tanstack/react-router';
import { ArrowLeft, Loader2 } from 'lucide-react';
import { useState } from 'react';
import { ShopFloorView } from '@/modules/shop-floor/components/shop-floor-view';
import { authenticatedRoute } from '@/routes/_authenticated';
import { ListHeader } from '@/ui/layout';
import { useRealtimeRunningOps, useRunningOps } from '../api';
import { RunningOpsBoard } from '../components/running-ops-board';

export const runningOpsRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: 'op-entry/running',
  component: RunningOpsPage,
});

function RunningOpsPage(): React.JSX.Element {
  useRealtimeRunningOps();
  const { data, isLoading, isFetching, isError, error } = useRunningOps();
  const [view, setView] = useState<'table' | 'machine'>('table');

  return (
    <div>
      <ListHeader
        title="Live Operations"
        icon="🔴"
        count={isLoading ? undefined : (data ?? []).filter((r) => r.status === 'running').length}
        noun="running session"
        updating={isFetching && !isLoading}
        tools={
          <Link to="/op-entry" className="btn btn-ghost btn-sm">
            <ArrowLeft size={14} /> Op Entry
          </Link>
        }
      >
        <div style={{ display: 'flex', gap: 4, borderBottom: '1px solid var(--border)' }}>
          {(['table', 'machine'] as const).map((v) => (
            <button
              key={v}
              type="button"
              onClick={() => setView(v)}
              style={{
                background: 'none',
                border: 'none',
                borderBottom: view === v ? '2px solid var(--cyan)' : '2px solid transparent',
                color: view === v ? 'var(--cyan)' : 'var(--text3)',
                fontSize: 12,
                fontWeight: 700,
                padding: '6px 12px',
                cursor: 'pointer',
                marginBottom: -1,
              }}
            >
              {v === 'table' ? 'Table' : 'By Machine'}
            </button>
          ))}
        </div>
      </ListHeader>

      {view === 'machine' ? (
        <ShopFloorView />
      ) : isLoading ? (
        <div className="panel">
          <div className="empty-state">
            <Loader2 className="mr-2 inline h-4 w-4 animate-spin" /> Loading…
          </div>
        </div>
      ) : isError ? (
        <div className="panel">
          <div className="empty-state" style={{ color: 'var(--red2)' }}>
            {error instanceof Error
              ? error.message
              : 'Could not load running operations. Try again.'}
          </div>
        </div>
      ) : (
        <RunningOpsBoard rows={data ?? []} />
      )}
    </div>
  );
}
