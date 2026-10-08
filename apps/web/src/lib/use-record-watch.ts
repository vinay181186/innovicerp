// ADR-226 — tell the user THE MOMENT someone else saves the record their edit
// screen has open, instead of letting them find out after pressing Save.
//
// One subscription, filtered to one row by id, alive only while an edit form is
// mounted. It does NOT touch the form: it reports, and the screen shows a
// 3-second notice. Nothing the user has typed is re-seeded or cleared — that
// was the Plan-edit bug (ADR-226, plans/routes/edit.tsx) and it is the whole
// reason this hook hands back a flag rather than invalidating the query.
//
// ADR-004 AMENDMENT, recorded in docs/DECISIONS.md: the original rule allowed
// Realtime only on Op Entry, the Live Operations Board, Machine Status and Task
// Allocation, on the arithmetic "100 users x 5 tabs = 500 connections". That
// arithmetic was about Realtime on EVERY screen. A subscription here exists
// only while one of a dozen EDIT forms is open and is filtered to a single row,
// so in a factory with ~23 logins it is a handful of sockets at a time. The
// owner took that decision on 2026-10-08 after being shown both costs.
//
// PREREQUISITE, and it was not true until migration 0202: the table must be in
// the `supabase_realtime` publication. That publication was EMPTY — so Op
// Entry's own two subscriptions had never delivered an event either, and its
// "30s polling fallback alongside Realtime" was doing all the work. If a table
// is somehow not published, this hook is simply silent: the screen loses its
// early warning and keeps every bit of its protection, because the real guard
// is the version check on save (lib/save-with-merge.ts), not this.
//
// RLS applies to the row stream at the WebSocket layer, so a subscriber is only
// ever sent rows their own login may read. This grants no new access — it only
// lets a change the user could already have polled for arrive sooner.

import { useCallback, useEffect, useId, useState } from 'react';
import { supabase } from './supabase';

/** A per-component-instance suffix for a Realtime channel topic.
 *
 *  `supabase.channel(topic)` returns the SAME channel object for a topic that is
 *  already open, and adding another `postgres_changes` callback to it after
 *  `.subscribe()` throws `cannot add postgres_changes callbacks for
 *  realtime:<topic> after subscribe()` — which took out a whole page when Op
 *  Entry's "By Machine" view was folded into the Op Entry page and both called
 *  the same hook. `useId` gives every caller its own topic. React 18 wraps
 *  useId output in colons, which read oddly inside a colon-delimited topic, so
 *  they are stripped. Copied deliberately from modules/op-entry/api.ts rather
 *  than rediscovered. */
function useChannelTopicId(): string {
  return useId().replaceAll(':', '');
}

export interface RecordWatch {
  /** True once someone else has saved this record since the screen opened.
   *  Latches — it does not clear itself, because the screen's own save is what
   *  resolves it. */
  changedByOther: boolean;
  /** Forget the flag — call it after the screen's own save has merged and the
   *  notice has been shown, so a later change can raise it again. */
  acknowledge: () => void;
}

export interface UseRecordWatchOptions {
  /** The Postgres table, e.g. `goods_receipt_notes`. Must be in the
   *  `supabase_realtime` publication (migration 0202). */
  table: string;
  /** The row's id. Undefined while the record is still loading — the
   *  subscription waits. */
  id: string | undefined;
  /** Our own save sets this so the hook ignores the event it causes. Pass the
   *  version the screen currently holds; see the note in the body. */
  enabled?: boolean;
}

/**
 * Watch one record for a change made by anybody else.
 *
 * Deliberately ignores WHAT changed. The screen already knows how to work that
 * out properly on save (`changedKeys(loaded, fresh)` — the same rule the server
 * uses), and a column list off a Realtime payload would be a second, divergent
 * answer to the same question. This is a doorbell, not a diff.
 */
export function useRecordWatch({ table, id, enabled = true }: UseRecordWatchOptions): RecordWatch {
  const [changedByOther, setChangedByOther] = useState(false);
  const topicId = useChannelTopicId();
  // Our OWN save fires this subscription too. The screen calls `acknowledge()`
  // right after its save, which clears the flag — so a self-inflicted event
  // shows no notice.
  //
  // ADR-226 review — the reason this comment used to give for not filtering it
  // properly was WRONG. It said reading `updated_by` off the payload "arrives
  // only when REPLICA IDENTITY FULL is set". The NEW row is always in the WAL;
  // it is the OLD row that needs FULL. So `payload.new.updated_by !== me` IS
  // available and would be the honest filter. Not built here, deliberately:
  // this hook is inert until the browser's token carries a company claim (see
  // the header), and writing a better filter for a stream that delivers nothing
  // is work with no way to test it. When the token is fixed, filter on
  // `payload.new` and the acknowledge-after-save dance can go.
  //
  // One consequence while it stays: `acknowledge()` runs when the save
  // RESOLVES, but the event our own save caused arrives later (commit -> WAL ->
  // socket is slower than the HTTP response). A screen still mounted could
  // therefore tell the user somebody else changed the record right after their
  // own successful save. Every screen using this navigates away on success, so
  // it is unreachable today — and masked anyway while the stream is silent.

  useEffect(() => {
    if (!enabled || !id) return;
    const channel = supabase
      .channel(`record-watch:${table}:${id}:${topicId}`)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table, filter: `id=eq.${id}` },
        () => {
          setChangedByOther(true);
        },
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [table, id, enabled, topicId]);

  const acknowledge = useCallback(() => {
    setChangedByOther(false);
  }, []);

  return { changedByOther, acknowledge };
}
