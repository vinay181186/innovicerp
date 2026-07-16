// SO Costing detail — mirror of legacy _soCostDetail (L17310). Per-line
// Material/Outsource/Machine cost with op rows. Read-only. Every currency
// figure here is server-owned (so-costing/service.ts); none is summed in the
// browser.
//
// Legacy deltas kept deliberately:
//  - No "Export Excel" button. Legacy L17384 wires one to _soCostExport
//    (L17402), which re-derives the whole costing in the browser via
//    calcEngine(). Porting it needs a server-side export; not invented here.
//  - The op Type chip prints "(<cycle>m × <qty>)" where legacy L17362 prints
//    "(<cycle>h × <qty> × ₹<rate>/h)". Our cycle_time_min is minutes, not
//    hours, and legacy derives the ₹/h by dividing machTimeCost by
//    cycleTime×qty in the browser. No hourRate is exposed on SoCostingOpRow,
//    so the rate is omitted rather than computed here.

import type { SoCostingDetail } from '@innovic/shared';
import { Link, createRoute } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, Loader2 } from 'lucide-react';
import { apiFetch } from '@/lib/api';
import { inrFormat } from '@/lib/print/doc-print';
import { authenticatedRoute } from '@/routes/_authenticated';

export const soCostingDetailRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: 'so-costing/$id',
  component: SoCostingDetailPage,
});

const m2 = (v: number): string => (v > 0 ? `₹${inrFormat(v)}` : '—');

// Legacy sizes only SO and TOTAL at 16px (L17386/L17392); every other stat
// inherits the body size.
function Stat({
  label,
  value,
  color,
  fontSize,
}: {
  label: string;
  value: string;
  color?: string;
  fontSize?: number;
}): React.JSX.Element {
  return (
    <div>
      <span className="text3" style={{ fontSize: 10 }}>
        {label}
      </span>
      <br />
      <b style={{ color, fontSize }}>{value}</b>
    </div>
  );
}

function SoCostingDetailPage(): React.JSX.Element {
  const { id } = soCostingDetailRoute.useParams();
  const { data, isLoading, isError, error } = useQuery<SoCostingDetail>({
    queryKey: ['so-costing', id],
    queryFn: () => apiFetch<SoCostingDetail>(`/so-costing/${id}`),
  });

  if (isLoading) {
    return (
      <div className="empty-state" style={{ padding: 40 }}>
        <Loader2 className="inline h-4 w-4 animate-spin" /> Loading…
      </div>
    );
  }
  if (isError || !data) {
    return (
      <div className="empty-state" style={{ padding: 40, color: 'var(--red)' }}>
        {error instanceof Error ? error.message : 'Failed to load'}
      </div>
    );
  }

  return (
    <div>
      <Link to="/so-costing" className="btn btn-ghost" style={{ marginBottom: 14 }}>
        <ArrowLeft size={14} /> Back to SO Costing
      </Link>

      <div
        className="panel"
        style={{ padding: '12px 16px', marginBottom: 16, display: 'flex', gap: 20, flexWrap: 'wrap' }}
      >
        <Stat label="SO" value={data.soNo} color="var(--cyan)" fontSize={16} />
        <Stat label="CUSTOMER" value={data.customer ?? '—'} />
        {data.costCenter ? (
          <Stat
            label="COST CENTER"
            value={`${data.costCenter}${data.costCenterName ? ` — ${data.costCenterName}` : ''}`}
            color="var(--teal, #0d9488)"
          />
        ) : null}
        <Stat label="MATERIAL" value={m2(data.grandMaterial)} color="var(--blue)" />
        <Stat label="OUTSOURCE" value={m2(data.grandOutsource)} color="var(--amber)" />
        <Stat label="MACHINE TIME" value={m2(data.grandMachineTime)} color="var(--cyan)" />
        <Stat label="TOTAL" value={m2(data.grandTotal)} color="var(--green)" fontSize={16} />
      </div>

      <div className="panel">
        <div className="tbl-wrap">
          <table className="innovic-table">
            <thead>
              <tr>
                <th>Ln</th>
                <th>Item Code</th>
                <th>Item Name</th>
                <th className="td-ctr">Qty</th>
                <th>JC / Detail</th>
                <th>Operation</th>
                <th>Type</th>
                <th className="td-ctr" style={{ color: 'var(--green)' }}>Cost</th>
              </tr>
            </thead>
            <tbody>
              {data.lines.map((line) => (
                <LineRows key={line.salesOrderLineId} line={line} />
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function LineRows({ line }: { line: SoCostingDetail['lines'][number] }): React.JSX.Element {
  return (
    <>
      <tr>
        <td className="td-ctr mono fw-700" style={{ color: 'var(--cyan)' }}>
          {line.lineNo}
        </td>
        <td className="td-code" style={{ color: 'var(--purple)' }}>
          {line.itemCode ?? '—'}
        </td>
        <td style={{ fontSize: 11 }}>{line.itemName}</td>
        <td className="td-ctr mono fw-700">{line.orderQty}</td>
        <td colSpan={3} />
        <td className="td-ctr mono fw-700" style={{ color: 'var(--green)' }}>
          {m2(line.lineTotal)}
        </td>
      </tr>
      {line.materialCost > 0 ? (
        <tr style={{ background: 'var(--bg3)', fontSize: 11 }}>
          <td />
          <td />
          <td />
          <td />
          <td colSpan={3} style={{ fontSize: 10, color: 'var(--blue)' }}>
            📦 Material POs
          </td>
          <td className="td-ctr mono" style={{ fontSize: 10, color: 'var(--blue)' }}>
            ₹{inrFormat(line.materialCost)}
          </td>
        </tr>
      ) : null}
      {line.ops.map((op, i) => {
        const typeLabel =
          op.opType === 'qc' ? '🔬 QC' : op.opType === 'outsource' ? '🏭 Outsource' : `⚙ ${op.machineCode ?? ''}`;
        return (
          <tr key={`${op.jcNo}-${op.opSeq}-${i}`} style={{ background: 'var(--bg3)', fontSize: 11 }}>
            <td />
            <td />
            <td />
            <td />
            <td className="mono" style={{ color: 'var(--cyan)', fontSize: 10 }}>
              {op.jcNo}
            </td>
            <td style={{ fontSize: 10 }}>
              Op{op.opSeq}: {op.operation}
            </td>
            <td className="text3" style={{ fontSize: 10 }}>
              {typeLabel}
              {op.machineTimeCost > 0 ? (
                <span style={{ color: 'var(--amber)', fontSize: 9 }}>
                  {' '}
                  ({op.cycleTimeMin}m × {op.qty})
                </span>
              ) : null}
            </td>
            {/* Legacy L17364-67 prints the outsource and machine-time figures as
                two separately coloured spans, not a sum. Kept that way: both are
                server-owned, so nothing is added in the browser. */}
            <td className="td-ctr mono" style={{ fontSize: 10 }}>
              {op.outsourceCost > 0 ? (
                <span style={{ color: 'var(--amber)' }}>₹{inrFormat(op.outsourceCost)}</span>
              ) : null}
              {op.outsourceCost > 0 && op.machineTimeCost > 0 ? ' + ' : null}
              {op.machineTimeCost > 0 ? (
                <span style={{ color: 'var(--cyan)' }}>₹{inrFormat(op.machineTimeCost)}</span>
              ) : null}
              {op.outsourceCost === 0 && op.machineTimeCost === 0 ? '—' : null}
            </td>
          </tr>
        );
      })}
    </>
  );
}
