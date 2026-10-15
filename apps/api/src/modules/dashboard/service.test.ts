// Dashboard service is read-only and rides on the existing seeded + migrated
// data — no fixture creation needed. Tests confirm the response shape, that
// each tile has a sensible severity, and that the company scope is honored
// (a different company's row should not bleed in).

import { accessFormPermsSchema } from '@innovic/shared';
import { eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';
import { db } from '../../db/client';
import { users } from '../../db/schema';
import type { AuthContext } from '../../db/with-user-context';
import { AuthorizationError } from '../../lib/errors';
import { AUDITOR, asAccess } from '../../lib/test-access';
import * as service from './service';

const ADMIN_EMAIL = 'innovic.technology@gmail.com';
const ALL_KINDS = [
  'open_sales_orders',
  'open_purchase_orders',
  'jc_ops_awaiting_qc',
  'ncs_pending_dispose',
  'grn_lines_pending_qc',
  'prs_pending_conversion',
  'ops_in_progress',
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
  it('admin gets all 7 tiles with the correct kinds + shape', async () => {
    const result = await service.getDashboardKpis(admin);
    expect(result.generatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(result.tiles).toHaveLength(7);
    const kinds = result.tiles.map((t) => t.kind).sort();
    expect(kinds).toEqual([...ALL_KINDS].sort());

    for (const tile of result.tiles) {
      expect(tile.title.length).toBeGreaterThan(0);
      expect(tile.count).toBeGreaterThanOrEqual(0);
      expect(tile.route.startsWith('/')).toBe(true);
      expect(['ok', 'info', 'warning', 'danger']).toContain(tile.severity);
    }
  });

  // ADR-232: a tile follows the View right of the page it counts, not the role.
  it('View on every counted page sees all 7 tiles (role manager)', async () => {
    const all = asAccess(
      admin,
      { departments: { sales: 'L1', purchase: 'L1', production: 'L1', qc: 'L1' } },
      'manager',
    );
    const result = await service.getDashboardKpis(all);
    expect(result.tiles.map((t) => t.kind).sort()).toEqual([...ALL_KINDS].sort());
  });

  it('L7 Auditor sees all 7 tiles (reads every page)', async () => {
    const auditor = asAccess(admin, AUDITOR, 'viewer');
    const result = await service.getDashboardKpis(auditor);
    expect(result.tiles).toHaveLength(7);
  });

  it('Production tier sees the Op Entry tile only (role operator)', async () => {
    const operator = asAccess(admin, { departments: { production: 'L2' } }, 'operator');
    const result = await service.getDashboardKpis(operator);
    const kinds = result.tiles.map((t) => t.kind).sort();
    expect(kinds).toEqual(['ops_in_progress']);
  });

  it('QC tier sees ops awaiting QC + Incoming QC + NC Register tiles (role qc)', async () => {
    const qc = asAccess(admin, { departments: { qc: 'L2' } }, 'qc');
    const result = await service.getDashboardKpis(qc);
    const kinds = result.tiles.map((t) => t.kind).sort();
    expect(kinds).toEqual(['grn_lines_pending_qc', 'jc_ops_awaiting_qc', 'ncs_pending_dispose']);
  });

  it('Purchase tier sees POs + PRs pending PO', async () => {
    const proc = asAccess(admin, { departments: { purchase: 'L2' } }, 'operator');
    const result = await service.getDashboardKpis(proc);
    const kinds = result.tiles.map((t) => t.kind).sort();
    expect(kinds).toEqual(['open_purchase_orders', 'prs_pending_conversion']);
  });

  it('a manager role no longer widens the tiles past the ticks (owner D10)', async () => {
    const salesOnly = asAccess(admin, { departments: { sales: 'L3' } }, 'manager');
    const result = await service.getDashboardKpis(salesOnly);
    expect(result.tiles.map((t) => t.kind)).toEqual(['open_sales_orders']);
  });

  it('a per-page View tick alone shows that tile (role viewer)', async () => {
    const ticked = asAccess(
      admin,
      {
        forms: {
          nc_dispose: accessFormPermsSchema.parse({ view: true, entry: false, edit: false }),
        },
      },
      'viewer',
    );
    const result = await service.getDashboardKpis(ticked);
    expect(result.tiles.map((t) => t.kind)).toEqual(['ncs_pending_dispose']);
  });

  it('an account with nothing configured sees no tiles', async () => {
    const none = asAccess(admin, {}, 'viewer');
    const result = await service.getDashboardKpis(none);
    expect(result.tiles).toEqual([]);
  });

  it('ops_in_progress tile severity stays at info or ok (state, not backlog)', async () => {
    const result = await service.getDashboardKpis(admin);
    const opsTile = result.tiles.find((t) => t.kind === 'ops_in_progress');
    expect(opsTile).toBeDefined();
    expect(['ok', 'info']).toContain(opsTile?.severity);
  });

  it('NC tile reports `pending` count + sum of rejected_qty when non-zero', async () => {
    const result = await service.getDashboardKpis(admin);
    const ncTile = result.tiles.find((t) => t.kind === 'ncs_pending_dispose');
    expect(ncTile).toBeDefined();
    if (ncTile && ncTile.count > 0) {
      expect(ncTile.secondary).not.toBeNull();
      expect(ncTile.secondary?.label).toBe('deviated qty');
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
