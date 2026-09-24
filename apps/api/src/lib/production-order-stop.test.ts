// Unit test for the ADR-182 short-close guard. The decision and the wording are
// pure, so they are tested here without a database; the recursive walk itself is
// checked against a stub transaction that records the SQL it was handed (the
// same shape production-order-link.test.ts uses). Runnable on its own with
// `npx vitest run src/lib/production-order-stop.test.ts` — vitest's globalSetup
// is a no-op without DATABASE_URL in the environment.

import type { SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import { describe, expect, it, vi } from 'vitest';
import type { DbTransaction } from '../db/with-user-context';
import { ValidationError } from './errors';
import { PRODUCTION_ORDER_LINK_MAX_DEPTH } from './production-order-link';
import {
  assertProductionOrderNotShortClosed,
  assertProductionOrderNotShortClosedForOp,
  findStoppedProductionOrder,
  productionOrderStopError,
  productionOrderStoppedMessage,
} from './production-order-stop';

const JC_ID = '0f6a1f3e-2f6e-4d25-9c9d-3b7d1c1d1a11';

function stubTx(rows: unknown[]) {
  const execute = vi.fn().mockResolvedValue(rows);
  return { tx: { execute } as unknown as DbTransaction, execute };
}

function renderedSql(execute: ReturnType<typeof vi.fn>) {
  const q = execute.mock.calls[0]?.[0] as SQL;
  return new PgDialect().sqlToQuery(q);
}

describe('productionOrderStoppedMessage (ADR-182 wording)', () => {
  it('names the order, the date and the Job Card', () => {
    expect(
      productionOrderStoppedMessage({
        code: 'IN-PRO-00007',
        shortClosedOn: '2026-09-24',
        jcCode: 'IN-JC-26-00055',
      }),
    ).toBe(
      'Production Order IN-PRO-00007 was short closed on 2026-09-24 — ' +
        'no further work is allowed on Job Card IN-JC-26-00055.',
    );
  });

  it('never prints the word "null" when the date is missing', () => {
    const m = productionOrderStoppedMessage({
      code: 'IN-PRO-00007',
      shortClosedOn: null,
      jcCode: 'IN-JC-26-00055',
    });
    expect(m).toBe(
      'Production Order IN-PRO-00007 was short closed — ' +
        'no further work is allowed on Job Card IN-JC-26-00055.',
    );
    expect(m).not.toContain('null');
  });
});

describe('productionOrderStopError (the decision)', () => {
  it('lets work through when no order up the chain is short closed', () => {
    expect(productionOrderStopError(null)).toBeNull();
  });

  it('refuses, in the same words, when one is', () => {
    expect(
      productionOrderStopError({
        code: 'IN-PRO-00007',
        shortClosedOn: '2026-09-24',
        jcCode: 'IN-JC-26-00055',
      }),
    ).toContain('no further work is allowed on Job Card IN-JC-26-00055.');
  });
});

describe('findStoppedProductionOrder (the walk)', () => {
  it('returns the stopped order when the chain yields one', async () => {
    const { tx } = stubTx([
      { po_code: 'IN-PRO-00007', short_closed_on: '2026-09-24', jc_code: 'IN-JC-26-00055' },
    ]);
    await expect(findStoppedProductionOrder(tx, JC_ID)).resolves.toEqual({
      code: 'IN-PRO-00007',
      shortClosedOn: '2026-09-24',
      jcCode: 'IN-JC-26-00055',
    });
  });

  it('is null (never throws) for a Job Card with no stopped order', async () => {
    const { tx } = stubTx([]);
    await expect(findStoppedProductionOrder(tx, JC_ID)).resolves.toBeNull();
  });

  it('walks parent_job_card_id, skips deleted rows, caps the depth, wants only short_closed', async () => {
    const { tx, execute } = stubTx([]);
    await findStoppedProductionOrder(tx, JC_ID);
    const { sql, params } = renderedSql(execute);
    expect(sql).toMatch(/WITH RECURSIVE chain AS/);
    expect(sql).toMatch(/JOIN public\.job_cards p ON p\.id = c\.parent_job_card_id/);
    expect(sql).toMatch(/po\.status = 'short_closed'/);
    expect(sql).toMatch(/po\.deleted_at IS NULL/);
    // The JC id (seed row), the depth cap, then the JC id again for the code.
    expect(params).toEqual([JC_ID, PRODUCTION_ORDER_LINK_MAX_DEPTH, JC_ID]);
  });
});

describe('assertProductionOrderNotShortClosed', () => {
  it('does nothing when the card is free to work on', async () => {
    const { tx } = stubTx([]);
    await expect(assertProductionOrderNotShortClosed(tx, JC_ID)).resolves.toBeUndefined();
  });

  it('throws a ValidationError naming the order when it is stopped', async () => {
    const { tx } = stubTx([
      { po_code: 'IN-PRO-00007', short_closed_on: '2026-09-24', jc_code: 'IN-JC-26-00055' },
    ]);
    await expect(assertProductionOrderNotShortClosed(tx, JC_ID)).rejects.toBeInstanceOf(
      ValidationError,
    );
    await expect(assertProductionOrderNotShortClosed(tx, JC_ID)).rejects.toThrow(
      /IN-PRO-00007 was short closed on 2026-09-24/,
    );
  });
});

// The jc_op-keyed variant — used by op-entry's `generateOspPr`, which has only
// the op id in hand when it raises a vendor PR/PO.
describe('assertProductionOrderNotShortClosedForOp', () => {
  function stubOpTx(opRows: unknown[], chainRows: unknown[]) {
    const execute = vi.fn().mockResolvedValueOnce(opRows).mockResolvedValueOnce(chainRows);
    return { tx: { execute } as unknown as DbTransaction, execute };
  }
  const OP_ID = '2c2b5d41-6d0f-4b1a-9f3e-7a1c5f2b0c99';

  it('resolves the op to its card, then lets live work through', async () => {
    const { tx, execute } = stubOpTx([{ job_card_id: JC_ID }], []);
    await expect(assertProductionOrderNotShortClosedForOp(tx, OP_ID)).resolves.toBeUndefined();
    expect(execute).toHaveBeenCalledTimes(2);
    expect(renderedSql(execute).sql).toMatch(/FROM public\.jc_ops o/);
  });

  it("refuses when the op's card belongs to a short-closed order", async () => {
    const { tx } = stubOpTx(
      [{ job_card_id: JC_ID }],
      [{ po_code: 'IN-PRO-00007', short_closed_on: '2026-09-24', jc_code: 'IN-JC-26-00055' }],
    );
    await expect(assertProductionOrderNotShortClosedForOp(tx, OP_ID)).rejects.toThrow(
      /IN-PRO-00007 was short closed on 2026-09-24/,
    );
  });

  it('does not walk anything for a missing / deleted op', async () => {
    const { tx, execute } = stubOpTx([], []);
    await expect(assertProductionOrderNotShortClosedForOp(tx, OP_ID)).resolves.toBeUndefined();
    expect(execute).toHaveBeenCalledTimes(1);
  });
});
