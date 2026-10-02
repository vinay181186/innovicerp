// QC Call Register (legacy renderQCDashboard L4126, page `qcdashboard`).
// The shared FIT table (ADR-199), one saved layout for the Pending queue
// (TABLE_KEYS.qcCallPending) and one for the Completed log
// (TABLE_KEYS.qcCallCompleted). A row's ▸ opens its secondary facts; the Inspect
// action (pending only) opens the accept/reject entry form as a popup over the
// register (QcCallInspectModal for a job-card op, IncomingQcInspectModal for a
// GRN line); row click opens the document the call sits on. TPI is folded in
// as a tab, which renders TpiView.
//
// ADR-201: 25 calls per page (`page` in the URL). Incoming and process calls are
// paged TOGETHER on the server (GET /qc-history/register); search, the stage and
// "Mine" run there over every call, any change goes back to page 1, the stage
// counts / totals are the server's whole-register figures, and the Excel export
// fetches EVERY matching call. The tables' browser Sort & Filter is off: one
// register mixes two kinds of row whose columns come from different documents.

import { useQueryClient } from '@tanstack/react-query';
import { createRoute, useNavigate } from '@tanstack/react-router';
import { Loader2 } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { normalizeSearchTerm } from '@/components/shared/search-match';
import { effectiveFormPerms, useMyAccess } from '@/lib/access-control';
import { LIST_PAGE_SIZE, useClampPage } from '@/lib/list-paging';
import { useSession } from '@/lib/session';
import { authenticatedRoute } from '@/routes/_authenticated';
import { DataTable, Panel, ROW_TINT, type RowMenuItem } from '@/ui/data';
import { TABLE_KEYS } from '@/ui/data/table-keys';
import { ListFooter } from '@/ui/layout';
import { qcHistoryKeys } from '@/modules/qc-history/api';
import { TpiView } from '@/modules/tpi/components/tpi-view';
import { IncomingQcInspectModal } from '@/modules/incoming-qc/components/incoming-qc-inspect-modal';
import { QcCallInspectModal } from '../components/qc-call-inspect-modal';
import type { RaisedNc } from '../components/qc-call-inspect-form';
import { QC_STAGES, type QcStage, type QcView } from '../components/qc-sheet';
import { useQcCallData } from '../components/qc-call-data';
import { RaisedNcBanner, exportRegister } from '../components/qc-call-extras';
import { useQcInspect } from '../components/use-qc-inspect';
import { QcCallTabs } from '../components/qc-call-tabs';
import { QcCallRegisterHeader } from '../components/qc-call-register-header';
import {
  PENDING_HIDDEN,
  type PendingVM,
  pendingColumns,
  pendingOverdue,
  pendingVmKey,
} from '../components/qc-call-pending-columns';
import {
  COMPLETED_HIDDEN,
  type CompletedVM,
  completedColumns,
  completedVmKey,
} from '../components/qc-call-completed-columns';

// `| undefined` on line / op / page is deliberate: the deep-link effect strips a
// consumed param by writing `undefined` back, and exactOptionalPropertyTypes
// rejects that on a plain `line?: string`.
type QcCallRegisterSearch = {
  line?: string | undefined;
  op?: string | undefined;
  tab?: 'qc' | 'tpi';
  search?: string;
  /** 1-based register page (ADR-201); absent = page 1. */
  page?: number | undefined;
};

