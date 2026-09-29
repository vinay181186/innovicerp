// SO / WO Orders — LIST VIEW. The same orders the card list shows, laid out as
// the app's ruled sheet (`.innovic-table.tbl-grid`, the Plans / Job Cards
// look) — one row per order, a ▸ chevron on the SO No. that opens the order's
// lines right under it, and the card's actions as one row of icon buttons at
// the end (hover names the action). Per the user-approved mock-up
// SO-List-Sheet-Mockup.html (2026-09-21) and the icons-only rule added the
// same day.
//
// Nothing here owns data or state: rows, the expanded-id set, the permission
// flags and every handler come from the list route, so both views share one
// query, one expand state and one set of mutations. The expanded content is
// rendered by the route too (renderExpanded) — the very same panel the card
// opens — so the line table lives in exactly one place.

import type { SalesOrderListItem } from '@innovic/shared';
import { Link } from '@tanstack/react-router';
import { fmtDate } from '@/lib/date';
import { ChevronDown, ChevronRight, Pencil, Trash2 } from 'lucide-react';
import { AssignTaskButton } from '@/modules/tasks/components/assign-task-button';
import { SoStatusBadge } from './so-status-badge';
import { soTypeLabel } from '../lib/so-status-label';

/** Column count — the expanded row's <td colSpan> must always match the
 *  <colgroup> below, so it is named once here. */
const COLUMN_COUNT = 12;
/** Icon size inside the Action buttons. */
const ICON = 13;
/** The icon buttons' inline trim: the sheet's `.jc-row-acts .btn-sm` rule
 *  pads 2px 6px (a labelled button's fit); an icon alone needs 3px a side so
 *  four of them sit on one row inside a 10% column at 1280px wide. */
const ICON_BTN: React.CSSProperties = { padding: '2px 3px' };
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
            <col style={{ width: '22%' }} />
            <col style={{ width: '5%' }} />
            <col style={{ width: '6%' }} />
            <col style={{ width: '6%' }} />
            <col style={{ width: '7%' }} />
            <col style={{ width: '6%' }} />
            <col style={{ width: '8%' }} />
            <col style={{ width: '8%' }} />
            <col style={{ width: '10%' }} />
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
              <th>Action</th>
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
                    {Math.max(0, so.totalQty - so.dispatchedQty)}
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
                    <SoStatusBadge status={so.status} />
                  </td>
                  {/* The card's actions, same gates: View is the code link;
                      + Line needs edit; Assign needs edit on a non-closed
                      order; Del needs edit + approve on a non-closed order.
                      Icons only, one row, centred — the title / aria-label
                      names the action on hover. Side padding trimmed on the
                      cell so four icons fit the column without spilling. */}
                  <td style={{ padding: '8px 2px' }}>
                    <div
                      className="jc-row-acts"
                      style={{
                        display: 'flex',
                        gap: 4,
                        justifyContent: 'center',
                        flexWrap: 'nowrap',
                      }}
                      onClick={(e) => e.stopPropagation()}
                    >
                      {canEdit ? (
                        <Link
                          to="/sales-orders/$id/edit"
                          params={{ id: so.id }}
                          className="btn btn-ghost btn-sm btn-icon"
                          style={ICON_BTN}
                          title="Edit"
                          aria-label="Edit"
                        >
                          <Pencil size={ICON} />
                        </Link>
                      ) : null}
                      {canEdit && so.status !== 'closed' ? (
                        <AssignTaskButton
                          linkedRef={{
                            type: 'sales_order',
                            id: so.id,
                            display: `SO ${so.code}`,
                            navPage: `/sales-orders/${so.id}`,
                          }}
                          suggestedTitle={
                            so.type === 'equipment' && so.bomStatus === 'BOM Pending'
                              ? `Create BOM for ${so.code}`
                              : `Follow up ${so.code}`
                          }
                          className="btn btn-ghost btn-sm btn-icon"
                          label=""
                        />
                      ) : null}
                      {canDelete && so.status !== 'closed' ? (
                        // The sheet paints every .btn-sm on paper (theme rule), which
                        // would leave btn-danger's white icon invisible — so the
                        // icon is told to be red here, tokens only.
                        <button
                          type="button"
                          className="btn btn-danger btn-sm btn-icon"
                          style={{ ...ICON_BTN, color: 'var(--red2)' }}
                          onClick={() => onDeleteSo(so)}
                          title="Delete"
                          aria-label="Delete"
                        >
                          <Trash2 size={ICON} />
                        </button>
                      ) : null}
                    </div>
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
    </>
  );
}
