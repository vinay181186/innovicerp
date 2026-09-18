// QC Call Register (legacy renderQCDashboard L4126, page `qcdashboard`).
// One ruled sheet (the user's mockup 2c): a title row with the register's
// totals, Export, one search box and a Pending | Completed toggle; a three-cell
// stage strip (Incoming / In-Process / Final Inspection) that also filters; and
// a hairline-ruled table. Pending calls expand inline into the accept/reject
// entry form exactly as before; completed calls read as a register log.
// Frontend-only — data from the qc-history + incoming-qc endpoints, the QC
// write reuses op-entry's submitQcLog mutation.
//
// No in-content .section-hdr: legacy's render returns the sheet directly and
// the page title lives in the topbar (#pageTitle, legacy L2232/L2322).

import {
  SHIFTS,
  SHIFT_LABELS,
  type Shift,
  type SubmitQcLogInput,
  opSrNo,
  shortName,
} from '@innovic/shared';
import type {
  IncomingQcCompletedRow,
  IncomingQcPendingRow,
  QcHistoryLogRow,
  QcHistoryPendingRow,
} from '@innovic/shared';
import { createRoute, Link } from '@tanstack/react-router';
import { Loader2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { QcReportAttach } from '@/components/shared/qc-report-attach';
import { matchesSearchTerm } from '@/components/shared/search-match';
import { effectiveFormPerms, useMyAccess } from '@/lib/access-control';
import { itemCodeWithRev } from '@/lib/item-code';
import { todayLocal } from '@/lib/date';
import { useSession } from '@/lib/session';
import { SearchableSelect } from '@/components/shared/searchable-select';
import type { SearchableOption } from '@/components/shared/searchable-select';
import { useQcUserOptions } from '@/modules/qc-users/api';
import { NO_SERVER_SEARCH, qcSelectedLabel, toQcSearchOptions } from '@/modules/qc-users/options';
import { useSubmitQcLog } from '@/modules/op-entry/api';
import { authenticatedRoute } from '@/routes/_authenticated';
import { useQcHistory } from '@/modules/qc-history/api';
import { exportCompletedQc, exportPendingQc } from '@/modules/qc-history/lib/export';
import { useIncomingQc } from '@/modules/incoming-qc/api';
import { TpiView } from '@/modules/tpi/components/tpi-view';
import { IncomingPendingRow } from '@/modules/incoming-qc/components/qc-call-rows';
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

export const qcCallRegisterRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: 'qc-call-register',
  // ?line=<grnLineId> deep-opens that incoming-QC row (the Incoming QC page's
  // Inspect button lands here).
  // ?tab=tpi opens straight on the TPI tab (the JC op card's 📋 TPI link). It
  // SEEDS the tab only — see the tab state below, which stays local.
  // ?search=<text> seeds the search box the same way (the JC op card's
  // 🔬 QC Call button passes its job-card code, so the inspector lands on that
  // card's calls instead of the whole register). Seed only — typing in the box
  // afterwards does not write back to the URL.
  validateSearch: (
    search: Record<string, unknown>,
  ): { line?: string; tab?: 'qc' | 'tpi'; search?: string } => {
    const out: { line?: string; tab?: 'qc' | 'tpi'; search?: string } = {};
    if (typeof search.line === 'string') out.line = search.line;
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
  const { line: lineParam, tab: tabParam, search: searchParam } = qcCallRegisterRoute.useSearch();
  const [openId, setOpenId] = useState<string | null>(lineParam ? `inc:${lineParam}` : null);
  // Pending | Completed toggle. Opens on Pending — that is the working queue,
  // and the ?line= deep-link lands on a pending row.
  const [view, setView] = useState<QcView>('pending');
  // Stage strip filter: null = every stage.
  const [stage, setStage] = useState<QcStage | null>(null);
  // One search box for whichever view is showing. Same fields the two old
  // per-pane boxes covered, now one term. ?search= only seeds it (see the
  // route's validateSearch).
  const [search, setSearch] = useState(searchParam ?? '');
  // Screen-merge: TPI folded in as a tab (it used to be its own /tpi page, which
  // stays registered). Tab choice stays LOCAL state — clicking a tab
  // deliberately does NOT write to the URL, so this route's own ?line=
  // deep-link param is untouched. ?tab= only SEEDS the initial value, so an
  // outside link (the JC op card's 📋 TPI button) can land on the TPI tab.
  const [tab, setTab] = useState<'qc' | 'tpi'>(tabParam ?? 'qc');
  // Caller's effective access — drives the "Hide page" VIEW guard below.
  const { data: eff } = useMyAccess();

  // People for the inline QC entry "QC By" picker. Legacy L4164 filled this from
  // db.operators (status==='Active'), which named the wrong crowd: operators are
  // shop-floor machinists. It now comes from the QC people the user defines in
  // Access Control, so an inspection can be linked to the person who signed it.
  const qcUsers = useQcUserOptions();
  const qcOptions = useMemo(
    () => toQcSearchOptions(qcUsers.data?.options ?? []),
    [qcUsers.data?.options],
  );

  const allPending = useMemo(() => data?.pending ?? [], [data]);
  const allLogsFull = useMemo(() => data?.logs ?? [], [data]);
  const incPending = useMemo(() => incomingQuery.data?.pending ?? [], [incomingQuery.data]);
  const incCompleted = useMemo(() => incomingQuery.data?.completed ?? [], [incomingQuery.data]);
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
      [o.jcCode, o.soCode, o.itemCode, o.itemRevision, o.itemName, o.operation],
      search,
    );
  const matchC = (l: QcHistoryLogRow): boolean =>
    matchesSearchTerm(
      [l.jcCode, l.soCode, l.itemCode, l.itemRevision, l.itemName, l.operation],
      search,
    );
  const matchIncP = (o: IncomingQcPendingRow): boolean =>
    matchesSearchTerm(
      [o.grnNo, o.itemCode, o.itemRevision, o.itemName, o.vendorName, o.poCode],
      search,
    );
  const matchIncC = (l: IncomingQcCompletedRow): boolean =>
    matchesSearchTerm([l.grnNo, l.itemCode, l.itemRevision, l.itemName, l.vendorName], search);
  const inStage = (s: QcStage): boolean => stage === null || stage === s;

  const pending = allPending.filter((o) => inStage(processStage(o.isLastOp)) && matchP(o));
  // Search + stage run over EVERY log the server sent (up to 500), and only
  // then is the list cut to LOG_SHOWN — so a card inspected 40 entries ago is
  // still found by its number instead of silently reading "no entries".
  const logs = allLogsFull
    .filter((l) => inStage(processStage(l.isLastOp)) && matchC(l))
    .slice(0, LOG_SHOWN);
  const incPendingF = inStage('incoming') ? incPending.filter(matchIncP) : [];
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

  // Legacy L4221's full-bleed box (margin:-16, height:calc(100vh - 112px)) is
  // kept verbatim as the outer shell; it just becomes a flex COLUMN so the tab
  // bar can sit above the sheet without a negative-margin collision. Everything
  // below the bar gets the leftover height via flex:1 + minHeight:0.
  const shell = (children: React.ReactNode): React.JSX.Element => (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: 'calc(100vh - 112px)',
        margin: -16,
        overflow: 'hidden',
      }}
    >
      <div
        style={{
          display: 'flex',
          gap: 4,
          borderBottom: '1px solid var(--border)',
          padding: '0 16px',
          flexShrink: 0,
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
      <div className="empty-state" style={{ color: 'var(--amber)', padding: 40 }}>
        ⛔ This page is hidden for your access. Ask an admin if you need access to it.
      </div>
    );
  }

  // TPI first, ahead of the QC loading/error gates: TPI runs off its own query,
  // so a failing qc-history fetch must not black out the TPI tab.
  if (tab === 'tpi') {
    return shell(
      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: 16 }}>
        <TpiView />
      </div>,
    );
  }
  if (isLoading) {
    return shell(
      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: 16 }}>
        <div className="panel">
          <div className="empty-state">
            <Loader2 className="mr-2 inline h-4 w-4 animate-spin" /> Loading QC calls…
          </div>
        </div>
      </div>,
    );
  }
  if (isError || !data) {
    return shell(
      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: 16 }}>
        <div className="panel">
          <div className="empty-state" style={{ color: 'var(--red)' }}>
            {error instanceof Error ? error.message : 'Failed to load QC call register'}
          </div>
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

  return shell(
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        flex: 1,
        minHeight: 0,
        background: 'var(--bg2)',
      }}
    >
      {/* Title row: register totals left; Export · search · Pending|Completed right. */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          padding: '10px 16px',
          borderBottom: '1px solid var(--border2)',
          flexShrink: 0,
        }}
      >
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 18, fontWeight: 700, lineHeight: 1.2 }}>QC Call Register</div>
          <div className="text3" style={{ fontSize: 12 }}>
            {pendingCount} calls · {pcsPending} pcs pending · {completeCount} completed
          </div>
        </div>
        <div style={{ flex: 1 }} />
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          style={{ fontSize: 12 }}
          disabled={isEmpty}
          title={`Export the ${view} rows on screen to Excel`}
          onClick={onExport}
        >
          ⬇ Export
        </button>
        <input
          className="innovic-input"
          style={{ fontSize: 12, width: 230 }}
          placeholder={
            view === 'pending'
              ? 'Search JC, GRN, SO, PO, item, part, vendor, op…'
              : 'Search JC, GRN, SO, item, part, vendor, op…'
          }
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <div style={{ display: 'flex', gap: 4 }}>
          {viewBtn('pending', 'Pending')}
          {viewBtn('completed', 'Completed')}
        </div>
      </div>

      <QcStageStrip stats={stageStats} selected={stage} onSelect={setStage} />

      <QcSheetTable
        view={view}
        empty={
          isEmpty ? (
            <div className="empty-state">
              {view === 'pending' ? (
                <>
                  <div style={{ fontSize: 28, marginBottom: 8 }}>✅</div>
                  No pending QC calls{stageName ? ` in ${stageName}` : ''}
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
            {incPendingF.map((o) => {
              const key = `inc:${o.grnLineId}`;
              return (
                <IncomingPendingRow
                  key={key}
                  o={o}
                  open={openId === key}
                  onToggle={() => setOpenId(openId === key ? null : key)}
                  onDone={() => setOpenId(null)}
                />
              );
            })}
            {pending.map((o) => (
              <PendingCall
                key={o.jcOpId}
                o={o}
                open={openId === o.jcOpId}
                qcOptions={qcOptions}
                qcLoading={qcUsers.isFetching}
                onToggle={() => setOpenId(openId === o.jcOpId ? null : o.jcOpId)}
                onDone={() => setOpenId(null)}
              />
            ))}
          </>
        ) : (
          completedFeed.map((it) => it.node)
        )}
      </QcSheetTable>
    </div>,
  );
}

