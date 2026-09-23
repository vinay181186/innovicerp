// BOM Master list (ports legacy renderBOMMaster L8438).
// Laid out as the app's ruled sheet (`.innovic-table.tbl-grid`, the SO / WO
// Orders list view) — Sr No first, Action last, fixed % widths that sum to
// 100 so nothing scrolls sideways, and a sticky header band (title, count,
// search, status pills, + New) that stays put while the sheet scrolls.
// The ▸ chevron on the BOM No. still reveals the line items right under the
// row (legacy UX) — the row itself now opens the detail page.

import type { BomMasterListItem, BomStatus } from '@innovic/shared';
import { Link, createRoute, useNavigate } from '@tanstack/react-router';
import { ChevronDown, ChevronRight, Eye, Loader2, Plus } from 'lucide-react';
import { useEffect, useState } from 'react';
import { z } from 'zod';
import { normalizeSearchTerm } from '@/components/shared/search-match';
import { effectiveFormPerms, useMyAccess } from '@/lib/access-control';
import { authenticatedRoute } from '@/routes/_authenticated';
import { useBomMaster, useBomMastersList } from '../api';

const searchSchema = z.object({
  search: z.string().optional(),
  status: z.enum(['draft', 'active', 'obsolete']).optional(),
});

export const bomMastersListRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: 'bom-masters',
  validateSearch: searchSchema,
  component: BomMastersListPage,
});

const STATUS_BADGE: Record<BomStatus, string> = {
  active: 'b-green',
  draft: 'b-amber',
  obsolete: 'b-red',
};
const STATUS_PILLS: BomStatus[] = ['draft', 'active', 'obsolete'];

/** One fetch, scroll — masters do not paginate. The API caps `limit` at 200. */
const LIST_LIMIT = 100;

/** Column count — every empty / loading / expanded row's <td colSpan> must
 *  match the <colgroup> below, so it is named once here. */
const COLUMN_COUNT = 10;
/** Icon size and inline trim for the Action column's icon button — the same
 *  numbers the SO sheet uses. */
const ICON = 13;
const ICON_BTN: React.CSSProperties = { padding: '2px 3px' };

