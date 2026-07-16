import { createRoute } from '@tanstack/react-router';
import { Loader2, Search } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { z } from 'zod';
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
  // Legacy `window._opEntryMode` (renderOpEntry L5210). JC Status enters Op
  // Entry via goToOpEntryStart / goToOpEntryComplete (L11013 / L11007), which
  // set this intent. Optional; absent = 'complete' (legacy default L5210),
  // which preserves the current combined form behaviour.
  mode: z.enum(['start', 'complete']).optional(),
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

  // Start vs Complete intent (legacy _opEntryMode). Default 'complete' matches
  // legacy L5210 and preserves the current form. Toggling writes it to the URL.
  const mode = search.mode ?? 'complete';

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

  function handleModeChange(next: 'start' | 'complete') {
    void navigate({
      search: (prev) => ({ ...prev, mode: next }),
      replace: true,
    });
  }

  return (
    <div>
      <div className="section-hdr">Operation Entry</div>

      <div className="panel" style={{ marginBottom: 16 }}>
        <div className="panel-body">
          <form
            onSubmit={handleJcSubmit}
            style={{ display: 'flex', gap: 8, alignItems: 'flex-end', flexWrap: 'wrap' }}
          >
            <div className="form-grp" style={{ marginBottom: 0, minWidth: 260 }}>
              <label className="form-label" htmlFor="jc-input">
                Job Card No.
              </label>
              <input
                id="jc-input"
                className="innovic-input"
                value={jcInput}
                onChange={(e) => setJcInput(e.target.value)}
                placeholder="🔍 e.g. IN-JC-00002"
                autoFocus
              />
            </div>
            <button type="submit" className="btn btn-primary">
              <Search size={14} /> Load
            </button>
          </form>
        </div>
      </div>

      {search.jc ? (
        <div>
          <div
            style={{ display: 'flex', alignItems: 'baseline', gap: 12, marginBottom: 10 }}
          >
            <span className="mono fw-700" style={{ color: 'var(--cyan)', fontSize: 15 }}>
              {search.jc}
            </span>
            {ops.isFetching && !ops.isLoading ? (
              <span className="text3" style={{ fontSize: 11, fontFamily: 'var(--mono)' }}>
                <Loader2 className="inline h-3 w-3 animate-spin" /> Updating…
              </span>
            ) : null}
          </div>

          <div className="panel" style={{ marginBottom: 16 }}>
            <div className="panel-hdr">
              <span className="panel-title">Operations — click a row to log entries</span>
            </div>
            {ops.isError ? (
              <div className="panel-body" style={{ color: 'var(--red)', fontSize: 13 }}>
                {ops.error instanceof Error ? ops.error.message : 'Failed to load ops'}
              </div>
            ) : ops.isLoading ? (
              <div className="empty-state">
                <Loader2 className="mr-2 inline h-4 w-4 animate-spin" /> Loading ops…
              </div>
            ) : (
              <JcOpsTable
                ops={ops.data ?? []}
                selectedOpId={search.op ?? null}
                onSelect={handleSelectOp}
              />
            )}
          </div>

          {selectedOp ? (
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'minmax(0, 3fr) minmax(0, 2fr)',
                gap: 16,
              }}
            >
              <div>
                <OpEntryForm
                  op={selectedOp}
                  activeRunningId={activeRunningId}
                  mode={mode}
                  onModeChange={handleModeChange}
                />
              </div>
              <div className="panel">
                <div className="panel-hdr">
                  <span className="panel-title">Recent log</span>
                </div>
                <OpLogHistory logs={opLog.data ?? []} isLoading={opLog.isLoading} />
              </div>
            </div>
          ) : ops.data && ops.data.length > 0 ? (
            <div className="text3" style={{ fontSize: 13 }}>
              Select an op above to log entries.
            </div>
          ) : null}
        </div>
      ) : (
        <div className="panel">
          <div className="empty-state">Enter a job card number to load its ops.</div>
        </div>
      )}
    </div>
  );
}
