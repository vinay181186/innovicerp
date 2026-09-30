// The customer box of a legal paper (Tax Invoice, JW Invoice, Dispatch DC, JW
// Return Challan) — plan v3 Step 4, owner decision D7, migration 0186.
//
// The paper's OWN copy of the customer (taken when it was made) wins, so a
// reprint after a master change still shows what was billed / shipped. Only a
// paper with no copy (made before 0186) reads the live customer master.
// The customer code and the contact line always come from the master: the code
// is permanent, and the contact is not part of the legal copy.

import { type Client, type ClientCopy, stateNameForCode } from '@innovic/shared';

export interface PrintParty {
  code: string;
  name: string;
  /** Street line, then "City, State, Pincode" — blanks dropped. */
  addressLines: string[];
  gstNumber: string;
  /** "Gujarat, Code: 24" — the State row; '' when not known. */
  stateLine: string;
  contact: string;
}

export function partyForPrint(
  copy: ClientCopy | null | undefined,
  live: Client | null | undefined,
  fallbackName: string | null | undefined,
): PrintParty {
  const src = copy
    ? copy
    : {
        name: live?.name ?? null,
        gstNumber: live?.gstNumber ?? null,
        addressLine1: live?.addressLine1 ?? null,
        city: live?.city ?? null,
        state: live?.state ?? null,
        stateCode: live?.stateCode ?? null,
        pincode: live?.pincode ?? null,
      };
  const state = src.state?.trim() || stateNameForCode(src.stateCode) || '';
  return {
    code: live?.code ?? '',
    name: src.name ?? fallbackName ?? '',
    addressLines: [
      src.addressLine1?.trim() ?? '',
      [src.city?.trim(), state, src.pincode?.trim()].filter(Boolean).join(', '),
    ].filter(Boolean),
    gstNumber: src.gstNumber ?? '',
    stateLine: state ? (src.stateCode ? `${state}, Code: ${src.stateCode}` : state) : '',
    contact: [live?.contactPerson, live?.phone].filter(Boolean).join(', '),
  };
}
