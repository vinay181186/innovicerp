import { createRoute } from '@tanstack/react-router';
import { Loader2, Search } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { z } from 'zod';
import { SearchableSelect } from '@/components/shared/searchable-select';
import { useJobCardsList } from '@/modules/job-cards/api';
import { authenticatedRoute } from '@/routes/_authenticated';
import {
  useJcOpsEnriched,
  useOpLog,
  useOpMachineOutput,
  useRealtimeOpLog,
  useRealtimeRunningOps,
  useRunningOps,
} from '../api';
import { JcOpsTable } from '../components/jc-ops-table';
import { MachineOutputPanel } from '../components/machine-output-panel';
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

  // Job Card No. is the shared type-to-search dropdown (see /dropdown skill),
  // backed server-side by the job-cards list `?search=` (matches jc code, item
  // code/name, and source SO/JW). Picking a JC loads it immediately; the typed
  // term also feeds jcInput so the Load button / Enter still work for an exact
  // code the user knows.
  const [jcId, setJcId] = useState<string | null>(null);
  const [jcSearch, setJcSearch] = useState('');
  const jcList = useJobCardsList({
    ...(jcSearch.trim() ? { search: jcSearch.trim() } : {}),
    limit: 20,
    offset: 0,
  });
  const jcOptions = useMemo(
    () => (jcList.data?.items ?? []).map((j) => ({ id: j.id, code: j.code, name: j.itemName })),
    [jcList.data],
  );

  // Right column tabs: Machine-wise output ↔ Recent log (one panel, one active
  // at a time) instead of two stacked panels.
  const [rightTab, setRightTab] = useState<'machine' | 'log'>('machine');

  function handlePickJc(id: string | null): void {
    setJcId(id);
    if (!id) return;
    const opt = jcList.data?.items.find((j) => j.id === id);
    if (!opt) return;
    setJcInput(opt.code);
    void navigate({ search: () => ({ jc: opt.code }), replace: true });
  }

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
  // 0095: qty-wise machine breakdown for the selected op.
  const machineOutput = useOpMachineOutput(
    { jcOpId: selectedOp?.id ?? '' },
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
            <div className="form-grp" style={{ marginBottom: 0, minWidth: 300 }}>
              <label className="form-label" htmlFor="jc-input">
                Job Card No.
              </label>
              <SearchableSelect
                id="jc-input"
                value={jcId}
                onChange={handlePickJc}
                onSearch={(term) => {
                  setJcSearch(term);
                  if (term) setJcInput(term);
                }}
                loading={jcList.isFetching}
                options={jcOptions}
                placeholder="🔍 Job card no, item, or SO…"
                emptyText="No job cards"
                valueLabel={search.jc ?? undefined}
                selectedLabel={(o) => o.code ?? o.name}
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
            {ops.data?.[0]?.soCode ? (
              /* T27: surface the source SO/JW order on Op Entry too. */
              <span className="text3" style={{ fontSize: 12, fontFamily: 'var(--mono)' }}>
                SO: {ops.data[0].soCode}
              </span>
            ) : null}
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
            // Log Entry form on top, then the Machine-wise output / Recent log
            // tabs BELOW it (full width) — stacked, not side-by-side.
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <div>
                <OpEntryForm
                  op={selectedOp}
                  activeRunningId={activeRunningId}
                  mode={mode}
                  onModeChange={handleModeChange}
                />
              </div>
              <div>
                <div className="panel">
                  <div
                    className="panel-hdr"
                    style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}
                  >
                    {(
                      [
                        { key: 'machine', label: 'Machine-wise output' },
                        { key: 'log', label: 'Recent log' },
                      ] as const
                    ).map((t) => {
                      const active = rightTab === t.key;
                      return (
                        <button
                          key={t.key}
                          type="button"
                          className="btn btn-sm"
                          onClick={() => setRightTab(t.key)}
                          style={{
                            borderColor: active ? 'var(--cyan)' : 'var(--border2)',
                            background: active ? 'var(--bg4)' : 'transparent',
                            color: active ? 'var(--cyan)' : 'var(--text2)',
                            fontWeight: 700,
                          }}
                        >
                          {t.label}
                        </button>
                      );
                    })}
                  </div>
                  {rightTab === 'machine' ? (
                    <MachineOutputPanel
                      rows={machineOutput.data ?? []}
                      isLoading={machineOutput.isLoading}
                    />
                  ) : (
                    <OpLogHistory
                      logs={opLog.data ?? []}
                      isLoading={opLog.isLoading}
                      {...(selectedOp ? { jcOpId: selectedOp.id } : {})}
                    />
                  )}
                </div>
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
