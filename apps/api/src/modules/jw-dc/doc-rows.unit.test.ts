// ADR-303 — the JW DC / Customer Material Return / Item Issue registers are one
// row per DOCUMENT again. Database-free (ADR-229 *.unit.test.ts): the "any line"
// filters (SO dropdown, Internal SO No., Return Kind — lib/list-query
// liftLineFilters over each register's lift spec), and the document Sort &
// Filter maps carrying every column the screens show.
import { PgDialect } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';

import { liftLineFilters } from '../../lib/list-query';
import {
  CUSTOMER_MATERIAL_RETURN_LINE_LIFT,
  CUSTOMER_MATERIAL_RETURN_SF_COLUMNS,
} from '../customer-material-returns/sf-columns';
import { STORE_ISSUE_SF_COLUMNS } from '../store-issues/sf-columns';
import {
  JW_DC_INWARD_LINE_LIFT,
  JW_DC_INWARD_SF_COLUMNS,
  JW_DC_OUTWARD_LINE_LIFT,
  JW_DC_OUTWARD_SF_COLUMNS,
} from './sf-columns';

const dialect = new PgDialect();

describe('the SO dropdown keeps each JW DC one row (lifted over its lines)', () => {
  it('soCode pick → ONE EXISTS over the DC lines of z; other filters + sort stay', () => {
    const sf = {
      sort: { field: 'soCode', dir: 'asc' as const },
      filters: [
        { field: 'soCode', kind: 'values' as const, values: ['IN-SO-00012'] },
        { field: 'vendor', kind: 'text' as const, op: 'contains' as const, q: 'acme' },
      ],
    };
    const r = liftLineFilters(sf, JW_DC_OUTWARD_LINE_LIFT);
    expect(r.docSf?.sort).toEqual(sf.sort);
    expect(r.docSf?.filters.map((f) => f.field)).toEqual(['vendor']);
    const out = dialect.sqlToQuery(r.lineFrag);
    expect(out.sql).toContain('EXISTS (SELECT 1');
    expect(out.sql).toContain('FROM public.jw_dc_outward_lines jdol');
    expect(out.sql).toContain('jdol.jw_dc_outward_id = z.id');
    expect(out.sql).toContain('COALESCE(so.code, jwo.code)::text IN');
    expect(out.params).toEqual(['IN-SO-00012']);
  });

  it('Internal SO No. is lifted exactly like SO No. (outward and inward)', () => {
    const sf = {
      sort: null,
      filters: [{ field: 'soInternalNo', kind: 'text' as const, op: 'equals' as const, q: 'X-1' }],
    };
    for (const spec of [JW_DC_OUTWARD_LINE_LIFT, JW_DC_INWARD_LINE_LIFT]) {
      const r = liftLineFilters(sf, spec);
      expect(r.docSf?.filters).toEqual([]);
      expect(dialect.sqlToQuery(r.lineFrag).sql).toContain('lower(so.internal_so_no::text)');
    }
  });

  it('Return Kind on a Customer Material Return is judged over its lines', () => {
    const sf = {
      sort: null,
      filters: [{ field: 'kind', kind: 'values' as const, values: ['rejected'] }],
    };
    const r = liftLineFilters(sf, CUSTOMER_MATERIAL_RETURN_LINE_LIFT);
    expect(r.docSf?.filters).toEqual([]);
    const out = dialect.sqlToQuery(r.lineFrag).sql;
    expect(out).toContain('kl.return_id = r.id');
    expect(out).toContain('kl.kind::text IN');
  });
});

describe('document Sort & Filter maps carry every shown column', () => {
  const has = (map: object, keys: string[]): void => {
    for (const k of keys) expect(Object.keys(map)).toContain(k);
  };
  it('Item Issue', () => {
    has(STORE_ISSUE_SF_COLUMNS, [
      'code',
      'createdOn',
      'soCode',
      'soInternalNo',
      'issueDate',
      'issueAgainst',
      'reference',
      'issuedTo',
      'lineCount',
      'qty',
      'purpose',
      'issuedBy',
      'createdBy',
    ]);
  });
  it('Customer Material Return', () => {
    has(CUSTOMER_MATERIAL_RETURN_SF_COLUMNS, [
      'code',
      'createdOn',
      'jwCode',
      'returnDate',
      'customer',
      'kind',
      'lineCount',
      'qty',
      'status',
      'vehicleNo',
      'createdBy',
    ]);
  });
  it('JW DC Outward', () => {
    has(JW_DC_OUTWARD_SF_COLUMNS, [
      'code',
      'createdOn',
      'soCode',
      'soInternalNo',
      'dcDate',
      'poNo',
      'vendor',
      'lineCount',
      'sentQty',
      'receivedQty',
      'pendingQty',
      'returnStatus',
      'createdBy',
    ]);
  });
  it('JW DC Inward', () => {
    has(JW_DC_INWARD_SF_COLUMNS, [
      'code',
      'createdOn',
      'soCode',
      'dcNo',
      'poNo',
      'vendor',
      'lineCount',
      'receivedQty',
      'acceptedQty',
      'rejectedQty',
      'createdBy',
    ]);
  });
});

// Need the TEST database (the api suite, run by the gate — never by an agent):
describe('one row per document — integration (TEST DB)', () => {
  it.todo(
    'Item Issue: a slip with 3 lines is ONE row; Lines = 3, Issue Qty = sum; total counts slips',
  );
  it.todo('Customer Material Return: a return with 3 lines is ONE row; good+rejected → "Good +1"');
  it.todo('JW DC Outward: a DC with 3 lines over 2 SOs is ONE row, SO No. = first + "+1"');
  it.todo('JW DC Outward: soCode = the 2nd SO still returns that DC exactly once (EXISTS)');
  it.todo('JW DC Inward: a receipt with 3 lines is ONE row; soCode pick returns it once');
  it.todo('search by an item code on line 3 finds the document (EXISTS), once');
  it.todo('page 2 Sr No starts at 26 and total = documents, not lines');
});
