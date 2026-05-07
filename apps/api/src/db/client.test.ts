import { describe, expect, it } from 'vitest';
import { pingDatabase } from './client';

describe('pingDatabase', () => {
  it('returns { ok: true } against the live dev DB', async () => {
    const result = await pingDatabase();
    expect(result).toEqual({ ok: true });
  });

  it('returns { ok: false, error } when the timeout is impossibly short', async () => {
    // 0ms timeout fires before any postgres-js round-trip can complete, so the
    // race resolves on the timeout side — exercises the error-wrapping branch.
    const result = await pingDatabase(0);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/timeout/);
  });
});
