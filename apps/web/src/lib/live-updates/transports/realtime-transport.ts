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
// Reconnects are Realtime's own: the socket reconnects and the channel rejoins.
// Every time it reports SUBSCRIBED again the core re-reads all screens on
// display, because what changed while it was down was not delivered.

import { LIVE_TABLES, type LiveTable } from '@innovic/shared';
import type { RealtimePostgresChangesPayload } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';
import type { LiveTransport } from '../transport';

type Row = Record<string, unknown>;

/** The changed row's id. INSERT/UPDATE carry the new row; a DELETE carries
 *  only the old row's primary key. A row we cannot name still refreshes its
 *  table's screens (id null). */
function rowId(payload: RealtimePostgresChangesPayload<Row>): string | null {
  const row: Partial<Row> =
    payload.eventType === 'DELETE' ? payload.old : (payload.new as Partial<Row>);
  return typeof row.id === 'string' ? row.id : null;
}

export const realtimeTransport: LiveTransport = {
  name: 'realtime',
  start({ companyId, sink }) {
    // A unique topic per start: supabase.channel(topic) returns the SAME channel
    // for a topic that is already open, and adding bindings after subscribe()
    // throws (see use-record-watch.ts).
    const channel = supabase.channel(`live:${companyId}:${crypto.randomUUID()}`);

    for (const table of LIVE_TABLES) {
      channel.on<Row>(
        'postgres_changes',
        { event: '*', schema: 'public', table, filter: `company_id=eq.${companyId}` },
        (payload) => sink.changes([{ table: table satisfies LiveTable, id: rowId(payload) }]),
      );
    }

    channel.subscribe((status, error) => {
      if (status === 'SUBSCRIBED') sink.connected();
      // CHANNEL_ERROR | TIMED_OUT | CLOSED — Realtime keeps retrying itself.
      else sink.disconnected(status, error);
    });

    return () => {
      void supabase.removeChannel(channel);
    };
  },
};
