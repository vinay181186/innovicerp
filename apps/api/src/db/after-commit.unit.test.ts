// ADR-309 — afterCommit / withAfterCommit, no database needed.
import { describe, expect, it, vi } from 'vitest';
import { afterCommit, withAfterCommit } from './after-commit';

describe('afterCommit', () => {
  it('runs at once outside any transaction scope', () => {
    const fn = vi.fn();
    afterCommit(fn);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('waits until the scope resolves (commit), then runs', async () => {
    const fn = vi.fn();
    const result = await withAfterCommit(async () => {
      afterCommit(fn);
      expect(fn).not.toHaveBeenCalled();
      return 42;
    });
    expect(result).toBe(42);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('drops the queue when the scope throws (rollback)', async () => {
    const fn = vi.fn();
    await expect(
      withAfterCommit(async () => {
        afterCommit(fn);
        throw new Error('rolled back');
      }),
    ).rejects.toThrow('rolled back');
    expect(fn).not.toHaveBeenCalled();
  });

  it('a nested scope (savepoint / inner call) waits for the OUTER commit', async () => {
    const fn = vi.fn();
    await withAfterCommit(async () => {
      await withAfterCommit(async () => {
        afterCommit(fn);
      });
      expect(fn).not.toHaveBeenCalled();
    });
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('a throwing or rejecting callback goes to the sink, never to the caller', async () => {
    const sink = vi.fn();
    await withAfterCommit(async () => {
      afterCommit(() => {
        throw new Error('sync');
      });
      afterCommit(async () => {
        throw new Error('async');
      });
    }, sink);
    expect(sink).toHaveBeenCalledTimes(2);
  });

  it('after the scope closed, a late call runs at once instead of being lost', async () => {
    let late: (() => void) | undefined;
    await withAfterCommit(async () => {
      late = () => afterCommit(fn);
    });
    const fn = vi.fn();
    late?.();
    expect(fn).toHaveBeenCalledTimes(1);
  });
});
