// QC Call Register (legacy renderQCDashboard L4126, page `qcdashboard`).
// One ruled sheet (the user's mockup 2c): a title row with the register's
// totals, Export, one search box and a Pending | Completed toggle; a three-cell
// stage strip (Incoming / In-Process / Final Inspection) that also filters; and
// a hairline-ruled table. Clicking a pending call opens the accept/reject
// entry form as a popup over the register (QcCallInspectModal for a job-card
// op, IncomingQcInspectModal for a GRN line — the Op Entry pattern), so the
// queue stays put behind it; completed calls read as a register log.
// Frontend-only — data from the qc-history + incoming-qc endpoints, the QC
// write reuses op-entry's submitQcLog mutation (inside the popup's form).
//
// No in-content .section-hdr: legacy's render returns the sheet directly. The
// sheet's own title row ("QC Call Register", below) is the page's title — the
// old top bar that used to repeat it is gone (header navigation, 2026-09-21).

import { opSrNo, shortName } from '@innovic/shared';
import type {
  IncomingQcCompletedRow,
  IncomingQcPendingRow,
  QcHistoryLogRow,
  QcHistoryPendingRow,
} from '@innovic/shared';
import { createRoute, Link } from '@tanstack/react-router';
import { Loader2 } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { matchesSearchTerm } from '@/components/shared/search-match';
import { ListHeader } from '@/ui/layout';
import { effectiveFormPerms, useMyAccess } from '@/lib/access-control';
import { itemCodeWithRev } from '@/lib/item-code';
import { todayLocal } from '@/lib/date';
import { useSession } from '@/lib/session';
import { Banner } from '@/ui/feedback/Banner';
import { authenticatedRoute } from '@/routes/_authenticated';
import { useQcHistory } from '@/modules/qc-history/api';
import { exportCompletedQc, exportPendingQc } from '@/modules/qc-history/lib/export';
import { useIncomingQc } from '@/modules/incoming-qc/api';
import { TpiView } from '@/modules/tpi/components/tpi-view';
import { IncomingPendingRow } from '@/modules/incoming-qc/components/qc-call-rows';
import { IncomingQcInspectModal } from '@/modules/incoming-qc/components/incoming-qc-inspect-modal';
import { QcCallInspectModal } from '../components/qc-call-inspect-modal';
import type { RaisedNc } from '../components/qc-call-inspect-form';
import {
  CompletedIncomingSheetRow,
  CompletedProcessSheetRow,
  PendingSheetRow,
  QC_STAGES,
  QcSheetTable,
  QcStageStrip,
  dayDiff,
  processStage,
  type QcStage,
  type QcView,
  type StageStat,
} from '../components/qc-sheet';

// `| undefined` on line / op is deliberate: the deep-link effect strips a
// consumed param by writing `undefined` back, and exactOptionalPropertyTypes
// rejects that on a plain `line?: string`.
type QcCallRegisterSearch = {
  line?: string | undefined;
  op?: string | undefined;
  tab?: 'qc' | 'tpi';
  search?: string;
};

// Which pending call the entry popup is open on; null = closed. Only the id is
// kept — the row itself is always read fresh off the feed, so a refetch cannot
// leave the box on stale figures.
type InspectTarget = { kind: 'op'; jcOpId: string } | { kind: 'inc'; grnLineId: string } | null;

export const qcCallRegisterRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: 'qc-call-register',
  // ?line=<grnLineId> deep-opens the Inspect popup for that incoming-QC row;
  // ?op=<jcOpId> does the same for an in-process / final call. Both are
  // consumed — acted on once, then stripped from the URL (see the deep-link
  // effect below), so a refresh does not throw the box up again.
  // ?tab=tpi opens straight on the TPI tab (the JC op card's 📋 TPI link). It
  // SEEDS the tab only — see the tab state below, which stays local.
  // ?search=<text> seeds the search box the same way (the JC op card's
  // 🔬 QC Call button passes its job-card code, so the inspector lands on that
  // card's calls instead of the whole register). Seed only — typing in the box
  // afterwards does not write back to the URL.
  validateSearch: (search: Record<string, unknown>): QcCallRegisterSearch => {
    const out: QcCallRegisterSearch = {};
    if (typeof search.line === 'string') out.line = search.line;
    if (typeof search.op === 'string') out.op = search.op;
    if (search.tab === 'qc' || search.tab === 'tpi') out.tab = search.tab;
    if (typeof search.search === 'string' && search.search.trim()) out.search = search.search;
    return out;
  },
  component: QcCallRegisterPage,
});

