// ADR-243 — the SO / JWSO create/edit forms' Place of Supply + Tax Type
// PREVIEW and live money rows. A preview only: the server decides the tax type
// on save from the same shared rule (placeOfSupplyFor / taxTypeForSupply) and
// the browser never sends it. One file so the SO and JWSO forms cannot drift.

import {
  type ServicePoTaxType,
  companyStateCodeFor,
  computeGstTotals,
  placeOfSupplyFor,
  placeOfSupplyLabel,
  taxTypeForSupply,
} from '@innovic/shared';
import { inrFormat } from '@/lib/print/doc-print';
import { partyAddressLines } from '@/lib/print/company';
import { useClient } from '@/modules/clients/api';
import { useMyCompany } from '@/modules/settings/api';
import { Banner } from '@/ui/feedback';
import { FormField } from '@/ui/forms';
import {
  ORDER_STATE_MISSING_NOTE,
  gstTaxRows,
  signedRoundOff,
  taxTypeLabel,
} from '../lib/gst-rows';

export interface OrderSupplyPreview {
  placeOfSupply: string | null;
  taxType: ServicePoTaxType | null;
  /** A customer is chosen and loaded, but its State is unknown. */
  customerStateMissing: boolean;
  /** The chosen customer's master address (line, city, state, pincode joined
   *  with ", ", blanks skipped); null when none / not loaded. Read-only. */
  customerAddress: string | null;
}

/** Place of Supply + Tax Type for the chosen customer, worked out live. */
export function useOrderSupplyPreview(clientId: string | null | undefined): OrderSupplyPreview {
  const { data: client } = useClient(clientId ?? undefined);
  const { data: company } = useMyCompany();
  const picked = client && client.id === clientId ? client : null;
  const placeOfSupply = picked ? placeOfSupplyFor(picked) : null;
  const taxType = picked
    ? taxTypeForSupply({
        placeOfSupply,
        companyStateCode: company ? companyStateCodeFor(company) : null,
        gstCategory: picked.gstCategory,
      })
    : null;
  const customerAddress = picked ? partyAddressLines(picked).join(', ') || null : null;
  return {
    placeOfSupply,
    taxType,
    customerStateMissing: picked != null && taxType == null,
    customerAddress,
  };
}

/** Read-only Customer Address beside the Customer picker — from the customer
 *  master, never typed. Same client query as the preview above (no extra fetch). */
export function CustomerAddressField(props: { preview: OrderSupplyPreview }): React.JSX.Element {
  const address = props.preview.customerAddress;
  return (
    <FormField label="Customer Address" size="lg">
      <div
        className="text2"
        title={address ?? undefined}
        style={{
          fontSize: 'var(--fs-sm)',
          fontWeight: 600,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
      >
        {address ?? '—'}
      </div>
    </FormField>
  );
}

/** The two read-only header fields beside the customer, plus the orange note. */
export function OrderSupplyFormFields(props: { preview: OrderSupplyPreview }): React.JSX.Element {
  const { placeOfSupply, taxType, customerStateMissing } = props.preview;
  return (
    <>
      <FormField label="Place of Supply" size="md">
        <div className="text2" style={{ fontSize: 'var(--fs-sm)', fontWeight: 600 }}>
          {placeOfSupply ? placeOfSupplyLabel(placeOfSupply) : '—'}
        </div>
      </FormField>
      <FormField label="Tax Type" size="sm">
        <div className="text2" style={{ fontSize: 'var(--fs-sm)', fontWeight: 600 }}>
          {placeOfSupply || taxType ? `${taxTypeLabel(taxType)} (auto)` : '—'}
        </div>
      </FormField>
      {customerStateMissing ? (
        <div className="f-full">
          <Banner tone="warn" flush>
            {ORDER_STATE_MISSING_NOTE}
          </Banner>
        </div>
      ) : null}
    </>
  );
}

/** The live totals rows for a form's line table footer: label + ₹ text. */
export function orderFormTotalRows(args: {
  subtotal: number;
  gstPercent: number;
  taxType: ServicePoTaxType | null;
}): {
  subtotal: string;
  taxRows: { label: string; value: string }[];
  roundOff: string;
  grand: string;
} {
  const t = computeGstTotals(args);
  return {
    subtotal: `₹${inrFormat(t.subtotal)}`,
    taxRows: gstTaxRows(t).map((r) => ({ label: r.label, value: `₹${inrFormat(r.amount)}` })),
    roundOff: signedRoundOff(t.roundOff),
    grand: `₹${inrFormat(t.grandTotal)}`,
  };
}
