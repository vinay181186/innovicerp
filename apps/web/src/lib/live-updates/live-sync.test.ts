import { QueryClient } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, type MockInstance, vi } from 'vitest';
import { LIVE_BATCH_MAX_WAIT_MS, LIVE_BATCH_WAIT_MS, LIVE_CONNECT_TIMEOUT_MS } from './constants';
import { LiveSync } from './live-sync';
import type { LiveSink, LiveTransport } from './transport';

vi.mock('@/lib/sentry', () => ({ captureWarning: vi.fn() }));
// The real screen map is under test, but it imports module api files, which
// import the API client and validate env at load. Neither is used here.
vi.mock('@/lib/api', () => ({ apiFetch: vi.fn() }));
vi.mock('@/lib/supabase', () => ({ supabase: {} }));

/** A transport the test drives by hand. */
function fakeTransport(): {
  transport: LiveTransport;
  sink: () => LiveSink;
  stop: ReturnType<typeof vi.fn>;
} {
  let captured: LiveSink | null = null;
  const stop = vi.fn();
  return {
    transport: {
      name: 'fake',
      start: ({ sink }) => {
        captured = sink;
        return stop;
      },
    },
    sink: () => {
      if (!captured) throw new Error('transport not started');
      return captured;
    },
    stop,
  };
}

