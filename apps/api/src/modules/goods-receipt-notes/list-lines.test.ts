// ADR-261 — GET /goods-receipt-notes/lines (list-lines.ts). Read-only: runs
// against whatever GRNs the TEST company already holds; creates nothing.
import { eq, inArray } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';
import { db } from '../../db/client';
import { goodsReceiptNoteLines, users } from '../../db/schema';
import type { AuthContext } from '../../db/with-user-context';
import { AuthorizationError } from '../../lib/errors';
import { listGoodsReceiptNoteLines } from './list-lines';
import { listGoodsReceiptNotesQuerySchema } from './schema';

const ADMIN_EMAIL = 'innovic.technology@gmail.com';
let admin: AuthContext;

beforeAll(async () => {
  const u = (await db.select().from(users).where(eq(users.email, ADMIN_EMAIL)).limit(1))[0];
  if (!u || !u.companyId) throw new Error('Seed admin missing — run pnpm --filter api seed');
  admin = { id: u.id, email: u.email, companyId: u.companyId, role: u.role, isActive: u.isActive };
});

describe('listGoodsReceiptNoteLines', () => {
  it('returns one row per live GRN line of the caller company + document counts', async () => {
    const q = listGoodsReceiptNotesQuerySchema.parse({ limit: '10', offset: '0' });
    const res = await listGoodsReceiptNoteLines(q, admin);
    expect(res.items.length).toBeLessThanOrEqual(10);
    expect(res.total).toBeGreaterThanOrEqual(res.items.length);
    // Tiles count GRNs, never more than the matching lines.
    expect(res.summary.total).toBeLessThanOrEqual(res.total);
    expect(res.summary.qcPending + res.summary.qcCleared).toBeLessThanOrEqual(res.summary.total);
    if (res.items.length > 0) {
      const stored = await db
        .select({
          id: goodsReceiptNoteLines.id,
          companyId: goodsReceiptNoteLines.companyId,
          grnId: goodsReceiptNoteLines.goodsReceiptNoteId,
        })
        .from(goodsReceiptNoteLines)
        .where(
          inArray(
            goodsReceiptNoteLines.id,
            res.items.map((r) => r.lineId),
          ),
        );
      for (const s of stored) {
        expect(s.companyId).toBe(admin.companyId);
        expect(res.items.find((r) => r.lineId === s.id)?.docId).toBe(s.grnId);
      }
    }
  });

  it('reads the QC status filter per line', async () => {
    const q = listGoodsReceiptNotesQuerySchema.parse({
      qcStatus: 'pending',
      limit: '25',
      offset: '0',
    });
    const res = await listGoodsReceiptNoteLines(q, admin);
    for (const r of res.items) {
      expect(r.receivedQty - r.qcAcceptedQty - r.qcRejectedQty).toBeGreaterThan(0);
      expect(r.lineQcStatus).not.toBe('completed');
    }
  });

  it('every Sort & Filter field, the search and includeCancelled run (list + summary)', async () => {
    const sf = JSON.stringify({
      sort: { field: 'createdOn', dir: 'desc' },
      filters: [
        { field: 'soCode', kind: 'text', op: 'contains', q: 'S' },
        { field: 'soInternalNo', kind: 'text', op: 'notContains', q: 'zzz' },
        { field: 'clientPoLineNo', kind: 'text', op: 'notContains', q: 'zzz' },
        { field: 'itemCode', kind: 'text', op: 'contains', q: '-' },
        { field: 'poNcCode', kind: 'text', op: 'contains', q: '-' },
        { field: 'totalReceivedQty', kind: 'num', op: 'gte', a: 0 },
      ],
    });
    const q = listGoodsReceiptNotesQuerySchema.parse({
      sf,
      search: 'a',
      includeCancelled: 'true',
      limit: '25',
      offset: '0',
    });
    const res = await listGoodsReceiptNoteLines(q, admin);
    expect(res.total).toBeGreaterThanOrEqual(res.items.length);
  });

  it('is scoped to the caller company', async () => {
    const q = listGoodsReceiptNotesQuerySchema.parse({ limit: '5', offset: '0' });
    const other = { ...admin, companyId: '00000000-0000-0000-0000-000000000000' };
    const res = await listGoodsReceiptNoteLines(q, other);
    expect(res.items).toEqual([]);
    expect(res.total).toBe(0);
    expect(res.summary.total).toBe(0);
    await expect(
      listGoodsReceiptNoteLines(q, { ...admin, companyId: null }),
    ).rejects.toBeInstanceOf(AuthorizationError);
  });
});
