// One dispatch = one SO-Master-style card. Replaces the 11-column register
// table, which was `white-space: nowrap` on every cell with three free-text
// columns (Customer / Dispatched By / Remarks) and a nested 8-column line table
// inside a `colSpan` cell — so the whole page scrolled sideways and the Dispatch
// No. slid out of view. Same three bands as sales-orders/routes/list.tsx and the
// JWSO port: accent bar + identity band, metric strip + meta line, line items.

import type { CustomerDispatchRegisterRow } from '@innovic/shared';
import { Link } from '@tanstack/react-router';
import { ChevronDown, ChevronRight } from 'lucide-react';

/** One dispatch document plus the register rows that belong to it. */
export type DispatchGroup = {
  dispatchId: string;
  code: string;
  date: string;
  soNo: string | null;
  customer: string | null;
  dispatchedBy: string | null;
  remarks: string | null;
  status: CustomerDispatchRegisterRow['status'];
  lines: CustomerDispatchRegisterRow[];
  totalQty: number;
};

/** One cell of the card's metric strip — big number over a small caps label,
 *  identical to the SO/WO and JWSO lists. `value` is a node, not a number, so
 *  the dispatch total can keep its leading minus (stock going out). */
function QtyBox({
  label,
  value,
  color,
  bordered,
}: {
  label: string;
  value: React.ReactNode;
  color?: string;
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
      <div className="mono fw-700" style={{ fontSize: 15, color: color ?? 'var(--text)', lineHeight: 1.2 }}>
        {value}
      </div>
      <div
        className="mono"
        style={{ fontSize: 9, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.08em' }}
      >
        {label}
      </div>
    </div>
  );
}

/** Left accent bar. Only two states exist for a dispatch: it happened (green —
 *  the same "done" green the status badge uses) or it was reversed (grey). */
function accentFor(g: DispatchGroup): string {
  return g.status === 'cancelled' ? 'var(--text3)' : 'var(--green)';
}

export function DispatchCard(props: {
  g: DispatchGroup;
  isOpen: boolean;
  cancelPending: boolean;
  onToggle: () => void;
  onCancel: () => void;
}): React.JSX.Element {
  const { g, isOpen } = props;
  const cancelled = g.status === 'cancelled';

  return (
    <div className="panel" style={{ display: 'flex', overflow: 'hidden', padding: 0, marginBottom: 10 }}>
      {/* Accent bar — green dispatched, grey cancelled. */}
      <div style={{ width: 4, flexShrink: 0, background: accentFor(g) }} />
      {/* A cancelled dispatch was reversed, so its card is dimmed — the same
          0.55 the old table rows used. The accent bar stays full strength. */}
      <div style={{ flex: 1, minWidth: 0, ...(cancelled ? { opacity: 0.55 } : null) }}>
        {/* Band 1: identity + status + actions */}
        <div
          onClick={props.onToggle}
          title={isOpen ? 'Hide dispatched items' : 'Show dispatched items'}
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
            {isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          </span>
          {/* Not a link — customer dispatches have no detail route; the card's
              own expand IS the detail. Kept in --cyan, this module's existing
              identity colour (JC No. and the KPI tile use it too). */}
          <span className="td-code" style={{ color: 'var(--cyan)', fontWeight: 800, fontSize: 13 }}>
            {g.code}
          </span>
          <span className="fw-700" style={{ fontSize: 13 }}>{g.customer ?? '—'}</span>
          <span className={`badge ${cancelled ? 'b-grey' : 'b-green'}`}>{g.status}</span>
          <span style={{ flex: 1 }} />
          {/* Stop the row-toggle when clicking an action button. */}
          {!cancelled ? (
            <div style={{ display: 'flex', gap: 4, alignItems: 'center' }} onClick={(e) => e.stopPropagation()}>
              <Link
                to="/invoices/new"
                search={{ dispatchId: g.dispatchId }}
                className="btn btn-ghost btn-sm"
                style={{ color: 'var(--green)' }}
                title="Raise an invoice against this dispatch"
              >
                🧾 Invoice
              </Link>
              <button
                type="button"
                className="btn btn-danger btn-sm"
                disabled={props.cancelPending}
                onClick={props.onCancel}
              >
                Cancel
              </button>
            </div>
          ) : null}
        </div>

        {/* Band 2: metric strip + meta line */}
        <div
          onClick={props.onToggle}
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
            <QtyBox label="Total Qty" value={`-${g.totalQty}`} color="var(--red)" />
            <QtyBox label="Lines" value={g.lines.length} bordered />
          </div>
          <div
            className="mono"
            style={{ fontSize: 11, color: 'var(--text3)', display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}
          >
            <span className="text2">{g.date}</span>
            <span>·</span>
            <span>
              SO <span style={{ color: 'var(--purple)', fontWeight: 700 }}>{g.soNo ?? '—'}</span>
            </span>
            <span>·</span>
            <span className="text2">{g.dispatchedBy ?? '—'}</span>
            <span>·</span>
            <span title={g.remarks ?? ''}>{g.remarks || '—'}</span>
          </div>
        </div>

        {/* Band 3: the dispatched item lines */}
        {isOpen ? (
          <div style={{ background: 'var(--bg3)', borderTop: '1px solid var(--border)' }}>
            <DispatchLines g={g} />
          </div>
        ) : null}
      </div>
    </div>
  );
}

/** The expanded line table. No `.tbl-wrap` inside a card (SO rule) — the card
 *  owns the width, so the table is `width: 100%` and wraps with the page. */
function DispatchLines({ g }: { g: DispatchGroup }): React.JSX.Element {
  return (
    <div style={{ padding: '8px 12px 8px 36px' }}>
      <div
        style={{
          fontSize: 10,
          color: 'var(--blue)',
          fontFamily: 'var(--mono)',
          fontWeight: 700,
          letterSpacing: '0.06em',
          marginBottom: 6,
        }}
      >
        ▸ DISPATCHED ITEMS — {g.code}
      </div>
      <table className="innovic-table" style={{ width: '100%', margin: 0 }}>
        <thead>
          <tr style={{ background: 'var(--bg4)' }}>
            <th style={{ width: 36 }}>#</th>
            <th>JC No.</th>
            <th style={{ color: 'var(--purple)' }}>CPO Ln</th>
            <th>Item Code</th>
            <th>Item Name</th>
            <th className="td-ctr" style={{ color: 'var(--red)' }}>Qty</th>
            <th className="td-ctr">UOM</th>
            <th className="td-ctr">Stock B→A</th>
          </tr>
        </thead>
        <tbody>
          {g.lines.map((l, i) => (
            <tr key={`${l.dispatchId}-${i}`} style={{ background: 'var(--bg)' }}>
              <td className="td-ctr mono">{i + 1}</td>
              <td className="td-code" style={{ color: 'var(--cyan)', fontSize: 11 }}>
                {l.jcNo ?? <span style={{ color: 'var(--text3)' }}>—</span>}
              </td>
              <td className="mono" style={{ fontSize: 11, color: 'var(--purple)', fontWeight: 700 }}>
                {l.clientPoLineNo ?? '—'}
              </td>
              <td className="td-code" style={{ color: 'var(--purple)' }}>
                {l.itemCode ?? l.itemCodeText ?? '—'}
              </td>
              <td className="fw-700">{l.itemName}</td>
              <td className="td-ctr mono fw-700" style={{ color: 'var(--red)' }}>-{l.qty}</td>
              <td className="td-ctr">
                <span className="badge b-grey">{l.uom ?? 'NOS'}</span>
              </td>
              <td className="td-ctr mono" style={{ fontSize: 11, color: 'var(--text3)' }}>
                {l.stockBefore ?? '—'}→{l.stockAfter ?? '—'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
