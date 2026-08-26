import { createRoute } from '@tanstack/react-router';
import { Loader2, Search } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { z } from 'zod';
import { SearchableSelect } from '@/components/shared/searchable-select';
import { effectiveFormPerms, useMyAccess } from '@/lib/access-control';
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
import { MachineOpEntryView } from '../components/machine-op-entry-view';
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
  // By Job Card / By Machine switch — 'machine' is the former standalone
  // /op-entry/machines screen. Absent = 'jc' (the default JC-wise entry).
  view: z.enum(['machine']).optional(),
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
  const { data: eff } = useMyAccess();

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

  const view = search.view ?? 'jc';

  // "Hide page" (Access Control → Config): once access has loaded, a user whose
  // VIEW was removed for this page sees the no-access panel, not the page. `eff`
  // is undefined only while access loads — don't block then, or every legitimate
  // user flashes this panel on cold load.
  if (eff && !effectiveFormPerms(eff, 'op_entry').view) {
    return (
      <div className="empty-state" style={{ color: 'var(--amber)', padding: 40 }}>
        ⛔ This page is hidden for your access. Ask an admin if you need access to it.
      </div>
    );
  }

  return (
    <div>
      <div className="section-hdr">Operation Entry</div>

      {/* By Job Card | By Machine switch (By Machine is the former standalone
          Machine Op Entry screen). */}
      <div style={{ display: 'flex', gap: 4, borderBottom: '1px solid var(--border)', marginBottom: 14 }}>
        {(['jc', 'machine'] as const).map((v) => (
          <button
            key={v}
            type="button"
            onClick={() =>
              void navigate({
                search: (prev) => ({ ...prev, view: v === 'jc' ? undefined : 'machine' }),
                replace: true,
              })
            }
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
            {v === 'jc' ? '📋 By Job Card' : '⚙ By Machine'}
          </button>
        ))}
      </div>

      {view === 'machine' ? (
        <MachineOpEntryView />
      ) : (
        <>
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

          {/* Two columns: LEFT = Operations table + Log Entry (stacked); RIGHT =
              Machine-wise output / Recent log tabs sidebar (once an op is
              selected). Applies to production AND QC inspection ops. */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'minmax(0, 3fr) minmax(0, 2fr)',
              gap: 16,
              alignItems: 'start',
            }}
          >
            <div>
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
                <OpEntryForm
                  op={selectedOp}
                  activeRunningId={activeRunningId}
                  mode={mode}
                  onModeChange={handleModeChange}
                />
              ) : ops.data && ops.data.length > 0 ? (
                <div className="text3" style={{ fontSize: 13 }}>
                  Select an op above to log entries.
                </div>
              ) : null}
            </div>

            <div>
              {selectedOp ? (
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
                          // Active tab = solid filled pill (btn-primary), inactive
                          // = outline (btn-ghost) — clear highlight on click.
                          className={`btn btn-sm ${active ? 'btn-primary' : 'btn-ghost'}`}
                          onClick={() => setRightTab(t.key)}
                          style={{ fontWeight: 700 }}
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
              ) : null}
            </div>
          </div>
        </div>
      ) : (
        <div className="panel">
          <div className="empty-state">Enter a job card number to load its ops.</div>
        </div>
      )}
        </>
      )}
    </div>
  );
}
