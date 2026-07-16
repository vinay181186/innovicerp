// BOM Master list (ports legacy renderBOMMaster L8438).
// Expand-row reveals the line items table per legacy UX.

import type { BomMasterListItem, BomStatus } from '@innovic/shared';
import { Link, createRoute, useNavigate } from '@tanstack/react-router';
import { ChevronDown, ChevronRight, Loader2, Plus } from 'lucide-react';
import { useState } from 'react';
import { z } from 'zod';
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

function BomMastersListPage(): React.JSX.Element {
  const navigate = useNavigate();
  const { search, status } = bomMastersListRoute.useSearch();
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const { data, isLoading, isError, error } = useBomMastersList({
    search,
    status,
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
        <div className="section-hdr m-0">📦 BOM Master</div>
        <div className="flex items-center gap-2">
          <input
            className="innovic-input"
            style={{ width: 220 }}
            placeholder="Search BOM..."
            value={search ?? ''}
            onChange={(e) =>
              void navigate({
                to: '/bom-masters',
                search: { ...(status ? { status } : {}), search: e.target.value || undefined },
              })
            }
          />
          <select
            className="innovic-select"
            style={{ width: 120 }}
            value={status ?? ''}
            onChange={(e) =>
              void navigate({
                to: '/bom-masters',
                search: {
                  ...(search ? { search } : {}),
                  status: (e.target.value || undefined) as BomStatus | undefined,
                },
              })
            }
          >
            <option value="">All status</option>
            <option value="draft">Draft</option>
            <option value="active">Active</option>
            <option value="obsolete">Obsolete</option>
          </select>
          <Link to="/bom-masters/new" className="btn btn-primary">
            <Plus size={14} /> New BOM
          </Link>
        </div>
      </div>

      <div className="panel">
        <div className="tbl-wrap">
          <table className="innovic-table">
            <thead>
              <tr>
                <th style={{ width: 28 }}></th>
                <th>BOM No.</th>
                <th>BOM Name</th>
                <th className="td-ctr">Items</th>
                <th className="td-ctr">Revision</th>
                <th>Rev Date</th>
                <th className="td-ctr">Linked SOs</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr>
                  <td colSpan={8} className="empty-state">
                    <Loader2 className="mr-2 inline h-4 w-4 animate-spin" />
                    Loading…
                  </td>
                </tr>
              ) : isError ? (
                <tr>
                  <td colSpan={8} className="empty-state">
                    <span style={{ color: 'var(--red)' }}>
                      {error instanceof Error ? error.message : 'Failed to load BOMs.'}
                    </span>
                  </td>
                </tr>
              ) : !data || data.items.length === 0 ? (
                <tr>
                  <td colSpan={8} className="empty-state">
                    No BOMs created yet — click <strong>+ New BOM</strong>
                  </td>
                </tr>
              ) : (
                data.items.map((b) => (
                  <BomRow
                    key={b.id}
                    bom={b}
                    expanded={expanded.has(b.id)}
                    onToggle={() => toggleExpand(b.id)}
                  />
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="text3" style={{ fontSize: 11, padding: '6px 4px 0', marginTop: 4 }}>
        💡 BOM Master defines part lists (items + qty per set). Link a BOM to Equipment SO orders.
        Use <strong>Revise</strong> to create a new revision with change log.
      </div>
    </div>
  );
}

interface BomRowProps {
  bom: BomMasterListItem;
  expanded: boolean;
  onToggle: () => void;
}

function BomRow({ bom, expanded, onToggle }: BomRowProps): React.JSX.Element {
  return (
    <>
      <tr style={{ cursor: 'pointer' }} onClick={onToggle}>
        <td className="td-ctr">
          {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        </td>
        <td>
          <Link
            to="/bom-masters/$id"
            params={{ id: bom.id }}
            className="td-code cyan"
            style={{ fontWeight: 700 }}
            onClick={(e) => e.stopPropagation()}
          >
            {bom.bomNo}
          </Link>
        </td>
        <td style={{ fontWeight: 600 }}>{bom.bomName}</td>
        <td className="td-ctr mono fw-700" style={{ color: 'var(--purple)' }}>
          {bom.lineCount}
        </td>
        <td className="td-ctr mono fw-700" style={{ color: 'var(--cyan)' }}>
          Rev {bom.revision}
        </td>
        <td className="text2" style={{ fontSize: 11 }}>
          {bom.revisionDate}
        </td>
        <td className="td-ctr">
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
      </tr>
      {expanded ? (
        <tr>
          <td colSpan={8} style={{ padding: 0, background: 'var(--bg3)' }}>
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
            <th style={{ width: 36 }}>#</th>
            <th>Item Code</th>
            <th>Item Name</th>
            <th className="td-ctr">Qty / Set</th>
            <th>Type</th>
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
