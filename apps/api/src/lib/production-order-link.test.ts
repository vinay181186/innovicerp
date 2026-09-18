// Unit test for the ADR-170 stock OFF switch. No database: the transaction is
// a stub whose `execute` records the SQL it was handed and returns a canned
// row, so this checks (a) how the answer is read back and (b) that the query
// really is the recursive parent walk the ADR asks for. Runnable on its own
// with `npx vitest run src/lib/production-order-link.test.ts` — vitest's
// globalSetup is a no-op without DATABASE_URL in the environment.

import type { SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import { describe, expect, it, vi } from 'vitest';
import type { DbTransaction } from '../db/with-user-context';
import {
  PRODUCTION_ORDER_LINK_MAX_DEPTH,
  isProductionOrderLinkedJc,
} from './production-order-link';

const JC_ID = '0f6a1f3e-2f6e-4d25-9c9d-3b7d1c1d1a11';

function stubTx(rows: unknown[]) {
  const execute = vi.fn().mockResolvedValue(rows);
  return { tx: { execute } as unknown as DbTransaction, execute };
}

function renderedSql(execute: ReturnType<typeof vi.fn>) {
  const q = execute.mock.calls[0]?.[0] as SQL;
  return new PgDialect().sqlToQuery(q);
}

describe('isProductionOrderLinkedJc (ADR-170 stock OFF switch)', () => {
  it('is true when the JC or an ancestor carries production_order_id', async () => {
    const { tx } = stubTx([{ linked: true }]);
    await expect(isProductionOrderLinkedJc(tx, JC_ID)).resolves.toBe(true);
  });

  it('is false for an old JC with no Production Order anywhere up the chain', async () => {
    const { tx } = stubTx([{ linked: false }]);
    await expect(isProductionOrderLinkedJc(tx, JC_ID)).resolves.toBe(false);
  });

  it('is false (never throws) when the JC is missing or deleted — no row back', async () => {
    const { tx } = stubTx([]);
    await expect(isProductionOrderLinkedJc(tx, JC_ID)).resolves.toBe(false);
  });

  it('walks parent_job_card_id recursively, skips deleted rows, caps the depth', async () => {
    const { tx, execute } = stubTx([{ linked: false }]);
    await isProductionOrderLinkedJc(tx, JC_ID);
    expect(execute).toHaveBeenCalledTimes(1);
    const { sql, params } = renderedSql(execute);
    expect(sql).toMatch(/WITH RECURSIVE chain AS/);
    expect(sql).toMatch(/JOIN public\.job_cards p ON p\.id = c\.parent_job_card_id/);
    expect(sql).toMatch(/production_order_id IS NOT NULL/);
    // Both the seed row and every hop ignore soft-deleted job cards.
    expect(sql.match(/deleted_at IS NULL/g)).toHaveLength(2);
    // The JC id and the depth cap are bound parameters, in that order.
    expect(params).toEqual([JC_ID, PRODUCTION_ORDER_LINK_MAX_DEPTH]);
    expect(PRODUCTION_ORDER_LINK_MAX_DEPTH).toBe(10);
  });
});
