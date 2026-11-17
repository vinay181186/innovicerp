// ADR-303 — liftLineFilters: a line fact's filter judges the WHOLE document
// (header value + every live line), one predicate per filter. Database-free:
// it checks the generated SQL text and its bound parameters.
import { SF_BLANK, type SfQuery } from '@innovic/shared';
import { sql, type SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';

import { liftLineFilters, type SfLiftSpec } from './list-query';

const dialect = new PgDialect();
const render = (q: SQL) => dialect.sqlToQuery(q);
const squash = (s: string) => s.replace(/\s+/g, ' ').trim();

const LINES = sql`FROM l WHERE l.doc_id = d.id AND l.deleted_at IS NULL`;
const SPEC: SfLiftSpec = {
  fields: {
    soCode: { line: sql`l.so`, header: sql`d.so`, type: 'text' },
    soInternalNo: { line: sql`l.ino`, type: 'text' },
  },
  linesFrom: LINES,
};
const EXISTS = 'EXISTS (SELECT 1 FROM l WHERE l.doc_id = d.id AND l.deleted_at IS NULL AND';

const sfOf = (filters: SfQuery['filters'], sort: SfQuery['sort'] = null): SfQuery => ({
  sort,
  filters,
});

describe('liftLineFilters (lib/list-query)', () => {
  it('no sf → nothing lifted', () => {
    const r = liftLineFilters(undefined, SPEC);
    expect(r.docSf).toBeUndefined();
    expect(r.lifted).toBe(false);
    expect(render(r.lineFrag).sql.trim()).toBe('');
  });

  it('contains → header OR any live line', () => {
    const r = liftLineFilters(
      sfOf([{ field: 'soCode', kind: 'text', op: 'contains', q: 'SO-1' }]),
      SPEC,
    );
    const out = render(r.lineFrag);
    expect(squash(out.sql)).toBe(
      squash(
        `AND (COALESCE(d.so::text ILIKE $1 ESCAPE '\\', FALSE) OR ${EXISTS} l.so::text ILIKE $2 ESCAPE '\\'))`,
      ),
    );
    expect(out.params).toEqual(['%SO-1%', '%SO-1%']);
    expect(r.docSf?.filters).toEqual([]);
  });

  it('notContains → NOT (header OR any line contains) — never "some line lacks it"', () => {
    const r = liftLineFilters(
      sfOf([{ field: 'soCode', kind: 'text', op: 'notContains', q: 'SO-1' }]),
      SPEC,
    );
    const out = squash(render(r.lineFrag).sql);
    expect(out).toBe(
      squash(
        `AND NOT (COALESCE(d.so::text ILIKE $1 ESCAPE '\\', FALSE) OR ${EXISTS} l.so::text ILIKE $2 ESCAPE '\\'))`,
      ),
    );
    expect(out).not.toContain('NOT ILIKE');
  });

  it('(Blanks) → no non-blank value on the header or any line (a line-less doc matches)', () => {
    const r = liftLineFilters(
      sfOf([{ field: 'soCode', kind: 'values', values: [SF_BLANK] }]),
      SPEC,
    );
    const out = render(r.lineFrag);
    expect(squash(out.sql)).toBe(
      squash(
        `AND (NOT (COALESCE((d.so IS NOT NULL AND btrim(d.so::text) <> ''), FALSE)` +
          ` OR ${EXISTS} (l.so IS NOT NULL AND btrim(l.so::text) <> ''))))`,
      ),
    );
    expect(out.params).toEqual([]);
  });

  it('tick list without (Blanks) = the non-blank side: some value is in the list', () => {
    const r = liftLineFilters(
      sfOf([{ field: 'soInternalNo', kind: 'values', values: ['A-1', 'B-2'] }]),
      SPEC,
    );
    const out = render(r.lineFrag);
    // No header source for this field → lines only, and no NOT anywhere.
    expect(squash(out.sql)).toBe(squash(`AND (${EXISTS} l.ino::text IN ($1, $2)))`));
    expect(out.params).toEqual(['A-1', 'B-2']);
  });

  it('values + (Blanks) → in the list OR blank everywhere', () => {
    const r = liftLineFilters(
      sfOf([{ field: 'soCode', kind: 'values', values: ['SO-1', SF_BLANK] }]),
      SPEC,
    );
    const out = squash(render(r.lineFrag).sql);
    expect(out).toContain('d.so::text IN ($1)');
    expect(out).toContain('l.so::text IN ($2)');
    expect(out).toContain(' OR NOT (COALESCE((d.so IS NOT NULL');
  });

  it('nothing ticked → FALSE (as in Excel)', () => {
    const r = liftLineFilters(sfOf([{ field: 'soCode', kind: 'values', values: [] }]), SPEC);
    expect(squash(render(r.lineFrag).sql)).toBe('AND FALSE');
  });

  it('two filters → two predicates AND-ed; other filters + sort stay on the doc map', () => {
    const sort = { field: 'soCode', dir: 'asc' as const };
    const r = liftLineFilters(
      sfOf(
        [
          { field: 'soCode', kind: 'values', values: ['SO-1'] },
          { field: 'vendorName', kind: 'text', op: 'contains', q: 'x' },
          { field: 'soInternalNo', kind: 'text', op: 'equals', q: 'I-9' },
        ],
        sort,
      ),
      SPEC,
    );
    expect(r.lifted).toBe(true);
    expect(r.docSf?.sort).toEqual(sort);
    expect(r.docSf?.filters.map((f) => f.field)).toEqual(['vendorName']);
    const out = render(r.lineFrag);
    const text = squash(out.sql);
    expect(text.startsWith('AND (')).toBe(true);
    expect(text).toContain(') AND EXISTS (');
    expect(text.match(/EXISTS \(/g)?.length).toBe(2);
    expect(out.params).toEqual(['SO-1', 'SO-1', 'I-9']);
  });

  it('a blank text filter is no filter (but still leaves the doc map)', () => {
    const r = liftLineFilters(
      sfOf([{ field: 'soCode', kind: 'text', op: 'contains', q: '  ' }]),
      SPEC,
    );
    expect(r.docSf?.filters).toEqual([]);
    expect(render(r.lineFrag).sql.trim()).toBe('');
  });

  it('a money line fact needs canSeePrice', () => {
    const spec: SfLiftSpec = {
      fields: { amt: { line: sql`l.amt`, type: 'num', price: true } },
      linesFrom: LINES,
    };
    const sf = sfOf([{ field: 'amt', kind: 'num', op: 'gt', a: 1 }]);
    expect(() => liftLineFilters(sf, spec)).toThrow();
    expect(() => liftLineFilters(sf, spec, { canSeePrice: true })).not.toThrow();
  });

  it('num ne → NOT any eq', () => {
    const spec: SfLiftSpec = {
      fields: { q: { line: sql`l.q`, type: 'num' } },
      linesFrom: LINES,
    };
    const r = liftLineFilters(sfOf([{ field: 'q', kind: 'num', op: 'ne', a: 5 }]), spec);
    expect(squash(render(r.lineFrag).sql)).toBe(squash(`AND NOT ${EXISTS} l.q = $1::numeric)`));
  });
});
