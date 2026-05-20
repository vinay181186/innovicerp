// Route Card list (ports legacy renderRouteCards L10078).
// Expand-row reveals the operation sequence per legacy UX (chip-style
// "1. M1 · turn", with QC + OSP rows highlighted).

import type { RouteCardListItem } from '@innovic/shared';
import { Link, createRoute, useNavigate } from '@tanstack/react-router';
import { ChevronDown, ChevronRight, Loader2, Plus } from 'lucide-react';
import { useState } from 'react';
import { z } from 'zod';
import { authenticatedRoute } from '@/routes/_authenticated';
import { useRouteCard, useRouteCardsList } from '../api';

const searchSchema = z.object({
  search: z.string().optional(),
});

export const routeCardsListRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: 'route-cards',
  validateSearch: searchSchema,
  component: RouteCardsListPage,
});

function RouteCardsListPage(): React.JSX.Element {
  const navigate = useNavigate();
  const { search } = routeCardsListRoute.useSearch();
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const { data, isLoading, isError, error } = useRouteCardsList({
    search,
    limit: 100,
    offset: 0,
  });

  const toggleExpand = (id: string): void => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <div>
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="section-hdr m-0">📋 Route Card Master</div>
        <div className="flex items-center gap-2">
          <input
            className="innovic-input"
            style={{ width: 220 }}
            placeholder="Search RC no., item code or name…"
            value={search ?? ''}
            onChange={(e) =>
              void navigate({
                to: '/route-cards',
                search: { search: e.target.value || undefined },
              })
            }
          />
          <Link to="/route-cards/new" className="btn btn-primary">
            <Plus size={14} /> New Route Card
          </Link>
        </div>
      </div>

      <div className="panel" style={{ marginBottom: 12 }}>
        <div className="panel-body" style={{ padding: '10px 14px' }}>
          <span style={{ fontSize: 12, color: 'var(--text2)' }}>
            💡 Route cards define the standard manufacturing sequence for each item. They are{' '}
            <b>auto-loaded</b> when creating Job Cards. Revision history is tracked on every save.
          </span>
        </div>
      </div>

      <div className="panel">
        <div className="tbl-wrap">
          <table className="innovic-table">
            <thead>
              <tr>
                <th style={{ width: 28 }}></th>
                <th>RC No.</th>
                <th>Item Code</th>
                <th>Item Name</th>
                <th className="td-ctr">Ops</th>
                <th className="td-ctr">Rev</th>
                <th>Last Updated</th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr>
                  <td colSpan={7} className="empty-state">
                    <Loader2 className="mr-2 inline h-4 w-4 animate-spin" />
                    Loading…
                  </td>
                </tr>
              ) : isError ? (
                <tr>
                  <td colSpan={7} className="empty-state">
                    <span style={{ color: 'var(--red)' }}>
                      {error instanceof Error ? error.message : 'Failed to load route cards.'}
                    </span>
                  </td>
                </tr>
              ) : !data || data.items.length === 0 ? (
                <tr>
                  <td colSpan={7} className="empty-state">
                    No route cards yet — click <strong>+ New Route Card</strong>
                  </td>
                </tr>
              ) : (
                data.items.map((rc) => (
                  <RouteCardRow
                    key={rc.id}
                    rc={rc}
                    expanded={expanded.has(rc.id)}
                    onToggle={() => toggleExpand(rc.id)}
                  />
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

interface RouteCardRowProps {
  rc: RouteCardListItem;
  expanded: boolean;
  onToggle: () => void;
}

function RouteCardRow({ rc, expanded, onToggle }: RouteCardRowProps): React.JSX.Element {
  return (
    <>
      <tr style={{ cursor: 'pointer' }} onClick={onToggle}>
        <td className="td-ctr">
          {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        </td>
        <td>
          <Link
            to="/route-cards/$id"
            params={{ id: rc.id }}
            className="td-code cyan"
            style={{ fontWeight: 700 }}
            onClick={(e) => e.stopPropagation()}
          >
            {rc.code}
          </Link>
        </td>
        <td className="td-code" style={{ color: 'var(--purple)' }}>
          {rc.itemCode ?? '—'}
        </td>
        <td style={{ fontWeight: 600 }}>{rc.itemName ?? '— unknown item —'}</td>
        <td className="td-ctr mono fw-700">{rc.opCount}</td>
        <td className="td-ctr">
          <span className="mono fw-700" style={{ color: 'var(--cyan)' }}>
            R{rc.currentRevision}
          </span>
        </td>
        <td className="text2" style={{ fontSize: 11 }}>
          {new Date(rc.updatedAt).toISOString().slice(0, 10)}
        </td>
      </tr>
      {expanded ? (
        <tr>
          <td colSpan={7} style={{ padding: 0, background: 'var(--bg3)' }}>
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
              {i + 1}. {label}
            </span>
          );
        })}
      </div>
    </div>
  );
}
