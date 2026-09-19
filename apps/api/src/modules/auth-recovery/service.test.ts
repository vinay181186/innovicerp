import { describe, expect, it } from 'vitest';
import { RateLimiter } from './rate-limit';

const WINDOW = 15 * 60 * 1000;

function makeClock(start = 1_000_000) {
  let t = start;
  return {
    now: () => t,
    advance: (ms: number) => {
      t += ms;
    },
  };
}

describe('auth-recovery rate limiter', () => {
  it('per-email: allows 3 requests, blocks the 4th, re-allows after the window', () => {
    const clock = makeClock();
    const limiter = new RateLimiter({ max: 3, windowMs: WINDOW, now: clock.now });

    expect(limiter.hit('a@x.com')).toBe(true);
    expect(limiter.hit('a@x.com')).toBe(true);
    expect(limiter.hit('a@x.com')).toBe(true);
    expect(limiter.hit('a@x.com')).toBe(false);
    // Another address is independent.
    expect(limiter.hit('b@x.com')).toBe(true);

    // Still inside the window — still blocked.
    clock.advance(WINDOW - 1);
    expect(limiter.hit('a@x.com')).toBe(false);

    // Window elapsed for the first three hits — allowed again.
    clock.advance(2);
    expect(limiter.hit('a@x.com')).toBe(true);
  });

  it('per-IP: allows 10 requests, blocks the 11th, re-allows after the window', () => {
    const clock = makeClock();
    const limiter = new RateLimiter({ max: 10, windowMs: WINDOW, now: clock.now });

    for (let i = 0; i < 10; i++) expect(limiter.hit('10.0.0.1')).toBe(true);
    expect(limiter.hit('10.0.0.1')).toBe(false);
    expect(limiter.hit('10.0.0.2')).toBe(true);

    clock.advance(WINDOW + 1);
    expect(limiter.hit('10.0.0.1')).toBe(true);
  });

  it('prunes expired keys so the map stays bounded', () => {
    const clock = makeClock();
    const limiter = new RateLimiter({ max: 3, windowMs: WINDOW, now: clock.now });

    limiter.hit('a@x.com');
    limiter.hit('b@x.com');
    expect(limiter.size).toBe(2);

    clock.advance(WINDOW + 1);
    limiter.hit('c@x.com');
    expect(limiter.size).toBe(1);
  });

  it('blocked hits do not extend the window', () => {
    const clock = makeClock();
    const limiter = new RateLimiter({ max: 1, windowMs: WINDOW, now: clock.now });

    expect(limiter.hit('k')).toBe(true);
    clock.advance(WINDOW / 2);
    expect(limiter.hit('k')).toBe(false); // must not be recorded
    clock.advance(WINDOW / 2 + 1);
    expect(limiter.hit('k')).toBe(true); // first hit expired; the blocked one never counted
  });
});
