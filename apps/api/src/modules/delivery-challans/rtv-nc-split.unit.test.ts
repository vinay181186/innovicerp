// 0237 — one return-to-vendor DC carrying several NCs: the receive books
// pieces back per LINE NC and the cancel sends every NC back. Pure, no
// database. Run via `pnpm --filter @innovic/api test:unit`.

import { describe, expect, it } from 'vitest';
import { lineNcId, receivedQtyByNc, returnDcNcIds } from './rtv-nc-split';

const NC_A = '00000000-0000-4000-8000-00000000000a';
const NC_B = '00000000-0000-4000-8000-00000000000b';

describe('lineNcId', () => {
  it('reads the line NC first, the header only as fallback', () => {
    expect(lineNcId({ ncId: NC_B }, NC_A)).toBe(NC_B);
    expect(lineNcId({ ncId: null }, NC_A)).toBe(NC_A);
    expect(lineNcId({ ncId: null }, null)).toBeNull();
  });
});

describe('receivedQtyByNc — receive split', () => {
  it('two NC lines, line 1 fully + line 2 partly: each NC gets ONLY its own qty', () => {
    // DC: Ln 1 = NC A, 5 pcs sent; Ln 2 = NC B, 3 pcs sent. Receive 5 + 1.
    const out = receivedQtyByNc(
      [
        { ncId: NC_B, receivedQty: 1 },
        { ncId: NC_A, receivedQty: 5 },
      ],
      NC_A,
    );
    expect(out).toEqual([
      { ncId: NC_A, qty: 5 },
      { ncId: NC_B, qty: 1 },
    ]);
  });

  it('never sums across NCs, adds two receipt lines of the same NC', () => {
    const out = receivedQtyByNc(
      [
        { ncId: NC_A, receivedQty: 2 },
        { ncId: NC_A, receivedQty: 0.5 },
        { ncId: NC_B, receivedQty: 3 },
      ],
      NC_A,
    );
    expect(out).toEqual([
      { ncId: NC_A, qty: 2.5 },
      { ncId: NC_B, qty: 3 },
    ]);
  });

  it('a 0 received line books nothing on its NC', () => {
    expect(
      receivedQtyByNc(
        [
          { ncId: NC_A, receivedQty: 4 },
          { ncId: NC_B, receivedQty: 0 },
        ],
        NC_A,
      ),
    ).toEqual([{ ncId: NC_A, qty: 4 }]);
  });

  it('an old (pre-0237) line with no NC falls back to the header NC', () => {
    expect(receivedQtyByNc([{ ncId: null, receivedQty: 7 }], NC_A)).toEqual([
      { ncId: NC_A, qty: 7 },
    ]);
  });

  it('an ordinary OSP DC (no NC anywhere) books nothing', () => {
    expect(receivedQtyByNc([{ ncId: null, receivedQty: 7 }], null)).toEqual([]);
  });

  it('returns NCs in id order (lock order), whatever the line order', () => {
    const out = receivedQtyByNc(
      [
        { ncId: NC_B, receivedQty: 1 },
        { ncId: NC_A, receivedQty: 1 },
      ],
      NC_B,
    );
    expect(out.map((x) => x.ncId)).toEqual([NC_A, NC_B]);
  });
});

describe('returnDcNcIds — cancel loop', () => {
  it('every NC of the DC once, header included, id order', () => {
    expect(returnDcNcIds(NC_B, [{ ncId: NC_B }, { ncId: NC_A }, { ncId: NC_A }])).toEqual([
      NC_A,
      NC_B,
    ]);
  });

  it('old single-NC DC with unbackfilled lines → just the header NC', () => {
    expect(returnDcNcIds(NC_A, [{ ncId: null }])).toEqual([NC_A]);
    expect(returnDcNcIds(NC_A, [])).toEqual([NC_A]);
  });

  it('an ordinary OSP DC → no NC to send back', () => {
    expect(returnDcNcIds(null, [{ ncId: null }])).toEqual([]);
  });
});
