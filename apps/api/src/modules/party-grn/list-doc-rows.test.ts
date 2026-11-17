// ADR-303 — GET /party-grn is the Party GRN list again: ONE ROW PER RECEIPT,
// with ONE QC status rolled up from its lines. Read-only against TEST data.
import { and, eq, inArray, isNull } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';
import { db } from '../../db/client';
import { partyGrnLines, users } from '../../db/schema';
import type { AuthContext } from '../../db/with-user-context';
import { listPartyGrn } from './service';
import { listPartyGrnQuerySchema } from '@innovic/shared';

const ADMIN_EMAIL = 'innovic.technology@gmail.com';
let admin: AuthContext;
const q = (o: Record<string, string>) => listPartyGrnQuerySchema.parse(o);

beforeAll(async () => {
  const u = (await db.select().from(users).where(eq(users.email, ADMIN_EMAIL)).limit(1))[0];
  if (!u || !u.companyId) throw new Error('Seed admin missing — run pnpm --filter api seed');
  admin = { id: u.id, email: u.email, companyId: u.companyId, role: u.role, isActive: u.isActive };
});

type L = { qcAt: unknown; received: number; accepted: number; rejected: number };
/** The roll-up, by the web's line rule (party-grn/lib/qc-state pgrnQcState). */
function expectedQc(lines: L[]): 'pending' | 'partly_done' | 'done' {
  const untouched = (l: L) => l.qcAt == null && l.accepted === 0 && l.rejected === 0;
  const done = lines.filter((l) => !untouched(l) && l.received - l.accepted - l.rejected <= 0);
  if (lines.length > 0 && done.length === lines.length) return 'done';
  if (lines.filter(untouched).length === lines.length) return 'pending';
  return 'partly_done';
}

describe('listPartyGrn — one row per receipt (ADR-303)', () => {
  it('roll-up rule: Pending / Partly done / Done', () => {
    expect(expectedQc([{ qcAt: null, received: 6, accepted: 0, rejected: 0 }])).toBe('pending');
    expect(expectedQc([{ qcAt: 'x', received: 60, accepted: 6, rejected: 0 }])).toBe('partly_done');
    expect(
      expectedQc([
        { qcAt: 'x', received: 6, accepted: 6, rejected: 0 },
        { qcAt: null, received: 6, accepted: 0, rejected: 0 },
      ]),
    ).toBe('partly_done');
    // A line booked before QC existed (accepted = received, no stamp) is done.
    expect(expectedQc([{ qcAt: null, received: 6, accepted: 6, rejected: 0 }])).toBe('done');
  });

  it('one row per receipt; linesCount and docQcStatus agree with the live lines', async () => {
    const res = await listPartyGrn(q({ limit: '50', offset: '0' }), admin);
    const ids = res.items.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
    if (ids.length === 0) return;
    const lines = await db
      .select({
        grn: partyGrnLines.partyGrnId,
        qcAt: partyGrnLines.qcAt,
        received: partyGrnLines.receivedQty,
        accepted: partyGrnLines.acceptedQty,
        rejected: partyGrnLines.rejectedQty,
      })
      .from(partyGrnLines)
      .where(and(inArray(partyGrnLines.partyGrnId, ids), isNull(partyGrnLines.deletedAt)));
    for (const r of res.items) {
      const mine = lines.filter((l) => l.grn === r.id);
      expect(r.linesCount).toBe(mine.length);
      expect(r.docQcStatus).toBe(expectedQc(mine));
    }
  });

  it('every new Sort & Filter field runs on list AND summary', async () => {
    for (const st of ['pending', 'partly_done', 'done'] as const) {
      const sf = JSON.stringify({
        sort: { field: 'createdBy', dir: 'asc' },
        filters: [
          { field: 'docQcStatus', kind: 'values', values: [st] },
          { field: 'acceptedQty', kind: 'num', op: 'gte', a: 0 },
          { field: 'createdBy', kind: 'text', op: 'notContains', q: 'zzz' },
        ],
      });
      const res = await listPartyGrn(
        q({ sf, search: 'a', includeCancelled: 'true', limit: '25', offset: '0' }),
        admin,
      );
      expect(res.total).toBeGreaterThanOrEqual(res.items.length);
      for (const r of res.items) expect(r.docQcStatus).toBe(st);
    }
  });
});
