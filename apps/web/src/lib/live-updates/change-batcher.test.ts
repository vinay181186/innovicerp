import type { LiveChange } from '@innovic/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ChangeBatcher } from './change-batcher';

const jc = (id: string): LiveChange => ({ table: 'job_cards', id });

describe('ChangeBatcher', () => {
  let flushed: LiveChange[][];
  let batcher: ChangeBatcher;

  beforeEach(() => {
    vi.useFakeTimers();
    flushed = [];
    batcher = new ChangeBatcher((b) => flushed.push(b), { waitMs: 750, maxWaitMs: 2_000 });
  });
  afterEach(() => {
    batcher.cancel();
    vi.useRealTimers();
  });

  it('collapses a burst into one batch after the quiet wait', () => {
    for (let i = 0; i < 5; i++) batcher.add([jc(`a${i}`)]);
    vi.advanceTimersByTime(749);
    expect(flushed).toHaveLength(0);
    vi.advanceTimersByTime(1);
    expect(flushed).toHaveLength(1);
    expect(flushed[0]).toHaveLength(5);
  });

  it('never holds a steady stream longer than the ceiling', () => {
    // A change every 500 ms keeps resetting the 750 ms wait forever…
    for (let t = 0; t < 1_900; t += 500) {
      batcher.add([jc(`t${t}`)]);
      vi.advanceTimersByTime(500);
    }
    // …but the deadline set by the first change fires at 2 000 ms.
    vi.advanceTimersByTime(100);
    expect(flushed).toHaveLength(1);
  });

  it('starts a fresh deadline after a flush', () => {
    batcher.add([jc('a')]);
    vi.advanceTimersByTime(750);
    batcher.add([jc('b')]);
    vi.advanceTimersByTime(750);
    expect(flushed.map((b) => b.map((c) => c.id))).toEqual([['a'], ['b']]);
  });

  it('ignores an empty add', () => {
    batcher.add([]);
    vi.advanceTimersByTime(5_000);
    expect(flushed).toHaveLength(0);
  });

  it('cancel drops what is waiting', () => {
    batcher.add([jc('a')]);
    batcher.cancel();
    vi.advanceTimersByTime(5_000);
    expect(flushed).toHaveLength(0);
  });
});
