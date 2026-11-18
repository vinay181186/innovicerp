// ADR-309 — the "a notice is waiting" signal from a task write to the push
// sender. A tiny registry so tasks/notices.ts never loads the sender (and its
// env / web-push imports): the sender registers itself when it starts
// (startPushSender, server.ts only — never under test), and until then a kick
// is a no-op. Pending rows are then picked up by the retry tick anyway.

let kicker: (() => void) | null = null;

/** Called by the sender when it starts (null = stopped). */
export function setPushKicker(fn: (() => void) | null): void {
  kicker = fn;
}

/** Ask the sender to flush soon (debounced there). Never throws. */
export function kickPushSender(): void {
  try {
    kicker?.();
  } catch {
    // A pop-up must never fail a task action (ADR-309).
  }
}
