// Every kind in lib/related-item-kinds is hand-written SQL that the type checker
// cannot read, so each one is run once: a document that does not exist has no items,
// and getting that answer proves the kind's SQL parses against the real tables. The
// list is the exported one, so a new kind is covered without touching this file.
//
// Read-only. Like every api integration test it runs on the database DATABASE_URL
// points at: TEST only, never production (house rules).

import { eq, sql } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';
import { db } from '../db/client';
import { users } from '../db/schema';
import { type AuthContext, withUserContext } from '../db/with-user-context';
import { KINDS, RELATED_ITEM_KINDS, type RelatedItemKind } from './related-item-kinds';
import { loadRelatedItems, type RelatedItemScope } from './related-items';

const ADMIN_EMAIL = 'innovic.technology@gmail.com';
const MISSING = '00000000-0000-4000-8000-000000000000';

const SCOPE_COLUMNS: readonly RelatedItemScope['column'][] = [
  'id',
  'source_so_line_id',
  'source_jw_line_id',
  'source_pr_id',
  'source_bom_master_id',
  'sales_order_line_id',
  'purchase_order_line_id',
  'jw_line_id',
  'nc_id',
];

let admin: AuthContext;

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
});

/** The scope columns this kind's line table really has. */
async function scopeColumnsOf(kind: RelatedItemKind): Promise<RelatedItemScope['column'][]> {
  const table = KINDS[kind].from.replace('public.', '').split(' ')[0] ?? '';
  const rows = (await db.execute(sql`
    SELECT column_name FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = ${table}
  `)) as unknown as Array<{ column_name: string }>;
  const has = new Set(rows.map((r) => r.column_name));
  return SCOPE_COLUMNS.filter((c) => has.has(c));
}

describe('loadRelatedItems: every kind', () => {
  it.each(RELATED_ITEM_KINDS)('%s: a missing document has no items', async (kind) => {
    const out = await withUserContext(admin, (tx) => loadRelatedItems(tx, kind, [MISSING]));
    expect(out.size).toBe(0);
  });

  it.each(RELATED_ITEM_KINDS)('%s: the same, through each scope column', async (kind) => {
    const columns = await scopeColumnsOf(kind);
    expect(columns).toContain('id');
    for (const column of columns) {
      const out = await withUserContext(admin, (tx) =>
        loadRelatedItems(tx, kind, [MISSING], { column, ids: [MISSING] }),
      );
      expect(out.size).toBe(0);
    }
  });
});
