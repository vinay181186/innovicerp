import { createRoute, Link } from '@tanstack/react-router';
import { Loader2 } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { z } from 'zod';
import { SearchableSelect } from '@/components/shared/searchable-select';
import { effectiveFormPerms, useMyAccess } from '@/lib/access-control';
import { itemCodeWithRev } from '@/lib/item-code';
import { useJobCardsList } from '@/modules/job-cards/api';
import { authenticatedRoute } from '@/routes/_authenticated';
import {
  useJcOpsEnriched,
  useOpLog,
  useOpMachineOutput,
  useRealtimeOpLog,
  useRealtimeRunningOps,
} from '../api';
import { JcOpsTable } from '../components/jc-ops-table';
import { MachineOpEntryView } from '../components/machine-op-entry-view';
import { MachineOutputPanel } from '../components/machine-output-panel';
import { OpEntryModal, type OpEntryModalTarget } from '../components/op-entry-modal';
import { OpLogHistory } from '../components/op-log-history';

const searchSchema = z.object({
  jc: z.string().optional(),
  op: z.string().uuid().optional(),
  // Legacy `window._opEntryMode` (renderOpEntry L5210). JC Status enters Op
  // Entry via goToOpEntryStart / goToOpEntryComplete (L11013 / L11007), which
  // set this intent, as does the Job Queue. It is now the DEEP LINK's intent
  // only: its PRESENCE is what tells this page the URL is a request to open the
  // entry popup (rather than a row the user merely selected), and its value
  // decides which half of the popup opens first. It is consumed — removed from
  // the URL — as soon as the popup opens. Switching halves inside the popup no
  // longer writes here either; that choice lives and dies with the popup.
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

  // This whole screen is about ONE job card, so every row of `ops` carries the
  // same card id, the same item and the same source order. The first row is
  // therefore the header's data source — the `SO:` chip already read it that
  // way, and naming it once stops the header line re-indexing the array for
  // every value it prints. Null only while the ops are still loading (or the
  // typed code matched nothing), never because a field is missing.
  const jcHead = ops.data?.[0] ?? null;

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

  // THE ONE ENTRY POPUP for this tab. The Date / Time / Shift / Operator /
  // Qty fields used to sit permanently beside the table, belonging to whichever
  // row was selected — and the operator could not see which row that was while
  // typing a quantity into them. There are now no fields on screen until an
  // operation has been named by pressing its own button, and the popup states
  // the job card, the operation and the machine above every field.
  //
  // Held here, once, rather than per row: one target, so only one form can
  // exist and it always belongs to the row that opened it.
  const [entryTarget, setEntryTarget] = useState<OpEntryModalTarget | null>(null);

  // Which operation the ?op= deep link has already been honoured for. Without
  // it the effect below would re-open the popup every time the ops list
  // refetches (realtime does that on every running_ops and op_log change) and
  // again the instant the operator closed the box, because ?op= is still in the
  // URL. It is also stamped by the ordinary click handlers, so selecting or
  // logging a row by hand never counts as an unhandled deep link.
  const autoOpenedOpRef = useRef<string | null>(null);

  function handleOpenEntry(target: OpEntryModalTarget): void {
    autoOpenedOpRef.current = target.op.id;
    setEntryTarget(target);
    // Also make it the selected row, so the Machine-wise output / Recent log
    // panel underneath is showing the operation being logged.
    void navigate({
      search: (prev) => ({ ...prev, op: target.op.id }),
      replace: true,
    });
  }

  // DEEP LINK — the Job Card page (jc-status-content.tsx onStart / onLog) and
  // the Job Queue both navigate here with ?jc=<code>&op=<uuid>&mode=start or
  // complete, meaning "open the entry for this operation". The ops for that job
  // card are fetched on THIS page, so the operation the link names does not
  // exist yet on the first render — open the popup the moment the list
  // resolves, and only then.
  //
  // `mode` is what marks the URL as a link rather than a selection: every
  // caller that names an op also names an intent (four call sites, all
  // checked), while an ?op= the page wrote itself when a row was clicked
  // carries none. That is the difference between "take me to this entry" and
  // "I am looking at this row", and without it a plain page refresh would
  // throw a data-entry box over the screen.
  useEffect(() => {
    const opId = search.op;
    if (!opId || !search.mode || autoOpenedOpRef.current === opId) return;
    const op = ops.data?.find((o) => o.id === opId);
    // Still loading, or the id belongs to a different job card. Leave the ref
    // alone so a later fetch can still honour the link.
    if (!op) return;
    autoOpenedOpRef.current = opId;
    setEntryTarget({ op, activeRunningId: op.activeRunningOpId, mode: search.mode });
    // The link has now been acted on, so take the intent back out of the URL.
    // The op stays (it is the selected row), but a refresh is not a second
    // request to open the box.
    void navigate({ search: (prev) => ({ ...prev, mode: undefined }), replace: true });
  }, [ops.data, search.op, search.mode, navigate]);

  function handleJcSubmit(e: React.FormEvent) {
    e.preventDefault();
    const v = jcInput.trim();
    void navigate({
      search: () => (v ? { jc: v } : {}),
      replace: true,
    });
  }

  function handleSelectOp(opId: string) {
    // Selecting a row is a READ action now — it points the history panel
    // underneath at this operation and nothing else. Stamp the ref so the
    // deep-link effect does not mistake this for a link it has to open.
    autoOpenedOpRef.current = opId;
    void navigate({
      search: (prev) => ({ ...prev, op: opId }),
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
          </form>
        </div>
      </div>

      {search.jc ? (
        <div>
          {/* Wraps because this line now carries the part as well as the
              number: on a narrow screen the SO chip drops underneath instead
              of being pushed off the edge. At normal widths it is still one
              line. */}
          <div
            style={{ display: 'flex', alignItems: 'baseline', gap: 12, marginBottom: 10, flexWrap: 'wrap' }}
          >
            {/* The job card number is this screen's subject and was dead text:
                an operator reading an entry screen had no way back to the card
                it belongs to. `jobCardId` is NOT NULL on this shape (jc_ops
                inner-joins job_cards), so the only reason to fall back to plain
                text is that the ops have not arrived yet — there is no such
                thing as an op without a card. Same target and same underlined
                treatment as the code on the Job Cards list. */}
            {jcHead ? (
              <Link
                to="/job-cards/$id"
                params={{ id: jcHead.jobCardId }}
                className="mono fw-700"
                style={{ color: 'var(--cyan)', fontSize: 15 }}
                title="Open this job card"
              >
                {search.jc}
              </Link>
            ) : (
              <span className="mono fw-700" style={{ color: 'var(--cyan)', fontSize: 15 }}>
                {search.jc}
              </span>
            )}
            {/* WHAT is being made, beside WHICH job — the number alone left the
                operator to look the part up on another screen before booking
                against it. Built as chips like the `SO:` one below rather than
                as a new treatment, and each is dropped entirely when its value
                is null, so a card whose item did not come back reads exactly as
                this line always has. */}
            {jcHead?.itemCode ? (
              /* `CODE/REV` through the one helper — the customer's drawing
                 revision from the SO line this card was raised against. A
                 JW-sourced or standalone card has none and keeps the bare
                 code, with no trailing slash. */
              <span className="text3" style={{ fontSize: 12, fontFamily: 'var(--mono)' }}>
                Item: {itemCodeWithRev(jcHead.itemCode, jcHead.itemRevision)}
              </span>
            ) : null}
            {jcHead?.itemName ? (
              /* A part name is free text, so it truncates rather than pushing
                 the SO chip off the line; the full name stays on hover. Same
                 weight and size the Job Cards list gives an item name next to
                 a card code. */
              <span
                className="fw-700"
                style={{
                  fontSize: 13,
                  maxWidth: 320,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
                title={jcHead.itemName}
              >
                {jcHead.itemName}
              </span>
            ) : null}
            {jcHead?.soCode ? (
              /* T27: surface the source SO/JW order on Op Entry too. */
              <span className="text3" style={{ fontSize: 12, fontFamily: 'var(--mono)' }}>
                SO: {jcHead.soCode}
              </span>
            ) : null}
            {ops.isFetching && !ops.isLoading ? (
              <span className="text3" style={{ fontSize: 11, fontFamily: 'var(--mono)' }}>
                <Loader2 className="inline h-3 w-3 animate-spin" /> Updating…
              </span>
            ) : null}
          </div>

          {/* Row 1 — the Operations table, now FULL WIDTH. The Log Entry form
              used to take the right-hand half of this row permanently; it is
              now the popup at the bottom of this file, opened from a row's own
              button, so the table gets the whole width back and no field is on
              screen without the job it belongs to written above it.
              Row 2 = the Machine-wise output / Recent log tabs, unchanged,
              underneath. Applies to production AND QC inspection ops. */}
          <div className="panel" style={{ marginBottom: 16 }}>
            <div className="panel-hdr">
              <span className="panel-title">
                Operations — press ▶ Start / ✚ Log on the row you are booking against
              </span>
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
                onOpenEntry={handleOpenEntry}
              />
            )}
          </div>

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
      ) : (
        <div className="panel">
          <div className="empty-state">Enter a job card number to load its ops.</div>
        </div>
      )}

      {/* Rendered ONCE for the whole tab, never once per row — one target
          means one form, and it always belongs to the row that opened it.
          The popup closes itself on a successful save (it hands OpEntryForm
          its onSubmitted), so clearing the target here covers the ✕ and the
          overlay click. Switching between the Start and Complete halves inside
          the box updates the target so the choice sticks while it is open. */}
      {entryTarget ? (
        <OpEntryModal
          target={entryTarget}
          onClose={() => setEntryTarget(null)}
          onModeChange={(m) => setEntryTarget((t) => (t ? { ...t, mode: m } : t))}
        />
      ) : null}
        </>
      )}
    </div>
  );
}
