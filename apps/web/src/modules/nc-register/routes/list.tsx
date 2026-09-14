// NC register list (UI-003-06).

import {
  type ListNcRegisterQuery,
  NC_REASON_CATEGORIES,
  NC_REASON_CATEGORY_LABELS,
  NC_STATUS_LABELS,
  NC_STATUSES,
  type NcReasonCategory,
  type NcStatus,
} from '@innovic/shared';
import { Link, createRoute } from '@tanstack/react-router';
import { ChevronLeft, ChevronRight, Loader2 } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { z } from 'zod';
import { StatStrip } from '@/components/shared/stat-strip';
import { normalizeSearchTerm } from '@/components/shared/search-match';
import { AssignTaskButton } from '@/modules/tasks/components/assign-task-button';
import { effectiveFormPerms, useMyAccess } from '@/lib/access-control';
import { itemCodeWithRev } from '@/lib/item-code';
import { authenticatedRoute } from '@/routes/_authenticated';
import { CapaView } from '@/modules/capa/components/capa-view';
import { useNcRegisterList, useNcRegisterSummary } from '../api';
import { NcDispositionBadge } from '../components/nc-disposition-badge';
import { NcStatusBadge } from '../components/nc-status-badge';

const PAGE_SIZE = 25;

const listSearchSchema = z.object({
  search: z.string().optional(),
  status: z.enum(NC_STATUSES).optional(),
  reasonCategory: z.enum(NC_REASON_CATEGORIES).optional(),
  page: z.coerce.number().int().positive().default(1),
});

export const ncRegisterListRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: 'nc-register',
  validateSearch: listSearchSchema,
  component: NcRegisterListPage,
});

// Accent bar colour by NC status — kept in step with NcStatusBadge's b-*
// classes: amber = still needs attention (pending / under recovery), blue =
// action taken, next move belongs to someone else, cyan = intermediate good
// (rework done), green = closed.
function accentForNc(status: NcStatus): string {
  switch (status) {
    case 'pending':
    case 'under_rework':
    case 'under_repair':
      return 'var(--amber)';
    case 'rework_done':
      return 'var(--cyan)';
    case 'closed':
      return 'var(--green)';
    default:
      // disposed, sent_to_vendor, received_qc_pending
      return 'var(--blue)';
  }
}

