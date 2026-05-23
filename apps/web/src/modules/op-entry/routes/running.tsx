import { Link, createRoute } from '@tanstack/react-router';
import { ArrowLeft, Loader2 } from 'lucide-react';
import { authenticatedRoute } from '@/routes/_authenticated';
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

  return (
    <div>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: 14,
          gap: 8,
        }}
      >
        <div>
          <div className="section-hdr" style={{ marginBottom: 0 }}>
            Live Operations Board
          </div>
          <div className="text3" style={{ fontSize: 11, marginTop: 2 }}>
            Real-time view of running shop-floor sessions.
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {isFetching && !isLoading ? (
            <span className="text3" style={{ fontSize: 11, fontFamily: 'var(--mono)' }}>
              <Loader2 className="inline h-3 w-3 animate-spin" /> Updating…
            </span>
          ) : null}
          <Link to="/op-entry" className="btn btn-ghost btn-sm">
            <ArrowLeft size={14} /> Op Entry
          </Link>
        </div>
      </div>

      {isLoading ? (
        <div className="panel">
          <div className="empty-state">
            <Loader2 className="mr-2 inline h-4 w-4 animate-spin" /> Loading…
          </div>
        </div>
      ) : isError ? (
        <div className="panel">
          <div className="empty-state" style={{ color: 'var(--red)' }}>
            {error instanceof Error ? error.message : 'Failed to load running ops'}
          </div>
        </div>
      ) : (
        <RunningOpsBoard rows={data ?? []} />
      )}
    </div>
  );
}
