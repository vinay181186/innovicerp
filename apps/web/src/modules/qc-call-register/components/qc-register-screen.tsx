// QC Call Register / Incoming QC — the ONE screen body both routes draw
// (ADR-251). FIT tables (ADR-199) for Pending and Completed; ▸ shows the
// secondary facts; ⋯ Inspect opens the entry popup (QcCallInspectModal /
// IncomingQcInspectModal / PartyGrnQcModal — ADR-203); row click opens the doc.
//
// mode 'register' (QC Call Register): every call — incoming, in-process, final
// — with the Stage and GRN Type filters, "Mine", Full History and the TPI tab.
// Page right: qc_submit · view.
// mode 'incoming' (Incoming QC): only GRNs Against PO and Party GRNs (the query
// always carries grnType); no Stage / Mine / TPI / Full History, and no
// Operation / Assigned To columns. Page right: qc_incoming · view; Inspect
// needs qc_incoming · entry. OSP returns and NC returns stay on the register.
//
// ADR-201: 25 calls a page, paged + searched + filtered on the server (GET
// /qc-history/register); counts are its whole-register figures; Export fetches
// every match. Browser Sort & Filter is off (mixed kinds of row).

import {
  INCOMING_QC_GRN_TYPES,
  QC_GRN_TYPE_LABELS,
  type PartyGrnQcRow,
  type QcGrnType,
} from '@innovic/shared';
import { useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { Loader2 } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { normalizeSearchTerm } from '@/components/shared/search-match';
import { effectiveFormPerms, useMyAccess } from '@/lib/access-control';
import { LIST_PAGE_SIZE, useClampPage } from '@/lib/list-paging';
import { DataTable, Panel, ROW_TINT, type RowMenuItem } from '@/ui/data';
import { TABLE_KEYS } from '@/ui/data/table-keys';
import { ListFooter } from '@/ui/layout';
import { qcHistoryKeys } from '@/modules/qc-history/api';
import { TpiView } from '@/modules/tpi/components/tpi-view';
import { IncomingQcInspectModal } from '@/modules/incoming-qc/components/incoming-qc-inspect-modal';
import { QcCallInspectModal } from './qc-call-inspect-modal';
import type { RaisedNc } from './qc-call-inspect-form';
import { QC_STAGES, type QcStage, type QcView } from './qc-sheet';
import { useQcCallData } from './qc-call-data';
import { PgrnQcPopup, RaisedNcBanner, exportRegister } from './qc-call-extras';
import { useQcInspect } from './use-qc-inspect';
import { QcCallTabs } from './qc-call-tabs';
import { QcCallRegisterHeader, type QcScreenMode } from './qc-call-register-header';
import {
  PENDING_HIDDEN,
  type PendingVM,
  pendingColumns,
  pendingOverdue,
  pendingVmKey,
} from './qc-call-pending-columns';
import {
  COMPLETED_HIDDEN,
  type CompletedVM,
  completedColumns,
  completedVmKey,
} from './qc-call-completed-columns';

/** The URL params the screen reads (each route validates its own). */
export interface QcScreenParams {
  line?: string | undefined;
  op?: string | undefined;
  tab?: 'qc' | 'tpi' | undefined;
  search?: string | undefined;
  page?: number | undefined;
}
/** The URL writes the screen makes: the page, and stripping a consumed link. */
export type QcScreenPatch = { page?: number | undefined; line?: undefined; op?: undefined };

/** Columns the Incoming QC screen leaves out — no job-card op stands behind a
 *  GRN or Party GRN call, and QC Command assigns process calls only. */
const INCOMING_DROPPED = new Set(['operation', 'assigned_to']);

export function QcRegisterScreen(props: {
  mode: QcScreenMode;
  params: QcScreenParams;
  /** Writes into the route's search (replace). Must be stable. */
  patchSearch: (patch: QcScreenPatch) => void;
}): React.JSX.Element {
  const { mode, params, patchSearch } = props;
  const incoming = mode === 'incoming';
  const page = params.page ?? 1;
  const queryClient = useQueryClient();
  // Row click opens the document — a plain navigate (not bound to a route).
  const nav = useNavigate();
  // Pending | Completed toggle. Opens on Pending — the working queue.
  const [view, setView] = useState<QcView>('pending');
  // Stage filter: null = every stage. The Incoming QC screen has none.
  const [stage, setStage] = useState<QcStage | null>(null);
  // ADR-251 GRN Type filter: null = every type this screen lists.
  const [grnType, setGrnType] = useState<QcGrnType | null>(null);
  // One search box for whichever view is showing. ?search= only seeds it.
  const [search, setSearch] = useState(params.search ?? '');
  // TPI tab choice stays LOCAL — clicking a tab does not write to the URL.
  const [tab, setTab] = useState<'qc' | 'tpi'>(params.tab ?? 'qc');
  // The NC the last QC submit raised (ADR-190) — named above the list.
  const [raisedNc, setRaisedNc] = useState<RaisedNc | null>(null);
  // "Mine": only the pending calls QC Command assigned to the signed-in user.
  const [mineOnly, setMineOnly] = useState(false);
  // ADR-232: the Access Control ticks alone decide, no role check:
  //   job-card op QC (op-entry submitQcLog): qc_submit entry;
  //   incoming GRN QC and a Party GRN line (ADR-203): qc_incoming entry.
  // A user who can inspect no kind of call on this screen gets no ⋯ column.
  const { data: eff } = useMyAccess();
  const canEntry = !incoming && effectiveFormPerms(eff, 'qc_submit').entry;
  const canIncoming = effectiveFormPerms(eff, 'qc_incoming').entry;
  const showAction = canEntry || canIncoming;

  const gotoPage = useCallback(
    (p: number): void => patchSearch({ page: p > 1 ? p : undefined }),
    [patchSearch],
  );
  // The search box reaches the server 300 ms after typing stops.
  const [q, setQ] = useState(normalizeSearchTerm(params.search ?? ''));
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
  const pendCols = useMemo(
    () => pendingColumns().filter((c) => !incoming || !INCOMING_DROPPED.has(c.id ?? '')),
    [incoming],
  );
  const compCols = useMemo(
    () => completedColumns().filter((c) => !incoming || !INCOMING_DROPPED.has(c.id ?? '')),
    [incoming],
  );

  // One page of the register + the server's counts and totals. Incoming QC
  // always narrows to its own GRN Types (and the Incoming stage).
  const qc = useQcCallData({
    view,
    stage: incoming ? 'incoming' : stage,
    search: q,
    mineOnly: !incoming && mineOnly,
    grnType: grnType ? [grnType] : incoming ? INCOMING_QC_GRN_TYPES : undefined,
    page,
  });
  useClampPage(page, qc.loaded ? qc.total : undefined, gotoPage);

  // Inspect popup: deep link (?line= / ?op=), fresh row, auto-close when it leaves.
  const { setInspect, inspectOp, inspectInc } = useQcInspect({
    pageRows: qc.pendingRows,
    lineParam: params.line,
    opParam: incoming ? undefined : params.op,
    grnType: incoming ? INCOMING_QC_GRN_TYPES : undefined,
    stripParam: (key) => patchSearch(key === 'line' ? { line: undefined } : { op: undefined }),
  });

  // A Party GRN line's QC popup (ADR-203) — kept apart from useQcInspect, which
  // reads job-card op / GRN line calls only.
  const [inspectPgrn, setInspectPgrn] = useState<PartyGrnQcRow | null>(null);
  const pendingRows: PendingVM[] = qc.pendingRows;
  const completedRows: CompletedVM[] = qc.completedRows;

  // A GRN-line inspection is saved by the incoming-qc module, which refreshes
  // its own feed; the screen reads /qc-history/register, so refresh it too.
  const closeInspect = (): void => {
    setInspect(null);
    setInspectPgrn(null);
    void queryClient.invalidateQueries({ queryKey: qcHistoryKeys.all });
  };

  const openInspect = (vm: PendingVM): void => {
    if (vm.kind === 'pgrn') setInspectPgrn(vm.row);
    else if (vm.kind === 'op') setInspect({ kind: 'op', jcOpId: vm.row.jcOpId });
    else setInspect({ kind: 'inc', grnLineId: vm.row.grnLineId });
  };
  // Party GRN has no detail page — open its list searched on the PGRN no.
  const openPgrn = (row: PartyGrnQcRow): void =>
    void nav({ to: '/party-grn', search: { search: row.partyGrnNo, page: 1 } });

  // Row click opens the document the call sits on (ADR-199 standard).
  const onPendingRowClick = (vm: PendingVM): void =>
    void (vm.kind === 'pgrn'
      ? openPgrn(vm.row)
      : vm.kind === 'op'
        ? nav({ to: '/job-cards/$id', params: { id: vm.row.jobCardId } })
        : nav({ to: '/goods-receipt-notes/$id', params: { id: vm.row.grnId } }));
  const onCompletedRowClick = (vm: CompletedVM): void => {
    if (vm.kind === 'pgrn') return openPgrn(vm.row);
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

  // Inspect is the ⋯ row item; left out for a kind of call this viewer cannot
  // inspect. The menu stops the click, so the row's own open still works.
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

  // The register's QC Calls | TPI tab bar; Incoming QC has no tabs.
  const shell = (children: React.ReactNode): React.JSX.Element =>
    incoming ? (
      <div>{children}</div>
    ) : (
      <QcCallTabs tab={tab} setTab={setTab}>
        {children}
      </QcCallTabs>
    );

  // "Hide page" (Access Control → Config): once access has loaded, a user whose
  // VIEW was removed for this page sees the no-access panel, not the page. `eff`
  // is undefined only while access loads — don't block then.
  if (eff && !effectiveFormPerms(eff, incoming ? 'qc_incoming' : 'qc_submit').view) {
    return (
      <div className="empty-state" style={{ color: 'var(--amber2)', padding: 40 }}>
        {incoming
          ? 'You do not have permission to view Incoming QC. Ask an admin.'
          : 'You do not have permission to view the QC Call Register. Ask an admin.'}
      </div>
    );
  }

  // TPI first, ahead of the QC loading/error gates: TPI runs off its own query.
  if (!incoming && tab === 'tpi') {
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
            : `Could not load ${incoming ? 'Incoming QC' : 'QC Call Register'}. Try again.`}
        </div>
      </div>,
    );
  }

  const stageLabel = stage ? (QC_STAGES.find((s) => s.key === stage)?.label ?? null) : null;
  const typeLabel = grnType ? QC_GRN_TYPE_LABELS[grnType] : null;
  const stageName = incoming
    ? typeLabel
    : stageLabel && typeLabel
      ? `${stageLabel} · ${typeLabel}`
      : stageLabel;
  const narrowed = stageName !== null || q !== '';
  const pendingEmptyText =
    narrowed || mineOnly
      ? 'No QC calls match.'
      : incoming
        ? 'No incoming QC calls waiting.'
        : 'No pending QC calls yet.';
  const completedEmptyText = narrowed ? 'No QC entries match.' : 'No QC entries yet.';
  const totals = incoming
    ? qc.incomingTotals
    : { pendingCount: qc.pendingCount, completeCount: qc.completeCount, pcsPending: qc.pcsPending };

  return shell(
    <>
      <QcCallRegisterHeader
        mode={mode}
        view={view}
        setView={(v) => {
          setView(v);
          gotoPage(1);
        }}
        stage={stage}
        setStage={(s) => {
          setStage(s);
          // A GRN Type only narrows Incoming calls.
          if (s !== 'incoming') setGrnType(null);
          gotoPage(1);
        }}
        stageName={stageName}
        grnType={grnType}
        setGrnType={(t) => {
          setGrnType(t);
          if (t && !incoming) setStage('incoming');
          gotoPage(1);
        }}
        grnTypeStats={qc.grnTypeStats}
        mineOnly={mineOnly}
        onToggleMine={() => {
          setMineOnly((v) => !v);
          gotoPage(1);
        }}
        search={search}
        setSearch={setSearch}
        onClearFilters={() => {
          setStage(null);
          setGrnType(null);
          setMineOnly(false);
          setSearch('');
          setQ('');
          gotoPage(1);
        }}
        stageStats={qc.stageStats}
        shownCount={qc.total}
        pendingCount={totals.pendingCount}
        completeCount={totals.completeCount}
        pcsPending={totals.pcsPending}
        isEmpty={qc.total === 0}
        onExport={() => void exportRegister(qc.query, view)}
      />

      {raisedNc ? <RaisedNcBanner nc={raisedNc} onDismiss={() => setRaisedNc(null)} /> : null}

      {/* Two saved layouts per screen (ADR-199): the Pending queue and the
          Completed log are separate fit tables, each with its own tableKey. */}
      {view === 'pending' ? (
        <Panel bodyPadding="none">
          <DataTable
            tableKey={incoming ? TABLE_KEYS.incomingQcCallPending : TABLE_KEYS.qcCallPending}
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
            tableKey={incoming ? TABLE_KEYS.incomingQcCallCompleted : TABLE_KEYS.qcCallCompleted}
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
      {/* Incoming QC: no popup without qc_incoming · entry (false while access
          loads), so a ?line= link cannot open it for a view-only user. */}
      {inspectInc && (!incoming || canIncoming) ? (
        <IncomingQcInspectModal
          key={inspectInc.grnLineId}
          o={inspectInc}
          onClose={closeInspect}
          onNcRaised={setRaisedNc}
        />
      ) : null}
      {inspectPgrn && canIncoming ? (
        <PgrnQcPopup key={inspectPgrn.partyGrnLineId} row={inspectPgrn} onClose={closeInspect} />
      ) : null}
    </>,
  );
}
