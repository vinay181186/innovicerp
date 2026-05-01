import { Link, createRoute } from '@tanstack/react-router';
import { ArrowLeft, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { authenticatedRoute } from '@/routes/_authenticated';
import { useRealtimeRunningOps, useRunningOps } from '../api';
import { RunningOpsBoard } from '../components/running-ops-board';

export const runningOpsRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: 'op-entry/running',
  component: RunningOpsPage,
});

function RunningOpsPage() {
  useRealtimeRunningOps();
  const { data, isLoading, isFetching, isError, error } = useRunningOps();

  return (
    <main className="container max-w-6xl py-10">
      <div className="space-y-6">
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-1">
            <h1 className="text-2xl font-semibold tracking-tight">Live operations board</h1>
            <p className="text-sm text-muted-foreground">
              Real-time view of running shop-floor sessions.
            </p>
          </div>
          <Button variant="outline" asChild>
            <Link to="/op-entry">
              <ArrowLeft />
              Op Entry
            </Link>
          </Button>
        </div>

        {isLoading ? (
          <p className="inline-flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading…
          </p>
        ) : isError ? (
          <p className="text-sm text-destructive">
            {error instanceof Error ? error.message : 'Failed to load running ops'}
          </p>
        ) : (
          <>
            {isFetching ? (
              <span className="inline-flex items-center gap-2 text-xs text-muted-foreground">
                <Loader2 className="h-3 w-3 animate-spin" />
                Updating
              </span>
            ) : null}
            <RunningOpsBoard rows={data ?? []} />
          </>
        )}
      </div>
    </main>
  );
}
