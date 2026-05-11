// Alerts worker tests (T-041d Phase B slice 6b, ADR-024).
//
// Three layers:
//   - digestWindowStart — pure unit (no DB).
//   - renderDigestHtml  — pure unit (no DB).
//   - runDigestTick     — integration against the live dev DB with the
//                          Resend wrapper mocked so we don't hit the network.
//
// Test code: AL-018 (NC pending disposition). Disjoint from
// subscriptions.test.ts (AL-001/-002/-014) + routes.test.ts (AL-005 config,
// AL-009/-012 subs). service.test.ts + routes.test.ts only READ AL-018,
// they don't subscribe to it, so the suites stay non-interfering.

import { and, eq } from 'drizzle-orm';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { db } from '../../db/client';
import { alertDeliveries, alertSubscriptions, users } from '../../db/schema';
import type { AuthContext } from '../../db/with-user-context';

// Hoisted by vitest above the worker.ts import below — the worker's
// `import { sendAlertDigest } from '../../lib/email'` resolves to this
// factory's vi.fn instead of the real Resend wrapper.
vi.mock('../../lib/email', () => ({
  sendAlertDigest: vi.fn(async () => ({
    messageId: `mock-${Math.random().toString(36).slice(2, 11)}`,
    realSend: false,
  })),
}));

import { sendAlertDigest } from '../../lib/email';
import * as subs from './subscriptions';
import { digestWindowStart, renderDigestHtml, runDigestTick } from './worker';

const ADMIN_EMAIL = 'innovic.technology@gmail.com';
const TEST_CODE = 'AL-018';

let admin: AuthContext;

async function cleanupForAdmin(): Promise<void> {
  await db
    .delete(alertDeliveries)
    .where(and(eq(alertDeliveries.userId, admin.id), eq(alertDeliveries.code, TEST_CODE)));
  await db
    .delete(alertSubscriptions)
    .where(and(eq(alertSubscriptions.userId, admin.id), eq(alertSubscriptions.code, TEST_CODE)));
}

beforeAll(async () => {
  const rows = await db.select().from(users).where(eq(users.email, ADMIN_EMAIL)).limit(1);
  const u = rows[0];
  if (!u || !u.companyId) throw new Error('Seed admin missing — run pnpm --filter api seed');
  admin = {
    id: u.id,
    email: u.email,
    companyId: u.companyId,
    role: u.role,
    isActive: u.isActive,
  };
  await cleanupForAdmin();
});

afterEach(async () => {
  vi.mocked(sendAlertDigest).mockClear();
  await cleanupForAdmin();
});

describe('alerts worker — digestWindowStart', () => {
  it('floors to the most recent 30-min boundary', () => {
    const at = new Date('2026-05-11T13:47:32.123Z');
    expect(digestWindowStart(at).toISOString()).toBe('2026-05-11T13:30:00.000Z');
  });

  it('snaps an exact-on-boundary time to itself', () => {
    const at = new Date('2026-05-11T14:00:00.000Z');
    expect(digestWindowStart(at).toISOString()).toBe('2026-05-11T14:00:00.000Z');
  });

  it('snaps to the previous boundary just before the half-hour', () => {
    const at = new Date('2026-05-11T14:29:59.999Z');
    expect(digestWindowStart(at).toISOString()).toBe('2026-05-11T14:00:00.000Z');
  });
});

describe('alerts worker — renderDigestHtml', () => {
  it('renders code + name + table rows + overflow notice when records exceed cap', () => {
    const records: ReadonlyArray<Record<string, string | number | null>> = Array.from(
      { length: 60 },
      (_, i) => ({ so: `SO-${i + 1}`, qty: i }),
    );
    const html = renderDigestHtml({
      userName: 'Test User',
      code: 'AL-005',
      alertName: 'SO Overdue',
      records,
    });
    expect(html).toContain('AL-005');
    expect(html).toContain('SO Overdue');
    expect(html).toContain('Test User');
    expect(html).toContain('SO-1<');
    expect(html).toContain('SO-50<');
    expect(html).not.toContain('SO-51<');
    expect(html).toContain('and 10 more');
    expect(html).toContain('60 items');
  });

  it('HTML-escapes user name, alert name, and record values', () => {
    const html = renderDigestHtml({
      userName: '<script>',
      code: 'AL-XSS',
      alertName: '<b>x</b>',
      records: [{ field: 'a&b<c>"d\'e' }],
    });
    expect(html).not.toContain('<script>');
    expect(html).not.toMatch(/<b>x<\/b>/);
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('a&amp;b&lt;c&gt;&quot;d&#39;e');
  });
});

describe('alerts worker — runDigestTick', () => {
  it('completes cleanly when no subscriptions match this suite\'s code', async () => {
    // beforeAll + afterEach guarantee cleanupForAdmin() ran. Other suites'
    // subs (different codes) may still be in-flight under parallel run; we
    // don't assert against those.
    const r = await runDigestTick();
    expect(r.window).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(r.evaluations).toBeGreaterThanOrEqual(0);
  });

  it('first tick records exactly one delivery row when records > 0; skips dispatch when records = 0', async () => {
    await subs.setMySubscription({ code: TEST_CODE, subscribed: true }, admin);

    const at = new Date();
    const r = await runDigestTick(at);
    const window = new Date(r.window);

    const deliveries = await db
      .select()
      .from(alertDeliveries)
      .where(
        and(
          eq(alertDeliveries.userId, admin.id),
          eq(alertDeliveries.code, TEST_CODE),
          eq(alertDeliveries.windowStart, window),
        ),
      );
    const sendCount = vi.mocked(sendAlertDigest).mock.calls.length;

    // Two valid fixture shapes — records > 0 OR records = 0. The contract
    // under test: a one-shot tick produces a 1:1 send-to-row relationship.
    if (sendCount === 1) {
      expect(deliveries).toHaveLength(1);
      expect(deliveries[0]?.realSend).toBe(false);
      expect(deliveries[0]?.code).toBe(TEST_CODE);
      expect(deliveries[0]?.channel).toBe('email');
      expect(r.dispatched).toBeGreaterThanOrEqual(1);
    } else {
      expect(sendCount).toBe(0);
      expect(deliveries).toHaveLength(0);
      expect(r.emptySkipped).toBeGreaterThanOrEqual(1);
    }
  });

  it('second tick within the same window does not insert a duplicate delivery row', async () => {
    await subs.setMySubscription({ code: TEST_CODE, subscribed: true }, admin);

    const at = new Date();
    const r1 = await runDigestTick(at);
    const window = new Date(r1.window);

    const firstRowCount = (
      await db
        .select()
        .from(alertDeliveries)
        .where(
          and(
            eq(alertDeliveries.userId, admin.id),
            eq(alertDeliveries.code, TEST_CODE),
            eq(alertDeliveries.windowStart, window),
          ),
        )
    ).length;

    const r2 = await runDigestTick(at);
    expect(r2.window).toBe(r1.window);

    const secondRowCount = (
      await db
        .select()
        .from(alertDeliveries)
        .where(
          and(
            eq(alertDeliveries.userId, admin.id),
            eq(alertDeliveries.code, TEST_CODE),
            eq(alertDeliveries.windowStart, window),
          ),
        )
    ).length;

    // The unique index on (code, user_id, window_start, channel) means the
    // row count must match across both ticks regardless of records shape.
    expect(secondRowCount).toBe(firstRowCount);
    if (firstRowCount === 1) {
      expect(r2.duplicateSkipped).toBeGreaterThanOrEqual(1);
    } else {
      expect(r2.emptySkipped).toBeGreaterThanOrEqual(1);
    }
  });
});