function BomMastersListPage(): React.JSX.Element {
  const navigate = useNavigate();
  const { search, status } = bomMastersListRoute.useSearch();
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
      void navigate({
        to: '/bom-masters',
        search: { ...(status ? { status } : {}), search: next },
        replace: true,
      });
    }, 300);
    return () => window.clearTimeout(id);
  }, [searchInput, search, status, navigate]);

  const { data, isLoading, isFetching, isError, error } = useBomMastersList({
    search,
    status,
    limit: LIST_LIMIT,
    offset: 0,
  });
  const { data: eff } = useMyAccess();
  const perms = effectiveFormPerms(eff, 'bom_create');
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
            marginBottom: 10,
            gap: 8,
            flexWrap: 'wrap',
          }}
        >
          <div>
            <div className="section-hdr" style={{ marginBottom: 0 }}>
              📦 BOM Master
            </div>
            <div className="text3" style={{ fontSize: 12, marginTop: 2 }}>
              {total} BOM{total === 1 ? '' : 's'}
              {status ? (
                <>
                  {' '}
                  · <span className="text2">{status}</span> only
                </>
              ) : null}
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <input
              className="innovic-input"
              placeholder="Search BOM no., name, parent item…"
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
              <Link to="/bom-masters/new" className="btn btn-primary">
                <Plus size={14} /> New BOM
              </Link>
            ) : null}
          </div>
        </div>

        {/* Status filter as pills (was a <select>) — same `status` search
            param, same query; only the control changed. */}
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {([null, ...STATUS_PILLS] as (BomStatus | null)[]).map((s) => {
            const active = (status ?? null) === s;
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
                    to: '/bom-masters',
                    search: { ...(search ? { search } : {}), status: s ?? undefined },
                    replace: true,
                  })
                }
              >
                {s ?? 'All'}
              </button>
            );
          })}
        </div>
      </div>

      {/* The ruled sheet: fixed % widths summing to 100, no sideways scroll.
          Every column centred by the standard; only BOM Name is left-aligned. */}
      <div className="tbl-wrap" style={{ overflowX: 'hidden' }}>
        <table className="innovic-table tbl-grid">
          <colgroup>
            <col style={{ width: '4%' }} />
            <col style={{ width: '11%' }} />
            <col style={{ width: '19%' }} />
            <col style={{ width: '23%' }} />
            <col style={{ width: '6%' }} />
            <col style={{ width: '7%' }} />
            <col style={{ width: '9%' }} />
            <col style={{ width: '8%' }} />
            <col style={{ width: '7%' }} />
            <col style={{ width: '6%' }} />
          </colgroup>
          <thead>
            <tr>
              <th>Sr No</th>
              <th>BOM No.</th>
              <th style={{ textAlign: 'left' }}>BOM Name</th>
              <th>Parent Item</th>
              <th>Items</th>
              <th>BOM Rev</th>
              <th>Revision Date</th>
              <th>Linked SOs</th>
              <th>BOM Status</th>
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
                    {error instanceof Error ? error.message : 'Failed to load BOMs.'}
                  </span>
                </td>
              </tr>
            ) : !data || data.items.length === 0 ? (
              <tr>
                <td colSpan={COLUMN_COUNT} className="empty-state">
                  No BOMs created yet — click <strong>+ New BOM</strong>
                </td>
              </tr>
            ) : (
              data.items.map((b, i) => (
                <BomRow
                  key={b.id}
                  bom={b}
                  srNo={i + 1}
                  expanded={expanded.has(b.id)}
                  onToggle={() => toggleExpand(b.id)}
                  onOpen={() => void navigate({ to: '/bom-masters/$id', params: { id: b.id } })}
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
          ? 'No BOMs'
          : total > LIST_LIMIT
            ? `Showing first ${LIST_LIMIT} of ${total} — refine with search`
            : `Showing all ${total} BOM${total === 1 ? '' : 's'}`}
      </div>
      <div className="text3" style={{ fontSize: 11, padding: '6px 4px 0', marginTop: 4 }}>
        💡 Click a row to open it · click ▸ before the <b>BOM No.</b> to show its part list. BOM
        Master defines part lists (items + qty per set). Link a BOM to Equipment SO orders. Use{' '}
        <strong>Revise</strong> to create a new revision with change log.
      </div>
    </div>
  );
}

interface BomRowProps {
  bom: BomMasterListItem;
  srNo: number;
  expanded: boolean;
  onToggle: () => void;
  onOpen: () => void;
}

