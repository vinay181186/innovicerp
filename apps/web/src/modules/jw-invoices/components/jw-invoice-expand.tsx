// What the ▸ row reveals under a JW Invoice (ADR-199 fit table). The register
// row carries everything already, so no extra fetch: the expand just lays out
// the fields that did not earn a column — Item Name, Rate, GST %, GST Amt — plus
// the screen-only Place of Supply note when the invoice is missing it.
//
// Rate / GST% / GST Amt are money (or money-adjacent) and are shown only when the
// viewer may see prices (`priceHidden` is false), the same gate the money columns
// use on the main row.

import type { JwInvoiceListItem } from '@innovic/shared';
import { PLACE_OF_SUPPLY_UNKNOWN_NOTE } from '@innovic/shared';

function money(n: number): string {
  return n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function Cell({ label, value }: { label: string; value: React.ReactNode }): React.JSX.Element {
  return (
    <div>
      <div
        className="text3"
        style={{
          fontSize: 10,
          textTransform: 'uppercase',
          letterSpacing: '0.05em',
          marginBottom: 2,
        }}
      >
        {label}
      </div>
      <div className="mono" style={{ fontSize: 12, color: 'var(--text)' }}>
        {value}
      </div>
    </div>
  );
}

export function JwInvoiceExpand({
  r,
  priceHidden,
}: {
  r: JwInvoiceListItem;
  priceHidden: boolean;
}): React.JSX.Element {
  return (
    <div style={{ padding: 'var(--sp-2) var(--sp-3) var(--sp-3) var(--sp-6)' }}>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(4, minmax(120px, 1fr))',
          gap: 'var(--sp-4)',
        }}
      >
        <Cell label="Item Name" value={r.partName ?? '—'} />
        {priceHidden ? null : (
          <>
            <Cell label="Rate" value={money(r.rate ?? 0)} />
            <Cell label="GST %" value={`${r.gstPercent ?? 0}%`} />
            <Cell label="GST Amt" value={money(r.gstAmount ?? 0)} />
          </>
        )}
      </div>

      {/* Screen-only (plan D2, 0186), never printed. */}
      {r.status !== 'cancelled' && !r.placeOfSupply ? (
        <div style={{ marginTop: 'var(--sp-2)', fontSize: 11, color: 'var(--amber2)' }}>
          ⚠ {PLACE_OF_SUPPLY_UNKNOWN_NOTE}
        </div>
      ) : null}
    </div>
  );
}
