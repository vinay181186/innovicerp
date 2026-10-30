import { describe, expect, it } from 'vitest';
import {
  CUSTOMER_RM_STATUS_LABEL,
  customerRmGrnPendingQty,
  customerRmStatus,
  sumCustomerRmQty,
  type CustomerRmQty,
} from './customer-rm-status';

function q(over: Partial<CustomerRmQty> = {}): CustomerRmQty {
  return {
    requiredQty: 10,
    receivedQty: 0,
    qcPendingQty: 0,
    deviatedQty: 0,
    acceptedQty: 0,
    inStoreQty: 0,
    issuedQty: 0,
    returnedQty: 0,
    ...over,
  };
}

describe('customerRmStatus (OW-143)', () => {
  it('nothing received → Awaited', () => {
    expect(customerRmStatus(q(), false)).toBe('awaited');
    expect(customerRmGrnPendingQty(q())).toBe(10);
  });

  it('received and waiting for QC → Inspection (PROD IN-JW-00025 read "None accepted")', () => {
    expect(customerRmStatus(q({ requiredQty: 8, receivedQty: 8, qcPendingQty: 8 }), false)).toBe(
      'inspection',
    );
  });

  it('some accepted, the rest still due → Partial', () => {
    const r = q({ receivedQty: 6, acceptedQty: 6, inStoreQty: 6 });
    expect(customerRmStatus(r, false)).toBe('partial');
    expect(customerRmGrnPendingQty(r)).toBe(4);
  });

  it('a pending NC wins over everything else → Deviated', () => {
    const r = q({
      requiredQty: 20,
      receivedQty: 14,
      qcPendingQty: 2,
      acceptedQty: 11,
      deviatedQty: 3,
    });
    expect(customerRmStatus(r, false)).toBe('deviated');
    expect(customerRmGrnPendingQty(r)).toBe(4);
  });

  it('QC pending wins over GRN pending', () => {
    expect(
      customerRmStatus(
        q({ receivedQty: 8, qcPendingQty: 2, acceptedQty: 6, inStoreQty: 6 }),
        false,
      ),
    ).toBe('inspection');
  });

  it('all accepted and in store → Accepted', () => {
    expect(customerRmStatus(q({ receivedQty: 10, acceptedQty: 10, inStoreQty: 10 }), false)).toBe(
      'accepted',
    );
  });

  it('part issued → Issuing; all issued → Issued (PROD IN-JW-00005 read "Accepted")', () => {
    expect(
      customerRmStatus(q({ receivedQty: 10, acceptedQty: 10, inStoreQty: 4, issuedQty: 6 }), false),
    ).toBe('issuing');
    expect(
      customerRmStatus(
        q({ requiredQty: 43, receivedQty: 43, acceptedQty: 43, issuedQty: 43 }),
        false,
      ),
    ).toBe('issued');
  });

  it('deviated pieces returned (NC closed) put the line back to Partial — the customer re-sends', () => {
    const r = q({ receivedQty: 10, acceptedQty: 8, inStoreQty: 8, returnedQty: 2 });
    expect(customerRmStatus(r, false)).toBe('partial');
    expect(customerRmGrnPendingQty(r)).toBe(2);
  });

  it('a cancelled JWSO, or nothing to track → none (—)', () => {
    expect(customerRmStatus(q({ qcPendingQty: 4, receivedQty: 4 }), true)).toBe('none');
    expect(customerRmStatus(q({ requiredQty: 0 }), false)).toBe('none');
    expect(CUSTOMER_RM_STATUS_LABEL.none).toBe('—');
  });

  it('over-receipt never makes GRN pending negative', () => {
    expect(customerRmGrnPendingQty(q({ requiredQty: 4, qcPendingQty: 6, receivedQty: 6 }))).toBe(0);
  });

  it('the JWSO word is the rule on the sum of its lines', () => {
    const lineA = q({ requiredQty: 10, receivedQty: 10, acceptedQty: 10, issuedQty: 10 }); // Issued
    const lineB = q({ requiredQty: 6 }); // Awaited
    const total = sumCustomerRmQty([lineA, lineB]);
    expect(total.requiredQty).toBe(16);
    expect(customerRmStatus(total, false)).toBe('partial');
  });
});
