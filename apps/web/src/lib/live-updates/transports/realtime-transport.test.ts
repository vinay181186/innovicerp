import { LIVE_TABLES } from '@innovic/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LiveSink } from '../transport';

type Handler = (payload: unknown) => void;
type StatusCallback = (status: string, error?: Error) => void;
interface Binding {
  filter: { event: string; schema: string; table: string; filter: string };
  handler: Handler;
}
interface FakeChannel {
  topic: string;
  bindings: Binding[];
  status: StatusCallback | null;
  on: (type: string, filter: Binding['filter'], handler: Handler) => FakeChannel;
  subscribe: (cb: StatusCallback) => FakeChannel;
}

const channels: FakeChannel[] = [];
const removeChannel = vi.fn();

function makeChannel(topic: string): FakeChannel {
  const ch: FakeChannel = {
    topic,
    bindings: [],
    status: null,
    on: (_type, filter, handler) => {
      ch.bindings.push({ filter, handler });
      return ch;
    },
    subscribe: (cb) => {
      ch.status = cb;
      return ch;
    },
  };
  channels.push(ch);
  return ch;
}

vi.mock('@/lib/supabase', () => ({
  supabase: {
    channel: (topic: string) => makeChannel(topic),
    removeChannel: (c: unknown) => removeChannel(c),
  },
}));

const { realtimeTransport, REOPEN_BACKOFF_MS } = await import('./realtime-transport');

function fakeSink(): LiveSink & { [K in keyof LiveSink]: ReturnType<typeof vi.fn> } {
  return { changes: vi.fn(), connected: vi.fn(), resync: vi.fn(), disconnected: vi.fn() };
}

const last = (): FakeChannel => {
  const ch = channels[channels.length - 1];
  if (!ch) throw new Error('no channel opened');
  return ch;
};

describe('realtimeTransport', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    channels.length = 0;
    removeChannel.mockClear();
  });
  afterEach(() => vi.useRealTimers());

  it('binds every live table, filtered to the company', () => {
    realtimeTransport.start({ companyId: 'co-1', sink: fakeSink() });
    expect(last().bindings.map((b) => b.filter.table)).toEqual([...LIVE_TABLES]);
    for (const b of last().bindings) {
      expect(b.filter).toMatchObject({
        event: '*',
        schema: 'public',
        filter: 'company_id=eq.co-1',
      });
    }
  });

  it('uses a fresh topic on every start', () => {
    realtimeTransport.start({ companyId: 'co-1', sink: fakeSink() });
    realtimeTransport.start({ companyId: 'co-1', sink: fakeSink() });
    expect(new Set(channels.map((c) => c.topic)).size).toBe(2);
  });

  it('turns an UPDATE and a DELETE into the changed row id', () => {
    const sink = fakeSink();
    realtimeTransport.start({ companyId: 'co-1', sink });
    const jcOps = last().bindings.find((b) => b.filter.table === 'jc_ops');
    jcOps?.handler({ eventType: 'UPDATE', new: { id: 'op-1' }, old: {} });
    jcOps?.handler({ eventType: 'DELETE', new: {}, old: { id: 'op-2' } });
    jcOps?.handler({ eventType: 'UPDATE', new: {}, old: {} });
    expect(sink.changes.mock.calls).toEqual([
      [[{ table: 'jc_ops', id: 'op-1' }]],
      [[{ table: 'jc_ops', id: 'op-2' }]],
      [[{ table: 'jc_ops', id: null }]],
    ]);
  });

  it('reports subscribed as connected and failures as disconnected', () => {
    const sink = fakeSink();
    realtimeTransport.start({ companyId: 'co-1', sink });
    const err = new Error('socket');
    last().status?.('SUBSCRIBED');
    last().status?.('CHANNEL_ERROR', err);
    last().status?.('TIMED_OUT');
    expect(sink.connected).toHaveBeenCalledTimes(1);
    expect(sink.disconnected.mock.calls).toEqual([
      ['CHANNEL_ERROR', err],
      ['TIMED_OUT', undefined],
    ]);
    // Realtime rejoins those by itself — no new channel.
    expect(channels).toHaveLength(1);
  });

  it('reopens a CLOSED channel itself, with a backoff', () => {
    const sink = fakeSink();
    realtimeTransport.start({ companyId: 'co-1', sink });
    const first = last();
    first.status?.('CLOSED');
    expect(sink.disconnected).toHaveBeenCalledWith('CLOSED', undefined);
    expect(removeChannel).toHaveBeenCalledWith(first);

    vi.advanceTimersByTime((REOPEN_BACKOFF_MS[0] ?? 0) - 1);
    expect(channels).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(channels).toHaveLength(2);

    // A late callback from the replaced channel is ignored.
    first.status?.('SUBSCRIBED');
    expect(sink.connected).not.toHaveBeenCalled();
    last().status?.('SUBSCRIBED');
    expect(sink.connected).toHaveBeenCalledTimes(1);
  });

  it('backs off further on repeated closes and resets after success', () => {
    realtimeTransport.start({ companyId: 'co-1', sink: fakeSink() });
    last().status?.('CLOSED');
    vi.advanceTimersByTime(REOPEN_BACKOFF_MS[0] ?? 0);
    last().status?.('CLOSED');
    vi.advanceTimersByTime((REOPEN_BACKOFF_MS[1] ?? 0) - 1);
    expect(channels).toHaveLength(2);
    vi.advanceTimersByTime(1);
    expect(channels).toHaveLength(3);
    last().status?.('SUBSCRIBED');
    last().status?.('CLOSED');
    vi.advanceTimersByTime(REOPEN_BACKOFF_MS[0] ?? 0);
    expect(channels).toHaveLength(4);
  });

  it('stop removes the channel and cancels a pending reopen', () => {
    const sink = fakeSink();
    const stop = realtimeTransport.start({ companyId: 'co-1', sink });
    last().status?.('CLOSED');
    stop();
    vi.advanceTimersByTime(60_000);
    expect(channels).toHaveLength(1);

    const stop2 = realtimeTransport.start({ companyId: 'co-1', sink });
    const ch = last();
    stop2();
    expect(removeChannel).toHaveBeenLastCalledWith(ch);
    ch.status?.('CLOSED'); // removeChannel's own CLOSED on the way out
    expect(sink.disconnected).toHaveBeenCalledTimes(1); // only the first CLOSED above
  });
});
