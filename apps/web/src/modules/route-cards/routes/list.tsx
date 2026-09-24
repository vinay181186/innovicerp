// Route Card list (ports legacy renderRouteCards L10078).
// Laid out as the app's ruled sheet (`.innovic-table.tbl-grid`, the SO / WO
// Orders list view) — Sr No first, icon-only Action last, fixed % widths that
// sum to 100 so nothing scrolls sideways, and a sticky header band (title,
// count, search, + Add) that stays put while the sheet scrolls.
// The ▸ chevron on the RC No. still reveals the operation sequence per legacy
// UX (chip-style "1. M1 · turn", with QC + OSP rows highlighted). Legacy renders
// that sequence as an inline 8th column, but `RouteCardListItem` carries only
// `opCount` — the ops live behind the detail endpoint — so the expand-row
// lazily fetches them instead of firing a detail request per row. See ISSUE-019.
// The row itself now opens the detail page.

import type { RouteCardListItem } from '@innovic/shared';
import { opSrNo } from '@innovic/shared';
import { Link, createRoute, useNavigate } from '@tanstack/react-router';
import { ChevronDown, ChevronRight, Eye, Loader2, Pencil, Plus, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { z } from 'zod';
import { normalizeSearchTerm } from '@/components/shared/search-match';
import { effectiveFormPerms, useMyAccess } from '@/lib/access-control';
import { authenticatedRoute } from '@/routes/_authenticated';
import { useDeleteRouteCard, useRouteCard, useRouteCardsList } from '../api';
import { PrintRouteCardButton } from '../components/print-route-card-button';

const searchSchema = z.object({
  search: z.string().optional(),
});

export const routeCardsListRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: 'route-cards',
  validateSearch: searchSchema,
  component: RouteCardsListPage,
});

/** One fetch, scroll — masters do not paginate. The API caps `limit` at 200. */
const LIST_LIMIT = 100;

/** Column count — every empty / loading / expanded row's <td colSpan> must
 *  match the <colgroup> below, so it is named once here. */
const COLUMN_COUNT = 9;
/** Icon size and inline trim for the Action column's icon buttons — the same
 *  numbers the SO sheet uses, so four of them sit on one row in a 10% column. */
const ICON = 13;
const ICON_BTN: React.CSSProperties = { padding: '2px 3px' };