function todayIso(): string {
  return todayLocal();
}

// The endpoint caps the completed log at 500 rows, so a browser-side count that
// lands exactly on the cap is a floor, not a total.
const LOG_SERVER_CAP = 500;
// How many completed entries the register lists (the /qc-history page shows
// the full capped feed; this screen is the working queue, not the archive).
const LOG_SHOWN = 30;

function emptyStat(): StageStat {
  return { count: 0, pcsPending: 0, done: 0, doneCapped: false };
}

function QcCallRegisterPage(): React.JSX.Element {
  const { data, isLoading, isError, error } = useQcHistory();
  // Incoming-material QC (GRN lines) shown on the same approval screen. Optional
  // — if it fails to load we still render process QC rather than blocking.
  const incomingQuery = useIncomingQc();
  const {
    line: lineParam,
    op: opParam,
    tab: tabParam,
    search: searchParam,
  } = qcCallRegisterRoute.useSearch();
  const navigate = qcCallRegisterRoute.useNavigate();
  const [inspect, setInspect] = useState<InspectTarget>(null);
  // Pending | Completed toggle. Opens on Pending — that is the working queue,
  // and the ?line= / ?op= deep-links open a pending row's popup.
  const [view, setView] = useState<QcView>('pending');
  // Stage strip filter: null = every stage.
  const [stage, setStage] = useState<QcStage | null>(null);
  // One search box for whichever view is showing. Same fields the two old
  // per-pane boxes covered, now one term. ?search= only seeds it (see the
  // route's validateSearch).
  const [search, setSearch] = useState(searchParam ?? '');
  // Screen-merge: TPI folded in as a tab (it used to be its own /tpi page, which
  // stays registered). Tab choice stays LOCAL state — clicking a tab does
  // not write to the URL. ?tab= only SEEDS the initial value, so an outside
  // link (the JC op card's 📋 TPI button) can land on the TPI tab.
  const [tab, setTab] = useState<'qc' | 'tpi'>(tabParam ?? 'qc');
  // The NC the last QC submit raised (ADR-189) — named above the list with a
  // link to its disposition until dismissed, instead of the popup closing
  // silently. Held here, not in the popup: a fully inspected call leaves the
  // pending feed on the very refetch the submit triggers, closing the popup.
  const [raisedNc, setRaisedNc] = useState<RaisedNc | null>(null);
  // "Mine": only the pending calls QC Command assigned to the signed-in user.
  // Client-side over the loaded feed — Assigned To is the inspector's NAME
  // (qc_assignments.inspector_name), so it is matched on the session's full
  // name and its short form, case-insensitively.
  const [mineOnly, setMineOnly] = useState(false);
  const session = useSession().data;
  const myNames = useMemo(() => {
    const full = (session?.fullName ?? '').trim().toLowerCase();
    return new Set([full, shortName(session?.fullName ?? '').toLowerCase()].filter(Boolean));
  }, [session?.fullName]);
  // Caller's effective access — drives the "Hide page" VIEW guard below and
  // whether a process-QC row opens its popup (qc_submit `entry`; the incoming
  // rows check qc_incoming themselves).
  const { data: eff } = useMyAccess();
  const canEntry = effectiveFormPerms(eff, 'qc_submit').entry;

  const allPending = useMemo(() => data?.pending ?? [], [data]);
  const allLogsFull = useMemo(() => data?.logs ?? [], [data]);
  const incPending = useMemo(() => incomingQuery.data?.pending ?? [], [incomingQuery.data]);
  const incCompleted = useMemo(() => incomingQuery.data?.completed ?? [], [incomingQuery.data]);

  // The popup's row, read fresh off the WHOLE feed (not the searched subset,
  // so typing in the search box while the box is up does not close it).
  const inspectOp =
    inspect?.kind === 'op' ? (allPending.find((o) => o.jcOpId === inspect.jcOpId) ?? null) : null;
  const inspectInc =
    inspect?.kind === 'inc'
      ? (incPending.find((o) => o.grnLineId === inspect.grnLineId) ?? null)
      : null;

  // DEEP LINK — ?line= / ?op= open the popup once the matching feed has
  // loaded and the call is in it. Acted on once per id, then the param is
  // stripped (replace, so Back does not step through it) — the op-entry
  // pattern. A call that is not in the queue (already inspected elsewhere)
  // opens nothing; the param is still consumed.
  const autoOpenedRef = useRef<string | null>(null);
  useEffect(() => {
    if (!lineParam || !incomingQuery.data || autoOpenedRef.current === `inc:${lineParam}`) return;
    autoOpenedRef.current = `inc:${lineParam}`;
    if (incPending.some((o) => o.grnLineId === lineParam)) {
      setInspect({ kind: 'inc', grnLineId: lineParam });
    }
    void navigate({ search: (prev) => ({ ...prev, line: undefined }), replace: true });
  }, [lineParam, incomingQuery.data, incPending, navigate]);
  useEffect(() => {
    if (!opParam || !data || autoOpenedRef.current === `op:${opParam}`) return;
    autoOpenedRef.current = `op:${opParam}`;
    if (allPending.some((o) => o.jcOpId === opParam)) setInspect({ kind: 'op', jcOpId: opParam });
    void navigate({ search: (prev) => ({ ...prev, op: undefined }), replace: true });
  }, [opParam, data, allPending, navigate]);

  // The row vanished after a refetch — fully inspected elsewhere, or the call
  // was withdrawn — so there is nothing left to inspect: close rather than
  // keep a form up for a call that no longer needs one. Only once its feed
  // has loaded, or the box would shut on the poll's first empty render.
  useEffect(() => {
    if (inspect?.kind === 'op' && data && !allPending.some((o) => o.jcOpId === inspect.jcOpId)) {
      setInspect(null);
    }
    if (
      inspect?.kind === 'inc' &&
      incomingQuery.data &&
      !incPending.some((o) => o.grnLineId === inspect.grnLineId)
    ) {
      setInspect(null);
    }
  }, [inspect, data, allPending, incomingQuery.data, incPending]);

  // Server-owned count (op_log COUNT(*) where log_type='qc'). `data.logs` is
  // capped at LIMIT 500 by the endpoint, so counting it in the browser silently
  // under-reports past 500 entries.
  const completeCount = (data?.stats.totalEntries ?? 0) + incCompleted.length;
  const pendingCount = (data?.stats.pendingOps ?? 0) + incPending.length;
  const pcsPending =
    allPending.reduce((n, o) => n + o.qcPending, 0) +
    incPending.reduce((n, o) => n + o.pendingQty, 0);

  // Stage strip figures — over the whole register, not the searched subset, so
  // the strip reads as the register's totals and clicking a cell does not zero
  // its neighbours. "done" for the two process stages is counted over the
  // capped 500-row log, so it shows as a floor ("500+") once the cap is hit.
  const stageStats = useMemo(() => {
    const st: Record<QcStage, StageStat> = {
      incoming: emptyStat(),
      inprocess: emptyStat(),
      final: emptyStat(),
    };
    for (const o of incPending) st.incoming.pcsPending += o.pendingQty;
    for (const o of allPending) st[processStage(o.isLastOp)].pcsPending += o.qcPending;
    st.incoming.done = incCompleted.length;
    for (const l of allLogsFull) st[processStage(l.isLastOp)].done += 1;
    const capped = allLogsFull.length >= LOG_SERVER_CAP;
    st.inprocess.doneCapped = capped;
    st.final.doneCapped = capped;
    if (view === 'pending') {
      st.incoming.count = incPending.length;
      for (const o of allPending) st[processStage(o.isLastOp)].count += 1;
    } else {
      st.incoming.count = incCompleted.length;
      for (const l of allLogsFull) st[processStage(l.isLastOp)].count += 1;
    }
    return st;
  }, [view, incPending, allPending, incCompleted, allLogsFull]);

  // Search: the revision is part of what the row shows, so it is part of what
  // the box searches; the part name searches on the same footing as the code
  // because an inspector is far likelier to remember "plunger". These filters
  // run over rows already loaded, so widening them cannot hide anything the
  // server did send.
  const matchP = (o: QcHistoryPendingRow): boolean =>
    matchesSearchTerm(
      [o.jcCode, o.soCode, o.clientPoLineNo, o.itemCode, o.itemRevision, o.itemName, o.operation],
      search,
    );
  const matchC = (l: QcHistoryLogRow): boolean =>
    matchesSearchTerm(
      [l.jcCode, l.soCode, l.clientPoLineNo, l.itemCode, l.itemRevision, l.itemName, l.operation],
      search,
    );
  const matchIncP = (o: IncomingQcPendingRow): boolean =>
    matchesSearchTerm(
      [o.grnNo, o.clientPoLineNo, o.itemCode, o.itemRevision, o.itemName, o.vendorName, o.poCode],
      search,
    );
  const matchIncC = (l: IncomingQcCompletedRow): boolean =>
    matchesSearchTerm(
      [l.grnNo, l.clientPoLineNo, l.itemCode, l.itemRevision, l.itemName, l.vendorName],
      search,
    );
  const inStage = (s: QcStage): boolean => stage === null || stage === s;

  const isMine = (o: QcHistoryPendingRow): boolean =>
    !!o.assignedTo && myNames.has(o.assignedTo.trim().toLowerCase());
  const pending = allPending.filter(
    (o) => inStage(processStage(o.isLastOp)) && matchP(o) && (!mineOnly || isMine(o)),
  );
  // Search + stage run over EVERY log the server sent (up to 500), and only
  // then is the list cut to LOG_SHOWN — so a card inspected 40 entries ago is
  // still found by its number instead of silently reading "no entries".
  const logs = allLogsFull
    .filter((l) => inStage(processStage(l.isLastOp)) && matchC(l))
    .slice(0, LOG_SHOWN);
  // Incoming (GRN) calls carry no QC Command assignment, so "Mine" hides them.
  const incPendingF = inStage('incoming') && !mineOnly ? incPending.filter(matchIncP) : [];
  const incCompletedF = inStage('incoming') ? incCompleted.filter(matchIncC) : [];

  // Unified completed feed — incoming + process QC interleaved newest-first by
  // the actual QC timestamp, so a fresh entry isn't buried (previously ALL
  // incoming rows rendered above ALL process logs regardless of when done).
  const completedFeed = [
    ...incCompletedF.map((l) => ({
      key: `inc:${l.grnLineId}`,
      at: l.qcAt ?? l.qcDate ?? l.grnDate ?? '',
      node: <CompletedIncomingSheetRow key={`inc:${l.grnLineId}`} l={l} />,
    })),
    ...logs.map((l) => ({
      key: `proc:${l.logId}`,
      at: l.loggedAt ?? l.logDate ?? '',
      node: <CompletedProcessSheetRow key={l.logId} l={l} />,
    })),
  ].sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));

  // Export the rows on screen (after search + stage), for the view showing.
  function onExport(): void {
    if (view === 'pending') exportPendingQc(pending, incPendingF);
    else exportCompletedQc(logs, incCompletedF);
  }

  // The tab bar sits above whichever tab is showing. No full-bleed box any
  // more (it used margin:-16 + a fixed height): the app shell owns the gutter
  // and the width, and the sheet scrolls inside its own .tbl-wrap.
  const shell = (children: React.ReactNode): React.JSX.Element => (
    <div>
      <div
        style={{
          display: 'flex',
          gap: 4,
          borderBottom: '1px solid var(--border)',
          marginBottom: 'var(--sp-2)',
        }}
      >
        {(
          [
            ['qc', '📋 QC Queue'],
            ['tpi', '🔍 TPI'],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            onClick={() => setTab(key)}
            style={{
              background: 'none',
              border: 'none',
              borderBottom: tab === key ? '2px solid var(--cyan)' : '2px solid transparent',
              color: tab === key ? 'var(--cyan)' : 'var(--text3)',
              fontSize: 12,
              fontWeight: 700,
              padding: '6px 12px',
              cursor: 'pointer',
              marginBottom: -1,
            }}
          >
            {label}
          </button>
        ))}
      </div>
      {children}
    </div>
  );

  // "Hide page" (Access Control → Config): once access has loaded, a user whose
  // VIEW was removed for this page sees the no-access panel, not the page. `eff`
  // is undefined only while access loads — don't block then, or every legitimate
  // user flashes this panel on cold load.
  if (eff && !effectiveFormPerms(eff, 'qc_submit').view) {
    return (
      <div className="empty-state" style={{ color: 'var(--amber2)', padding: 40 }}>
        ⛔ This page is hidden for your access. Ask an admin if you need access to it.
      </div>
    );
  }

  // TPI first, ahead of the QC loading/error gates: TPI runs off its own query,
  // so a failing qc-history fetch must not black out the TPI tab.
  if (tab === 'tpi') {
    return shell(<TpiView />);
  }
  if (isLoading) {
    return shell(
      <div className="panel">
        <div className="empty-state">
          <Loader2 className="mr-2 inline h-4 w-4 animate-spin" /> Loading QC calls…
        </div>
      </div>,
    );
  }
  if (isError || !data) {
    return shell(
      <div className="panel">
        <div className="empty-state" style={{ color: 'var(--red2)' }}>
          {error instanceof Error ? error.message : 'Could not load QC Call Register. Try again.'}
        </div>
      </div>,
    );
  }

  // Pending | Completed segmented toggle: the chosen side is filled dark, the
  // other outlined — the mockup's two-button switch, built on the .btn base.
  const viewBtn = (v: QcView, label: string): React.JSX.Element => {
    const on = view === v;
    return (
      <button
        key={v}
        type="button"
        className="btn btn-sm"
        aria-pressed={on}
        onClick={() => setView(v)}
        style={{
          background: on ? 'var(--text)' : 'var(--bg2)',
          color: on ? 'var(--bg2)' : 'var(--text)',
          border: `1px solid ${on ? 'var(--text)' : 'var(--border2)'}`,
          fontSize: 12,
        }}
      >
        {label}
      </button>
    );
  };

  const isEmpty =
    view === 'pending'
      ? pending.length === 0 && incPendingF.length === 0
      : completedFeed.length === 0;
  const stageName = stage ? QC_STAGES.find((s) => s.key === stage)?.label : null;

  const shownCount =
    view === 'pending' ? pending.length + incPendingF.length : completedFeed.length;

  return shell(
    <>
      <ListHeader
        title="QC Call Register"
        icon="📋"
        count={shownCount}
        noun={view === 'pending' ? 'pending call' : 'completed entry'}
        nounPlural={view === 'pending' ? 'pending calls' : 'completed entries'}
        filterNote={stageName ?? undefined}
        search={search}
        onSearch={setSearch}
        searchPlaceholder="Search JC, GRN, SO, POL, item, part, vendor…"
        tools={
          <>
            <div style={{ display: 'flex', gap: 4 }}>
              {viewBtn('pending', 'Pending')}
              {viewBtn('completed', 'Completed')}
            </div>
            {view === 'pending' ? (
              <button
                type="button"
                className="btn btn-sm"
                aria-pressed={mineOnly}
                title="Only the QC calls assigned to you on QC Command"
                onClick={() => setMineOnly((v) => !v)}
                style={{
                  background: mineOnly ? 'var(--text)' : 'var(--bg2)',
                  color: mineOnly ? 'var(--bg2)' : 'var(--text)',
                  border: `1px solid ${mineOnly ? 'var(--text)' : 'var(--border2)'}`,
                  fontSize: 12,
                }}
              >
                👤 Mine
              </button>
            ) : null}
            {view === 'completed' ? (
              <Link
                to="/qc-history"
                className="btn btn-ghost btn-sm"
                title="The full QC history log — every completed entry, not just the latest 30"
              >
                Full history →
              </Link>
            ) : null}
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              disabled={isEmpty}
              title={`Export the ${view} rows on screen to Excel`}
              onClick={onExport}
            >
              ⬇ Export
            </button>
          </>
        }
      >
        <div className="text3" style={{ fontSize: 12 }}>
          {pendingCount} calls · {pcsPending} pcs pending · {completeCount} completed
        </div>
        <QcStageStrip stats={stageStats} selected={stage} onSelect={setStage} />
      </ListHeader>

      {raisedNc ? (
        <Banner
          tone="warn"
          accent
          onDismiss={() => setRaisedNc(null)}
          title={
            <>
              NC{' '}
              <span className="mono fw-700" style={{ color: 'var(--text)' }}>
                {raisedNc.code}
              </span>{' '}
              raised —{' '}
              <Link to="/nc-register/$id" params={{ id: raisedNc.id }}>
                Dispose now →
              </Link>
            </>
          }
        >
          The rejected qty from the QC Inspection just saved is on this NC until it is disposed.
        </Banner>
      ) : null}

      <QcSheetTable
        view={view}
        empty={
          isEmpty ? (
            <div className="empty-state">
              {view === 'pending' ? (
                <>
                  <div style={{ fontSize: 28, marginBottom: 8 }}>✅</div>
                  No pending QC calls{mineOnly ? ' assigned to you' : ''}
                  {stageName ? ` in ${stageName}` : ''}
                  {search.trim() ? ' matching your search' : ''}
                </>
              ) : (
                <>
                  No QC entries{stageName ? ` in ${stageName}` : ''}
                  {search.trim() ? ' matching your search' : ' yet'}
                </>
              )}
            </div>
          ) : null
        }
      >
        {view === 'pending' ? (
          <>
            {incPendingF.map((o) => (
              <IncomingPendingRow
                key={`inc:${o.grnLineId}`}
                o={o}
                onInspect={() => setInspect({ kind: 'inc', grnLineId: o.grnLineId })}
              />
            ))}
            {pending.map((o) => (
              <PendingCall
                key={o.jcOpId}
                o={o}
                canInspect={canEntry}
                onInspect={() => setInspect({ kind: 'op', jcOpId: o.jcOpId })}
              />
            ))}
          </>
        ) : (
          completedFeed.map((it) => it.node)
        )}
      </QcSheetTable>

      {/* The entry popups. Keyed by the call so moving from one row to
          another starts a fresh form, never one carrying the last row's qty. */}
      {inspectOp ? (
        <QcCallInspectModal
          key={inspectOp.jcOpId}
          o={inspectOp}
          onClose={() => setInspect(null)}
          onNcRaised={setRaisedNc}
        />
      ) : null}
      {inspectInc ? (
        <IncomingQcInspectModal
          key={inspectInc.grnLineId}
          o={inspectInc}
          onClose={() => setInspect(null)}
        />
      ) : null}
    </>,
  );
}

