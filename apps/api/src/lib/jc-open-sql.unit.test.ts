import { PgDialect } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import { isoOrRaw } from '../modules/job-queue/queue-load';
import { jcOpenCond, jcOpenSql } from './jc-open-sql';

const render = (q: ReturnType<typeof jcOpenSql>) => new PgDialect().sqlToQuery(q).sql;

describe('jcOpenSql (decision 2a — Closed card ops are not pending)', () => {
  it('excludes Closed and cancelled cards for the given alias', () => {
    expect(render(jcOpenSql('jc'))).toBe('(jc.closed_at IS NULL AND jc.deleted_at IS NULL)');
    expect(jcOpenCond('pd_jc')).toBe('(pd_jc.closed_at IS NULL AND pd_jc.deleted_at IS NULL)');
  });

  it('ANDs into a larger query unchanged', () => {
    expect(render(sql`WHERE x = 1 AND ${jcOpenSql('jc')}`)).toBe(
      'WHERE x = 1 AND (jc.closed_at IS NULL AND jc.deleted_at IS NULL)',
    );
  });

  it('refuses anything that is not a plain alias', () => {
    expect(() => jcOpenSql('jc; DROP TABLE x')).toThrow(/bad alias/);
    expect(() => jcOpenCond('JC')).toThrow(/bad alias/);
  });
});

describe('isoOrRaw (Job Queue createdAt)', () => {
  it('turns the raw driver timestamptz text into ISO', () => {
    expect(isoOrRaw('2026-11-01 05:16:00.515278+00')).toBe('2026-11-01T05:16:00.515Z');
  });
  it('passes Date through as ISO, null stays null, junk stays raw', () => {
    expect(isoOrRaw(new Date('2026-11-01T05:16:00Z'))).toBe('2026-11-01T05:16:00.000Z');
    expect(isoOrRaw(null)).toBeNull();
    expect(isoOrRaw(undefined)).toBeNull();
    expect(isoOrRaw('not a date')).toBe('not a date');
  });
});
