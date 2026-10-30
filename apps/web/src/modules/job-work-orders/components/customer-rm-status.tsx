// OW-143 — where the customer's own raw material is, as ONE word, on every JWSO
// screen (Master List, the list's ▸ line table, JWSO detail header + lines).
// The server computes the status (packages/shared lib/customer-rm-status.ts);
// this only maps status → word + colour, and lists the quantities in a
// HoverCard (ui/data — portalled, so the table cell never clips it).

import { CUSTOMER_RM_STATUS_LABEL, type CustomerRm } from '@innovic/shared';
import { HoverCard } from '@/ui/data';

const COLOUR: Record<CustomerRm['status'], string> = {
  awaited: 'var(--red2)',
  deviated: 'var(--red2)',
  partial: 'var(--amber2)',
  inspection: 'var(--amber2)',
  accepted: 'var(--green2)',
  issuing: 'var(--blue)',
  issued: 'var(--blue)',
  none: 'var(--text3)',
};

type Row = readonly [label: string, qty: number, colour?: string] | 'sep';

/** The breakdown rows — names from docs/NAMING.md (OW-143 rows). */
function rows(v: CustomerRm): Row[] {
  return [
    ['Required', v.requiredQty],
    ['Received (Party GRN)', v.receivedQty],
    'sep',
    ['GRN Pending', v.grnPendingQty, 'var(--red2)'],
    ['Waiting QC', v.qcPendingQty, 'var(--amber2)'],
    ['Deviated (NC open)', v.deviatedQty, 'var(--red2)'],
    ['In Store', v.inStoreQty, 'var(--green2)'],
    ['Issued to JC', v.issuedQty, 'var(--blue)'],
    ['Returned to Customer', v.returnedQty],
    'sep',
    ['Accepted', v.acceptedQty],
  ];
}

function Breakdown({ value }: { value: CustomerRm }): React.JSX.Element {
  return (
    <>
      <div className="hover-card-title">Customer RM breakdown</div>
      <table className="hover-card-rows">
        <tbody>
          {rows(value).map((r, i) =>
            r === 'sep' ? (
              <tr key={i} className="sep">
                <td colSpan={2} />
              </tr>
            ) : (
              <tr key={r[0]}>
                <td style={r[2] && r[1] !== 0 ? { color: r[2] } : undefined}>{r[0]}</td>
                <td className="n" style={r[2] && r[1] !== 0 ? { color: r[2] } : undefined}>
                  {r[1]}
                </td>
              </tr>
            ),
          )}
        </tbody>
      </table>
    </>
  );
}

export function CustomerRmStatus({ value }: { value: CustomerRm | undefined }): React.JSX.Element {
  if (!value || value.status === 'none') {
    return <span style={{ color: 'var(--text3)' }}>—</span>;
  }
  return (
    <HoverCard label="Customer RM breakdown" card={<Breakdown value={value} />}>
      <span style={{ color: COLOUR[value.status], fontWeight: 700 }}>
        {CUSTOMER_RM_STATUS_LABEL[value.status]}
      </span>
    </HoverCard>
  );
}
