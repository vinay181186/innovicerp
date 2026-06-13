// SO Documents service tests. Attach a file_registry row to an existing SO in
// the dev DB, exercise read/create/delete + the viewer authorization guard,
// then hard-delete the test rows in afterAll (they carry a TEST marker in the
// file name and write no activity_log).

import { and, eq, inArray, isNull } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { db } from '../../db/client';
import { fileRegistry, salesOrders } from '../../db/schema';
import type { AuthContext } from '../../db/with-user-context';
import { AuthorizationError, NotFoundError } from '../../lib/errors';
import { users } from '../../db/schema';
import * as service from './service';

const ADMIN_EMAIL = 'innovic.technology@gmail.com';
const VIEWER_EMAIL = 'viewer@innovic.test';
const TEST_FILE_PREFIX = 'SODOC_TEST_';

let admin: AuthContext;
let viewer: AuthContext;
let companyId: string;
let soId: string;
let soCode: string;
const createdIds: string[] = [];

beforeAll(async () => {
  const adminRows = await db.select().from(users).where(eq(users.email, ADMIN_EMAIL)).limit(1);
  const a = adminRows[0];
  if (!a || !a.companyId) throw new Error('Seed admin missing');
  admin = { id: a.id, email: a.email, companyId: a.companyId, role: a.role, isActive: a.isActive };
  companyId = a.companyId;

  const viewerRows = await db.select().from(users).where(eq(users.email, VIEWER_EMAIL)).limit(1);
  const v = viewerRows[0];
  if (!v || !v.companyId) throw new Error('Seed viewer missing');
  viewer = { id: v.id, email: v.email, companyId: v.companyId, role: v.role, isActive: v.isActive };

  const soRows = await db
    .select()
    .from(salesOrders)
    .where(and(eq(salesOrders.companyId, companyId), isNull(salesOrders.deletedAt)))
    .limit(1);
  const so = soRows[0];
  if (!so) throw new Error('No sales order in dev DB to attach a document to');
  soId = so.id;
  soCode = so.code;
});

afterAll(async () => {
  if (createdIds.length) {
    await db.delete(fileRegistry).where(inArray(fileRegistry.id, createdIds));
  }
});

describe('so-documents service', () => {
  it('createSoDocument rejects a viewer', async () => {
    await expect(
      service.createSoDocument(
        {
          salesOrderId: soId,
          soCodeText: soCode,
          category: 'other',
          fileName: `${TEST_FILE_PREFIX}viewer.pdf`,
          storagePath: 'company/so-docs/x.pdf',
        },
        viewer,
      ),
    ).rejects.toBeInstanceOf(AuthorizationError);
  });

  it('createSoDocument registers a file and returns it', async () => {
    const created = await service.createSoDocument(
      {
        salesOrderId: soId,
        soCodeText: soCode,
        category: 'drawing',
        docType: 'Rev A',
        fileName: `${TEST_FILE_PREFIX}drawing.pdf`,
        storagePath: 'company/so-docs/drawing.pdf',
        fileSize: 2048,
        fileType: 'application/pdf',
      },
      admin,
    );
    createdIds.push(created.id);
    expect(created.source).toBe('registry');
    expect(created.salesOrderId).toBe(soId);
    expect(created.category).toBe('drawing');
    expect(created.fileSize).toBe(2048);
    expect(created.status).toBe('active');
    expect(created.uploadedByText).toBe(ADMIN_EMAIL);
  });

  it('getSoDocumentDetail returns the SO header + the registered file', async () => {
    const detail = await service.getSoDocumentDetail(soId, admin);
    expect(detail.so.id).toBe(soId);
    expect(detail.files.some((f) => createdIds.includes(f.id))).toBe(true);
    expect(detail.totals.fileCount).toBeGreaterThanOrEqual(1);
    expect(detail.totals.totalSize).toBeGreaterThanOrEqual(2048);
  });

  it('getSoDocumentDetail throws NotFoundError for unknown SO', async () => {
    await expect(
      service.getSoDocumentDetail('00000000-0000-0000-0000-000000000000', admin),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('listSoDocumentOverview includes the SO with a positive file count', async () => {
    const overview = await service.listSoDocumentOverview(admin);
    const row = overview.rows.find((r) => r.salesOrderId === soId);
    expect(row).toBeDefined();
    expect(row?.fileCount).toBeGreaterThanOrEqual(1);
  });

  it('deleteSoDocument soft-deletes the file; detail no longer lists it', async () => {
    const id = createdIds[0]!;
    const res = await service.deleteSoDocument(id, admin);
    expect(res.id).toBe(id);
    const detail = await service.getSoDocumentDetail(soId, admin);
    expect(detail.files.some((f) => f.id === id)).toBe(false);
  });

  it('deleteSoDocument throws NotFoundError for unknown id', async () => {
    await expect(
      service.deleteSoDocument('00000000-0000-0000-0000-000000000000', admin),
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});
