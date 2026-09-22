// GRN list (UI-003-05). Ports legacy renderGRN L26444.
//
// Rendered as one CARD per GRN, the same layout the SO Master list uses
// (sales-orders/routes/list.tsx, reference supplied 2026-08-11): frozen header
// band with status pills, accent bar, identity row with badges, metric strip,
// meta line, and the GRN's lines inside an expandable panel. Replaced a
// twelve-column table; no field was dropped in the move, only regrouped.
//
// The table machinery (TanStack column defs + SortableHead) is gone with it:
// a card list has no column headers to click. It only ever sorted the 25 rows
// already on screen.

import {
  GRN_QC_STATUSES,
  type GoodsReceiptNoteListItem,
  type GrnQcStatus,
  type ListGoodsReceiptNotesQuery,
} from '@innovic/shared';
import { Link, createRoute } from '@tanstack/react-router';
import { ChevronDown, ChevronLeft, ChevronRight, Loader2, Plus } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { z } from 'zod';
import { StatStrip } from '@/components/shared/stat-strip';
import { normalizeSearchTerm } from '@/components/shared/search-match';
import { effectiveFormPerms, useMyAccess } from '@/lib/access-control';
import { itemCodeWithRev } from '@/lib/item-code';
import { AssignTaskButton } from '@/modules/tasks/components/assign-task-button';
import { authenticatedRoute } from '@/routes/_authenticated';
import { useGoodsReceiptNote, useGoodsReceiptNotesList } from '../api';
import { QcStatusBadge } from '../components/qc-status-badge';

// Pagination is KEPT here (unlike SO Master): the GRN API is paginated and the
// receipt book grows every day, so the whole list is not loaded in one go.
const PAGE_SIZE = 25;

/** One cell of the card's metric strip — big number over a small caps label.
 *  Local copy of the SO list's QtyBox (it is local there too — no cross-module
 *  import). */
function QtyBox({
  label,
  value,
  color,
  bordered,
}: {
  label: string;
  value: number;
  color?: string | undefined;
  bordered?: boolean;
}): React.JSX.Element {
  return (
    <div
      style={{
        padding: '4px 12px',
        textAlign: 'center',
        minWidth: 58,
        borderLeft: bordered ? '1px solid var(--border)' : undefined,
      }}
    >
      <div
        className="mono fw-700"
        style={{ fontSize: 15, color: color ?? 'var(--text)', lineHeight: 1.2 }}
      >
        {value}
      </div>
      <div
        className="mono"
        style={{
          fontSize: 9,
          color: 'var(--text3)',
          textTransform: 'uppercase',
          letterSpacing: '0.08em',
        }}
      >
        {label}
      </div>
    </div>
  );
}

const listSearchSchema = z.object({
  search: z.string().optional(),
  qcStatus: z.enum(GRN_QC_STATUSES).optional(),
  page: z.coerce.number().int().positive().default(1),
});

export const goodsReceiptNotesListRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: 'goods-receipt-notes',
  validateSearch: listSearchSchema,
  component: GoodsReceiptNotesListPage,
});

