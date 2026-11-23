// ADR-312 — without a database: the document number opens the next step's
// page only for a caller holding that right (else the document itself), and
// the "View all" page searches the check's own Reference column.

import { PgDialect } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { describe, expect, it, vi } from 'vitest';
import { dash, perms, raw } from '../personal/test-fixtures';

vi.mock('../../../db/client', () => ({ db: {} }));
vi.mock('../../access-control/service', () => ({ getMyAccess: vi.fn() }));
vi.mock('../../purchase-requests/service', () => ({ orderedQtySql: () => sql`0` }));
vi.mock('../../party-grn/service', () => ({ partyCommittedQtySql: () => sql`0` }));
vi.mock('../../../lib/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

const svc = await import('./service');
const t = await import('./types');
const page = await import('./page');

const TODAY = '2026-11-23';
const def = (key: string) => {
  const d = svc.CHECK_DEFS.find((x) => x.key === key);
  if (!d) throw new Error(`no check ${key}`);
  return d;
};
const href = (key: string, a: ReturnType<typeof dash>, over: Parameters<typeof raw>[0] = {}) =>
  t.toCheckRow(def(key), raw(over), TODAY, true, a).docHref;

const PR = '22222222-2222-4222-8222-222222222222';
const OP = '33333333-3333-4333-8333-333333333333';
const PLAN = '44444444-4444-4444-8444-444444444444';
const LINE = '55555555-5555-4555-8555-555555555555';

describe('actionHref (ADR-312)', () => {
  it('with the next-step right the document number opens that page', () => {
    const buyer = dash({ forms: { po_create: perms({ view: true, entry: true }) } });
    expect(href('pur_pr_pending', buyer, { id: PR })).toBe(`/purchase-orders/from-pr?prId=${PR}`);
  });

  it('without the right it opens the document (docHref)', () => {
    const viewer = dash({ forms: { po_create: perms({ view: true }) } });
    const d = def('pur_pr_pending');
    expect(href('pur_pr_pending', viewer, { id: PR })).toBe(d.docHref(raw({ id: PR })));
  });

  it('a per-page Hide on the target page closes the link', () => {
    const hidden = dash({
      departments: { production: 'L3' },
      forms: { op_entry: perms({ viewOff: true }) },
    });
    const r = { code: 'IN-JC-1', x1: OP };
    expect(href('prod_ops_ready', hidden, r)).toBe(def('prod_ops_ready').docHref(raw(r)));
  });

  it('no access passed (old callers) keeps docHref', () => {
    const d = def('pur_pr_pending');
    expect(t.toCheckRow(d, raw({ id: PR }), TODAY).docHref).toBe(d.docHref(raw({ id: PR })));
  });

  it('admin gets every implemented action', () => {
    const admin = dash({}, true);
    expect(href('prod_ops_ready', admin, { code: 'IN-JC 1', x1: OP })).toBe(
      `/op-entry?jc=IN-JC%201&op=${OP}&mode=start`,
    );
    expect(href('prod_plans_available', admin, { id: PLAN, code: 'PLN-1' })).toBe(
      `/production-orders/new?planId=${PLAN}&planCode=PLN-1`,
    );
    expect(href('prod_due_week', admin, { x1: PLAN, x2: 'PLN-1' })).toBe(
      `/production-orders/close?planId=${PLAN}&planCode=PLN-1`,
    );
    expect(href('plan_so_unplanned', admin, { id: PR, rowKey: LINE })).toBe(
      `/planning?soId=${PR}&planLine=${LINE}`,
    );
    expect(href('store_po_dc', admin, { id: PR })).toBe(`/delivery-challans/new?poId=${PR}`);
    expect(href('store_po_grn', admin, { id: PR })).toBe(`/goods-receipt-notes/new?poId=${PR}`);
    expect(href('store_jwso_grn', admin, { id: PR })).toBe(`/party-grn/new?jw=${PR}`);
    expect(href('store_so_customer_parts', admin, { id: PR })).toBe(`/party-grn/new?so=${PR}`);
    expect(href('fin_jw_not_invoiced', admin, { id: PR })).toBe(`/invoices?tab=jw&jw=${PR}`);
    expect(href('sales_so_draft', admin, { id: PR })).toBe(`/sales-orders/${PR}/edit`);
    expect(href('sales_overdue', admin, { id: PR, kind: 'so' })).toBe(
      `/customer-dispatches/new?so=${PR}`,
    );
    expect(href('qc_reports', admin, { kind: 'jwso', x1: PR, x2: LINE })).toBe(
      `/qc-docs?view=dossier&kind=jwso&orderId=${PR}&lineId=${LINE}`,
    );
    expect(href('qc_incoming', admin, { kind: 'purchase', x1: LINE })).toBe(
      `/incoming-qc?line=${LINE}`,
    );
  });

  it('rows lacking what the step needs keep docHref', () => {
    const admin = dash({}, true);
    const keep = (key: string, over: Parameters<typeof raw>[0]) =>
      expect(href(key, admin, over)).toBe(def(key).docHref(raw(over)));
    keep('sales_overdue', { kind: 'jw' }); // JWSO line: no SO dispatch
    keep('qc_incoming', { kind: 'party_grn', x1: LINE }); // Party GRN keeps its page
    keep('qc_reports', { kind: 'so', x1: null }); // standalone job card
    keep('prod_due_week', { x1: null }); // PRO with no plan
    keep('prod_ops_ready', { x1: null });
  });
});

describe('check page search (ADR-312)', () => {
  const render = (q: ReturnType<typeof sql>) => new PgDialect().sqlToQuery(q);

  it("finds the check's Reference column from refCode", () => {
    expect(page.refColumn(def('sales_overdue'))).toBe('x1');
    expect(page.refColumn(def('prod_due_week'))).toBe('x2');
    expect(page.refColumn(def('prod_ops_ready'))).toBe('x3');
    expect(page.refColumn(def('qc_final'))).toBe('kind');
    expect(page.refColumn(def('pur_pr_pending'))).toBeNull();
  });

  it('no search = TRUE; a search ORs the columns with an escaped pattern', () => {
    expect(render(page.searchWhere(def('sales_overdue'), undefined)).sql).toBe('TRUE');
    expect(render(page.searchWhere(def('sales_overdue'), '  ')).sql).toBe('TRUE');
    const q = render(page.searchWhere(def('sales_overdue'), '50%_a'));
    expect(q.sql).toContain('x.code::text ILIKE');
    expect(q.sql).toContain('x.item_name::text ILIKE');
    expect(q.sql).toContain('x.x1::text ILIKE');
    expect(q.params).toContain('%50\\%\\_a%');
  });

  it('the page orders by the home order and pages with LIMIT / OFFSET', () => {
    const q = render(page.checkPageSql(sql`SELECT 1`, sql`TRUE`, 25, 50));
    expect(q.sql).toContain('ORDER BY f.is_late DESC, f.sort_key ASC NULLS LAST');
    expect(q.params).toEqual(expect.arrayContaining([25, 50]));
  });
});
