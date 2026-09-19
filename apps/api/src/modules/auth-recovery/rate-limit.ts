// In-memory sliding-window rate limiter for the public forgot-password
// endpoint. One process, no Redis: the API runs as a single Railway
// container, so a Map is enough. Two independent buckets — per address and
// per client IP — each "N hits per window".
//
// The clock is injectable so the unit test can move time without waiting.

export interface RateLimiterOptions {
  /** Hits allowed per key inside one window. */
  max: number;
  /** Window length in milliseconds. */
  windowMs: number;
  /** Returns the current time in ms. Defaults to Date.now. */
  now?: () => number;
}

export class RateLimiter {
  private readonly max: number;
  private readonly windowMs: number;
  private readonly now: () => number;
  /** key → timestamps (ms) of hits inside the current window. */
  private readonly hits = new Map<string, number[]>();

  constructor(opts: RateLimiterOptions) {
    this.max = opts.max;
    this.windowMs = opts.windowMs;
    this.now = opts.now ?? Date.now;
  }

  /** Record a hit for `key`. Returns true when the hit is within the limit,
   *  false when the key has already used up its allowance in this window.
   *  Every call prunes expired entries (for every key) so the map stays
   *  bounded to the keys seen in the last window. */
  hit(key: string): boolean {
    const t = this.now();
    this.prune(t);
    const list = this.hits.get(key) ?? [];
    if (list.length >= this.max) return false;
    list.push(t);
    this.hits.set(key, list);
    return true;
  }

  /** Number of keys currently tracked (test / diagnostics only). */
  get size(): number {
    return this.hits.size;
  }

  private prune(t: number): void {
    const cutoff = t - this.windowMs;
    for (const [key, list] of this.hits) {
      const kept = list.filter((ts) => ts > cutoff);
      if (kept.length === 0) this.hits.delete(key);
      else if (kept.length !== list.length) this.hits.set(key, kept);
    }
  }
}
