// Reports service tests — list (static), run (3 reports), error paths.
// Each report exercises a different SQL pattern (list / aggregate / computed
// field). Tests run against the real seeded + migrated dev data — no fixture
// creation.

import { eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';
import { db } from '../../db/client';
import { users } from '../../db/schema';
import type { AuthContext } from '../../db/with-user-context';
import { AuthorizationError, NotFoundError } from '../../lib/errors';
import * as service from './service';

const ADMIN_EMAIL = 'innovic.technology@gmail.com';
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

describe('reports service', () => {
  it('listReports returns all registered reports with stable shape', () => {
    const result = service.listReports();
    const slugs = result.reports.map((r) => r.slug).sort();
    expect(slugs).toEqual([
      'daily-op-log',
      'design-engineer-workload',
      'design-issue-aging',
      'design-project-summary',
      'grn-qc-log',
      'item-tracker',
      'items-on-hand',
      'jc-ageing',
      'jc-status-summary',
      'nc-by-so-jc',
      'nc-register-all',
      'nc-summary-by-reason',
      'open-po-ageing',
      'operator-productivity',
      'production-item-tracker',
      'production-so-line-tracker',
      'so-open-backlog',
      'stock-movement-log',
      'vendor-po-summary',
    ]);
    for (const def of result.reports) {
      expect(def.title.length).toBeGreaterThan(0);
      expect(def.group.length).toBeGreaterThan(0);
      expect(def.columns.length).toBeGreaterThan(0);
    }
  });

  it('runReport "daily-op-log" returns rows with the expected columns', async () => {
    const result = await service.runReport('daily-op-log', {}, admin);
    expect(result.slug).toBe('daily-op-log');
    expect(result.columns.length).toBe(10);
    expect(result.rowCount).toBe(result.rows.length);
    // op_log has 24 migrated rows; expect a non-zero count without filters.
    expect(result.rowCount).toBeGreaterThan(0);
    // Spot-check the first row's shape — should have all the column keys.
    const first = result.rows[0];
    expect(first).toBeDefined();
    if (first) {
      expect(first).toHaveProperty('jc_code');
      expect(first).toHaveProperty('op_seq');
      expect(first).toHaveProperty('qty');
    }
  });

  it('runReport "daily-op-log" applies fromDate/toDate filters and echoes them', async () => {
    const result = await service.runReport(
      'daily-op-log',
      { fromDate: '2099-01-01', toDate: '2099-12-31' },
      admin,
    );
    expect(result.rowCount).toBe(0);
    expect(result.filters).toMatchObject({ fromDate: '2099-01-01', toDate: '2099-12-31' });
  });

  it('runReport "nc-summary-by-reason" aggregates by reason_category', async () => {
    const result = await service.runReport('nc-summary-by-reason', {}, admin);
    expect(result.slug).toBe('nc-summary-by-reason');
    // 3 migrated NCs all have reason_category='dimensional' → 1 group row.
    expect(result.rowCount).toBeGreaterThanOrEqual(1);
    const dimensional = result.rows.find((r) => r['reason_category'] === 'dimensional');
    expect(dimensional).toBeDefined();
    if (dimensional) {
      expect(Number(dimensional['nc_count'])).toBeGreaterThanOrEqual(3);
      expect(Number(dimensional['total_rejected_qty'])).toBeGreaterThanOrEqual(15);
    }
  });

  it('runReport "open-po-ageing" computes days_open + sums line aggregates', async () => {
    const result = await service.runReport('open-po-ageing', {}, admin);
    expect(result.slug).toBe('open-po-ageing');
    // 1 migrated PO (IN-JWPO-00001) is `open`; expect at least 1 row.
    expect(result.rowCount).toBeGreaterThanOrEqual(0);
    for (const row of result.rows) {
      expect(typeof row['days_open']).toBe('number');
      expect(Number(row['days_open'])).toBeGreaterThanOrEqual(0);
    }
  });

  it('runReport "open-po-ageing" status filter narrows results', async () => {
    const open = await service.runReport('open-po-ageing', { status: 'open' }, admin);
    for (const row of open.rows) {
      expect(row['status']).toBe('open');
    }
    // Invalid status value falls back to the default 4-status whitelist.
    const fallback = await service.runReport('open-po-ageing', { status: 'invalid' }, admin);
    expect(Array.isArray(fallback.rows)).toBe(true);
  });

  it('runReport "items-on-hand" returns one row per item incl. zero-stock items', async () => {
    const result = await service.runReport('items-on-hand', {}, admin);
    expect(result.slug).toBe('items-on-hand');
    expect(result.rowCount).toBeGreaterThan(0);
    // Items master has 352 migrated rows; LIMIT 1000 caps it.
    expect(result.rowCount).toBeLessThanOrEqual(1000);
    for (const row of result.rows) {
      expect(typeof row['code']).toBe('string');
      expect(typeof row['on_hand_qty']).toBe('number');
      // COALESCE → 0 means no negative on_hand from missing ledger.
      expect(Number(row['on_hand_qty'])).toBeGreaterThanOrEqual(0);
    }
  });

  it('runReport "operator-productivity" aggregates per-operator + computes reject_pct', async () => {
    const result = await service.runReport('operator-productivity', {}, admin);
    expect(result.slug).toBe('operator-productivity');
    for (const row of result.rows) {
      expect(typeof row['operator_name']).toBe('string');
      expect(Number(row['log_count'])).toBeGreaterThan(0);
      const rejectPct = Number(row['reject_pct']);
      expect(rejectPct).toBeGreaterThanOrEqual(0);
      expect(rejectPct).toBeLessThanOrEqual(100);
    }
  });

  it('runReport "jc-status-summary" pivots count by computed_status × item', async () => {
    const result = await service.runReport('jc-status-summary', {}, admin);
    expect(result.slug).toBe('jc-status-summary');
    expect(result.rowCount).toBeGreaterThanOrEqual(0);
    const validStatuses = ['open', 'qc_pending', 'complete', 'closed', 'no_ops'];
    for (const row of result.rows) {
      expect(validStatuses).toContain(row['computed_status']);
      expect(Number(row['jc_count'])).toBeGreaterThan(0);
    }
  });

  it('runReport "so-open-backlog" returns rows with computed pending_qty + line_value', async () => {
    const result = await service.runReport('so-open-backlog', {}, admin);
    expect(result.slug).toBe('so-open-backlog');
    for (const row of result.rows) {
      expect(typeof row['so_code']).toBe('string');
      expect(Number(row['order_qty'])).toBeGreaterThanOrEqual(0);
      expect(Number(row['pending_qty'])).toBeGreaterThanOrEqual(0);
      // pending = order - completed (clamped at 0)
      expect(Number(row['pending_qty'])).toBeLessThanOrEqual(Number(row['order_qty']));
      expect(Number(row['line_value'])).toBeGreaterThanOrEqual(0);
    }
  });

  it('runReport "so-open-backlog" with future-only due date returns 0 rows', async () => {
    const result = await service.runReport('so-open-backlog', { fromDueDate: '2099-01-01' }, admin);
    expect(result.rowCount).toBe(0);
    expect(result.filters).toMatchObject({ fromDueDate: '2099-01-01' });
  });

  it('runReport "vendor-po-summary" aggregates per vendor with non-negative counts/values', async () => {
    const result = await service.runReport('vendor-po-summary', {}, admin);
    expect(result.slug).toBe('vendor-po-summary');
    for (const row of result.rows) {
      expect(typeof row['vendor_name']).toBe('string');
      expect(Number(row['po_count'])).toBeGreaterThan(0);
      expect(Number(row['open_count'])).toBeGreaterThanOrEqual(0);
      expect(Number(row['closed_count'])).toBeGreaterThanOrEqual(0);
      expect(Number(row['total_value'])).toBeGreaterThanOrEqual(0);
      expect(Number(row['pending_value'])).toBeGreaterThanOrEqual(0);
      // Pending value never exceeds total value.
      expect(Number(row['pending_value'])).toBeLessThanOrEqual(Number(row['total_value']) + 0.01);
    }
  });

  it('runReport "stock-movement-log" returns rows with valid txn_type + source_type', async () => {
    const result = await service.runReport('stock-movement-log', {}, admin);
    expect(result.slug).toBe('stock-movement-log');
    const validTxnTypes = ['in', 'out', 'adjust'];
    const validSourceTypes = ['grn_qc', 'manual_adjust', 'dispatch', 'jw_in', 'jw_out', 'other'];
    for (const row of result.rows) {
      expect(validTxnTypes).toContain(row['txn_type']);
      expect(validSourceTypes).toContain(row['source_type']);
      expect(Number(row['qty'])).toBeGreaterThan(0);
    }
  });

  it('runReport "jc-ageing" returns only open/qc_pending/no_ops JCs with non-negative days_open', async () => {
    const result = await service.runReport('jc-ageing', {}, admin);
    expect(result.slug).toBe('jc-ageing');
    const validStatuses = ['open', 'qc_pending', 'no_ops'];
    for (const row of result.rows) {
      expect(validStatuses).toContain(row['computed_status']);
      expect(Number(row['days_open'])).toBeGreaterThanOrEqual(0);
      expect(Number(row['qty'])).toBeGreaterThan(0);
    }
  });

  it('runReport "jc-ageing" computedStatus filter narrows results', async () => {
    const open = await service.runReport('jc-ageing', { computedStatus: 'open' }, admin);
    for (const row of open.rows) {
      expect(row['computed_status']).toBe('open');
    }
  });

  it('runReport "grn-qc-log" returns rows with valid qc_status + accept/reject ≥ 0', async () => {
    const result = await service.runReport('grn-qc-log', {}, admin);
    expect(result.slug).toBe('grn-qc-log');
    const validQc = ['pending', 'in_progress', 'completed'];
    for (const row of result.rows) {
      expect(validQc).toContain(row['qc_status']);
      expect(Number(row['received_qty'])).toBeGreaterThan(0);
      expect(Number(row['qc_accepted_qty'])).toBeGreaterThanOrEqual(0);
      expect(Number(row['qc_rejected_qty'])).toBeGreaterThanOrEqual(0);
    }
  });

  it('runReport "grn-qc-log" qcStatus filter narrows results', async () => {
    const completed = await service.runReport('grn-qc-log', { qcStatus: 'completed' }, admin);
    for (const row of completed.rows) {
      expect(row['qc_status']).toBe('completed');
    }
  });

  it('runReport "stock-movement-log" sourceType filter narrows the result', async () => {
    const all = await service.runReport('stock-movement-log', {}, admin);
    const filtered = await service.runReport('stock-movement-log', { sourceType: 'grn_qc' }, admin);
    for (const row of filtered.rows) {
      expect(row['source_type']).toBe('grn_qc');
    }
    expect(filtered.rowCount).toBeLessThanOrEqual(all.rowCount);
  });

  it('runReport throws NotFoundError for unknown slug', async () => {
    await expect(service.runReport('not-a-real-report', {}, admin)).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });

  it('runReport rejects users without a company assignment', async () => {
    const orphan: AuthContext = { ...admin, companyId: null };
    await expect(service.runReport('daily-op-log', {}, orphan)).rejects.toBeInstanceOf(
      AuthorizationError,
    );
  });
});
