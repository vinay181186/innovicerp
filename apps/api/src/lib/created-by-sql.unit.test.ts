import { PgDialect, alias } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import { salesOrders } from '../db/schema';
import { createdByNameSql } from './created-by-sql';

const render = (q: ReturnType<typeof createdByNameSql>) => new PgDialect().sqlToQuery(q).sql;

describe('createdByNameSql (ADR-261 rev)', () => {
  it('writes a Drizzle column table-qualified, never bare (bare binds to users.created_by)', () => {
    const s = render(createdByNameSql(salesOrders.createdBy));
    expect(s).toContain('cbu.id = "sales_orders"."created_by"');
  });
  it('uses the alias name for an aliased table', () => {
    const so = alias(salesOrders, 'so2');
    expect(render(createdByNameSql(so.createdBy))).toContain('cbu.id = "so2"."created_by"');
  });
  it('passes raw SQL through unchanged', () => {
    const s = render(createdByNameSql(sql`COALESCE(l.created_by, h.created_by)`));
    expect(s).toContain('cbu.id = COALESCE(l.created_by, h.created_by)');
  });
});
