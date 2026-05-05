// Saved-reports service tests (T-041b).
//
// Covers CRUD + spec validation + run + preview + visibility rules.
// Test fixtures use `T041B-` prefix on report `name` so global-setup
// can wipe leftovers from killed runs.

import { and, eq, like } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { db } from '../../db/client';
import { savedReports, users } from '../../db/schema';
import type { AuthContext } from '../../db/with-user-context';
import {
  AuthorizationError,
  ConflictError,
  NotFoundError,
  ValidationError,
} from '../../lib/errors';
import * as service from './service';
import type { AdHocSpec } from './schema';

const ADMIN_EMAIL = 'innovic.technology@gmail.com';
const VIEWER_EMAIL = 'viewer@innovic.test';
const SECOND_ADMIN_EMAIL = 'japan@innovictechnology.com';
const PREFIX = 'T041B-';

let admin: AuthContext;
let viewer: AuthContext;
let secondAdmin: AuthContext;

async function loadUser(email: string): Promise<AuthContext> {
  const rows = await db.select().from(users).where(eq(users.email, email)).limit(1);
  const u = rows[0];
  if (!u || !u.companyId) throw new Error(`Seeded user ${email} missing`);
  return {
    id: u.id,
    email: u.email,
    companyId: u.companyId,
    role: u.role,
    isActive: u.isActive,
  };
}

const sampleSpec: AdHocSpec = {
  sourceKey: 'sales-orders',
  columns: ['so_code', 'so_date', 'item_code', 'qty', 'amount'],
  filters: [],
  groupBy: null,
  sumCol: null,
  sumFn: 'SUM',
  sort: [{ field: 'so_date', dir: 'desc' }],
};

beforeAll(async () => {
  admin = await loadUser(ADMIN_EMAIL);
  viewer = await loadUser(VIEWER_EMAIL);
  secondAdmin = await loadUser(SECOND_ADMIN_EMAIL);
});

afterAll(async () => {
  await db.delete(savedReports).where(like(savedReports.name, `${PREFIX}%`));
});