function NcRegisterListPage(): React.JSX.Element {
  const search = ncRegisterListRoute.useSearch();
  const navigate = ncRegisterListRoute.useNavigate();
  const { data: eff } = useMyAccess();

  const [searchInput, setSearchInput] = useState(search.search ?? '');
  useEffect(() => {
    setSearchInput(search.search ?? '');
  }, [search.search]);

  useEffect(() => {
    // normalizeSearchTerm (shared) — trims and collapses inner spacing so
    // "  NC  0012 " and "NC 0012" are one query, one cache entry, one URL.
    const trimmed = normalizeSearchTerm(searchInput);
    const next = trimmed === '' ? undefined : trimmed;
    if (next === search.search) return;
    const id = window.setTimeout(() => {
      void navigate({ search: (prev) => ({ ...prev, search: next, page: 1 }), replace: true });
    }, 300);
    return () => window.clearTimeout(id);
  }, [searchInput, search.search, navigate]);

  const query: ListNcRegisterQuery = useMemo(
    () => ({
      search: search.search,
      status: search.status,
      reasonCategory: search.reasonCategory,
      limit: PAGE_SIZE,
      offset: (search.page - 1) * PAGE_SIZE,
    }),
    [search.search, search.status, search.reasonCategory, search.page],
  );

  const { data, isLoading, isFetching, isError, error } = useNcRegisterList(query);
  const { data: summary } = useNcRegisterSummary();
  // Tier-driven, per department (QC). Was a global role string
  // (admin||manager||operator), which handed dispose rights to a manager whose
  // QC tier is L1 view-only and withheld them from a QC L3 Editor.
  const ncPerms = effectiveFormPerms(eff, 'nc_dispose');
  // Reporting an NC creates a record → entry. Disposing / closing rework
  // rewrites a saved one → edit.
  const canReportNc = ncPerms.entry;
  const canDispose = ncPerms.edit;
  // The CAPA button creates a CAPA, so it follows the CAPA form key — gating it
  // on nc_dispose meant the button could open a form the API then refused.
  const canCreateCapa = effectiveFormPerms(eff, 'capa_create').entry;

  // Screen-merge: CAPA folded in as a tab (it used to be its own /capa page,
  // which stays registered). Tab choice is local — it deliberately does NOT go
  // in the URL, so the NC list's own ?search/?status/?page params are untouched.
  const [tab, setTab] = useState<'nc' | 'capa'>('nc');

  // "Hide page" (Access Control → Config): once access has loaded, a user whose
  // VIEW was removed for this page sees the no-access panel, not the page. `eff`
  // is undefined only while access loads — don't block then, or every legitimate
  // user flashes this panel on cold load. Sits after every hook so the early
  // return never trips rules-of-hooks.
  if (eff && !ncPerms.view) {
    return (
      <div className="empty-state" style={{ color: 'var(--amber)', padding: 40 }}>
        ⛔ This page is hidden for your access. Ask an admin if you need access to it.
      </div>
    );
  }

  const rows = data?.items ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const currentPage = search.page;

  const tabBar = (
    <div
      style={{
        display: 'flex',
        gap: 4,
        borderBottom: '1px solid var(--border)',
        marginBottom: 14,
      }}
    >
      {(
        [
          ['nc', '⚠️ NC Register'],
          ['capa', '🛡 CAPA'],
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
  );

  return (
    <div>
      {tabBar}
      {tab === 'capa' ? (
        <CapaView />
      ) : (
        <>
          {/* Legacy L22549-22551: title + Report NC only; filters sit below the
          cards in their own row. */}
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              marginBottom: 14,
            }}
          >
            <div className="section-hdr" style={{ marginBottom: 0 }}>
              ❌ NC Register
            </div>
            {canReportNc ? (
              <Link to="/nc-register/new" className="btn btn-primary">
                ❌ Report NC
              </Link>
            ) : null}
          </div>

          {/* Counts as ONE single-row strip (styling skill Rule 3 + SO Master),
              not five separate .panel cards. Read-only metrics — no onClick, so
              each cell renders as a plain div. */}
          <div style={{ marginBottom: 16 }}>
            <StatStrip
              items={[
                {
                  key: 'total',
                  label: 'Total',
                  count: summary?.total == null ? '—' : Math.round(summary.total),
                  color: 'var(--red)',
                },
                {
                  key: 'pending',
                  label: 'Pending',
                  count: summary?.pending == null ? '—' : Math.round(summary.pending),
                  color: 'var(--amber)',
                },
                {
                  key: 'totalQty',
                  label: 'Total Qty',
                  count: summary?.totalQty == null ? '—' : Math.round(summary.totalQty),
                },
                {
                  key: 'rework',
                  label: 'Rework',
                  count: summary?.reworkQty == null ? '—' : Math.round(summary.reworkQty),
                  color: 'var(--cyan)',
                },
                {
                  key: 'scrap',
                  label: 'Scrap',
                  count: summary?.scrapQty == null ? '—' : Math.round(summary.scrapQty),
                  color: 'var(--red)',
                },
              ]}
            />
          </div>

          {/* Legacy L22553-22557 filter row. Placeholder names only the fields the
          API actually searches — legacy's "Search JC, item, reason..." works
          because its filter is a client-side row-text scan; the port's search
          is server-side over code/reason/item (service.ts L215) and does NOT
          match JC. */}
          <div
            style={{
              display: 'flex',
              gap: 8,
              marginBottom: 14,
              flexWrap: 'wrap',
              alignItems: 'center',
            }}
          >
            <input
              className="innovic-input"
              placeholder="🔍 Search NC no., item code, item name, reason…"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              style={{ minWidth: 220, fontSize: 13 }}
            />
            <select
              className="innovic-select"
              value={search.status ?? ''}
              onChange={(e) => {
                const v = e.target.value as NcStatus | '';
                void navigate({
                  search: (prev) => ({ ...prev, status: v === '' ? undefined : v, page: 1 }),
                  replace: true,
                });
              }}
              style={{ width: 160, fontSize: 12 }}
            >
              <option value="">All Status</option>
              {NC_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {NC_STATUS_LABELS[s]}
                </option>
              ))}
            </select>
            <select
              className="innovic-select"
              value={search.reasonCategory ?? ''}
              onChange={(e) => {
                const v = e.target.value as NcReasonCategory | '';
                void navigate({
                  search: (prev) => ({
                    ...prev,
                    reasonCategory: v === '' ? undefined : v,
                    page: 1,
                  }),
                  replace: true,
                });
              }}
              style={{ width: 160, fontSize: 12 }}
            >
              <option value="">All Reasons</option>
              {NC_REASON_CATEGORIES.map((r) => (
                <option key={r} value={r}>
                  {NC_REASON_CATEGORY_LABELS[r]}
                </option>
              ))}
            </select>
            {isFetching && !isLoading ? (
              <span className="text3" style={{ fontSize: 11, fontFamily: 'var(--mono)' }}>
                <Loader2 className="inline h-3 w-3 animate-spin" /> Updating…
              </span>
            ) : null}
          </div>

          {/* Card-per-NC list, mirroring SO Master (sales-orders list): a rounded
              panel per row with a status accent bar, an identity band and a meta
              band. An NC has no sub line items, so there is no expand toggle —
              the whole card opens the detail page. */}
          {isLoading ? (
            <div className="panel empty-state" style={{ padding: 24 }}>
              <Loader2 className="mr-2 inline h-4 w-4 animate-spin" />
              Loading…
            </div>
          ) : isError ? (
            <div className="panel empty-state" style={{ padding: 24, color: 'var(--red)' }}>
              {error instanceof Error ? error.message : 'Failed to load NCs'}
            </div>
          ) : rows.length === 0 ? (
            <div className="panel empty-state" style={{ padding: 24 }}>
              No NCs recorded. Raise one from a QC operation that rejected pieces, or with ❌ Report
              NC above.
            </div>
          ) : (
            rows.map((nc) => {
              const seq = nc.jcOpSeqResolved ?? nc.opSeq;
              const op = nc.jcOpOperation ?? nc.operationText ?? nc.qcOperationText;
              const opText =
                seq == null && !op
                  ? null
                  : `${seq != null ? `Op${seq}` : ''}${seq != null && op ? ': ' : ''}${op ?? ''}`;
              const itemCode = nc.itemCode
                ? itemCodeWithRev(nc.itemCode, nc.itemRevision)
                : (nc.itemCodeText ?? '');
              const itemName = nc.itemName ?? nc.itemNameText ?? '';
              return (
                <div
                  key={nc.id}
                  className="panel"
                  style={{ display: 'flex', overflow: 'hidden', padding: 0, marginBottom: 10 }}
                >
                  {/* Accent bar — amber pending, blue disposed, cyan rework done,
                      green closed. */}
                  <div style={{ width: 4, flexShrink: 0, background: accentForNc(nc.status) }} />
                  <div
                    style={{ flex: 1, minWidth: 0, cursor: 'pointer' }}
                    onClick={() =>
                      void navigate({ to: '/nc-register/$id', params: { id: nc.id } })
                    }
                    title="Open this NC"
                  >
                    {/* ── Band 1: identity + badges — actions ── */}
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 8,
                        flexWrap: 'wrap',
                        padding: '10px 14px',
                      }}
                    >
                      {/* The card opens the detail; the CODE is the explicit link
                          to it — stopPropagation keeps its click self-contained. */}
                      <Link
                        to="/nc-register/$id"
                        params={{ id: nc.id }}
                        className="td-code"
                        style={{ color: 'var(--red)', fontWeight: 800, fontSize: 13 }}
                        title="Open the NC detail page"
                        onClick={(e) => e.stopPropagation()}
                      >
                        {nc.code}
                      </Link>
                      {itemName ? (
                        <span
                          className="fw-700"
                          style={{
                            fontSize: 13,
                            maxWidth: 260,
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                          }}
                          title={itemName}
                        >
                          {itemName}
                        </span>
                      ) : null}
                      <NcStatusBadge status={nc.status} />
                      {nc.disposition ? <NcDispositionBadge disposition={nc.disposition} /> : null}
                      {/* Legacy L22534: rework progress hint beside the disposition. */}
                      {nc.disposition === 'rework' && Number(nc.reworkDoneQty) > 0 ? (
                        <span style={{ fontSize: 10, color: 'var(--cyan)' }}>
                          ♻ {Number(nc.reworkDoneQty)}/{Number(nc.rejectedQty)} done
                        </span>
                      ) : null}
                      <span style={{ flex: 1 }} />
                      {/* Row opens the NC detail; these controls do OTHER things,
                          so stop the click from also firing the row navigation
                          (styling skill). All these actions live on the detail
                          page — they link there, matching the old table. */}
                      <div
                        style={{ display: 'flex', gap: 3, alignItems: 'center' }}
                        onClick={(e) => e.stopPropagation()}
                      >
                        <Link
                          to="/nc-register/$id"
                          params={{ id: nc.id }}
                          className="btn btn-ghost btn-sm"
                          style={{ fontSize: 10 }}
                          title="View NC"
                        >
                          👁
                        </Link>
                        {canDispose && nc.status === 'pending' ? (
                          <Link
                            to="/nc-register/$id"
                            params={{ id: nc.id }}
                            className="btn btn-primary btn-sm"
                            style={{ fontSize: 10 }}
                            title="Dispose this NC on its detail page"
                          >
                            ✏ Dispose
                          </Link>
                        ) : null}
                        {canDispose && nc.status === 'disposed' && nc.disposition === 'rework' ? (
                          <Link
                            to="/nc-register/$id"
                            params={{ id: nc.id }}
                            className="btn btn-ghost btn-sm"
                            style={{ fontSize: 10 }}
                            title="Close the rework on this NC's detail page"
                          >
                            ✅ Close
                          </Link>
                        ) : null}
                        {canCreateCapa && nc.status !== 'pending' && !nc.linkedCapaCode ? (
                          <Link
                            to="/nc-register/$id"
                            params={{ id: nc.id }}
                            className="btn btn-ghost btn-sm"
                            style={{ fontSize: 10, color: 'var(--purple)' }}
                            title="Create a CAPA from this NC on its detail page"
                          >
                            🛡 CAPA
                          </Link>
                        ) : null}
                        {nc.linkedCapaCode ? (
                          <Link
                            to="/nc-register"
                            className="mono"
                            style={{
                              fontSize: 10,
                              color: 'var(--purple)',
                              fontWeight: 700,
                              textDecoration: 'none',
                            }}
                            title="Open linked CAPA"
                          >
                            {nc.linkedCapaCode}
                          </Link>
                        ) : null}
                        {nc.status !== 'closed' ? (
                          <AssignTaskButton
                            linkedRef={{
                              type: 'nc',
                              id: nc.id,
                              display: `NC ${nc.code}`,
                              navPage: `/nc-register/${nc.id}`,
                            }}
                            suggestedTitle={
                              nc.status === 'pending' ? `Dispose ${nc.code}` : `Review ${nc.code}`
                            }
                            className="btn btn-ghost btn-sm"
                            label=""
                          />
                        ) : null}
                      </div>
                    </div>

                    {/* ── Band 2: meta line (dot-separated) ── Item Code strong-mono
                        (the main thing — memory rule) AND Item Name, both clearly
                        shown, then JC, operation, qty, reason, date, CAPA. */}
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 6,
                        flexWrap: 'wrap',
                        padding: '0 14px 10px',
                        fontSize: 11,
                        color: 'var(--text3)',
                      }}
                    >
                      <span className="td-code" style={{ color: 'var(--text)' }}>
                        {itemCode || '—'}
                      </span>
                      <span>·</span>
                      <span
                        className="text2"
                        style={{
                          maxWidth: 200,
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}
                        title={itemName}
                      >
                        {itemName || '—'}
                      </span>
                      <span>·</span>
                      <span>
                        JC{' '}
                        <span className="mono" style={{ color: 'var(--cyan)' }}>
                          {nc.jcCode ?? '—'}
                        </span>
                      </span>
                      {opText ? (
                        <>
                          <span>·</span>
                          <span className="text2">{opText}</span>
                        </>
                      ) : null}
                      <span>·</span>
                      <span>
                        Qty{' '}
                        <span className="mono fw-700" style={{ color: 'var(--red)' }}>
                          {Number(nc.rejectedQty).toFixed(0)}
                        </span>
                      </span>
                      <span>·</span>
                      <span className="text2">
                        {NC_REASON_CATEGORY_LABELS[nc.reasonCategory]}
                      </span>
                      <span>·</span>
                      <span className="text2">{nc.ncDate}</span>
                      {nc.linkedCapaCode ? (
                        <>
                          <span>·</span>
                          <span className="mono" style={{ color: 'var(--purple)', fontWeight: 700 }}>
                            {nc.linkedCapaCode}
                          </span>
                        </>
                      ) : null}
                    </div>
                  </div>
                </div>
              );
            })
          )}

          {/* Tip line — matches the SO Master tip shape. An NC is raised
              automatically when a QC operation rejects pieces (or manually with
              ❌ Report NC). */}
          <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 8 }}>
            💡 Click the NC number (or the card) to open it. An NC is raised automatically when a QC
            operation rejects pieces (or with ❌ Report NC); then click <b>✏ Dispose</b> to decide:
            Rework, Repair, Return to Vendor, Reject / Scrap, Use As Is, or Make Fresh.
          </div>

          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              marginTop: 8,
              fontSize: 12,
              color: 'var(--text3)',
            }}
          >
            <span>
              {total === 0
                ? 'No NCs'
                : `Showing ${(currentPage - 1) * PAGE_SIZE + 1}–${Math.min(currentPage * PAGE_SIZE, total)} of ${total}`}
            </span>
            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                disabled={currentPage <= 1}
                onClick={() =>
                  void navigate({
                    search: (prev) => ({ ...prev, page: Math.max(1, currentPage - 1) }),
                    replace: true,
                  })
                }
              >
                <ChevronLeft size={14} /> Prev
              </button>
              <span style={{ fontFamily: 'var(--mono)', padding: '0 8px' }}>
                Page {currentPage} / {totalPages}
              </span>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                disabled={currentPage >= totalPages}
                onClick={() =>
                  void navigate({
                    search: (prev) => ({ ...prev, page: Math.min(totalPages, currentPage + 1) }),
                    replace: true,
                  })
                }
              >
                Next <ChevronRight size={14} />
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