function PendingCall(props: {
  o: QcHistoryPendingRow;
  open: boolean;
  qcOptions: SearchableOption[];
  qcLoading: boolean;
  onToggle: () => void;
  onDone: () => void;
}): React.JSX.Element {
  const { o, open, qcOptions, qcLoading, onToggle, onDone } = props;
  const submitQc = useSubmitQcLog();
  const session = useSession().data;
  const companyId = session?.companyId ?? null;
  // Tier-driven, per department. Recording accept/reject qty is `entry` on
  // qc_submit (QC). op-entry's submitQcLog already refuses without it, but this
  // screen had no check at all — an L1 Viewer was handed the whole form and only
  // discovered the 403 on click. The session below still legitimately prefills
  // the inspector name; only the form is gated.
  const { data: eff } = useMyAccess();
  const canEntry = effectiveFormPerms(eff, 'qc_submit').entry;
  const [logDate, setLogDate] = useState(todayIso());
  const [shift, setShift] = useState<Shift>('day');
  const [accept, setAccept] = useState('');
  const [reject, setReject] = useState('0');
  // Seeded with the signed-in person (the common case: the QC person on this
  // screen is the one inspecting). `inspectorId` is the Access Control user
  // behind that name once it is picked from the dropdown; the two are only ever
  // set together.
  const [inspector, setInspector] = useState(shortName(session?.fullName ?? session?.email ?? ''));
  const [inspectorId, setInspectorId] = useState<string | null>(null);
  const [remarks, setRemarks] = useState('');
  const [qcReportPath, setQcReportPath] = useState<string | null>(null);
  const [qcReportName, setQcReportName] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function submit(): Promise<void> {
    setErr(null);
    const acc = Number(accept || '0');
    const rej = Number(reject || '0');
    if (!Number.isInteger(acc) || acc < 0 || !Number.isInteger(rej) || rej < 0) {
      setErr('Accept/Reject must be non-negative integers.');
      return;
    }
    if (acc + rej <= 0) {
      setErr('Enter accept and/or reject qty.');
      return;
    }
    if (acc + rej > o.qcPending) {
      setErr(`Total ${acc + rej} exceeds pending ${o.qcPending}.`);
      return;
    }
    if (!inspector.trim()) {
      setErr('Enter who did the QC (QC By).');
      return;
    }
    // Nobody touched the dropdown, so the field still holds the seeded name of
    // the signed-in person. Their own user id is on the session, so link the
    // entry to them — but only when they are genuinely on the QC list, because
    // that list, not this screen's permissions, is what "a QC person" means.
    const seededId = session && qcOptions.some((u) => u.id === session.id) ? session.id : null;
    const qcUserId = inspectorId ?? seededId;
    const input: SubmitQcLogInput = {
      jcOpId: o.jcOpId,
      qty: acc,
      rejectQty: rej,
      logDate,
      shift,
      // The name stays the snapshot of who signed off on the day; the id below
      // is the extra link, sent only when there is a real user behind it.
      operatorName: inspector.trim(),
      ...(qcUserId ? { qcUserId } : {}),
      ...(remarks.trim() ? { remarks: remarks.trim() } : {}),
      ...(qcReportPath ? { qcReportPath, qcReportName } : {}),
    };
    try {
      await submitQc.mutateAsync(input);
      onDone();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'QC submit failed');
    }
  }

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
      partName={o.itemName}
      itemCode={itemCodeWithRev(o.itemCode, o.itemRevision)}
      context={
        <>
          <span className="mono">{o.soCode ?? '—'}</span> · Op{opSrNo(o.opSeq)} {o.operation}
        </>
      }
      contextLine2={
        o.clientPoLineNo ? (
          <span style={{ color: 'var(--purple)', fontWeight: 700 }}>CPO:{o.clientPoLineNo}</span>
        ) : undefined
      }
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
      open={open}
      onToggle={onToggle}
    >
      {/* No `entry` → the form is simply not drawn. No notice either: an
          expanded row that shows only its figures reads as view-only on its own. */}
      {canEntry ? (
        <div style={{ padding: '14px 16px', borderTop: '2px solid var(--green)' }}>
          {/* Legacy L4167: QC Entry header naming the JC/Op and the operation. */}
          <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--green)', marginBottom: 10 }}>
            ✅ QC Entry — {o.jcCode} Op{opSrNo(o.opSeq)} — {o.operation}
          </div>
          <div className="form-grid">
            <div className="form-grp">
              <label className="form-label" style={{ fontSize: 10 }}>
                Date
              </label>
              <input
                type="date"
                className="innovic-input"
                value={logDate}
                onChange={(e) => setLogDate(e.target.value)}
              />
            </div>
            <div className="form-grp">
              <label className="form-label" style={{ fontSize: 10 }}>
                Shift
              </label>
              <select
                className="innovic-select"
                value={shift}
                onChange={(e) => setShift(e.target.value as Shift)}
              >
                {SHIFTS.map((s) => (
                  <option key={s} value={s}>
                    {SHIFT_LABELS[s]}
                  </option>
                ))}
              </select>
            </div>
            <div className="form-grp">
              <label className="form-label" style={{ fontSize: 10, color: 'var(--green)' }}>
                ✅ Accept Qty (max {o.qcPending})
              </label>
              <input
                type="number"
                className="innovic-input"
                min={0}
                max={o.qcPending}
                value={accept}
                onChange={(e) => setAccept(e.target.value)}
                placeholder="0"
                style={{
                  fontSize: 18,
                  fontWeight: 800,
                  color: 'var(--green)',
                  border: '2px solid var(--green)',
                  textAlign: 'center',
                }}
              />
            </div>
            <div className="form-grp">
              <label className="form-label" style={{ fontSize: 10, color: 'var(--red)' }}>
                ❌ Reject Qty
              </label>
              <input
                type="number"
                className="innovic-input"
                min={0}
                max={o.qcPending}
                value={reject}
                onChange={(e) => setReject(e.target.value)}
                placeholder="0"
                style={{
                  fontSize: 18,
                  fontWeight: 800,
                  color: 'var(--red)',
                  border: '2px solid var(--red)',
                  textAlign: 'center',
                }}
              />
            </div>
            <div className="form-grp form-full">
              <label className="form-label" style={{ fontSize: 10 }}>
                👤 QC By ★
              </label>
              {/* The whole QC list comes back in one small response, so the
                  picker filters it in the browser and there is no ?search= to
                  round-trip. */}
              <SearchableSelect
                value={inspectorId}
                onChange={(id) => {
                  setInspectorId(id);
                  const picked = qcOptions.find((u) => u.id === id);
                  setInspector(picked ? qcSelectedLabel(picked) : '');
                }}
                options={qcOptions}
                onSearch={NO_SERVER_SEARCH}
                loading={qcLoading}
                valueLabel={inspector}
                selectedLabel={qcSelectedLabel}
                placeholder="🔍 Select QC person…"
                emptyText="No QC users — set them up in Access Control"
              />
            </div>
            <div className="form-grp form-full">
              <label className="form-label" style={{ fontSize: 10 }}>
                Remarks
              </label>
              <input
                className="innovic-input"
                value={remarks}
                onChange={(e) => setRemarks(e.target.value)}
                placeholder="NC reason, observations..."
              />
            </div>
            <div className="form-grp form-full">
              <QcReportAttach
                companyId={companyId}
                fileName={qcReportName}
                onUploaded={(path, name) => {
                  setQcReportPath(path);
                  setQcReportName(name);
                }}
                onClear={() => {
                  setQcReportPath(null);
                  setQcReportName(null);
                }}
              />
            </div>
          </div>
          {err ? (
            <div role="alert" style={{ color: 'var(--red)', fontSize: 12, marginTop: 8 }}>
              {err}
            </div>
          ) : null}
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 10 }}>
            <button type="button" className="btn btn-ghost btn-sm" onClick={onToggle}>
              Cancel
            </button>
            <button
              type="button"
              className="btn btn-success"
              disabled={submitQc.isPending}
              onClick={() => void submit()}
            >
              {submitQc.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}✓ Submit QC
            </button>
          </div>
        </div>
      ) : null}
    </PendingSheetRow>
  );
}
