import { Link, createRoute } from '@tanstack/react-router';
import { ArrowRight, Loader2, Search } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { authenticatedRoute } from '@/routes/_authenticated';
import {
  useJcOpsEnriched,
  useOpLog,
  useRealtimeOpLog,
  useRealtimeRunningOps,
  useRunningOps,
} from '../api';
import { JcOpsTable } from '../components/jc-ops-table';
import { OpEntryForm } from '../components/op-entry-form';
import { OpLogHistory } from '../components/op-log-history';

const searchSchema = z.object({
  jc: z.string().optional(),
  op: z.string().uuid().optional(),
});

export const opEntryRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: 'op-entry',
  validateSearch: searchSchema,
  component: OpEntryPage,
});

function OpEntryPage() {
  const search = opEntryRoute.useSearch();
  const navigate = opEntryRoute.useNavigate();

  const [jcInput, setJcInput] = useState(search.jc ?? '');
  useEffect(() => {
    setJcInput(search.jc ?? '');
  }, [search.jc]);

  // Realtime: refresh running_ops list everywhere; for the per-op view, sub
  // is created once an op is selected. Both subs invalidate jc_ops cache.
  useRealtimeRunningOps();
  useRealtimeOpLog(search.op);

  const jcQuery = useMemo(
    () => (search.jc ? { jobCardCode: search.jc } : ({ jobCardCode: '' } as const)),
    [search.jc],
  );
  const ops = useJcOpsEnriched(jcQuery, { enabled: Boolean(search.jc) });
  const running = useRunningOps({ status: 'running' });

  const selectedOp = useMemo(
    () => ops.data?.find((o) => o.id === search.op) ?? null,
    [ops.data, search.op],
  );
  const opLog = useOpLog(
    { jcOpId: selectedOp?.id ?? '', limit: 100 },
    { enabled: Boolean(selectedOp) },
  );

  const activeRunningId = useMemo(() => {
    if (!selectedOp || !running.data) return null;
    return (
      running.data.find((r) => r.jcOpId === selectedOp.id && r.status === 'running')?.id ?? null
    );
  }, [running.data, selectedOp]);

  function handleJcSubmit(e: React.FormEvent) {
    e.preventDefault();
    const v = jcInput.trim();
    void navigate({
      search: () => (v ? { jc: v } : {}),
      replace: true,
    });
  }

  function handleSelectOp(opId: string) {
    void navigate({
      search: (prev) => ({ ...prev, op: opId }),
      replace: true,
    });
  }

  return (
    <main className="container max-w-6xl py-10">
      <div className="space-y-6">
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-1">
            <h1 className="text-2xl font-semibold tracking-tight">Op Entry</h1>
            <p className="text-sm text-muted-foreground">
              Log shop-floor work against a job card.
            </p>
          </div>
          <Button variant="outline" asChild>
            <Link to="/op-entry/running">
              <ArrowRight />
              Live operations board
            </Link>
          </Button>
        </div>

        <form onSubmit={handleJcSubmit} className="flex flex-col gap-3 md:flex-row md:items-end">
          <div className="space-y-1 md:flex-1 md:max-w-sm">
            <Label htmlFor="jc-input">Job Card No.</Label>
            <Input
              id="jc-input"
              value={jcInput}
              onChange={(e) => setJcInput(e.target.value)}
              placeholder="e.g. IN-JC-00002"
              autoFocus
            />
          </div>
          <Button type="submit">
            <Search />
            Load
          </Button>
        </form>

        {search.jc ? (
          <section className="space-y-4">
            <header className="flex items-baseline gap-3">
              <h2 className="text-lg font-semibold">
                <span className="font-mono text-primary">{search.jc}</span>
              </h2>
              {ops.isFetching && !ops.isLoading ? (
                <span className="inline-flex items-center gap-2 text-xs text-muted-foreground">
                  <Loader2 className="h-3 w-3 animate-spin" />
                  Updating
                </span>
              ) : null}
            </header>

            {ops.isLoading ? (
              <p className="inline-flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                Loading ops…
              </p>
            ) : ops.isError ? (
              <p className="text-sm text-destructive">
                {ops.error instanceof Error ? ops.error.message : 'Failed to load ops'}
              </p>
            ) : (
              <div className="rounded-md border bg-card">
                <JcOpsTable
                  ops={ops.data ?? []}
                  selectedOpId={search.op ?? null}
                  onSelect={handleSelectOp}
                />
              </div>
            )}

            {selectedOp ? (
              <div className="grid gap-4 md:grid-cols-5">
                <div className="md:col-span-3">
                  <OpEntryForm op={selectedOp} activeRunningId={activeRunningId} />
                </div>
                <div className="md:col-span-2">
                  <div className="rounded-md border bg-card p-4">
                    <h3 className="mb-3 text-sm font-semibold">Recent log</h3>
                    <OpLogHistory logs={opLog.data ?? []} isLoading={opLog.isLoading} />
                  </div>
                </div>
              </div>
            ) : ops.data && ops.data.length > 0 ? (
              <p className="text-sm text-muted-foreground">Select an op above to log entries.</p>
            ) : null}
          </section>
        ) : (
          <p className="rounded-md border border-dashed bg-muted/40 p-6 text-center text-sm text-muted-foreground">
            Enter a job card number to load its ops.
          </p>
        )}
      </div>
    </main>
  );
}
