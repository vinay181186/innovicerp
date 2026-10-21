// ADR-241 — the SO / JWSO money strip and supply facts on the DETAIL pages.
// Figures are the server's `totals` (Subtotal → SGST + CGST or IGST →
// Round-off → Grand Total); nothing is worked out here. One component so the
// SO and JWSO detail pages cannot drift.

import { type ServicePoTaxType, type SoTotals, placeOfSupplyLabel } from '@innovic/shared';
import { QtyStrip } from '@/ui/data';
import { Banner } from '@/ui/feedback';
import { ReadField } from '@/ui/layout';
import {
  ORDER_STATE_MISSING_NOTE,
  gstTaxRows,
  signedRoundOff,
  taxTypeLabel,
} from '../lib/gst-rows';

/** ₹ with Indian grouping, to the paise. */
function fmtInr(n: number): string {
  return `₹${n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** Subtotal / tax rows / Round-off / Grand Total, plus the orange note when a
 *  customer is set but its State is unknown. Null totals (prices hidden) → nothing. */
export function OrderTotalsStrip(props: {
  totals: SoTotals | null | undefined;
  hasCustomer: boolean;
}): React.JSX.Element | null {
  const t = props.totals;
  if (!t) return null;
  return (
    <>
      {t.taxType == null && props.hasCustomer ? (
        <div style={{ marginTop: 'var(--sp-3)' }}>
          <Banner tone="warn" flush>
            {ORDER_STATE_MISSING_NOTE}
          </Banner>
        </div>
      ) : null}
      <QtyStrip
        style={{ marginTop: 'var(--sp-3)' }}
        items={[
          { label: 'Subtotal', value: fmtInr(t.subtotal) },
          ...gstTaxRows(t).map((r) => ({ label: r.label, value: fmtInr(r.amount) })),
          { label: 'Round-off', value: signedRoundOff(t.roundOff) },
          { label: 'Grand Total', value: fmtInr(t.grandTotal) },
        ]}
      />
    </>
  );
}

/** Place of Supply + Tax Type read fields for the header grid. */
export function OrderSupplyFields(props: {
  placeOfSupply: string | null;
  taxType: ServicePoTaxType | null;
}): React.JSX.Element {
  return (
    <>
      <ReadField
        label="Place of Supply"
        size="md"
        value={props.placeOfSupply ? placeOfSupplyLabel(props.placeOfSupply) : null}
      />
      <ReadField
        label="Tax Type"
        size="sm"
        value={props.placeOfSupply || props.taxType ? taxTypeLabel(props.taxType) : null}
      />
    </>
  );
}