function BomRow({ bom, srNo, expanded, onToggle, onOpen }: BomRowProps): React.JSX.Element {
  return (
    <>
      <tr style={{ cursor: 'pointer' }} onClick={onOpen}>
        <td className="text3">{srNo}</td>
        <td>
          <div style={{ whiteSpace: 'nowrap' }}>
            {/* ▸ / ▾ opens the part list in place; the row itself navigates,
                so the chevron stops the click. */}
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onToggle();
              }}
              title={expanded ? 'Hide part list' : 'Show part list'}
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
              to="/bom-masters/$id"
              params={{ id: bom.id }}
              className="td-code"
              title="Open this BOM"
              onClick={(e) => e.stopPropagation()}
            >
              {bom.bomNo}
            </Link>
          </div>
        </td>
        <td style={{ textAlign: 'left' }}>
          <div
            className="fw-700"
            style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
            title={bom.bomName}
          >
            {bom.bomName}
          </div>
        </td>
        <td>
          {bom.parentItemCode ? (
            // Code strong, name quiet, one line — clipped with the full text on hover.
            <div
              style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
              title={`${bom.parentItemCode} — ${bom.parentItemName ?? ''}`}
            >
              <span className="mono fw-700" style={{ color: 'var(--text)' }}>
                {bom.parentItemCode}
              </span>
              {bom.parentItemName ? (
                <span className="text3" style={{ fontSize: 11 }}>
                  {' '}
                  — {bom.parentItemName}
                </span>
              ) : null}
            </div>
          ) : (
            <span style={{ color: 'var(--amber)' }}>not set</span>
          )}
        </td>
        <td className="mono fw-700" style={{ color: 'var(--purple)' }}>
          {bom.lineCount}
        </td>
        <td className="mono fw-700" style={{ color: 'var(--cyan)', whiteSpace: 'nowrap' }}>
          Rev {bom.revision}
        </td>
        <td className="mono text2" style={{ fontSize: 12, whiteSpace: 'nowrap' }}>
          {bom.revisionDate}
        </td>
        <td style={{ whiteSpace: 'nowrap' }}>
          {bom.linkedSoCount > 0 ? (
            <span style={{ color: 'var(--green)', fontWeight: 700 }}>
              {bom.linkedSoCount} SO{bom.linkedSoCount > 1 ? 's' : ''}
            </span>
          ) : (
            <span className="text3">—</span>
          )}
        </td>
        <td>
          <span className={`badge ${STATUS_BADGE[bom.status]}`}>{bom.status}</span>
        </td>
        <td>
          {/* Icon-only actions on one row; hover names the action. */}
          <div
            className="jc-row-acts"
            style={{ display: 'flex', gap: 4, justifyContent: 'center', flexWrap: 'nowrap' }}
            onClick={(e) => e.stopPropagation()}
          >
            <Link
              to="/bom-masters/$id"
              params={{ id: bom.id }}
              className="btn btn-ghost btn-sm btn-icon"
              style={ICON_BTN}
              title="View"
              aria-label="View"
            >
              <Eye size={ICON} />
            </Link>
          </div>
        </td>
      </tr>
      {expanded ? (
        <tr>
          <td
            colSpan={COLUMN_COUNT}
            style={{ padding: 0, background: 'var(--bg3)', textAlign: 'left' }}
          >
            <ExpandedLines bomId={bom.id} />
          </td>
        </tr>
      ) : null}
    </>
  );
}

function ExpandedLines({ bomId }: { bomId: string }): React.JSX.Element {
  const { data, isLoading } = useBomMaster(bomId);
  if (isLoading) {
    return (
      <div style={{ padding: 16, fontSize: 12, color: 'var(--text3)' }}>
        <Loader2 className="mr-2 inline h-3 w-3 animate-spin" />
        Loading lines…
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
        ▸ PART LIST / ITEMS — {data.bomNo}
      </div>
      <table style={{ width: '100%' }}>
        <thead>
          <tr style={{ background: 'var(--bg4)' }}>
            <th style={{ width: 36 }}>Sr No</th>
            <th>Item Code</th>
            <th>Item Name</th>
            <th className="td-ctr">Qty / Set</th>
            <th>BOM Type</th>
          </tr>
        </thead>
        <tbody>
          {data.lines.map((line, idx) => (
            <tr key={line.id}>
              <td className="td-ctr mono fw-700">{idx + 1}</td>
              <td className="td-code" style={{ color: 'var(--purple)' }}>
                {line.childItemCode ?? '—'}
              </td>
              <td>{line.childItemName ?? '—'}</td>
              <td className="td-ctr mono fw-700" style={{ fontSize: 14 }}>
                {Number(line.qtyPerSet)}
              </td>
              <td>
                <BomTypeBadge type={line.bomType} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function BomTypeBadge({ type }: { type: string }): React.JSX.Element {
  const cfg = {
    manufacture: { label: '🏭 Mfg', color: 'var(--cyan)' },
    purchase: { label: '🛒 Buy', color: 'var(--green)' },
    outsource: { label: '🏭 Outsrc', color: 'var(--amber)' },
  }[type] ?? { label: type, color: 'var(--text3)' };
  return <span style={{ color: cfg.color, fontSize: 11, fontWeight: 700 }}>{cfg.label}</span>;
}
