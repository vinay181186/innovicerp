// Unit test for the Sort & Filter SQL builder (ADR-200). Pure — renders the
// SQL with the Postgres dialect, no database.

import { sql, type SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';

import { sfOrderBy, sfWhere, type SfColumnMap } from './list-query';

const render = (q: SQL) => new PgDialect().sqlToQuery(q);

const MAP: SfColumnMap = {
  code: { sql: sql`jc.code`, type: 'text' },
  qty: { sql: sql`jc.order_qty`, type: 'num' },
  due: { sql: sql`COALESCE(jc.due_date, sol.due_date)`, type: 'date' },
  status: { sql: sql`COALESCE(s.computed_status, 'no_ops')`, type: 'list' },
  value: { sql: sql`jc.value`, type: 'num', price: true },
};

describe('sfWhere', () => {
  it('is empty without filters', () => {
    expect(render(sfWhere(MAP, undefined)).sql).toBe('');
  });

  it('binds every value as a parameter, escapes LIKE', () => {
    const q = render(
      sfWhere(MAP, {
        sort: null,
        filters: [
          { field: 'code', kind: 'text', op: 'contains', q: "50%'; drop" },
          { field: 'status', kind: 'values', values: ['open', '(Blanks)'] },
          { field: 'qty', kind: 'num', op: 'between', a: 10, b: 2 },
        ],
      }),
    );
    expect(q.sql).not.toContain('drop');
    expect(q.params).toContain("%50\\%'; drop%");
    expect(q.params).toContain('open');
    expect(q.params).toEqual(expect.arrayContaining([2, 10]));
    expect(q.sql).toContain('IS NULL OR btrim');
  });

  it('turns a date range into day bounds; nothing ticked matches nothing', () => {
    const q = render(
      sfWhere(MAP, {
        sort: null,
        filters: [
          { field: 'due', kind: 'date', op: 'between', from: '2026-09-30', to: '2026-09-01' },
          { field: 'code', kind: 'values', values: [] },
        ],
      }),
    );
    expect(q.params).toEqual(['2026-09-01', '2026-09-30']);
    expect(q.sql).toContain('FALSE');
  });

  it('refuses an unknown field, a mistyped op and a hidden price column', () => {
    expect(() =>
      sfWhere(MAP, {
        sort: null,
        filters: [{ field: 'secret', kind: 'text', op: 'contains', q: 'x' }],
      }),
    ).toThrow(/cannot be sorted or filtered/);
    expect(() =>
      sfWhere(MAP, { sort: null, filters: [{ field: 'code', kind: 'num', op: 'eq', a: 1 }] }),
    ).toThrow(/number column/);
    expect(() =>
      sfWhere(
        MAP,
        { sort: null, filters: [{ field: 'value', kind: 'num', op: 'gt', a: 1 }] },
        { canSeePrice: false },
      ),
    ).toThrow(/cannot sort or filter/);
    // Object.prototype keys are not columns.
    expect(() =>
      sfOrderBy(MAP, { sort: { field: 'constructor', dir: 'asc' }, filters: [] }, sql`x`),
    ).toThrow();
  });
});

describe('sfOrderBy', () => {
  it('chosen column first, blanks last, the default order as tie-breaker', () => {
    const q = render(
      sfOrderBy(MAP, { sort: { field: 'due', dir: 'desc' }, filters: [] }, sql`jc.jc_date DESC`),
    );
    expect(q.sql).toBe('COALESCE(jc.due_date, sol.due_date) DESC NULLS LAST, jc.jc_date DESC');
  });
  it('falls back without a sort', () => {
    expect(render(sfOrderBy(MAP, undefined, sql`jc.code`)).sql).toBe('jc.code');
  });
});