function RouteCardsListPage(): React.JSX.Element {
  const navigate = useNavigate();
  const { search } = routeCardsListRoute.useSearch();
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  // Search lives in the URL (`search` param) so it survives refresh and Back;
  // the input mirrors it and a debounce writes it back — the SO list shape.
  const [searchInput, setSearchInput] = useState(search ?? '');
  useEffect(() => {
    setSearchInput(search ?? '');
  }, [search]);
  useEffect(() => {
    const trimmed = normalizeSearchTerm(searchInput);
    const next = trimmed === '' ? undefined : trimmed;
    if (next === search) return;
    const id = window.setTimeout(() => {
      void navigate({ to: '/route-cards', search: { search: next }, replace: true });
    }, 300);
    return () => window.clearTimeout(id);
  }, [searchInput, search, navigate]);

  const { data, isLoading, isFetching, isError, error } = useRouteCardsList({
    search,
    limit: LIST_LIMIT,
    offset: 0,
  });
  const { data: eff } = useMyAccess();
  const perms = effectiveFormPerms(eff, 'routecard_create');
  const total = data?.total ?? 0;

  const toggleExpand = (id: string): void => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  if (eff && !perms.view) {
    return (
      <div className="empty-state" style={{ color: 'var(--amber)', padding: 40 }}>
        ⛔ This page is hidden for your access. Ask an admin if you need access to it.
      </div>
    );
  }

  return (
    <div>
      {/* Sticky header band — same styles as the SO / WO Orders list band. */}
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
            gap: 8,
            flexWrap: 'wrap',
          }}
        >
          <div>
            <div className="section-hdr" style={{ marginBottom: 0 }}>
              Route Card Master
            </div>
            <div className="text3" style={{ fontSize: 12, marginTop: 2 }}>
              {total} card{total === 1 ? '' : 's'}
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <input
              className="innovic-input"
              placeholder="Search RC no., item code, item name…"
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
              <Link to="/route-cards/new" className="btn btn-primary">
                <Plus size={14} /> Add Route Card
              </Link>
            ) : null}
          </div>
        </div>
      </div>

      {/* SO-Planning tinted info box (its "In Production (no plan)" note uses the
          same shape: a cyan-tinted panel with a matching translucent border). */}
      <div
        style={{
          display: 'flex',
          gap: 8,
          alignItems: 'flex-start',
          padding: '10px 14px',
          marginBottom: 10,
          background: 'rgba(0,136,187,0.06)',
          border: '1px solid rgba(0,136,187,0.3)',
          borderRadius: 6,
        }}
      >
        <span style={{ fontSize: 12 }}>💡</span>
        <span style={{ fontSize: 12, color: 'var(--text2)' }}>
          Route cards define the standard manufacturing sequence for each item. A card's operations
          are <b>loaded into the plan</b> when you plan that item, and executing that plan creates
          the Job Card. You can also create/edit route cards directly here. Revision history is
          tracked on every save.
        </span>
      </div>

      {/* The ruled sheet: fixed % widths summing to 100, no sideways scroll.
          Every column centred by the standard; only Item Name is left-aligned. */}
      <div className="tbl-wrap" style={{ overflowX: 'hidden' }}>
        <table className="innovic-table tbl-grid">
          <colgroup>
            <col style={{ width: '4%' }} />
            <col style={{ width: '12%' }} />
            <col style={{ width: '13%' }} />
            <col style={{ width: '24%' }} />
            <col style={{ width: '15%' }} />
            <col style={{ width: '5%' }} />
            <col style={{ width: '6%' }} />
            <col style={{ width: '11%' }} />
            <col style={{ width: '10%' }} />
          </colgroup>
          <thead>
            <tr>
              <th>Sr No</th>
              <th>RC No.</th>
              <th>Item Code</th>
              <th style={{ textAlign: 'left' }}>Item Name</th>
              <th>Grade / Size</th>
              <th>Ops</th>
              <th>Route Card Rev</th>
              <th>Last Updated</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr>
                <td colSpan={COLUMN_COUNT} className="empty-state">
                  <Loader2 className="mr-2 inline h-4 w-4 animate-spin" />
                  Loading…
                </td>
              </tr>
            ) : isError ? (
              <tr>
                <td colSpan={COLUMN_COUNT} className="empty-state">
                  <span style={{ color: 'var(--red)' }}>
                    {error instanceof Error ? error.message : 'Failed to load route cards.'}
                  </span>
                </td>
              </tr>
            ) : !data || data.items.length === 0 ? (
              <tr>
                <td colSpan={COLUMN_COUNT} className="empty-state">
                  No route cards yet — click <strong>+ Add Route Card</strong>
                </td>
              </tr>
            ) : (
              data.items.map((rc, i) => (
                <RouteCardRow
                  key={rc.id}
                  rc={rc}
                  srNo={i + 1}
                  expanded={expanded.has(rc.id)}
                  onToggle={() => toggleExpand(rc.id)}
                  onOpen={() => void navigate({ to: '/route-cards/$id', params: { id: rc.id } })}
                />
              ))
            )}
          </tbody>
        </table>
      </div>

      <div
        style={{
          display: 'flex',
          justifyContent: 'flex-end',
          marginTop: 8,
          fontSize: 12,
          color: 'var(--text3)',
        }}
      >
        {total === 0
          ? 'No route cards'
          : total > LIST_LIMIT
            ? `Showing first ${LIST_LIMIT} of ${total} — refine with search`
            : `Showing all ${total} route card${total === 1 ? '' : 's'}`}
      </div>
      <div className="text3" style={{ fontSize: 11, padding: '6px 4px 0', marginTop: 4 }}>
        💡 Click a row to open it · click ▸ before the <b>RC No.</b> to show its operation sequence.
      </div>
    </div>
  );
}

interface RouteCardRowProps {
  rc: RouteCardListItem;
  srNo: number;
  expanded: boolean;
  onToggle: () => void;
  onOpen: () => void;
}