describe('LiveSync', () => {
  let qc: QueryClient;
  let invalidate: MockInstance<QueryClient['invalidateQueries']>;
  let sync: LiveSync;
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

  beforeEach(() => {
    vi.useFakeTimers();
    qc = new QueryClient();
    invalidate = vi.spyOn(qc, 'invalidateQueries').mockResolvedValue();
    sync = new LiveSync(qc);
    warn.mockClear();
  });
  afterEach(() => vi.useRealTimers());

  const invalidatedRoots = (): string[] =>
    invalidate.mock.calls.map((c) => {
      const filters = c[0] as { queryKey?: readonly unknown[] } | undefined;
      return filters?.queryKey ? String(filters.queryKey[0]) : '*';
    });

  it('re-reads every screen on the first connect, and only on a transition', () => {
    const t = fakeTransport();
    sync.start(t.transport, 'co-1');
    expect(sync.getStatus()).toBe('connecting');
    t.sink().connected();
    t.sink().connected();
    expect(sync.getStatus()).toBe('live');
    expect(invalidatedRoots()).toEqual(['*']);
  });

  it('never shows live when the token cannot hear the company', () => {
    const t = fakeTransport();
    sync.start(t.transport, 'co-1');
    t.sink().connected();
    expect(sync.getStatus()).toBe('live');
    sync.reportTokenProblem('token_no_company');
    expect(sync.getStatus()).toBe('paused');
    expect(warn).toHaveBeenCalledTimes(1);
    t.sink().disconnected('CHANNEL_ERROR');
    t.sink().connected();
    expect(sync.getStatus()).toBe('paused');
  });

  it('logs a token problem even while already paused', () => {
    const t = fakeTransport();
    sync.start(t.transport, 'co-1');
    t.sink().disconnected('CHANNEL_ERROR');
    warn.mockClear();
    sync.reportTokenProblem('token_other_company');
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('goes live and re-reads when a refreshed token names the company again', () => {
    const t = fakeTransport();
    sync.start(t.transport, 'co-1');
    t.sink().connected();
    sync.reportTokenProblem('token_no_company');
    invalidate.mockClear();
    sync.clearTokenProblem();
    expect(sync.getStatus()).toBe('live');
    expect(invalidatedRoots()).toEqual(['*']);
  });

  it('stays paused after the token is fixed while the channel is down', () => {
    const t = fakeTransport();
    sync.start(t.transport, 'co-1');
    sync.reportTokenProblem('token_no_company');
    sync.clearTokenProblem();
    expect(sync.getStatus()).toBe('paused');
    t.sink().connected();
    expect(sync.getStatus()).toBe('live');
  });

  it('refreshes the mapped screens once per burst', () => {
    const t = fakeTransport();
    sync.start(t.transport, 'co-1');
    t.sink().connected();
    invalidate.mockClear();

    // A QC clear writes jc_ops AND op_log — five events in one burst.
    for (let i = 0; i < 5; i++) {
      t.sink().changes([
        { table: 'jc_ops', id: `op-${i}` },
        { table: 'op_log', id: `log-${i}` },
      ]);
    }
    expect(invalidate).not.toHaveBeenCalled();
    vi.advanceTimersByTime(LIVE_BATCH_WAIT_MS);

    const roots = invalidatedRoots();
    expect(roots).toContain('qc-history');
    expect(roots).toContain('qc-command');
    expect(roots).toContain('job-cards');
    expect(roots).toContain('op-entry');
    // Each screen once, however many events.
    expect(new Set(roots).size).toBe(roots.length);
  });

  it('flushes a never-ending stream by the ceiling', () => {
    const t = fakeTransport();
    sync.start(t.transport, 'co-1');
    t.sink().connected();
    invalidate.mockClear();
    for (let ms = 0; ms < LIVE_BATCH_MAX_WAIT_MS; ms += 400) {
      t.sink().changes([{ table: 'job_cards', id: 'x' }]);
      vi.advanceTimersByTime(400);
    }
    expect(invalidate).toHaveBeenCalled();
  });

  it('a drop pauses, warns once, and the reconnect re-reads everything', () => {
    const t = fakeTransport();
    sync.start(t.transport, 'co-1');
    t.sink().connected();
    invalidate.mockClear();

    t.sink().disconnected('CHANNEL_ERROR', new Error('socket closed'));
    t.sink().disconnected('TIMED_OUT');
    expect(sync.getStatus()).toBe('paused');
    expect(warn).toHaveBeenCalledTimes(1);

    t.sink().connected();
    expect(sync.getStatus()).toBe('live');
    expect(invalidatedRoots()).toEqual(['*']);
  });

  it('a resync re-reads everything but rings no record watcher', () => {
    const t = fakeTransport();
    sync.start(t.transport, 'co-1');
    t.sink().connected();
    invalidate.mockClear();
    const watcher = vi.fn();
    sync.watchRecord('sales_orders', 'so-1', watcher);
    t.sink().resync();
    vi.advanceTimersByTime(LIVE_BATCH_MAX_WAIT_MS);
    expect(invalidatedRoots()).toEqual(['*']);
    expect(watcher).not.toHaveBeenCalled();
  });

  it('a connection that never answers is reported as paused', () => {
    const t = fakeTransport();
    sync.start(t.transport, 'co-1');
    vi.advanceTimersByTime(LIVE_CONNECT_TIMEOUT_MS);
    expect(sync.getStatus()).toBe('paused');
    expect(warn).toHaveBeenCalledWith(
      '[live-updates] paused',
      expect.objectContaining({ reason: 'connect_timeout' }),
    );
  });

  it('a transport that throws on start is reported, not swallowed', () => {
    sync.start(
      {
        name: 'broken',
        start: () => {
          throw new Error('boom');
        },
      },
      'co-1',
    );
    expect(sync.getStatus()).toBe('paused');
    expect(warn).toHaveBeenCalledWith(
      '[live-updates] paused',
      expect.objectContaining({ reason: 'start_failed', error: 'boom' }),
    );
  });

  it('stop releases the transport and ignores late callbacks', () => {
    const t = fakeTransport();
    const stop = sync.start(t.transport, 'co-1');
    t.sink().connected();
    invalidate.mockClear();
    t.sink().changes([{ table: 'job_cards', id: 'x' }]);
    stop();
    expect(t.stop).toHaveBeenCalledTimes(1);
    expect(sync.getStatus()).toBe('off');

    t.sink().changes([{ table: 'job_cards', id: 'y' }]);
    t.sink().connected();
    vi.advanceTimersByTime(LIVE_BATCH_MAX_WAIT_MS);
    expect(invalidate).not.toHaveBeenCalled();
  });

  it('tells a record watcher about its own record only', () => {
    const t = fakeTransport();
    sync.start(t.transport, 'co-1');
    t.sink().connected();
    const mine = vi.fn();
    const other = vi.fn();
    sync.watchRecord('sales_orders', 'so-1', mine);
    sync.watchRecord('sales_orders', 'so-2', other);

    t.sink().changes([{ table: 'sales_orders', id: 'so-1' }]);
    vi.advanceTimersByTime(LIVE_BATCH_WAIT_MS);
    expect(mine).toHaveBeenCalledTimes(1);
    expect(other).not.toHaveBeenCalled();
  });

  it('a change that cannot name its row reaches every watcher of that table', () => {
    const t = fakeTransport();
    sync.start(t.transport, 'co-1');
    t.sink().connected();
    const so = vi.fn();
    const po = vi.fn();
    sync.watchRecord('sales_orders', 'so-1', so);
    sync.watchRecord('purchase_orders', 'po-1', po);

    t.sink().changes([{ table: 'sales_orders', id: null }]);
    vi.advanceTimersByTime(LIVE_BATCH_WAIT_MS);
    expect(so).toHaveBeenCalledTimes(1);
    expect(po).not.toHaveBeenCalled();
  });

  it('an unwatched record is forgotten', () => {
    const t = fakeTransport();
    sync.start(t.transport, 'co-1');
    t.sink().connected();
    const listener = vi.fn();
    const unwatch = sync.watchRecord('job_cards', 'jc-1', listener);
    unwatch();
    t.sink().changes([{ table: 'job_cards', id: 'jc-1' }]);
    vi.advanceTimersByTime(LIVE_BATCH_WAIT_MS);
    expect(listener).not.toHaveBeenCalled();
  });
});
