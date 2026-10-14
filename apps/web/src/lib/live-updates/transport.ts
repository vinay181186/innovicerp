// ADR-230 — the contract every way of hearing about changes must meet.
//
// The core (batching, which screens to refresh, closing gaps, the "paused"
// marker) is the same whatever the transport is. A transport only answers one
// question: "what changed?" — and reports honestly whether it can currently
// hear. It never refreshes a screen itself.

import type { LiveChange } from '@innovic/shared';

export interface LiveSink {
  /** Records that changed. Duplicates and out-of-order delivery are harmless:
   *  the screens re-read from the API. */
  changes(changes: readonly LiveChange[]): void;
  /** The transport can hear again. If it had been deaf, the core re-reads
   *  every screen on display, because whatever changed meanwhile was missed. */
  connected(): void;
  /** The transport heard that SOMETHING changed but cannot say what (e.g. its
   *  cursor fell too far behind). Every screen on display re-reads; no edit
   *  screen is told "someone else changed this", because nobody may have. */
  resync(): void;
  /** The transport cannot hear right now. `reason` is a short machine word
   *  (`CHANNEL_ERROR`, `TIMED_OUT`, `http_503`, …) for logs; it is never shown
   *  to the user. The transport keeps retrying on its own. */
  disconnected(reason: string, error?: unknown): void;
}

export interface LiveTransportContext {
  companyId: string;
  sink: LiveSink;
}

export interface LiveTransport {
  /** Short name for logs, e.g. `realtime`, `sse`, `poll`. */
  readonly name: string;
  /** Start listening. Returns the function that stops it and releases every
   *  connection and timer it holds. */
  start(context: LiveTransportContext): () => void;
}