function GoodsReceiptNotesListPage(): React.JSX.Element {
  const search = goodsReceiptNotesListRoute.useSearch();
  const navigate = goodsReceiptNotesListRoute.useNavigate();
  // Tier-driven, per department (Store). Was `role === admin || manager`, which
  // handed a Purchase manager the Store's receipt book and locked out the L2
  // storekeeper whose job this is.
  const { data: eff } = useMyAccess();
  const perms = effectiveFormPerms(eff, 'grn_create');

  const [searchInput, setSearchInput] = useState(search.search ?? '');
  useEffect(() => {
    setSearchInput(search.search ?? '');
  }, [search.search]);

  useEffect(() => {
    // normalizeSearchTerm (shared) — trims and collapses inner spacing so
    // "  IN-GRN  00012 " and "IN-GRN 00012" are one query, one cache entry, one URL.
    const trimmed = normalizeSearchTerm(searchInput);
    const next = trimmed === '' ? undefined : trimmed;
    if (next === search.search) return;
    const id = window.setTimeout(() => {
      void navigate({ search: (prev) => ({ ...prev, search: next, page: 1 }), replace: true });
    }, 300);
    return () => window.clearTimeout(id);
  }, [searchInput, search.search, navigate]);

  const query: ListGoodsReceiptNotesQuery = useMemo(
    () => ({
      search: search.search,
      qcStatus: search.qcStatus,
      limit: PAGE_SIZE,
      offset: (search.page - 1) * PAGE_SIZE,
    }),
    [search.search, search.qcStatus, search.page],
  );

  const { data, isLoading, isFetching, isError, error } = useGoodsReceiptNotesList(query);

  // Many cards can be open at once, so this is a Set. Nothing auto-expands on
  // load: each open card fetches that GRN's detail, and expanding 25 of them on
  // arrival would fire 25 requests nobody asked for.
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const toggleExpand = (id: string): void =>
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const rows = data?.items ?? [];
  const allExpanded = rows.length > 0 && rows.every((r) => expandedIds.has(r.id));

  /** Left accent bar — green once every line is QC-cleared, amber while any
   *  line still waits on QC. Same two tokens the status badge uses. */
  const accentFor = (grn: GoodsReceiptNoteListItem): string =>
    grn.grnStatus === 'close' ? 'var(--green)' : 'var(--amber)';

  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const currentPage = search.page;

  // "Hide page" (Access Control → Config): once access has loaded, a user whose
  // VIEW was removed for this page sees the no-access panel, not the page. `eff`
  // is undefined only while access loads — don't block then, or every legitimate
  // user flashes this panel on cold load.
  if (eff && !perms.view) {
    return (
      <div className="empty-state" style={{ color: 'var(--amber)', padding: 40 }}>
        ⛔ This page is hidden for your access. Ask an admin if you need access to it.
      </div>
    );
  }

  return (
    <div>
      {/* Frozen header band — the title, the search toolbar and the status
          pills stay put while the GRN cards scroll underneath. `#content` is
          the app's scroll container, so `top:0` pins this band to its padding
          box; the background must be opaque and match #content's own (`--bg`)
          or the cards show through as they pass under it. Not bled to the
          edges with negative margins — see the SO list for why (a mismatch
          gives the whole app a horizontal scrollbar). */}
      <div
        style={{
          position: 'sticky',
          top: 0,
          zIndex: 20,
          background: 'var(--bg)',
          paddingBottom: 8,
          marginBottom: 10,
          borderBottom: '1px solid var(--border)',
        }}
      >
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'flex-start',
            marginBottom: 10,
            gap: 8,
            flexWrap: 'wrap',
          }}
        >
          <div>
            <div className="section-hdr" style={{ marginBottom: 0 }}>
              📥 Goods Receipt Note (GRN)
            </div>
            {/* Count comes from the list response's `total` — the whole book,
                not just the page on screen. */}
            <div className="text3" style={{ fontSize: 12, marginTop: 2 }}>
              {total} GRN{total === 1 ? '' : 's'}
              {search.qcStatus ? (
                <>
                  {' '}
                  · <span className="text2">{search.qcStatus.replaceAll('_', ' ')}</span> only
                </>
              ) : null}
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <input
              className="innovic-input"
              placeholder="Search GRN no., PO, vendor, DC, invoice…"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              style={{ width: 220, fontSize: 12 }}
            />
            {isFetching && !isLoading ? (
              <span className="text3" style={{ fontSize: 11, fontFamily: 'var(--mono)' }}>
                <Loader2 className="inline h-3 w-3 animate-spin" /> Updating…
              </span>
            ) : null}
            {perms.entry ? (
              <Link to="/goods-receipt-notes/new" className="btn btn-primary">
                <Plus size={14} /> New GRN
              </Link>
            ) : null}
          </div>
        </div>

        {/* QC-status filter as pills. Replaces the <select> it used to sit
            beside — every GRN_QC_STATUSES value gets a pill, so nothing that
            could be filtered before is unreachable now. Same `qcStatus` search
            param, same query; only the control changed. */}
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            gap: 10,
            flexWrap: 'wrap',
          }}
        >
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {([null, ...GRN_QC_STATUSES] as (GrnQcStatus | null)[]).map((s) => {
              const active = (search.qcStatus ?? null) === s;
              return (
                <button
                  key={s ?? 'all'}
                  type="button"
                  className={`btn btn-sm ${active ? 'btn-primary' : 'btn-ghost'}`}
                  style={{
                    fontSize: 11,
                    textTransform: 'capitalize',
                    borderRadius: 999,
                    padding: '3px 12px',
                  }}
                  onClick={() =>
                    void navigate({
                      search: (prev) => ({ ...prev, qcStatus: s ?? undefined, page: 1 }),
                      replace: true,
                    })
                  }
                >
                  {s ? s.replaceAll('_', ' ') : 'All'}
                </button>
              );
            })}
          </div>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() =>
              setExpandedIds(allExpanded ? new Set() : new Set(rows.map((r) => r.id)))
            }
            disabled={rows.length === 0}
            title={allExpanded ? 'Hide every card’s lines' : 'Show every card’s lines'}
          >
            {allExpanded ? 'Collapse all' : 'Expand all'}
          </button>
        </div>
      </div>

      {data?.summary ? (
        <GrnKpiStrip
          summary={data.summary}
          activeStatus={search.qcStatus ?? null}
          onSelectStatus={(s) => {
            void navigate({
              search: (prev) => ({ ...prev, qcStatus: s, page: 1 }),
              replace: true,
            });
          }}
        />
      ) : null}

      {isLoading ? (
        <div className="panel empty-state" style={{ padding: 24 }}>
          <Loader2 className="mr-2 inline h-4 w-4 animate-spin" />
          Loading…
        </div>
      ) : isError ? (
        <div className="panel empty-state" style={{ padding: 24, color: 'var(--red)' }}>
          {error instanceof Error ? error.message : 'Failed to load goods receipt notes'}
        </div>
      ) : rows.length === 0 ? (
        <div className="panel empty-state" style={{ padding: 24 }}>
          No GRN entries yet
        </div>
      ) : (
        rows.map((grn) => {
          const isExpanded = expandedIds.has(grn.id);
          const closed = grn.grnStatus === 'close';
          const poRef = grn.poCode ?? grn.poCodeText;
          return (
            <div
              key={grn.id}
              className="panel"
              style={{ display: 'flex', overflow: 'hidden', padding: 0, marginBottom: 10 }}
            >
              {/* Accent bar — green cleared, amber still under QC. */}
              <div style={{ width: 4, flexShrink: 0, background: accentFor(grn) }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                {/* ── Band 1: identity + badges — actions ── */}
                <div
                  onClick={() => toggleExpand(grn.id)}
                  title={isExpanded ? 'Hide lines' : 'Show lines'}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    flexWrap: 'wrap',
                    padding: '10px 14px',
                    cursor: 'pointer',
                  }}
                >
                  <span style={{ color: 'var(--text3)', display: 'inline-flex' }} aria-hidden>
                    {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                  </span>
                  {/* The card body toggles the lines, so the CODE is the way to
                      the detail page — stopPropagation keeps the click off the
                      toggle underneath it. */}
                  <Link
                    to="/goods-receipt-notes/$id"
                    params={{ id: grn.id }}
                    className="td-code"
                    style={{ color: 'var(--blue)', fontWeight: 800, fontSize: 13 }}
                    title="Open the GRN detail page"
                    onClick={(e) => e.stopPropagation()}
                  >
                    {grn.code}
                  </Link>
                  <span className="fw-700" style={{ fontSize: 13 }}>
                    {grn.vendorName ?? grn.vendorCodeText ?? '—'}
                  </span>
                  {/* GRN status: 'close' once every line is fully QC-inspected,
                      else 'pending' (any line still has QC qty remaining, incl.
                      partial approval). */}
                  <span className={`badge ${closed ? 'b-green' : 'b-amber'}`}>
                    {closed ? 'QC Cleared' : 'QC Pending'}
                  </span>
                  {/* Source: an NC's return-to-vendor challan (ADR-161), an OSP
                      delivery challan (ADR-080) or a purchase PO. An NC GRN
                      also carries deliveryChallanId, so NC is checked first. */}
                  {grn.ncId ? (
                    <span className="badge b-red">Against NC</span>
                  ) : grn.deliveryChallanId ? (
                    <span className="badge b-cyan">Against DC</span>
                  ) : grn.purchaseOrderId ? (
                    <span className="badge b-grey">Against PO</span>
                  ) : null}
                  <span style={{ flex: 1 }} />
                  {/* Legacy L26458-26460/L26472 — "assign to QC user" button.
                      Legacy gates on qcStatus==='Pending'; our nearest signal is
                      "has any line awaiting QC" (qcPendingCount>0), which also
                      covers legacy's 'Partial'. AssignTaskButton self-gates to
                      admin/manager. */}
                  {grn.qcPendingCount > 0 ? (
                    <div
                      style={{ display: 'flex', gap: 4, alignItems: 'center' }}
                      onClick={(e) => e.stopPropagation()}
                    >
                      <AssignTaskButton
                        linkedRef={{
                          type: 'GRN',
                          id: grn.id,
                          display: grn.code,
                          navPage: '/incoming-qc',
                        }}
                        suggestedTitle={`Inspect ${grn.code}`}
                      />
                    </div>
                  ) : null}
                </div>

                {/* ── Band 2: metric boxes + meta line ── */}
                <div
                  onClick={() => toggleExpand(grn.id)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 12,
                    flexWrap: 'wrap',
                    padding: '0 14px 10px',
                    cursor: 'pointer',
                  }}
                >
                  <div style={{ display: 'flex', border: '1px solid var(--border)', borderRadius: 6 }}>
                    <QtyBox label="Received" value={grn.totalReceivedQty} />
                    <QtyBox
                      label="Accepted"
                      value={grn.totalQcAcceptedQty}
                      color={grn.totalQcAcceptedQty > 0 ? 'var(--green)' : undefined}
                      bordered
                    />
                    <QtyBox
                      label="Rejected"
                      value={grn.totalQcRejectedQty}
                      color={grn.totalQcRejectedQty > 0 ? 'var(--red)' : undefined}
                      bordered
                    />
                    <QtyBox label="Lines" value={grn.lineCount} bordered />
                  </div>
                  <div
                    className="mono"
                    style={{
                      fontSize: 11,
                      color: 'var(--text3)',
                      display: 'flex',
                      gap: 6,
                      alignItems: 'center',
                      flexWrap: 'wrap',
                    }}
                  >
                    <span className="text2" style={{ whiteSpace: 'nowrap' }}>
                      {grn.grnDate}
                    </span>
                    <span>·</span>
                    {/* On an NC-return GRN poCodeText holds the NC code (no PO
                        exists), so the same slot reads "NC …" instead. */}
                    <span style={{ whiteSpace: 'nowrap' }}>
                      {grn.ncId ? 'NC' : 'PO'}{' '}
                      <span style={{ color: 'var(--purple)', fontWeight: 700 }}>
                        {grn.ncId ? (grn.poCodeText ?? '—') : (poRef ?? '—')}
                      </span>
                    </span>
                    {grn.dcNo ? (
                      <>
                        <span>·</span>
                        <span style={{ whiteSpace: 'nowrap' }}>
                          DC <span className="text2">{grn.dcNo}</span>
                        </span>
                      </>
                    ) : null}
                    {grn.invoiceNo ? (
                      <>
                        <span>·</span>
                        <span style={{ whiteSpace: 'nowrap' }}>
                          Inv <span className="text2">{grn.invoiceNo}</span>
                        </span>
                      </>
                    ) : null}
                    <span>·</span>
                    <span title={grn.remarks ?? ''}>{grn.remarks || '—'}</span>
                  </div>
                </div>

                {/* ── Band 3: lines ── */}
                {isExpanded ? (
                  <div style={{ background: 'var(--bg3)', borderTop: '1px solid var(--border)' }}>
                    <GrnExpandedPanel grnId={grn.id} />
                  </div>
                ) : null}
              </div>
            </div>
          );
        })
      )}

      {/* Legacy L26502-26503 — plain tip line under the register. */}
      <div className="text3" style={{ fontSize: 11, marginTop: 8, padding: '0 4px' }}>
        💡 GRN creates receipt record with <b>QC Pending</b> status. Go to <b>Incoming QC</b> to
        inspect and accept/reject. Only QC-accepted qty moves to Store inventory.
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
            ? 'No goods receipt notes'
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
    </div>
  );
}