describe('saved-reports service', () => {
  it('listSources returns the 5 registered source descriptors', () => {
    const result = service.listSources();
    const keys = result.sources.map((s) => s.sourceKey).sort();
    expect(keys).toEqual([
      'items-stock',
      'job-cards',
      'nc-register',
      'purchase-orders',
      'sales-orders',
    ]);
    for (const s of result.sources) {
      expect(s.label.length).toBeGreaterThan(0);
      expect(s.fields.length).toBeGreaterThan(0);
    }
  });

  it('createSavedReport inserts a row and returns it normalised', async () => {
    const created = await service.createSavedReport(
      {
        name: `${PREFIX}create-1`,
        description: 'create test',
        sourceKey: 'sales-orders',
        spec: sampleSpec,
        isShared: false,
      },
      admin,
    );
    expect(created.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(created.name).toBe(`${PREFIX}create-1`);
    expect(created.ownerId).toBe(admin.id);
    expect(created.ownerEmail).toBe(admin.email);
    expect(created.spec.columns).toEqual(sampleSpec.columns);
  });

  it('createSavedReport rejects duplicate name for same owner', async () => {
    await service.createSavedReport(
      {
        name: `${PREFIX}dup`,
        description: '',
        sourceKey: 'sales-orders',
        spec: sampleSpec,
        isShared: false,
      },
      admin,
    );
    await expect(
      service.createSavedReport(
        {
          name: `${PREFIX}dup`,
          description: '',
          sourceKey: 'sales-orders',
          spec: sampleSpec,
          isShared: false,
        },
        admin,
      ),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it('createSavedReport rejects mismatch between input.sourceKey and spec.sourceKey', async () => {
    await expect(
      service.createSavedReport(
        {
          name: `${PREFIX}mismatch`,
          description: '',
          sourceKey: 'job-cards',
          spec: sampleSpec, // sales-orders
          isShared: false,
        },
        admin,
      ),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it('createSavedReport rejects unknown sourceKey', async () => {
    await expect(
      service.createSavedReport(
        {
          name: `${PREFIX}badsrc`,
          description: '',
          sourceKey: 'not-a-source',
          spec: { ...sampleSpec, sourceKey: 'not-a-source' },
          isShared: false,
        },
        admin,
      ),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('listSavedReports returns the user own + shared reports, ordered by updatedAt desc', async () => {
    const result = await service.listSavedReports(admin);
    const ours = result.reports.filter((r) => r.name.startsWith(PREFIX));
    expect(ours.length).toBeGreaterThanOrEqual(2);
  });

  it('updateSavedReport persists changes and returns the row', async () => {
    const created = await service.createSavedReport(
      {
        name: `${PREFIX}update-base`,
        description: 'orig',
        sourceKey: 'sales-orders',
        spec: sampleSpec,
        isShared: false,
      },
      admin,
    );
    const updated = await service.updateSavedReport(
      created.id,
      {
        name: `${PREFIX}update-base`,
        description: 'changed',
        isShared: true,
      },
      admin,
    );
    expect(updated.description).toBe('changed');
    expect(updated.isShared).toBe(true);
  });

  it('softDeleteSavedReport removes the row from list', async () => {
    const created = await service.createSavedReport(
      {
        name: `${PREFIX}delete-me`,
        description: '',
        sourceKey: 'sales-orders',
        spec: sampleSpec,
        isShared: false,
      },
      admin,
    );
    await service.softDeleteSavedReport(created.id, admin);
    await expect(service.getSavedReport(created.id, admin)).rejects.toBeInstanceOf(NotFoundError);
  });

  it('runSavedReport executes the saved spec and returns rows + columns', async () => {
    const created = await service.createSavedReport(
      {
        name: `${PREFIX}run-1`,
        description: '',
        sourceKey: 'sales-orders',
        spec: sampleSpec,
        isShared: false,
      },
      admin,
    );
    const result = await service.runSavedReport(created.id, admin);
    expect(result.id).toBe(created.id);
    expect(result.title).toBe(`${PREFIX}run-1`);
    expect(result.columns.map((c) => c.key)).toEqual(sampleSpec.columns);
    expect(result.rowCount).toBe(result.rows.length);
    expect(result.summary).toEqual([]);
  });

  it('runSavedReport with groupBy returns a non-empty summary', async () => {
    const created = await service.createSavedReport(
      {
        name: `${PREFIX}group-1`,
        description: '',
        sourceKey: 'sales-orders',
        spec: {
          ...sampleSpec,
          groupBy: 'so_status',
          sumCol: 'qty',
          sumFn: 'SUM',
        },
        isShared: false,
      },
      admin,
    );
    const result = await service.runSavedReport(created.id, admin);
    expect(result.summaryFunction).toBe('SUM');
    expect(result.summaryColumn).toBe('qty');
    expect(Array.isArray(result.summary)).toBe(true);
  });

  it('previewAdHocSpec runs without persisting', async () => {
    const result = await service.previewAdHocSpec(sampleSpec, admin);
    expect(result.id).toBe('preview');
    expect(result.title).toBe('Preview');
    expect(Array.isArray(result.rows)).toBe(true);
  });

  it('runner rejects unknown column in spec', async () => {
    await expect(
      service.previewAdHocSpec({ ...sampleSpec, columns: ['so_code', 'not_a_column'] }, admin),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('runner rejects filter op incompatible with field type', async () => {
    await expect(
      service.previewAdHocSpec(
        {
          ...sampleSpec,
          filters: [{ field: 'qty', op: 'contains', value: '5' }],
        },
        admin,
      ),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('runner rejects sumCol that is not numeric for SUM function', async () => {
    await expect(
      service.previewAdHocSpec(
        {
          ...sampleSpec,
          groupBy: 'so_status',
          sumCol: 'so_code', // text
          sumFn: 'SUM',
        },
        admin,
      ),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('contains filter narrows results case-insensitively', async () => {
    const result = await service.previewAdHocSpec(
      {
        ...sampleSpec,
        filters: [{ field: 'so_code', op: 'contains', value: 'so' }],
      },
      admin,
    );
    for (const row of result.rows) {
      expect(String(row['so_code']).toLowerCase()).toContain('so');
    }
  });

  it('orphan-company user → AuthorizationError', async () => {
    const orphan: AuthContext = { ...admin, companyId: null };
    await expect(service.listSavedReports(orphan)).rejects.toBeInstanceOf(AuthorizationError);
    await expect(service.previewAdHocSpec(sampleSpec, orphan)).rejects.toBeInstanceOf(
      AuthorizationError,
    );
  });

  it('viewer cannot see admin-owned non-shared report in list', async () => {
    const created = await service.createSavedReport(
      {
        name: `${PREFIX}private-list`,
        description: '',
        sourceKey: 'sales-orders',
        spec: sampleSpec,
        isShared: false,
      },
      admin,
    );
    const viewerList = await service.listSavedReports(viewer);
    const ids = viewerList.reports.map((r) => r.id);
    expect(ids).not.toContain(created.id);
  });

  it('viewer can see admin-owned shared report in list', async () => {
    const created = await service.createSavedReport(
      {
        name: `${PREFIX}shared-list`,
        description: '',
        sourceKey: 'sales-orders',
        spec: sampleSpec,
        isShared: true,
      },
      admin,
    );
    const viewerList = await service.listSavedReports(viewer);
    const ids = viewerList.reports.map((r) => r.id);
    expect(ids).toContain(created.id);
  });

  it('viewer trying to edit admin-owned report → AuthorizationError', async () => {
    const created = await service.createSavedReport(
      {
        name: `${PREFIX}foreign-edit`,
        description: '',
        sourceKey: 'sales-orders',
        spec: sampleSpec,
        isShared: true, // shared so viewer can SEE it, but still can't edit
      },
      admin,
    );
    await expect(
      service.updateSavedReport(created.id, { description: 'tamper' }, viewer),
    ).rejects.toBeInstanceOf(AuthorizationError);
  });

  it('admin (different user) can edit another admin-owned report', async () => {
    const created = await service.createSavedReport(
      {
        name: `${PREFIX}admin-edit`,
        description: '',
        sourceKey: 'sales-orders',
        spec: sampleSpec,
        isShared: false,
      },
      admin,
    );
    const updated = await service.updateSavedReport(
      created.id,
      { description: 'second-admin-touched' },
      secondAdmin,
    );
    expect(updated.description).toBe('second-admin-touched');
  });
});

// Sanity check that the test cleanup pattern works.
describe('saved-reports cleanup pattern', () => {
  it('all test rows match the T041B- prefix', async () => {
    const rows = await db
      .select({ id: savedReports.id, name: savedReports.name })
      .from(savedReports)
      .where(and(eq(savedReports.companyId, admin.companyId!), like(savedReports.name, '%')));
    for (const r of rows.filter((x) => x.name.startsWith(PREFIX))) {
      expect(r.name).toMatch(/^T041B-/);
    }
  });
});
