// ADR-303 — GET /goods-receipt-notes is the GRN list again: ONE ROW PER GRN,
// with ONE QC status rolled up from the lines. Read-only against TEST data.
import { and, eq, inArray, isNull } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';
import { db } from '../../db/client';
import { goodsReceiptNoteLines, users } from '../../db/schema';
import type { AuthContext } from '../../db/with-user-context';
import { listGoodsReceiptNotes } from './service';
import { listGoodsReceiptNotesQuerySchema } from './schema';

const ADMIN_EMAIL = 'innovic.technology@gmail.com';
let admin: AuthContext;
const q = (o: Record<string, string>) => listGoodsReceiptNotesQuerySchema.parse(o);

beforeAll(async () => {
  const u = (await db.select().from(users).where(eq(users.email, ADMIN_EMAIL)).limit(1))[0];
  if (!u || !u.companyId) throw new Error('Seed admin missing — run pnpm --filter api seed');
  admin = { id: u.id, email: u.email, companyId: u.companyId, role: u.role, isActive: u.isActive };
});

/** The roll-up rule, written out in TypeScript to check the SQL against. */
function expectedQc(
  lines: Array<{ received: number; accepted: number; rejected: number }>,
): 'pending' | 'partly_done' | 'done' {
  const waiting = lines.filter((l) => l.received - l.accepted - l.rejected > 0).length;
  const touched = lines.filter((l) => l.accepted + l.rejected > 0).length;
  if (lines.length > 0 && waiting === 0) return 'done';
  if (waiting === lines.length && touched === 0) return 'pending';
  return 'partly_done';
}

describe('listGoodsReceiptNotes — one row per GRN (ADR-303)', () => {
  it('one row per GRN; lineCount and the QC roll-up agree with the stored lines', async () => {
    const res = await listGoodsReceiptNotes(q({ limit: '50', offset: '0' }), admin);
    const ids = res.items.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
    if (ids.length === 0) return;
    const lines = await db
      .select({
        grn: goodsReceiptNoteLines.goodsReceiptNoteId,
        received: goodsReceiptNoteLines.receivedQty,
        accepted: goodsReceiptNoteLines.qcAcceptedQty,
        rejected: goodsReceiptNoteLines.qcRejectedQty,
      })
      .from(goodsReceiptNoteLines)
      .where(
        and(
          inArray(goodsReceiptNoteLines.goodsReceiptNoteId, ids),
          isNull(goodsReceiptNoteLines.deletedAt),
        ),
      );
    for (const r of res.items) {
      const mine = lines
        .filter((l) => l.grn === r.id)
        .map((l) => ({
          received: Number(l.received),
          accepted: Number(l.accepted),
          rejected: Number(l.rejected),
        }));
      expect(r.lineCount).toBe(mine.length);
      expect(r.docQcStatus).toBe(expectedQc(mine));
    }
  });

  it('roll-up rule: Pending / Partly done / Done', () => {
    expect(expectedQc([{ received: 5, accepted: 0, rejected: 0 }])).toBe('pending');
    expect(
      expectedQc([
        { received: 5, accepted: 5, rejected: 0 },
        { received: 5, accepted: 0, rejected: 0 },
      ]),
    ).toBe('partly_done');
    expect(expectedQc([{ received: 5, accepted: 2, rejected: 1 }])).toBe('partly_done');
    expect(
      expectedQc([
        { received: 5, accepted: 4, rejected: 1 },
        { received: 0, accepted: 0, rejected: 0 },
      ]),
    ).toBe('done');
  });

  it('docQcStatus ▾ filter returns only that status', async () => {
    for (const st of ['pending', 'partly_done', 'done'] as const) {
      const sf = JSON.stringify({
        sort: null,
        filters: [{ field: 'docQcStatus', kind: 'values', values: [st] }],
      });
      const res = await listGoodsReceiptNotes(q({ sf, limit: '25', offset: '0' }), admin);
      for (const r of res.items) expect(r.docQcStatus).toBe(st);
    }
  });

  it('the SO dropdown (soCode tick) returns each GRN once, incl. the GRN it came from', async () => {
    const all = await listGoodsReceiptNotes(q({ limit: '200', offset: '0' }), admin);
    const withSo = all.items.find((r) => r.soCode);
    if (!withSo) return;
    const sf = JSON.stringify({
      sort: null,
      filters: [{ field: 'soCode', kind: 'values', values: [withSo.soCode] }],
    });
    const res = await listGoodsReceiptNotes(q({ sf, limit: '200', offset: '0' }), admin);
    const ids = res.items.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toContain(withSo.id);
    expect(res.total).toBe(res.items.length);
  });

  it('every new Sort & Filter field runs on list AND summary', async () => {
    const sf = JSON.stringify({
      sort: { field: 'soCode', dir: 'asc' },
      filters: [
        { field: 'soInternalNo', kind: 'text', op: 'notContains', q: 'zzz' },
        { field: 'createdBy', kind: 'text', op: 'notContains', q: 'zzz' },
        { field: 'lineCount', kind: 'num', op: 'gte', a: 0 },
        { field: 'grnType', kind: 'values', values: ['po', 'dc', 'nc'] },
        { field: 'dcNo', kind: 'text', op: 'notContains', q: 'zzz' },
        { field: 'invoiceNo', kind: 'text', op: 'notContains', q: 'zzz' },
      ],
    });
    const res = await listGoodsReceiptNotes(
      q({ sf, search: 'a', includeCancelled: 'true', limit: '25', offset: '0' }),
      admin,
    );
    expect(res.total).toBeGreaterThanOrEqual(res.items.length);
  });
});
