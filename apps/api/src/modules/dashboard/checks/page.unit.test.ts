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
    keep('qc_incoming', { kind: 'purchase', x1: null }); // purchase GRN without a line
    keep('qc_reports', { kind: 'so', x1: null }); // standalone job card
    keep('prod_due_week', { x1: null }); // PRO with no plan
    keep('prod_ops_ready', { x1: null });
  });
});

// ADR-312 phase 2: [check, right, row, link]. Each link opens with its right,
// falls back to docHref without it, and (where the step needs an id the row
// may lack) falls back to docHref when that id is missing.
type Case = {
  key: string;
  form: string;
  action: 'entry' | 'edit' | 'approve' | 'advance';
  row: Parameters<typeof raw>[0];
  to: string;
  missing?: Parameters<typeof raw>[0];
  /** The form whose View opens the target page, when not `form` itself. */
  pageForm?: string;
  /** The step also needs entry on pageForm (e.g. TPI needs QC Submit entry). */
  pageEntry?: boolean;
};
const ITEM = '66666666-6666-4666-8666-666666666666';
const PHASE2: Case[] = [
  {
    key: 'prod_ops_overtime',
    form: 'op_entry',
    action: 'entry',
    row: { code: 'IN-JC 1', x4: OP },
    to: `/op-entry?jc=IN-JC%201&op=${OP}&mode=complete`,
    missing: { code: 'IN-JC 1', x4: null },
  },
  {
    key: 'prod_osp_send',
    form: 'ospdc_create',
    action: 'entry',
    row: { x4: PR },
    to: `/delivery-challans/new?poId=${PR}`,
    missing: { x4: null },
  },
  {
    key: 'prod_osp_at_vendor',
    form: 'ospdc_create',
    action: 'entry',
    row: { x4: PR },
    to: `/delivery-challans/${PR}/receive`,
    missing: { x4: null },
  },
  {
    key: 'prod_rc_pending',
    form: 'routecard_create',
    action: 'entry',
    row: { kind: 'route_card_pending', x4: ITEM, itemCode: 'A&B', itemName: 'Shaft 1' },
    to: `/route-cards/new?itemId=${ITEM}&itemCode=A%26B&itemName=Shaft%201`,
    missing: { kind: 'route_card_pending', x4: null },
  },
  {
    key: 'prod_rc_pending',
    form: 'routecard_create',
    action: 'approve',
    row: { kind: 'route_card_approval_pending', x4: PLAN },
    to: `/route-cards/${PLAN}`,
    missing: { kind: 'route_card_approval_pending', x4: null },
  },
  {
    key: 'qc_tpi',
    form: 'tpi_submit',
    action: 'entry',
    row: { x1: OP },
    to: `/qc-call-register?tab=tpi&tpiOp=${OP}&search=IN-PO-00001`,
    pageForm: 'qc_submit',
    // A TPI save also needs QC Submit entry (tpi-pending-card.tsx).
    pageEntry: true,
    missing: { x1: null },
  },
  {
    key: 'des_bom_pending',
    form: 'bom_create',
    action: 'entry',
    row: { id: PR },
    to: `/bom-masters/new?soId=${PR}`,
  },
  {
    key: 'qc_nc_pending',
    form: 'nc_dispose',
    action: 'advance',
    row: { id: PR },
    to: `/nc-register/${PR}?open=dispose`,
  },
  {
    key: 'pur_rtv_challan',
    form: 'ospdc_create',
    action: 'entry',
    row: { id: PR },
    to: `/nc-register/${PR}?open=dc`,
    pageForm: 'nc_dispose',
  },
  {
    key: 'pur_osp_no_pr',
    form: 'pr_create',
    action: 'entry',
    row: { x1: OP },
    to: `/jc-ops?op=${OP}&open=pr&jc=IN-PO-00001`,
    pageForm: 'jc_create',
    missing: { x1: null },
  },
  {
    key: 'qc_calibration',
    form: 'toolissue_create',
    action: 'entry',
    row: { id: PR },
    to: `/instruments?open=${PR}`,
  },
  {
    key: 'store_tools_out',
    form: 'toolissue_create',
    action: 'advance',
    row: { id: PR },
    to: `/issue-register?tab=tools&open=${PR}`,
  },
  {
    key: 'fin_invoice_overdue',
    form: 'invoice_create',
    action: 'entry',
    row: { id: PR },
    to: `/invoices/${PR}?open=payment`,
  },
  {
    key: 'qc_incoming',
    form: 'qc_incoming',
    action: 'entry',
    row: { kind: 'party_grn', id: PR, x1: LINE },
    to: `/incoming-qc?pgrn=${PR}`,
  },
  ...(['sales_overdue', 'sales_due_week', 'sales_due_month'] as const).map(
    (key): Case => ({
      key,
      form: 'jw_create',
      action: 'entry',
      row: { kind: 'jw', id: PR },
      to: `/customer-dispatches?tab=jw&jw=${PR}`,
      pageForm: 'dispatch_create',
    }),
  ),
];

describe('actionHref phase 2 (ADR-312)', () => {
  // The tick, plus View on the target page when another form owns it
  // (nextStep's canSeeLink: the page must open for the caller).
  const pageView = (c: Case) =>
    c.pageForm
      ? { [c.pageForm]: perms({ view: true, ...(c.pageEntry ? { entry: true } : {}) }) }
      : {};
  const withRight = (c: Case) =>
    dash({ forms: { ...pageView(c), [c.form]: perms({ view: true, [c.action]: true }) } });

  it.each(PHASE2)('$key ($action) with $form opens the next step', (c) => {
    expect(href(c.key, withRight(c), c.row)).toBe(c.to);
  });

  it.each(PHASE2)('$key ($action) without the right keeps docHref', (c) => {
    const viewer = dash({ forms: { ...pageView(c), [c.form]: perms({ view: true }) } });
    expect(href(c.key, viewer, c.row)).toBe(def(c.key).docHref(raw(c.row)));
  });

  it.each(PHASE2.filter((c) => c.missing))('$key ($action) lacking its id keeps docHref', (c) => {
    const m = c.missing as Parameters<typeof raw>[0];
    expect(href(c.key, withRight(c), m)).toBe(def(c.key).docHref(raw(m)));
  });

  it('an RC waiting approval needs Approve, not Entry (and the reverse)', () => {
    const entryOnly = dash({ forms: { routecard_create: perms({ view: true, entry: true }) } });
    const waiting = { kind: 'route_card_approval_pending', x4: PLAN };
    expect(href('prod_rc_pending', entryOnly, waiting)).toBe(
      def('prod_rc_pending').docHref(raw(waiting)),
    );
    const approveOnly = dash({ forms: { routecard_create: perms({ view: true, approve: true }) } });
    const missing = { kind: 'route_card_pending', x4: ITEM };
    expect(href('prod_rc_pending', approveOnly, missing)).toBe(
      def('prod_rc_pending').docHref(raw(missing)),
    );
  });

  it('SO rows still need the dispatch right; JWSO rows need the JW Return right', () => {
    const jwOnly = dash({
      forms: {
        dispatch_create: perms({ view: true }),
        jw_create: perms({ view: true, entry: true }),
      },
    });
    const so = { kind: 'so', id: PR };
    expect(href('sales_overdue', jwOnly, so)).toBe(def('sales_overdue').docHref(raw(so)));
    const dispatchOnly = dash({ forms: { dispatch_create: perms({ view: true, entry: true }) } });
    const jw = { kind: 'jw', id: PR };
    expect(href('sales_overdue', dispatchOnly, jw)).toBe(def('sales_overdue').docHref(raw(jw)));
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
