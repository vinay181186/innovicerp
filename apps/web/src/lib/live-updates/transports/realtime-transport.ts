// ADR-230 v1 — hear changes through Supabase Realtime.
//
// One channel per tab, one `postgres_changes` binding per live table, each
// filtered to the user's company. Realtime also applies the table's RLS policy
// per subscriber (the browser token carries company_id since ADR-228 / 0207),
// so the filter is a cost saving, not the access check.
//
// PREREQUISITE: the tables must be in the `supabase_realtime` publication —
// migration 0208. A table that is not published is simply silent; the 60 s
// safety refresh still covers its screens.
//
// Reconnects: realtime-js rejoins a channel by itself after CHANNEL_ERROR and
// TIMED_OUT, but NOT after CLOSED (the server closed it, or the bindings were
// refused). So on CLOSED this transport opens a fresh channel itself, with a
// backoff. Every time a channel reports SUBSCRIBED the core re-reads all
// screens on display, because what changed while it was down was not delivered.

import { LIVE_TABLES, type LiveTable } from '@innovic/shared';
import type { RealtimeChannel, RealtimePostgresChangesPayload } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';
import type { LiveSink, LiveTransport } from '../transport';

type Row = Record<string, unknown>;

/** Waits before reopening a CLOSED channel: 1 s, 2 s, 5 s, 10 s, then 30 s. */
export const REOPEN_BACKOFF_MS = [1_000, 2_000, 5_000, 10_000, 30_000] as const;

function reopenDelay(attempt: number): number {
  return REOPEN_BACKOFF_MS[Math.min(attempt, REOPEN_BACKOFF_MS.length - 1)] ?? 30_000;
}

/** The changed row's id. INSERT/UPDATE carry the new row; a DELETE carries
 *  only the old row's primary key. A row we cannot name still refreshes its
 *  table's screens (id null). */
function rowId(payload: RealtimePostgresChangesPayload<Row>): string | null {
  const row: Partial<Row> =
    payload.eventType === 'DELETE' ? payload.old : (payload.new as Partial<Row>);
  return typeof row.id === 'string' ? row.id : null;
}

function openChannel(companyId: string, sink: LiveSink): RealtimeChannel {
  // A unique topic per channel: supabase.channel(topic) returns the SAME
  // channel for a topic that is already open, and adding bindings after
  // subscribe() throws (see use-record-watch.ts).
  const channel = supabase.channel(`live:${companyId}:${crypto.randomUUID()}`);
  for (const table of LIVE_TABLES) {
    channel.on<Row>(
      'postgres_changes',
      { event: '*', schema: 'public', table, filter: `company_id=eq.${companyId}` },
      (payload) => sink.changes([{ table: table satisfies LiveTable, id: rowId(payload) }]),
    );
  }
  return channel;
}

export const realtimeTransport: LiveTransport = {
  name: 'realtime',
  start({ companyId, sink }) {
    let stopped = false;
    let attempt = 0;
    let channel: RealtimeChannel | null = null;
    let reopenTimer: ReturnType<typeof setTimeout> | null = null;

    const open = (): void => {
      reopenTimer = null;
      const current = openChannel(companyId, sink);
      channel = current;
      current.subscribe((status, error) => {
        // Ignore a channel we already replaced or stopped (removeChannel
        // reports CLOSED on its way out).
        if (stopped || channel !== current) return;
        if (status === 'SUBSCRIBED') {
          attempt = 0;
          sink.connected();
          return;
        }
        sink.disconnected(status, error);
        if (status === 'CLOSED') {
          channel = null;
          void supabase.removeChannel(current);
          reopenTimer = setTimeout(open, reopenDelay(attempt++));
        }
      });
    };

    open();

    return () => {
      stopped = true;
      if (reopenTimer !== null) clearTimeout(reopenTimer);
      if (channel !== null) void supabase.removeChannel(channel);
      channel = null;
    };
  },
};