/** Expanded card body — the GRN's lines, fetched lazily from the detail
 *  endpoint the first time the card is opened (same shape as SoExpandedPanel). */
function GrnExpandedPanel({ grnId }: { grnId: string }): React.JSX.Element {
  const { data, isLoading, isError, error } = useGoodsReceiptNote(grnId);
  if (isLoading) {
    return (
      <div style={{ padding: '12px 18px', fontSize: 12, color: 'var(--text3)' }}>
        <Loader2 size={12} className="inline animate-spin" /> Loading lines…
      </div>
    );
  }
  if (isError || !data) {
    return (
      <div style={{ padding: '12px 18px', fontSize: 12, color: 'var(--red)' }}>
        {error instanceof Error ? error.message : 'Failed to load GRN detail'}
      </div>
    );
  }
  return (
    <div style={{ padding: '8px 12px 8px 36px' }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          marginBottom: 6,
          flexWrap: 'wrap',
        }}
      >
        <div
          style={{
            fontSize: 10,
            color: 'var(--blue)',
            fontFamily: 'var(--mono)',
            fontWeight: 700,
            letterSpacing: '0.06em',
          }}
        >
          ▸ LINES — {data.code}
        </div>
        <Link
          to="/goods-receipt-notes/$id"
          params={{ id: data.id }}
          style={{ fontSize: 11, color: 'var(--blue)' }}
          onClick={(e) => e.stopPropagation()}
        >
          Open full detail →
        </Link>
      </div>
      {/* tbl-ctr — the table-alignment standard: header and data share one
          centre line; no per-cell textAlign / td-ctr. */}
      <table className="innovic-table tbl-ctr" style={{ width: '100%', margin: 0 }}>
        <thead>
          <tr style={{ background: 'var(--bg4)' }}>
            <th style={{ width: 36 }}>#</th>
            <th>Item Code</th>
            <th>Item Name</th>
            <th>Received</th>
            <th style={{ color: 'var(--green)' }}>Accepted</th>
            <th style={{ color: 'var(--red)' }}>Rejected</th>
            <th>QC</th>
            <th>QC Date</th>
          </tr>
        </thead>
        <tbody>
          {data.lines.length === 0 ? (
            <tr>
              <td colSpan={8} className="empty-state">
                No lines
              </td>
            </tr>
          ) : (
            data.lines.map((l) => (
              <tr key={l.id} style={{ background: 'var(--bg)' }}>
                <td className="mono fw-700">{l.lineNo}</td>
                {/* Item code is THE main thing — strong, never the faint text3.
                    CODE/REV (ADR-177); bare code when the line has no revision. */}
                <td className="mono fw-700" style={{ color: 'var(--text)', whiteSpace: 'nowrap' }}>
                  {itemCodeWithRev(l.itemCode ?? l.itemCodeText, l.itemRevision)}
                </td>
                <td
                  style={{
                    maxWidth: 320,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                  title={l.itemName}
                >
                  {l.itemName}
                </td>
                <td className="mono fw-700">{l.receivedQty}</td>
                <td className="mono fw-700" style={{ color: l.qcAcceptedQty > 0 ? 'var(--green)' : undefined }}>
                  {l.qcAcceptedQty}
                </td>
                <td className="mono" style={{ color: l.qcRejectedQty > 0 ? 'var(--red)' : undefined }}>
                  {l.qcRejectedQty}
                </td>
                <td>
                  <QcStatusBadge status={l.qcStatus} />
                </td>
                <td className="text2" style={{ fontSize: 11, whiteSpace: 'nowrap' }}>
                  {l.qcDate ?? '—'}
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}

// PL-GRN-1b — 4-tile stat strip mirroring legacy renderGRN L26483–26488.
// Clicking Total / QC Pending / QC Cleared filters by qcStatus. Today
// is informational (we don't have a "filter by today's date" yet — the
// Today tile shows the count for context only).
function GrnKpiStrip({
  summary,
  activeStatus,
  onSelectStatus,
}: {
  summary: { total: number; qcPending: number; qcCleared: number; today: number };
  activeStatus: GrnQcStatus | null;
  onSelectStatus: (next: GrnQcStatus | undefined) => void;
}): React.JSX.Element {
  return (
    <div style={{ marginBottom: 12 }}>
      <StatStrip
        items={[
          {
            key: 'all',
            label: 'Total GRNs',
            count: summary.total,
            color: 'var(--cyan)',
            onClick: () => onSelectStatus(undefined),
            active: activeStatus === null,
          },
          {
            key: 'qcpending',
            label: 'QC Pending',
            count: summary.qcPending,
            color: 'var(--amber)',
            sub: '→ Go to Incoming QC',
            onClick: () => onSelectStatus('pending'),
            active: activeStatus === 'pending',
          },
          {
            key: 'qccleared',
            label: 'QC Cleared',
            count: summary.qcCleared,
            color: 'var(--green)',
            onClick: () => onSelectStatus('completed'),
            active: activeStatus === 'completed',
          },
          {
            // Read-only total (no onClick) — legacy showed a "Today" count for
            // context only, with no filter behind it.
            key: 'today',
            label: 'Today',
            count: summary.today,
            color: 'var(--blue)',
          },
        ]}
      />
    </div>
  );
}
