// ADR-230 — collect change messages and hand them on in one batch.
//
// Trailing wait with a ceiling: every new change restarts the short wait, but
// the first change of a batch starts a hard deadline that no later change can
// move. So a burst collapses into one refresh, and a never-ending stream still
// flushes at least every `maxWaitMs`.
//
// Pure — no React, no Supabase — so the timing is unit-tested with a fake clock.

import type { LiveChange } from '@innovic/shared';

export interface ChangeBatcherOptions {
  waitMs: number;
  maxWaitMs: number;
}

export class ChangeBatcher {
  private pending: LiveChange[] = [];
  private waitTimer: ReturnType<typeof setTimeout> | null = null;
  private deadlineTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly onFlush: (changes: LiveChange[]) => void,
    private readonly options: ChangeBatcherOptions,
  ) {}

  add(changes: readonly LiveChange[]): void {
    if (changes.length === 0) return;
    this.pending.push(...changes);

    if (this.waitTimer !== null) clearTimeout(this.waitTimer);
    this.waitTimer = setTimeout(() => this.flush(), this.options.waitMs);

    // The deadline is set by the FIRST change of a batch and never moved.
    if (this.deadlineTimer === null) {
      this.deadlineTimer = setTimeout(() => this.flush(), this.options.maxWaitMs);
    }
  }

  /** Hand on whatever is waiting, now. */
  flush(): void {
    this.clearTimers();
    if (this.pending.length === 0) return;
    const batch = this.pending;
    this.pending = [];
    this.onFlush(batch);
  }

  /** Drop everything without handing it on — used on unmount / sign-out, when
   *  there is no screen left to refresh. */
  cancel(): void {
    this.clearTimers();
    this.pending = [];
  }

  private clearTimers(): void {
    if (this.waitTimer !== null) clearTimeout(this.waitTimer);
    if (this.deadlineTimer !== null) clearTimeout(this.deadlineTimer);
    this.waitTimer = null;
    this.deadlineTimer = null;
  }
}
