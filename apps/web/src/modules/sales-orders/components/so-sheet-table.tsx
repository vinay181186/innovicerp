// SO / WO Orders — LIST VIEW. The same orders the card list shows, laid out as
// the app's ruled sheet (`.innovic-table.tbl-grid`, the Plans / Job Cards
// look) — one row per order, a ▸ chevron on the SO No. that opens the order's
// lines right under it, and the card's actions in the row's ⋯ menu at the end
// (Edit · Assign Task · ─ · Delete, owner-approved spec 2026-10-01). Per the
// user-approved mock-up SO-List-Sheet-Mockup.html (2026-09-21).
//
// Nothing here owns data or state: rows, the expanded-id set, the permission
// flags and every handler come from the list route, so both views share one
// query, one expand state and one set of mutations. The expanded content is
// rendered by the route too (renderExpanded) — the very same panel the card
// opens — so the line table lives in exactly one place.

import type { SalesOrderListItem } from '@innovic/shared';
import { Link } from '@tanstack/react-router';
import { useState } from 'react';
import { fmtDate } from '@/lib/date';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { AssignTaskModal } from '@/modules/tasks/components/assign-task-modal';
import { RowMenu } from '@/ui/data';
import { SoStatusBadge } from './so-status-badge';
import { SoFulfilmentBadge } from './so-fulfilment-badge';
import { soTypeLabel } from '../lib/so-status-label';

/** Column count — the expanded row's <td colSpan> must always match the
 *  <colgroup> below, so it is named once here. */
const COLUMN_COUNT = 12;
/** The Type chip's word. */
const TYPE_SHORT: Record<string, string> = {
  component_manufacturing: 'Component',
  equipment: 'Equipment',
  with_material: 'With Material',
};