function RouteCardRow({
  rc,
  srNo,
  expanded,
  onToggle,
  onOpen,
}: RouteCardRowProps): React.JSX.Element {
  const { data: eff } = useMyAccess();
  const perms = effectiveFormPerms(eff, 'routecard_create');
  const del = useDeleteRouteCard();

  // Legacy delRouteCard (L10279): confirm, then remove. Delete is admin-only
  // server-side (route-cards service L698), so the button is admin-gated —
  // matching the Route Card detail page.
  const onDelete = async (): Promise<void> => {
    if (!window.confirm(`Delete route card for ${rc.itemCode ?? rc.code}?`)) return;
    try {
      await del.mutateAsync(rc.id);
    } catch (e) {
      window.alert(e instanceof Error ? e.message : 'Delete failed.');
    }
  };

  return (
    <>
      <tr style={{ cursor: 'pointer' }} onClick={onOpen}>
        <td className="text3">{srNo}</td>
        <td>
          <div style={{ whiteSpace: 'nowrap' }}>
            {/* ▸ / ▾ opens the op sequence in place; the row itself navigates,
                so the chevron stops the click. */}
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onToggle();
              }}
              title={expanded ? 'Hide operation sequence' : 'Show operation sequence'}
              aria-expanded={expanded}
              style={{
                background: 'none',
                border: 0,
                padding: 0,
                marginRight: 2,
                cursor: 'pointer',
                color: 'var(--blue)',
                display: 'inline-flex',
                verticalAlign: 'middle',
              }}
            >
              {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
            </button>
            <Link
              to="/route-cards/$id"
              params={{ id: rc.id }}
              className="td-code"
              title="Open this route card"
              onClick={(e) => e.stopPropagation()}
            >
              {rc.code}
            </Link>
          </div>
        </td>
        <td className="mono fw-700" style={{ whiteSpace: 'nowrap', color: 'var(--text)' }}>
          {rc.itemCode ?? '—'}
        </td>
        <td style={{ textAlign: 'left' }}>
          <div
            className="fw-700"
            style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
            title={rc.itemName ?? ''}
          >
            {rc.itemName ?? '— unknown item —'}
          </div>
        </td>
        {/* Grade then size on one line — the stock this card is cut from, so the
            master answers "what is it made of" without opening a card. */}
        <td
          className="mono"
          style={{
            fontSize: 11,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
          title={`${rc.rawMaterialGradeText ?? '—'} / ${rc.rawMaterialSizeText ?? '—'}`}
        >
          <span className="fw-700">{rc.rawMaterialGradeText ?? '—'}</span>
          <span className="text3"> / {rc.rawMaterialSizeText ?? '—'}</span>
        </td>
        <td className="mono">{rc.opCount}</td>
        <td className="mono fw-700" style={{ color: 'var(--cyan)', whiteSpace: 'nowrap' }}>
          R{rc.currentRevision}
        </td>
        <td className="mono text2" style={{ fontSize: 12, whiteSpace: 'nowrap' }}>
          {new Date(rc.updatedAt).toISOString().slice(0, 10)}
        </td>
        <td>
          {/* Icon-only actions on one row; hover names the action. Same gates
              as before: Edit needs edit; Del needs edit + approve. */}
          <div
            className="jc-row-acts"
            style={{ display: 'flex', gap: 4, justifyContent: 'center', flexWrap: 'nowrap' }}
            onClick={(e) => e.stopPropagation()}
          >
            <Link
              to="/route-cards/$id"
              params={{ id: rc.id }}
              className="btn btn-ghost btn-sm btn-icon"
              style={ICON_BTN}
              title="View"
              aria-label="View"
            >
              <Eye size={ICON} />
            </Link>
            {perms.edit ? (
              <Link
                to="/route-cards/$id/edit"
                params={{ id: rc.id }}
                className="btn btn-ghost btn-sm btn-icon"
                style={ICON_BTN}
                title="Edit"
                aria-label="Edit"
              >
                <Pencil size={ICON} />
              </Link>
            ) : null}
            <PrintRouteCardButton rc={rc} />
            {perms.edit && perms.approve ? (
              // The sheet paints every .btn-sm on paper (theme rule), which
              // would leave btn-danger's white icon invisible — so the icon is
              // told to be red here, tokens only.
              <button
                type="button"
                className="btn btn-danger btn-sm btn-icon"
                style={{ ...ICON_BTN, color: 'var(--red)' }}
                onClick={() => void onDelete()}
                disabled={del.isPending}
                title="Delete"
                aria-label="Delete"
              >
                <Trash2 size={ICON} />
              </button>
            ) : null}
          </div>
        </td>
      </tr>
      {expanded ? (
        <tr>
          <td
            colSpan={COLUMN_COUNT}
            style={{ padding: 0, background: 'var(--bg3)', textAlign: 'left' }}
          >
            <ExpandedOps rcId={rc.id} />
          </td>
        </tr>
      ) : null}
    </>
  );
}

function ExpandedOps({ rcId }: { rcId: string }): React.JSX.Element {
  const { data, isLoading } = useRouteCard(rcId);
  if (isLoading) {
    return (
      <div style={{ padding: 16, fontSize: 12, color: 'var(--text3)' }}>
        <Loader2 className="mr-2 inline h-3 w-3 animate-spin" />
        Loading ops…
      </div>
    );
  }
  if (!data) return <div style={{ padding: 16 }}>—</div>;
  return (
    <div style={{ padding: '8px 12px 12px 32px' }}>
      <div
        style={{
          fontSize: 10,
          color: 'var(--cyan)',
          fontFamily: 'var(--mono)',
          fontWeight: 700,
          marginBottom: 6,
        }}
      >
        ▸ OPERATION SEQUENCE — {data.code}
      </div>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {data.ops.map((op, i) => {
          const accent =
            op.opType === 'qc'
              ? 'var(--green)'
              : op.opType === 'outsource'
                ? '#7c3aed'
                : 'var(--cyan)';
          const bg =
            op.opType === 'qc'
              ? 'rgba(34,197,94,0.10)'
              : op.opType === 'outsource'
                ? 'rgba(124,58,237,0.10)'
                : 'var(--bg4)';
          const label =
            op.opType === 'qc'
              ? op.operation || 'QC'
              : op.opType === 'outsource'
                ? `${op.operation} → ${op.ospVendorCode ?? op.ospVendorCodeText ?? '—'}`
                : `${op.machineCode ?? op.machineCodeText ?? '—'} · ${op.operation}`;
          return (
            <span
              key={op.id}
              style={{
                fontSize: 10,
                padding: '2px 8px',
                background: bg,
                color: accent,
                border: `1px solid ${accent}`,
                borderRadius: 4,
                fontFamily: 'var(--mono)',
                fontWeight: 700,
              }}
            >
              {opSrNo(i + 1)}. {label}
            </span>
          );
        })}
      </div>
    </div>
  );
}