export const qcCallRegisterRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: 'qc-call-register',
  // ?line=<grnLineId> deep-opens the Inspect popup for that incoming-QC row;
  // ?op=<jcOpId> does the same for an in-process / final call. Both are
  // consumed — acted on once, then stripped from the URL (see useQcInspect), so
  // a refresh does not throw the box up again.
  // ?tab=tpi opens straight on the TPI tab (the JC op card's 📋 TPI link). It
  // SEEDS the tab only — see the tab state below, which stays local.
  // ?search=<text> seeds the search box the same way (the JC op card's
  // 🔬 QC Call button passes its job-card code, so the inspector lands on that
  // card's calls instead of the whole register). Seed only.
  validateSearch: (search: Record<string, unknown>): QcCallRegisterSearch => {
    const out: QcCallRegisterSearch = {};
    if (typeof search.line === 'string') out.line = search.line;
    if (typeof search.op === 'string') out.op = search.op;
    if (search.tab === 'qc' || search.tab === 'tpi') out.tab = search.tab;
    if (typeof search.search === 'string' && search.search.trim()) out.search = search.search;
    const page = Number(search.page);
    if (Number.isInteger(page) && page > 1) out.page = page;
    return out;
  },
  component: QcCallRegisterPage,
});

function QcCallRegisterPage(): React.JSX.Element {
  const {
    line: lineParam,
    op: opParam,
    tab: tabParam,
    search: searchParam,
    page: pageParam,
  } = qcCallRegisterRoute.useSearch();
  const page = pageParam ?? 1;
  const navigate = qcCallRegisterRoute.useNavigate();
  const queryClient = useQueryClient();
  // Row click opens the document — a plain navigate (not bound to this route) so
  // it reaches other routes cleanly.
  const nav = useNavigate();
  // Pending | Completed toggle. Opens on Pending — the working queue.
  const [view, setView] = useState<QcView>('pending');
  // Stage filter: null = every stage.
  const [stage, setStage] = useState<QcStage | null>(null);
  // One search box for whichever view is showing. ?search= only seeds it.
  const [search, setSearch] = useState(searchParam ?? '');
  // TPI tab choice stays LOCAL — clicking a tab does not write to the URL.
  const [tab, setTab] = useState<'qc' | 'tpi'>(tabParam ?? 'qc');
  // The NC the last QC submit raised (ADR-190) — named above the list with a
  // link to its disposition until dismissed.
  const [raisedNc, setRaisedNc] = useState<RaisedNc | null>(null);
  // "Mine": only the pending calls QC Command assigned to the signed-in user —
  // the server matches the caller's full name and short form.
  const [mineOnly, setMineOnly] = useState(false);
  const session = useSession().data;
  // Caller's effective access — drives the "Hide page" VIEW guard below and
  // whether a row offers Inspect. Each kind follows its server rule exactly:
  //   job-card op QC (op-entry submitQcLog): role admin / manager / operator
  //     AND qc_submit entry;
  //   incoming GRN QC (incoming-qc inspect): role admin / manager AND
  //     qc_incoming entry.
  // A viewer who can inspect neither kind gets no ⋯ column.
  const { data: eff } = useMyAccess();
  const role = session?.role;
  const canEntry =
    (role === 'admin' || role === 'manager' || role === 'operator') &&
    effectiveFormPerms(eff, 'qc_submit').entry;
  const canIncoming =
    (role === 'admin' || role === 'manager') && effectiveFormPerms(eff, 'qc_incoming').entry;
  const showAction = canEntry || canIncoming;

  const gotoPage = useCallback(
    (p: number): void => {
      void navigate({
        search: (prev) => ({ ...prev, page: p > 1 ? p : undefined }),
        replace: true,
      });
    },
    [navigate],
  );
  // The search box reaches the server 300 ms after typing stops.
  const [q, setQ] = useState(normalizeSearchTerm(searchParam ?? ''));
  useEffect(() => {
    const next = normalizeSearchTerm(search);
    if (next === q) return;
    const id = window.setTimeout(() => {
      setQ(next);
      gotoPage(1);
    }, 300);
    return () => window.clearTimeout(id);
  }, [search, q, gotoPage]);

  // Fit-table columns — static, so built once.
  const pendCols = useMemo(() => pendingColumns(), []);
  const compCols = useMemo(() => completedColumns(), []);

  // One page of the register + the server's stage counts and totals.
  const qc = useQcCallData({ view, stage, search: q, mineOnly, page });
  useClampPage(page, qc.loaded ? qc.total : undefined, gotoPage);

  // The Inspect popup target: deep-link open (?line= / ?op=), the fresh row, and
  // auto-close when the row leaves the queue.
  const { setInspect, inspectOp, inspectInc } = useQcInspect({
    pageRows: qc.pendingRows,
    lineParam,
    opParam,
    stripParam: (key) => {
      if (key === 'line') {
        void navigate({ search: (prev) => ({ ...prev, line: undefined }), replace: true });
      } else {
        void navigate({ search: (prev) => ({ ...prev, op: undefined }), replace: true });
      }
    },
  });

  // The page, in the server's order: pending = incoming (GRN) calls first, then
  // process-QC calls; completed = both kinds interleaved newest-first.
  const pendingRows: PendingVM[] = qc.pendingRows;
  const completedRows: CompletedVM[] = qc.completedRows;

  // A GRN-line inspection is saved by the incoming-qc module, which refreshes
  // its own feed; the register reads /qc-history/register, so refresh it too.
  const closeInspect = (): void => {
    setInspect(null);
    void queryClient.invalidateQueries({ queryKey: qcHistoryKeys.all });
  };

  // Open the accept/reject popup for a pending call (the existing inspect flow).
  const openInspect = (vm: PendingVM): void =>
    setInspect(
      vm.kind === 'op'
        ? { kind: 'op', jcOpId: vm.row.jcOpId }
        : { kind: 'inc', grnLineId: vm.row.grnLineId },
    );

  // Row click opens the document the call sits on (ADR-199 standard).
  const onPendingRowClick = (vm: PendingVM): void =>
    void (vm.kind === 'op'
      ? nav({ to: '/job-cards/$id', params: { id: vm.row.jobCardId } })
      : nav({ to: '/goods-receipt-notes/$id', params: { id: vm.row.grnId } }));
  const onCompletedRowClick = (vm: CompletedVM): void => {
    if (vm.kind === 'inc') {
      void nav({ to: '/goods-receipt-notes/$id', params: { id: vm.row.grnId } });
      return;
    }
    // A log row carries the card's code, not always its id — fall back to the
    // Job Cards list searched on that code when the id is absent.
    void (vm.row.jobCardId
      ? nav({ to: '/job-cards/$id', params: { id: vm.row.jobCardId } })
      : nav({ to: '/job-cards', search: { search: vm.row.jcCode, page: 1 } }));
  };

  // Inspect is the ⋯ row item. No ⋯ column when the viewer can inspect
  // nothing; the item is left out (blank cell) for a kind of call this viewer
  // cannot inspect. The menu stops the click, so the row's own open still works.
  const pendingRowMenu = showAction
    ? (vm: PendingVM): RowMenuItem[] => [
        {
          key: 'inspect',
          label: 'Inspect',
          icon: 'search',
          group: 'workflow',
          hidden: !(vm.kind === 'op' ? canEntry : canIncoming),
          onSelect: () => openInspect(vm),
        },
      ]
    : undefined;

  // The tab bar sits above whichever tab is showing.
  const shell = (children: React.ReactNode): React.JSX.Element => (
    <QcCallTabs tab={tab} setTab={setTab}>
      {children}
    </QcCallTabs>
  );

  // "Hide page" (Access Control → Config): once access has loaded, a user whose
  // VIEW was removed for this page sees the no-access panel, not the page. `eff`
  // is undefined only while access loads — don't block then, or every legitimate
  // user flashes this panel on cold load.
  if (eff && !effectiveFormPerms(eff, 'qc_submit').view) {
    return (
      <div className="empty-state" style={{ color: 'var(--amber2)', padding: 40 }}>
        You do not have permission to view the QC Call Register. Ask an admin.
      </div>
    );
  }

  // TPI first, ahead of the QC loading/error gates: TPI runs off its own query,
  // so a failing register fetch must not black out the TPI tab.
  if (tab === 'tpi') {
    return shell(<TpiView />);
  }
  if (qc.isLoading) {
    return shell(
      <div className="panel">
        <div className="empty-state">
          <Loader2 className="mr-2 inline h-4 w-4 animate-spin" /> Loading QC calls…
        </div>
      </div>,
    );
  }
  if (qc.error || !qc.loaded) {
    return shell(
      <div className="panel">
        <div className="empty-state" style={{ color: 'var(--red2)' }}>
          {qc.error instanceof Error
            ? qc.error.message
            : 'Could not load QC Call Register. Try again.'}
        </div>
      </div>,
    );
  }

  const stageName = stage ? (QC_STAGES.find((s) => s.key === stage)?.label ?? null) : null;
  const pendingEmptyText =
    stageName || q || mineOnly ? 'No QC calls match.' : 'No pending QC calls yet.';
  const completedEmptyText = stageName || q ? 'No QC entries match.' : 'No QC entries yet.';

  return shell(
    <>
      <QcCallRegisterHeader
        view={view}
        setView={(v) => {
          setView(v);
          gotoPage(1);
        }}
        stage={stage}
        setStage={(s) => {
          setStage(s);
          gotoPage(1);
        }}
        stageName={stageName}
        mineOnly={mineOnly}
        onToggleMine={() => {
          setMineOnly((v) => !v);
          gotoPage(1);
        }}
        search={search}
        setSearch={setSearch}
        onClearFilters={() => {
          setStage(null);
          setMineOnly(false);
          setSearch('');
          setQ('');
          gotoPage(1);
        }}
        stageStats={qc.stageStats}
        shownCount={qc.total}
        pendingCount={qc.pendingCount}
        completeCount={qc.completeCount}
        pcsPending={qc.pcsPending}
        isEmpty={qc.total === 0}
        onExport={() => void exportRegister(qc.query, view)}
      />

      {raisedNc ? <RaisedNcBanner nc={raisedNc} onDismiss={() => setRaisedNc(null)} /> : null}

      {/* Two saved layouts (ADR-199): the Pending queue and the Completed log
          are separate fit tables, each with its own tableKey. */}
      {view === 'pending' ? (
        <Panel bodyPadding="none">
          <DataTable
            tableKey={TABLE_KEYS.qcCallPending}
            columns={pendCols}
            rows={pendingRows}
            rowKey={pendingVmKey}
            defaultHidden={PENDING_HIDDEN}
            sortFilter={false}
            emptyText={pendingEmptyText}
            onRowClick={onPendingRowClick}
            rowClassName={(vm) =>
              pendingOverdue(vm) ? `${ROW_TINT.late} qc-alert-blink` : undefined
            }
            rowMenu={pendingRowMenu}
          />
        </Panel>
      ) : (
        <Panel bodyPadding="none">
          <DataTable
            tableKey={TABLE_KEYS.qcCallCompleted}
            columns={compCols}
            rows={completedRows}
            rowKey={completedVmKey}
            defaultHidden={COMPLETED_HIDDEN}
            sortFilter={false}
            emptyText={completedEmptyText}
            onRowClick={onCompletedRowClick}
          />
        </Panel>
      )}

      <ListFooter
        total={qc.total}
        noun={view === 'pending' ? 'pending call' : 'completed entry'}
        nounPlural={view === 'pending' ? 'pending calls' : 'completed entries'}
        page={page}
        pageSize={LIST_PAGE_SIZE}
        onPage={gotoPage}
      />

      {/* The entry popups. Keyed by the call so moving from one row to another
          starts a fresh form, never one carrying the last row's qty. */}
      {inspectOp ? (
        <QcCallInspectModal
          key={inspectOp.jcOpId}
          o={inspectOp}
          onClose={closeInspect}
          onNcRaised={setRaisedNc}
        />
      ) : null}
      {inspectInc ? (
        <IncomingQcInspectModal
          key={inspectInc.grnLineId}
          o={inspectInc}
          onClose={closeInspect}
          onNcRaised={setRaisedNc}
        />
      ) : null}
    </>,
  );
}
