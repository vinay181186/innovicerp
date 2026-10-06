// Row 2 of every GRN header grid — WHO DELIVERED IT.
//
// One cluster, four cells: Vendor (two) · Vendor Code · GSTIN. It was written
// out four times, byte for byte, in the three create forms and the edit form,
// and so was the `useVendor` read behind it. One copy, one answer: Vendor Code
// and GSTIN come off the vendor master through the same hook the GRN detail
// page uses, so the receipt screens and the saved GRN can never show different
// codes for one vendor. GSTIN prints today and had never been on screen at all.
//
// The Vendor cell itself differs by SCREEN, not by vendor: the three create
// screens derive it from the picked source document and show a fact, the edit
// screen lets it be changed and shows a picker. That arrives as the `vendor`
// slot — this component does not know, and must not ask, which screen it is on.

import type { ReactNode } from 'react';
import { useVendor } from '@/modules/vendors/api';
import { Cluster, ClusterFact } from '@/ui/forms';

export interface GrnVendorClusterProps {
  /** The vendor master row to read Vendor Code and GSTIN from. Undefined (a
   *  free-text vendor, or nothing picked yet) leaves both cells a quiet dash. */
  vendorId?: string | null | undefined;
  /** The vendor's NAME, for the read-only Vendor cell this component then
   *  builds itself (the three create screens derive it from the picked source
   *  document). Ignored when `vendor` is given. */
  vendorLabel?: string | undefined;
  /** What the Vendor cell says when `vendorLabel` is empty — where the name is
   *  going to come FROM, e.g. "— from the PO —". */
  vendorFrom?: string | undefined;
  /** A Vendor cell built by the caller, two of the row's four, for a screen
   *  where the vendor is CHANGEABLE: the edit screen passes its <VendorPicker>
   *  carrying `className="form-grp cl-span-2"`. Given this, `vendorLabel` and
   *  `vendorFrom` are not read. Either way the row comes out full.
   *
   *  The component takes the cell, or the name, as a PROP; it never asks which
   *  screen it is on. */
  vendor?: ReactNode;
  /** Shown in the Vendor Code cell when the vendor is NOT in the master — the
   *  document's own `vendorCodeText` snapshot, or the edit screen's free-text
   *  box for it. A string is rendered as the fact's value; a node is rendered
   *  in place of the whole cell. */
  codeFallback?: ReactNode;
}

export function GrnVendorCluster({
  vendorId,
  vendorLabel = '',
  vendorFrom,
  vendor,
  codeFallback,
}: GrnVendorClusterProps): React.JSX.Element {
  // One fetch per screen, deduped by TanStack Query against the detail page's
  // own read of the same vendor.
  const { data: master } = useVendor(vendorId || undefined);
  const code = master?.code ?? null;
  const gstin = master?.gstNumber ?? null;
  // The LINK decides which cell this is, never the fetch: keying off `code`
  // would flash the "not linked" box for one render while the master row is
  // still loading for a vendor that is perfectly well linked.
  const linked = Boolean(vendorId);
  const fallbackIsCell = codeFallback !== undefined && typeof codeFallback !== 'string';
  const fallbackText = typeof codeFallback === 'string' ? codeFallback : null;
  const shown = linked ? code : fallbackText;

  return (
    <Cluster name="Vendor">
      {vendor ?? (
        <ClusterFact
          label="Vendor"
          span={2}
          value={vendorLabel || vendorFrom || '—'}
          empty={!vendorLabel}
          {...(vendorLabel ? { title: vendorLabel } : {})}
        />
      )}
      {!linked && fallbackIsCell ? (
        codeFallback
      ) : (
        <ClusterFact
          label="Vendor Code"
          num
          value={shown ?? '—'}
          empty={!shown}
          {...(shown ? { title: shown } : {})}
        />
      )}
      <ClusterFact
        label="GSTIN"
        num
        value={gstin ?? '—'}
        empty={!gstin}
        {...(gstin ? { title: gstin } : {})}
      />
    </Cluster>
  );
}