// One pending job-card operation on the sheet. The entry form itself is not
// here any more — it is the popup (components/qc-call-inspect-modal.tsx) the
// page opens when this line is clicked.
function PendingCall(props: {
  o: QcHistoryPendingRow;
  /** qc_submit `entry` — without it the line reads "View only" and does not
   *  open (op-entry's submitQcLog would refuse the write anyway). */
  canInspect: boolean;
  onInspect: () => void;
}): React.JSX.Element {
  const { o, canInspect, onInspect } = props;

  return (
    <PendingSheetRow
      className={o.overdue ? 'qc-alert-blink' : undefined}
      code={
        <Link
          to="/job-cards/$id"
          params={{ id: o.jobCardId }}
          title="Open this job card"
          style={{ color: 'inherit' }}
        >
          {o.jcCode}
        </Link>
      }
      // POL has its own column on the sheet now, beside the item code.
      clientPoLineNo={o.clientPoLineNo}
      partName={o.itemName}
      itemCode={itemCodeWithRev(o.itemCode, o.itemRevision)}
      context={
        <>
          <span className="mono">{o.soCode ?? '—'}</span> · Op{opSrNo(o.opSeq)} {o.operation}
        </>
      }
      // Assigned To (NAMING.md) — QC Command's inspector for this call.
      contextLine2={o.assignedTo ? `Assigned To: ${o.assignedTo}` : undefined}
      qty={o.qcPending}
      calledDate={o.qcCallDate ?? o.pendSince}
      waitDays={(() => {
        // Measured from the SAME date the cell shows, or "15-Sep · 7 days
        // waiting" would contradict itself when the call came after completion.
        const from = o.qcCallDate ?? o.pendSince;
        return from ? dayDiff(from, todayIso()) : null;
      })()}
      overdue={o.overdue}
      stage={processStage(o.isLastOp)}
      canInspect={canInspect}
      onInspect={onInspect}
    />
  );
}
