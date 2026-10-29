// ADR-230 — the transport-independent core of live updates.
//
//   transport ──changes──▶ ChangeBatcher ──batch──▶ refresh mapped screens
//                                                 └▶ notify record watchers
//   transport ──connected──▶ re-read every screen on display (close the gap)
//   transport ──disconnected──▶ status "paused" + warn + Sentry
//
// Why "connected" ALWAYS re-reads, the first time included: a screen that
// loaded its data before the subscription was up can have missed a change in
// between. One extra refresh per connect is the price of never being able to
// say "the screen was stale and nothing knew".
//
// Messages are never used as data. A change only marks screens stale and the
// screens re-read through the API, with the API's own access checks.

import type { LiveChange, LiveTable } from '@innovic/shared';
import type { QueryClient, QueryKey } from '@tanstack/react-query';
import { captureWarning } from '@/lib/sentry';
import { ChangeBatcher } from './change-batcher';
import { LIVE_BATCH_MAX_WAIT_MS, LIVE_BATCH_WAIT_MS, LIVE_CONNECT_TIMEOUT_MS } from './constants';
import { LIVE_TABLE_KEYS } from './table-keys';
import type { LiveSink, LiveTransport } from './transport';

/** off = no transport configured · connecting = started, not yet heard ·
 *  live = hearing changes · paused = cannot hear, retrying. */
export type LiveStatus = 'off' | 'connecting' | 'live' | 'paused';

type RecordListener = () => void;

function recordKey(table: LiveTable, id: string): string {
  return `${table}:${id}`;
}

export class LiveSync {
  private status: LiveStatus = 'off';
  private readonly statusListeners = new Set<() => void>();
  private readonly recordListeners = new Map<string, Set<RecordListener>>();
  private readonly batcher: ChangeBatcher;
  /** Set when the login token cannot hear this company (token-check.ts):
   *  the channel may still say "connected", but nothing will arrive. */
  private tokenProblem: string | null = null;
  /** The transport's own last word: connected (true) or not (false). */
  private transportUp = false;

  constructor(private readonly queryClient: QueryClient) {
    this.batcher = new ChangeBatcher((batch) => this.apply(batch), {
      waitMs: LIVE_BATCH_WAIT_MS,
      maxWaitMs: LIVE_BATCH_MAX_WAIT_MS,
    });
  }

  // ─── Lifecycle ───────────────────────────────────────────────────────────

  /** Start a transport for one company. Returns the stop function. */
  start(transport: LiveTransport, companyId: string): () => void {
    this.tokenProblem = null;
    this.transportUp = false;
    this.setStatus('connecting');
    const connectTimer = setTimeout(() => {
      if (this.status === 'connecting') {
        this.markDown(transport.name, 'connect_timeout');
      }
    }, LIVE_CONNECT_TIMEOUT_MS);

    // A transport may still call back after it was told to stop (a socket event
    // already in flight). Nothing it says after stop may touch the screens.
    let stopped = false;
    const sink: LiveSink = {
      changes: (changes) => {
        if (!stopped) this.batcher.add(changes);
      },
      connected: () => {
        if (stopped) return;
        clearTimeout(connectTimer);
        this.transportUp = true;
        // A token that cannot hear the company never counts as live.
        if (this.tokenProblem !== null) return;
        // Only a transition re-reads; a transport repeating "connected" is a no-op.
        if (this.status === 'live') return;
        this.setStatus('live');
        this.refreshEverythingOnScreen();
      },
      resync: () => {
        if (!stopped) this.refreshEverythingOnScreen();
      },
      disconnected: (reason, error) => {
        if (stopped) return;
        clearTimeout(connectTimer);
        this.transportUp = false;
        this.markDown(transport.name, reason, error);
      },
    };

    let stopTransport: (() => void) | null = null;
    try {
      stopTransport = transport.start({ companyId, sink });
    } catch (error) {
      this.markDown(transport.name, 'start_failed', error);
    }

    return () => {
      stopped = true;
      clearTimeout(connectTimer);
      this.batcher.cancel();
      stopTransport?.();
      this.setStatus('off');
    };
  }

  /** The token check found the login cannot hear its company: show the
   *  marker even though the channel says it is connected. Always logged, also
   *  when the marker is already up for another reason. */
  reportTokenProblem(reason: string): void {
    if (this.tokenProblem === reason) return;
    this.tokenProblem = reason;
    const detail = { transport: 'token', reason };
    console.warn('[live-updates] paused', detail);
    captureWarning('live-updates paused', detail);
    this.setStatus('paused');
  }

  /** A refreshed token names the company again. If the channel is up, the
   *  screens become live — and re-read, since changes were missed meanwhile. */
  clearTokenProblem(): void {
    if (this.tokenProblem === null) return;
    this.tokenProblem = null;
    if (!this.transportUp) return;
    this.setStatus('live');
    this.refreshEverythingOnScreen();
  }

  // ─── Status (read by the top-bar marker via useSyncExternalStore) ────────

  getStatus = (): LiveStatus => this.status;

  subscribeStatus = (listener: () => void): (() => void) => {
    this.statusListeners.add(listener);
    return () => this.statusListeners.delete(listener);
  };

  // ─── Record watchers (an edit screen asking "did someone else save this?") ─

  watchRecord(table: LiveTable, id: string, listener: RecordListener): () => void {
    const key = recordKey(table, id);
    const set = this.recordListeners.get(key) ?? new Set<RecordListener>();
    set.add(listener);
    this.recordListeners.set(key, set);
    return () => {
      set.delete(listener);
      if (set.size === 0) this.recordListeners.delete(key);
    };
  }

  // ─── Internals ───────────────────────────────────────────────────────────

  private apply(batch: readonly LiveChange[]): void {
    const keys = new Map<string, QueryKey>();
    const tables = new Set<LiveTable>();
    for (const change of batch) {
      tables.add(change.table);
      for (const key of LIVE_TABLE_KEYS[change.table]) keys.set(JSON.stringify(key), key);
    }
    for (const key of keys.values()) {
      void this.queryClient.invalidateQueries({ queryKey: key });
    }
    this.notifyRecords(batch, tables);
  }

  private notifyRecords(batch: readonly LiveChange[], tables: ReadonlySet<LiveTable>): void {
    if (this.recordListeners.size === 0) return;
    const fired = new Set<string>();
    const fire = (key: string): void => {
      if (fired.has(key)) return;
      fired.add(key);
      for (const listener of this.recordListeners.get(key) ?? []) listener();
    };
    for (const change of batch) {
      if (change.id !== null) fire(recordKey(change.table, change.id));
    }
    // A change that could not name its row may be any row of its table.
    for (const table of tables) {
      if (!batch.some((c) => c.table === table && c.id === null)) continue;
      for (const key of this.recordListeners.keys()) {
        if (key.startsWith(`${table}:`)) fire(key);
      }
    }
  }

  private refreshEverythingOnScreen(): void {
    void this.queryClient.invalidateQueries();
  }

  private markDown(transportName: string, reason: string, error?: unknown): void {
    if (this.status === 'paused') return; // report a drop once, not every retry
    this.setStatus('paused');
    const detail = {
      transport: transportName,
      reason,
      error: error instanceof Error ? error.message : error,
    };
    console.warn('[live-updates] paused', detail);
    captureWarning('live-updates paused', detail);
  }

  private setStatus(next: LiveStatus): void {
    if (this.status === next) return;
    this.status = next;
    for (const listener of this.statusListeners) listener();
  }
}