export function SoSheetTable({
  rows,
  expandedIds,
  toggleExpand,
  today,
  canEdit,
  canDelete,
  onOpen,
  onDeleteSo,
  onPreviewClientPo,
  renderExpanded,
}: {
  rows: SalesOrderListItem[];
  expandedIds: Set<string>;
  toggleExpand: (id: string) => void;
  /** ISO date (yyyy-mm-dd) the overdue check compares against — computed once
   *  by the route so the card and the sheet agree on "late". */
  today: string;
  canEdit: boolean;
  canDelete: boolean;
  /** Row click → the SO Master detail page (what the card's code link does). */
  onOpen: (so: SalesOrderListItem) => void;
  onDeleteSo: (so: SalesOrderListItem) => void;
  /** The 📎 — previews the client-PO document in-app (ADR-142). */
  onPreviewClientPo: (storagePath: string) => void;
  /** The expanded panel (component lines / equipment BOM) for one order. */
  renderExpanded: (so: SalesOrderListItem) => React.ReactNode;
}): React.JSX.Element {
  // The order whose Assign Task dialog is open (from its ⋯ menu), or null.
  const [assignSo, setAssignSo] = useState<SalesOrderListItem | null>(null);
  return (
    <>
      {/* The sheet look (tbl-grid): bold blue column names, gridlines, cream /
          white rows, fixed widths that add up to 100% so nothing scrolls
          sideways. Every column is centred by the standard; only Customer is
          left-aligned (a name reads from its left edge, and the POL under
          it must start at the same x). */}
      <div className="tbl-wrap">
        <table className="innovic-table tbl-grid">
          <colgroup>
            <col style={{ width: '4%' }} />
            <col style={{ width: '11%' }} />
            <col style={{ width: '7%' }} />
            <col style={{ width: '28%' }} />
            <col style={{ width: '5%' }} />
            <col style={{ width: '6%' }} />
            <col style={{ width: '6%' }} />
            <col style={{ width: '7%' }} />
            <col style={{ width: '6%' }} />
            <col style={{ width: '8%' }} />
            <col style={{ width: '8%' }} />
            <col style={{ width: '4%' }} />
          </colgroup>
          <thead>
            <tr>
              <th>Sr No</th>
              <th>SO No.</th>
              <th>SO Type</th>
              <th style={{ textAlign: 'left' }}>Customer</th>
              <th className="th-num">Lines</th>
              <th className="th-num">Order Qty</th>
              <th className="th-num">JC Qty</th>
              <th className="th-num">Dispatched</th>
              <th className="th-num">Pending</th>
              <th>Due Date</th>
              <th>SO Status</th>
              <th aria-label="Actions" />
            </tr>
          </thead>
          <tbody>
            {rows.map((so, i) => {
              const isExpanded = expandedIds.has(so.id);
              // Same three rules the card uses: late = open past its earliest
              // line due date; JC Qty green once every piece has a job card,
              // amber while some do, quiet while none do.
              const overdue =
                so.earliestDueDate != null && so.earliestDueDate < today && so.status === 'open';
              const jcColor =
                so.jcQty >= so.totalQty && so.totalQty > 0
                  ? 'var(--green)'
                  : so.jcQty > 0
                    ? 'var(--amber)'
                    : 'var(--text3)';
              return [
                <tr key={so.id} onClick={() => onOpen(so)} style={{ cursor: 'pointer' }}>
                  <td className="text3">{i + 1}</td>
                  <td>
                    <div style={{ whiteSpace: 'nowrap' }}>
                      {/* ▸ / ▾ opens the lines in place; the row itself
                          navigates, so the chevron stops the click. */}
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          toggleExpand(so.id);
                        }}
                        title={isExpanded ? 'Hide line items' : 'Show line items'}
                        aria-expanded={isExpanded}
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
                        {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                      </button>
                      <Link
                        to="/sales-orders/$id"
                        params={{ id: so.id }}
                        className="td-code"
                        title="Open the SO Master detail page"
                        onClick={(e) => e.stopPropagation()}
                      >
                        {so.code}
                      </Link>
                    </div>
                    <div
                      className="mono"
                      style={{ fontSize: 11, color: 'var(--text3)', whiteSpace: 'nowrap' }}
                    >
                      {fmtDate(so.soDate)}
                    </div>
                  </td>
                  <td>
                    {/* Legacy renders the type through badge() (L11870), which
                        has no map entry for either SO type and falls through to
                        grey — same chip as the card. */}
                    {/* One word per type: the full "component manufacturing"
                        is wider than this column and ran into Customer. */}
                    <span className="badge b-grey">
                      {TYPE_SHORT[so.type] ?? soTypeLabel(so.type)}
                    </span>
                    {so.type === 'equipment' && so.bomStatus ? (
                      <div style={{ marginTop: 3 }}>
                        <span
                          className={`badge ${so.bomStatus === 'BOM Pending' ? 'b-amber' : so.bomStatus === 'BOM Planned' ? 'b-green' : 'b-blue'}`}
                        >
                          {so.bomStatus}
                        </span>
                      </div>
                    ) : null}
                  </td>
                  <td style={{ textAlign: 'left' }}>
                    <div
                      className="fw-700"
                      style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                      title={so.customerName ?? ''}
                    >
                      {so.customerName ?? '—'}
                    </div>
                    <div
                      className="mono"
                      style={{
                        fontSize: 11,
                        color: 'var(--text3)',
                        display: 'flex',
                        alignItems: 'center',
                        gap: 4,
                        whiteSpace: 'nowrap',
                      }}
                    >
                      <span>
                        Client PO No.{' '}
                        <span style={{ color: 'var(--purple)', fontWeight: 700 }}>
                          {so.clientPoNo ?? '—'}
                        </span>
                      </span>
                      {so.clientPoFilePath ? (
                        <button
                          type="button"
                          className="btn btn-ghost btn-sm"
                          style={{ padding: '0 4px', lineHeight: 1 }}
                          title="Preview Client PO Document"
                          onClick={(e) => {
                            e.stopPropagation();
                            onPreviewClientPo(so.clientPoFilePath!);
                          }}
                        >
                          📎
                        </button>
                      ) : null}
                    </div>
                  </td>
                  <td className="td-num mono">{so.lineCount}</td>
                  <td className="td-num mono fw-700">{so.totalQty}</td>
                  <td className="td-num mono fw-700" style={{ color: jcColor }}>
                    {so.jcQty}
                  </td>
                  <td className="td-num mono fw-700" style={{ color: 'var(--green2)' }}>
                    {so.dispatchedQty}
                  </td>
                  <td className="td-num mono fw-700" style={{ color: 'var(--red2)' }}>
                    {/* ADR-196 — qty dropped by closing lines short is not Pending. */}
                    {Math.max(0, so.totalQty - so.dispatchedQty - so.shortClosedQty)}
                  </td>
                  <td
                    className="mono"
                    style={{
                      fontSize: 12,
                      whiteSpace: 'nowrap',
                      color: overdue ? 'var(--red)' : 'var(--text2)',
                      fontWeight: overdue ? 700 : undefined,
                    }}
                  >
                    {so.earliestDueDate
                      ? `${fmtDate(so.earliestDueDate)}${overdue ? ' ⚠' : ''}`
                      : '—'}
                  </td>
                  <td>
                    <div
                      style={{
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'center',
                        gap: 2,
                      }}
                    >
                      <SoStatusBadge status={so.status} />
                      {/* ADR-196 — To Deliver / To Bill / Completed / Closed. */}
                      <SoFulfilmentBadge status={so.fulfilmentStatus} />
                    </div>
                  </td>
                  {/* The card's actions in the ⋯, same gates: View is the
                      row click; Edit needs edit; Assign Task needs edit on a
                      non-closed order; Delete needs edit + approve on a
                      non-closed order (it opens the route's reason dialog). */}
                  <td className="td-ctr" onClick={(e) => e.stopPropagation()}>
                    <RowMenu
                      renderLink={(p) => <Link {...p} />}
                      items={[
                        {
                          key: 'edit',
                          label: 'Edit',
                          icon: 'pencil',
                          hidden: !canEdit,
                          to: `/sales-orders/${so.id}/edit`,
                        },
                        {
                          key: 'assign',
                          label: 'Assign Task',
                          icon: 'user-round',
                          group: 'assign',
                          hidden: !canEdit || so.status === 'closed',
                          onSelect: () => setAssignSo(so),
                        },
                        {
                          key: 'delete',
                          label: 'Delete',
                          icon: 'trash-2',
                          group: 'danger',
                          hidden: !canDelete || so.status === 'closed',
                          onSelect: () => onDeleteSo(so),
                        },
                      ]}
                    />
                  </td>
                </tr>,
                // The order's lines, right under its row — the same panel the
                // card opens (component lines with Edit / Del, or the equipment
                // BOM strip + items). padding 0 so the panel keeps its own inset.
                isExpanded ? (
                  <tr key={`${so.id}-lines`}>
                    <td
                      colSpan={COLUMN_COUNT}
                      style={{ background: 'var(--bg3)', padding: 0, textAlign: 'left' }}
                    >
                      {renderExpanded(so)}
                    </td>
                  </tr>
                ) : null,
              ];
            })}
          </tbody>
        </table>
      </div>
      {assignSo ? (
        <AssignTaskModal
          linkedRef={{
            type: 'sales_order',
            id: assignSo.id,
            display: `SO ${assignSo.code}`,
            navPage: `/sales-orders/${assignSo.id}`,
          }}
          suggestedTitle={
            assignSo.type === 'equipment' && assignSo.bomStatus === 'BOM Pending'
              ? `Create BOM for ${assignSo.code}`
              : `Follow up ${assignSo.code}`
          }
          onClose={() => setAssignSo(null)}
        />
      ) : null}
    </>
  );
}
