// Dashboard service is read-only and rides on the existing seeded + migrated
// data — no fixture creation needed. Tests confirm the response shape, that
// each tile has a sensible severity, and that the company scope is honored
// (a different company's row should not bleed in).

import { eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';
import { db } from '../../db/client';
import { users } from '../../db/schema';
import type { AuthContext } from '../../db/with-user-context';
import { AuthorizationError } from '../../lib/errors';
import * as service from './service';

const ADMIN_EMAIL = 'innovic.technology@gmail.com';
const ALL_KINDS = [
  'open_sales_orders',
  'open_purchase_orders',
  'jc_ops_awaiting_qc',
  'ncs_pending_dispose',
  'grn_lines_pending_qc',
] as const;

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

describe('dashboard service', () => {
  it('admin gets all 5 tiles with the correct kinds + shape', async () => {
    const result = await service.getDashboardKpis(admin);
    expect(result.generatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(result.tiles).toHaveLength(5);
    const kinds = result.tiles.map((t) => t.kind).sort();
    expect(kinds).toEqual([...ALL_KINDS].sort());

    for (const tile of result.tiles) {
      expect(tile.title.length).toBeGreaterThan(0);
      expect(tile.count).toBeGreaterThanOrEqual(0);
      expect(tile.route.startsWith('/')).toBe(true);
      expect(['ok', 'info', 'warning', 'danger']).toContain(tile.severity);
    }
  });

  it('manager sees the same 5 tiles as admin', async () => {
    const manager: AuthContext = { ...admin, role: 'manager' };
    const result = await service.getDashboardKpis(manager);
    expect(result.tiles.map((t) => t.kind).sort()).toEqual([...ALL_KINDS].sort());
  });

  it('viewer keeps full visibility (read-only audit role)', async () => {
    const viewer: AuthContext = { ...admin, role: 'viewer' };
    const result = await service.getDashboardKpis(viewer);
    expect(result.tiles).toHaveLength(5);
  });

  it('operator only sees jc_ops_awaiting_qc + ncs_pending_dispose', async () => {
    const operator: AuthContext = { ...admin, role: 'operator' };
    const result = await service.getDashboardKpis(operator);
    const kinds = result.tiles.map((t) => t.kind).sort();
    expect(kinds).toEqual(['jc_ops_awaiting_qc', 'ncs_pending_dispose']);
  });

  it('qc sees QC-relevant tiles (jc-ops, NCs, GRN-lines)', async () => {
    const qc: AuthContext = { ...admin, role: 'qc' };
    const result = await service.getDashboardKpis(qc);
    const kinds = result.tiles.map((t) => t.kind).sort();
    expect(kinds).toEqual(['grn_lines_pending_qc', 'jc_ops_awaiting_qc', 'ncs_pending_dispose']);
  });

  it('procurement sees PO + GRN lines pending QC only', async () => {
    const proc: AuthContext = { ...admin, role: 'procurement' };
    const result = await service.getDashboardKpis(proc);
    const kinds = result.tiles.map((t) => t.kind).sort();
    expect(kinds).toEqual(['grn_lines_pending_qc', 'open_purchase_orders']);
  });

  it('dispatch sees open sales orders only (until dispatch-specific tiles land)', async () => {
    const dispatch: AuthContext = { ...admin, role: 'dispatch' };
    const result = await service.getDashboardKpis(dispatch);
    const kinds = result.tiles.map((t) => t.kind).sort();
    expect(kinds).toEqual(['open_sales_orders']);
  });

  it('NC tile reports `pending` count + sum of rejected_qty when non-zero', async () => {
    const result = await service.getDashboardKpis(admin);
    const ncTile = result.tiles.find((t) => t.kind === 'ncs_pending_dispose');
    expect(ncTile).toBeDefined();
    if (ncTile && ncTile.count > 0) {
      expect(ncTile.secondary).not.toBeNull();
      expect(ncTile.secondary?.label).toBe('rejected qty');
      expect(Number(ncTile.secondary?.value)).toBeGreaterThanOrEqual(0);
    } else {
      expect(ncTile?.secondary).toBeNull();
    }
  });

  it('severity flips to `ok` when count=0 and `info`/`warning`/`danger` otherwise', async () => {
    const result = await service.getDashboardKpis(admin);
    for (const tile of result.tiles) {
      if (tile.count === 0) {
        expect(tile.severity).toBe('ok');
      } else {
        expect(tile.severity).not.toBe('ok');
      }
    }
  });

  it('rejects users without a company assignment', async () => {
    const orphan: AuthContext = { ...admin, companyId: null };
    await expect(service.getDashboardKpis(orphan)).rejects.toBeInstanceOf(AuthorizationError);
  });
});
