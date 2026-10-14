import { LIVE_TABLES } from '@innovic/shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { LiveSink } from '../transport';

type Handler = (payload: unknown) => void;
interface Binding {
  filter: { event: string; schema: string; table: string; filter: string };
  handler: Handler;
}

const bindings: Binding[] = [];
let statusCallback: ((status: string, error?: Error) => void) | null = null;
const channelTopics: string[] = [];
const removeChannel = vi.fn();

const fakeChannel = {
  on: (_type: string, filter: Binding['filter'], handler: Handler) => {
    bindings.push({ filter, handler });
    return fakeChannel;
  },
  subscribe: (cb: (status: string, error?: Error) => void) => {
    statusCallback = cb;
    return fakeChannel;
  },
};

vi.mock('@/lib/supabase', () => ({
  supabase: {
    channel: (topic: string) => {
      channelTopics.push(topic);
      return fakeChannel;
    },
    removeChannel: (c: unknown) => removeChannel(c),
  },
}));

const { realtimeTransport } = await import('./realtime-transport');

function fakeSink(): LiveSink & { [K in keyof LiveSink]: ReturnType<typeof vi.fn> } {
  return { changes: vi.fn(), connected: vi.fn(), disconnected: vi.fn() };
}

describe('realtimeTransport', () => {
  beforeEach(() => {
    bindings.length = 0;
    channelTopics.length = 0;
    statusCallback = null;
    removeChannel.mockClear();
  });

  it('binds every live table, filtered to the company', () => {
    realtimeTransport.start({ companyId: 'co-1', sink: fakeSink() });
    expect(bindings.map((b) => b.filter.table)).toEqual([...LIVE_TABLES]);
    for (const b of bindings) {
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
    expect(new Set(channelTopics).size).toBe(2);
  });

  it('turns an UPDATE and a DELETE into the changed row id', () => {
    const sink = fakeSink();
    realtimeTransport.start({ companyId: 'co-1', sink });
    const jcOps = bindings.find((b) => b.filter.table === 'jc_ops');
    jcOps?.handler({ eventType: 'UPDATE', new: { id: 'op-1' }, old: {} });
    jcOps?.handler({ eventType: 'DELETE', new: {}, old: { id: 'op-2' } });
    jcOps?.handler({ eventType: 'UPDATE', new: {}, old: {} });
    expect(sink.changes.mock.calls).toEqual([
      [[{ table: 'jc_ops', id: 'op-1' }]],
      [[{ table: 'jc_ops', id: 'op-2' }]],
      [[{ table: 'jc_ops', id: null }]],
    ]);
  });

  it('reports subscribed as connected and every failure status as disconnected', () => {
    const sink = fakeSink();
    realtimeTransport.start({ companyId: 'co-1', sink });
    statusCallback?.('SUBSCRIBED');
    const err = new Error('socket');
    statusCallback?.('CHANNEL_ERROR', err);
    statusCallback?.('TIMED_OUT');
    statusCallback?.('CLOSED');
    expect(sink.connected).toHaveBeenCalledTimes(1);
    expect(sink.disconnected.mock.calls.map((c) => c[0])).toEqual([
      'CHANNEL_ERROR',
      'TIMED_OUT',
      'CLOSED',
    ]);
    expect(sink.disconnected.mock.calls[0]?.[1]).toBe(err);
  });

  it('stop removes the channel', () => {
    const stop = realtimeTransport.start({ companyId: 'co-1', sink: fakeSink() });
    stop();
    expect(removeChannel).toHaveBeenCalledTimes(1);
  });
});
