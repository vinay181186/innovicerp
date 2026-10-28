// Plans list — the ▸ reveal (the fit table's expanded row): the secondary facts
// kept off the row. Split out of plans-list-columns.tsx (400-line ceiling).

import { PRODUCTION_ORDER_STATUS_LABEL, type ListPlansResponse } from '@innovic/shared';
import { Link } from '@tanstack/react-router';
import { fmtDate } from '@/lib/date';
import { soNoWithInternal } from '@/lib/so-number';

type PlanRow = ListPlansResponse['items'][number];

/** One labelled fact in the ▸ reveal. */
function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <div style={{ minWidth: 120 }}>
      <div
        className="text3"
        style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.04em' }}
      >
        {label}
      </div>
      <div style={{ fontSize: 13 }}>{children}</div>
    </div>
  );
}

/**
 * The ▸ reveal: the secondary facts kept off the row (POL, SO/JWSO, Ln, Order
 * Qty, Covered, PRO No., JC No., Dispatch date). PRO No. / JC No. are real
 * links; the rest are read-only.
 */
export function PlanExpanded({ row }: { row: PlanRow }): React.JSX.Element {
  const poStatus = row.productionOrderStatus
    ? ((PRODUCTION_ORDER_STATUS_LABEL as Record<string, string | undefined>)[
        row.productionOrderStatus
      ] ?? row.productionOrderStatus)
    : undefined;
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 18, padding: '10px 14px' }}>
      <Field label="POL">
        <span className="mono fw-700" style={{ color: 'var(--purple)' }}>
          {row.clientPoLineNo ?? '—'}
        </span>
      </Field>
      <Field label="SO / JWSO No.">
        <span className="mono">
          {row.soCodeText ? soNoWithInternal(row.soCodeText, row.soInternalNo) : '—'}
        </span>
      </Field>
      <Field label="Ln">{row.lineNo ?? '—'}</Field>
      <Field label="Order Qty">
        <span className="mono fw-700">{row.orderQty}</span>
      </Field>
      <Field label="Covered">
        <span className="mono">{row.derivedStatus ? row.coveredQty : '—'}</span>
      </Field>
      <Field label="PRO No.">
        {row.productionOrderId && row.productionOrderCode ? (
          <Link
            to="/production-orders/$id"
            params={{ id: row.productionOrderId }}
            className="td-code"
            title={poStatus ? `Production Order · ${poStatus}` : 'Production Order'}
          >
            {row.productionOrderCode}
          </Link>
        ) : (
          <span className="text3">—</span>
        )}
      </Field>
      <Field label="JC No.">
        {row.jcId && row.jcCode ? (
          <Link to="/job-cards/$id" params={{ id: row.jcId }} className="td-code">
            {row.jcCode}
          </Link>
        ) : (
          <span className="text3">—</span>
        )}
      </Field>
      <Field label="Dispatch date">
        {row.customerDispatchDate ? fmtDate(row.customerDispatchDate) : '—'}
      </Field>
    </div>
  );
}
